import { type Clock, NotFoundError, requireRole } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { BuildingScope, StaffContext, StaffRole } from '@rms/shared-types'
import type { FeeBatchReader } from '../../domain/fee-batch-reader'
import type {
  FeeNoticeJobRepository,
  FeeNoticeJobRow,
} from '../../domain/fee-notice-job-repository'

/** The signed GET of a ready ZIP lasts 15 minutes (DOC-34 §9.1, DR-123); the store's own default is the same 900 s. */
const ZIP_URL_TTL_SECONDS = 900

/** The Manager's and the Admin's (DOC-34 §9.1, DR-293). */
export const FEE_NOTICE_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** The ZIP of a ready job (DOC-34 §9.1, PD-37): a 15-minute signed GET, or `{ expired: true }` after the 7-day purge. */
export type FeeNoticeZip =
  | {
      readonly url: string
      readonly expiresAt: string
      readonly fileName: string
      readonly size: number
    }
  | { readonly expired: true }

/** The body of E-177 (DOC-34 §9.1): the latest job of a batch. */
export interface FeeNoticeJobView {
  readonly id: string
  readonly batchId: string
  readonly status: FeeNoticeJobRow['status']
  readonly language: FeeNoticeJobRow['language']
  readonly unitTotal: number
  readonly unitDone: number
  readonly zip: FeeNoticeZip | null
  readonly error: unknown
  readonly createdAt: Date
  readonly finishedAt: Date | null
}

/**
 * The reads of the bulk fee notices (E-177, DOC-34 §9.1): the latest job of a batch with its ZIP. A query service
 * (DOC-12 §4.5): no use case file per read. The URL is signed for 15 minutes (DR-123); after the 7-day purge removes the
 * file the answer is `{ expired: true }` (PD-37).
 */
export class FeeNoticeQueries {
  constructor(
    private readonly jobs: FeeNoticeJobRepository,
    private readonly batches: Pick<FeeBatchReader, 'findBatch'>,
    private readonly files: Pick<FilesApi, 'signedUrl' | 'findByOwnerRef'>,
    private readonly clock: Clock,
  ) {}

  /** E-177: the latest job of the caller's batch in the shape of §9.1; a batch with no job is 404. */
  async latestJob(staff: StaffContext, batchId: string): Promise<FeeNoticeJobView> {
    requireRole(staff, FEE_NOTICE_READ_ROLES)
    const job = await this.jobs.latestForBatch(staff.scope, batchId)
    if (!job) throw new NotFoundError()
    return {
      id: job.id,
      batchId: job.batchId,
      status: job.status,
      language: job.language,
      unitTotal: job.unitTotal,
      unitDone: job.unitDone,
      zip: await this.zip(staff.scope, job),
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    }
  }

  /** The ZIP of §9.1, or `null` while the job is not `ready` (PD-37). */
  private async zip(scope: BuildingScope, job: FeeNoticeJobRow): Promise<FeeNoticeZip | null> {
    if (job.status !== 'ready') return null
    if (job.zipFile === null) return { expired: true }
    const file = await this.files.findByOwnerRef(scope.buildingId, {
      module: 'finance',
      purpose: 'bulk_zip',
      ownerRef: zipOwnerRef(job),
    })
    if (!file) return { expired: true }
    const batch = await this.batches.findBatch(scope, job.batchId)
    const fileName = `${batch?.code ?? job.batchId}-${job.language}.zip`
    const url = await this.files.signedUrl(job.zipFile, { downloadName: fileName })
    if (!url) return { expired: true }
    return {
      url,
      expiresAt: new Date(this.clock.now().getTime() + ZIP_URL_TTL_SECONDS * 1000).toISOString(),
      fileName,
      size: file.size,
    }
  }
}

const zipOwnerRef = (job: FeeNoticeJobRow): string => `batch/${job.batchId}/zip/${job.id}.zip`
