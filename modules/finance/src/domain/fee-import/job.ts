import type { FeeImportPreview } from './types'

export type FeeImportStatus = 'validated' | 'failed' | 'committed' | 'expired'

/** A row of `finance.import_job` (DOC-15 §10.1): one fee file imported into one draft batch (`params.batchId`). */
export interface FeeImportJobRecord {
  readonly id: string
  readonly buildingId: string
  readonly kind: 'fee_batch'
  readonly status: FeeImportStatus
  /** The `file_object.id` of the upload, kept in `file_key`: `FilesApi` keeps the object key private (DR-86). */
  readonly fileId: string
  readonly fileName: string | null
  readonly batchId: string
  readonly result: FeeImportPreview
  readonly createdBy: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly committedAt: Date | null
}

export type NewFeeImportJob = Omit<FeeImportJobRecord, 'buildingId' | 'kind' | 'committedAt'>

/** The 24 hours a preview stays valid (DQ-51). */
export const IMPORT_TTL_MS = 24 * 3_600_000

/** A `validated` job past `expires_at` reads `expired` at once, before any job moves the row (E-73, E-169). */
export const statusAt = (
  job: Pick<FeeImportJobRecord, 'status' | 'expiresAt'>,
  now: Date,
): FeeImportStatus =>
  job.status === 'validated' && job.expiresAt.getTime() <= now.getTime() ? 'expired' : job.status
