import { type Clock, type Log, NotFoundError } from '@core/kernel'
import { type BuildingId, type BuildingScope, buildingToday } from '@rms/shared-types'
import type { ChargeRepository } from '../../domain/charge-repository'
import { InvalidTransitionError } from '../../domain/errors'
import type { FeeNoticeCache } from '../fee-notice-cache'
import { type FeeNoticeContext, type FeeNoticeSource, feeNoticeFileName } from '../fee-notice-input'
import type { PdfLanguage } from '../pdf-renderer'
import type { BuildingCalendar, NoticeContextSource } from '../ports'

/**
 * `RenderFeeNoticePdf` is the use case behind E-176 and the bulk job E-99 (DOC-34 §6.3, §8.1; DR-292, DR-293). A
 * published or closed batch with an open or paid charge takes the cached path: `FeeNoticeCache` names the file by the
 * hash of §8.1, reads a hit (only when the caller wants the bytes) and renders and stores a miss once. A draft batch
 * and charge render every time with the draft mark and store nothing. A void charge and a recalled batch are 409
 * `invalid_transition`.
 *
 * Nothing here opens a transaction: a render and a bucket call never hold one (DOC-12 §8.2), so there is no swap
 * either — the file is found by its key, not by a pointer (DR-293).
 */

/** What the caller wants rendered (DOC-34 §6.3): the charge, the language and whether the bytes are needed back. */
export interface RenderFeeNoticePdfInput {
  readonly buildingId: string
  readonly chargeId: string
  readonly language: PdfLanguage
  /** `true` reads a cached PDF's bytes and returns a fresh render's; `false` (the bulk job) only fills the cache. */
  readonly wantBytes: boolean
}

/** What happened (DOC-34 §8.1), with the file and the bytes the caller can use. */
export interface RenderFeeNoticePdfResult {
  /** `true` when an unchanged notice was found under its key and no render happened (PD-17). */
  readonly cached: boolean
  /** The stored file; `null` for a draft, which is never stored (DR-293). */
  readonly fileId: string | null
  readonly bytes: Uint8Array | null
  /** The `Content-Disposition` name of §8.1. */
  readonly fileName: string
}

const ACTION = 'fee_notice_pdf'

/** The use case of DOC-34 §6.3, §8.1 (DR-292, DR-293). One `execute` per charge. */
export class RenderFeeNoticePdf {
  constructor(
    private readonly charges: ChargeRepository,
    private readonly cache: FeeNoticeCache,
    private readonly noticeContext: NoticeContextSource,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {}

  async execute(input: RenderFeeNoticePdfInput): Promise<RenderFeeNoticePdfResult> {
    const { buildingId, chargeId, language, wantBytes } = input
    const scope: BuildingScope = { buildingId: buildingId as BuildingId }

    const source = await this.charges.findForNotice(scope, chargeId)
    if (!source) throw new NotFoundError()

    const fileName = feeNoticeFileName(source.batch.code, source.charge.unitCode)
    // DOC-34 §6.3: a recalled batch and a void charge may not be rendered; both are 409 `invalid_transition`.
    if (source.batch.status === 'recalled')
      throw new InvalidTransitionError('fee_batch', 'recalled', ACTION)
    if (source.charge.status === 'void') throw new InvalidTransitionError('charge', 'void', ACTION)
    const draft = source.batch.status === 'draft'
    if (!draft && source.charge.status !== 'open' && source.charge.status !== 'paid')
      throw new InvalidTransitionError('charge', source.charge.status, ACTION)

    const context = await this.context(source, buildingId, draft)
    if (draft) {
      // DR-293: a draft is never cached — its lines change and its notice carries the draft mark (PD-06).
      const bytes = await this.cache.render(buildingId, source, context, language)
      this.logger.info(
        { event: 'fee_notice.draft', buildingId, chargeId },
        'fee notice draft rendered',
      )
      return { cached: false, fileId: null, bytes, fileName }
    }
    const { cached, fileId, bytes } = await this.cache.get(
      buildingId,
      source,
      context,
      language,
      wantBytes,
    )
    return { cached, fileId, bytes, fileName }
  }

  /** The building block, the unit's owner and the issue day (DOC-34 §6.1, DR-292): the published day, or today for a draft. */
  private async context(
    source: FeeNoticeSource,
    buildingId: string,
    draft: boolean,
  ): Promise<FeeNoticeContext> {
    const building = await this.noticeContext.building(buildingId)
    const ownerNames = await this.noticeContext.ownerNames(buildingId, [source.charge.unitId])
    const timeZone = await this.calendar.timeZone(buildingId)
    const issueDate =
      draft || source.batch.publishedAt === null
        ? buildingToday(this.clock.now(), timeZone)
        : buildingToday(source.batch.publishedAt, timeZone)
    return { building, ownerName: ownerNames.get(source.charge.unitId) ?? null, issueDate }
  }
}
