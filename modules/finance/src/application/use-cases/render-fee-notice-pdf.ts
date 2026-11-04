import { type Clock, type Log, NotFoundError } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import {
  type BuildingId,
  type BuildingScope,
  buildingToday,
  type MetricsPort,
  NO_METRICS,
} from '@rms/shared-types'
import type { ChargeRepository } from '../../domain/charge-repository'
import { InvalidTransitionError } from '../../domain/errors'
import {
  type FeeNoticeContext,
  type FeeNoticeSource,
  feeNoticeFileName,
  feeNoticeHash,
  feeNoticeKey,
  toFeeNoticeInput,
} from '../fee-notice-input'
import type { LogoSource } from '../logo-source'
import type { PdfLanguage, PdfRenderer } from '../pdf-renderer'
import type { BuildingCalendar, NoticeContextSource } from '../ports'
import { systemFileActor } from '../system-file-actor'

/**
 * `RenderFeeNoticePdf` is the use case behind E-176 and the bulk job E-99 (DOC-34 §6.3, §8.1; DR-292, DR-293). A
 * published or closed batch with an open or paid charge takes the cached path: the hash of §8.1 names the file, a hit
 * is read (only when the caller wants the bytes) and a miss renders and stores once. A draft batch and charge render
 * every time with the draft mark and store nothing. A void charge and a recalled batch are 409 `invalid_transition`.
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

/** The files the use case touches (DOC-37 §3): find a cached PDF, read it, and store a fresh one. */
type FeeNoticeFiles = Pick<FilesApi, 'read' | 'storeGenerated' | 'findByOwnerRef'>

const ACTION = 'fee_notice_pdf'

/** The use case of DOC-34 §6.3, §8.1 (DR-292, DR-293). One `execute` per charge. */
export class RenderFeeNoticePdf {
  constructor(
    private readonly charges: ChargeRepository,
    private readonly files: FeeNoticeFiles,
    private readonly logo: LogoSource,
    private readonly renderer: PdfRenderer,
    private readonly noticeContext: NoticeContextSource,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
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
      const bytes = await this.render(buildingId, source, context, language)
      this.logger.info(
        { event: 'fee_notice.draft', buildingId, chargeId },
        'fee notice draft rendered',
      )
      return { cached: false, fileId: null, bytes, fileName }
    }
    return this.cached(source, context, buildingId, language, wantBytes, fileName)
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

  /** The cached path of §8.1 (DR-293): the key names the file; a hit reads it, a miss renders and stores one. */
  private async cached(
    source: FeeNoticeSource,
    context: FeeNoticeContext,
    buildingId: string,
    language: PdfLanguage,
    wantBytes: boolean,
    fileName: string,
  ): Promise<RenderFeeNoticePdfResult> {
    const hash = feeNoticeHash(toFeeNoticeInput(source, context, language, null))
    const ownerRef = feeNoticeKey(source.batch.id, source.charge.unitId, language, hash)
    const cached = await this.files.findByOwnerRef(buildingId, {
      module: 'finance',
      purpose: 'fee_notice_pdf',
      ownerRef,
    })
    if (cached) {
      // A hit that avoided a render is counted here, and only here (DOC-34 §14).
      this.metrics.inc('pdf_renders_total', { document: 'fee_notice', outcome: 'cached' })
      const bytes = wantBytes
        ? await this.files.read(systemFileActor(buildingId), cached.fileId, {
            module: 'finance',
            purpose: 'fee_notice_pdf',
            ownerRef,
          })
        : null
      return { cached: true, fileId: cached.fileId, bytes, fileName }
    }
    // A miss: render and store, both outside any transaction (§8.4 for the logo).
    const rendered = await this.render(buildingId, source, context, language)
    const stored = await this.files.storeGenerated({
      buildingId,
      module: 'finance',
      purpose: 'fee_notice_pdf',
      ownerRef,
      mime: 'application/pdf',
      body: rendered,
    })
    return { cached: false, fileId: stored.fileId, bytes: rendered, fileName }
  }

  /** Read the logo (§8.4) and render one notice (DOC-34 §2); neither touches a transaction. */
  private async render(
    buildingId: string,
    source: FeeNoticeSource,
    context: FeeNoticeContext,
    language: PdfLanguage,
  ): Promise<Uint8Array> {
    const logo = await this.logo.load(buildingId, context.building.logoFile)
    return this.renderer.render(toFeeNoticeInput(source, context, language, logo))
  }
}
