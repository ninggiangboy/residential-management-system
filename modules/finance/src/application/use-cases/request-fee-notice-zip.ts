import { type IdGenerator, NotFoundError, requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { InvalidTransitionError } from '../../domain/errors'
import type { FeeBatchReader } from '../../domain/fee-batch-reader'
import type {
  FeeNoticeJobRepository,
  FeeNoticeJobRequest,
} from '../../domain/fee-notice-job-repository'
import type { PdfLanguage } from '../pdf-renderer'
import type { NoticeLanguageSource } from '../ports'

/** The Manager's and the Admin's (DOC-34 §9.1, DR-293). */
export const REQUEST_FEE_NOTICE_ZIP_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/fee-batches/{id}/pdf` (E-99, DOC-34 §9.1, DR-293): a `published` or `closed` batch of the caller's building
 * gets one bulk job over its open and paid charges; a draft or a recalled batch is 409 `invalid_transition`, another
 * building's batch 404. The body's `language` defaults to the building's `feeNoticeLanguage` (`NoticeLanguageSource`). The
 * insert is idempotent under `uq_fee_notice_job_batch_active` (FNM-111): a second request while one is `queued` or
 * `running` answers that one. No audit row and no `Idempotency-Key` (DOC-35 §3.6).
 */
export class RequestFeeNoticeZip {
  constructor(
    private readonly batches: Pick<FeeBatchReader, 'findBatch'>,
    private readonly jobs: FeeNoticeJobRepository,
    private readonly language: NoticeLanguageSource,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    staff: StaffContext,
    batchId: string,
    input: { readonly language?: PdfLanguage } = {},
  ): Promise<FeeNoticeJobRequest> {
    requireRole(staff, REQUEST_FEE_NOTICE_ZIP_ROLES)
    const batch = await this.batches.findBatch(staff.scope, batchId)
    if (!batch) throw new NotFoundError()
    if (batch.status !== 'published' && batch.status !== 'closed')
      throw new InvalidTransitionError('fee_batch', batch.status, 'request_fee_notice')
    const language = input.language ?? (await this.language.language(staff.buildingId))
    return this.jobs.request(staff.scope, {
      id: this.ids.next(),
      batchId,
      language,
      requestedBy: staff.staffId,
    })
  }
}
