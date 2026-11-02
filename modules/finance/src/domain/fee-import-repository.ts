import type { BuildingScope } from '@rms/shared-types'
import type { DraftChargeInsert } from './fee-batch'
import type { FeeImportJobRecord, FeeImportStatus, NewFeeImportJob } from './fee-import/job'
import type { FeeImportCommitted, FeeImportCounts } from './fee-import/types'

export interface FeeImportJobCursor {
  readonly createdAt: Date
  readonly id: string
}

export interface FeeImportJobFilter {
  /** `expired` includes a `validated` job past its `expires_at`; `validated` means not yet expired (E-169). */
  readonly status?: FeeImportStatus
  readonly after?: FeeImportJobCursor
  readonly limit: number
  readonly now: Date
}

/** A job without its preview rows: the history list reads only `result->'counts'` (E-169). */
export interface FeeImportJobSummary extends Omit<FeeImportJobRecord, 'result'> {
  readonly counts: FeeImportCounts
}

/**
 * `finance.import_job` and the statements of the fee import commit (DOC-15 §10.1, DOC-21 §4.5). Every method runs in the caller's
 * transaction, so a commit that fails after its claim gives the claim back.
 */
export interface FeeImportRepository {
  insertJob(scope: BuildingScope, job: NewFeeImportJob): Promise<void>
  findJob(scope: BuildingScope, id: string): Promise<FeeImportJobRecord | null>
  /** Step 1: `committed` only from `validated` and before `expires_at`; `null` when it did not apply (FNM-S08). */
  claimJob(scope: BuildingScope, id: string, now: Date): Promise<FeeImportJobRecord | null>
  /** What the commit wrote, kept in `result.committed` so a later "Save" answers it again (DOC-21 §4.5 step 1). */
  recordCommitted(scope: BuildingScope, id: string, committed: FeeImportCommitted): Promise<void>
  /** Newest first, keyset on `(created_at, id)`; one row more than `limit` tells the caller there is a next page. */
  listJobs(scope: BuildingScope, filter: FeeImportJobFilter): Promise<FeeImportJobSummary[]>
  /** Step 2: `version + 1 … WHERE status = 'draft'`, the new version, or `null` when the batch is no longer a draft (DQ-79). */
  lockDraftBatch(scope: BuildingScope, batchId: string): Promise<number | null>
  /** Step 3: the draft's charges, those added by hand included; the lines cascade (DR-12). Returns the charges removed. */
  deleteDraftCharges(scope: BuildingScope, batchId: string): Promise<number>
  /** Step 4: charges and lines in bulk, `INSERT … SELECT FROM unnest(…)` in chunks of 1,000 rows; returns what was written. */
  insertDraftCharges(
    scope: BuildingScope,
    charges: readonly DraftChargeInsert[],
  ): Promise<{ readonly charges: number; readonly lines: number }>
}
