/**
 * The persistence of the bulk fee notice job (DOC-34 §9.1, §9.2; DR-293, DR-294). A port in `domain/` (DOC-12 §4.5): the
 * request insert, the latest-job read, the per-building claim and the fenced writes of the worker. Every method carries
 * the building scope; the worker's writes are keyed by the claimed row of that scope, so `saveProgress`, `finishReady`
 * and `finishFailed` take the `ClaimedJob` and its `attempts` fence. The Drizzle adapter is in
 * `infrastructure/persistence/`.
 */
import type { BuildingScope } from '@rms/shared-types'

/** The languages a fee notice prints in (DOC-34 §5, FR-36.1). */
export type FeeNoticeLanguage = 'vi' | 'en' | 'both'

/** The job's state (ck_fee_notice_job_status, DOC-34 §9.2). */
export type FeeNoticeJobStatus = 'queued' | 'running' | 'ready' | 'failed'

/** One attempt's lease, in seconds (DR-294, DOC-34 §9.2); the lease and the attempt limit are code constants. */
export const FEE_NOTICE_LEASE_SECONDS = 120

/** How many times the worker claims a job before it gives up (DR-294, DOC-34 §9.2). */
export const FEE_NOTICE_MAX_ATTEMPTS = 3

/** The charges the work loop reads per chunk (DOC-34 §9.2 phase 1); the loop itself is the next slice. */
export const FEE_NOTICE_CHUNK = 20

/** One `finance.fee_notice_job` row as the request and the status answer read it (DOC-34 §9.1). */
export interface FeeNoticeJobRow {
  readonly id: string
  readonly batchId: string
  readonly status: FeeNoticeJobStatus
  readonly language: FeeNoticeLanguage
  readonly unitTotal: number
  readonly unitDone: number
  /** `finance.fee_notice_job.zip_file`: the stored ZIP of a `ready` job. */
  readonly zipFile: string | null
  /** `ck_fee_notice_job_failed`: `{ code, … }` on a `failed` row, else `null`. */
  readonly error: unknown
  readonly createdAt: Date
  readonly finishedAt: Date | null
}

/** The insert of one request (DOC-34 §9.1 step 2). */
export interface RequestFeeNoticeJobInput {
  readonly id: string
  readonly batchId: string
  readonly language: FeeNoticeLanguage
  readonly requestedBy: string
}

/** What the request answered: the job, and whether this call created it (a repeat returns the active one, FNM-111). */
export interface FeeNoticeJobRequest {
  readonly job: FeeNoticeJobRow
  readonly created: boolean
}

/** The job a worker claimed, with the `attempts` fence every later write of the run carries (DOC-34 §9.2, PD-24). */
export interface ClaimedJob {
  readonly id: string
  readonly buildingId: string
  readonly batchId: string
  readonly language: FeeNoticeLanguage
  readonly unitTotal: number
  readonly unitDone: number
  readonly cursorCharge: string | null
  /** `finance.fee_notice_job.attempts` after the claim: the fence of every write of this run. */
  readonly attempts: number
}

/** The progress and the renewed lease of one phase-1 chunk (DOC-34 §9.2 step 3). */
export interface SaveProgressInput {
  readonly unitDone: number
  readonly cursorCharge: string | null
}

export interface FeeNoticeJobRepository {
  /**
   * DOC-34 §9.1 step 2 (DR-293): one `INSERT … SELECT count(*) … ON CONFLICT DO NOTHING RETURNING`. The count is the
   * open and paid charges of the batch (the job's `unit_total`). Zero rows means a job of the batch is already `queued`
   * or `running` (`uq_fee_notice_job_batch_active`, FNM-111); the answer is that one with `created: false`.
   */
  request(scope: BuildingScope, input: RequestFeeNoticeJobInput): Promise<FeeNoticeJobRequest>
  /** E-177: the latest job of the batch, or `null` when it has none (another building's id included). */
  latestForBatch(scope: BuildingScope, batchId: string): Promise<FeeNoticeJobRow | null>
  /** DOC-34 §9.2 step 1: mark the building's jobs whose attempts are spent and lease expired `failed`; the row count. */
  giveUpExhausted(buildingId: string): Promise<number>
  /** DOC-34 §9.2 step 2: claim one job of the building (`FOR UPDATE SKIP LOCKED`), or `null` when there is none. */
  claim(buildingId: string): Promise<ClaimedJob | null>
  /** DOC-34 §9.2 step 3: save the progress and renew the lease, fenced by `attempts`; false on zero rows (PD-24). */
  saveProgress(claim: ClaimedJob, input: SaveProgressInput): Promise<boolean>
  /** DOC-34 §9.2 phase 2: set the job `ready` with its ZIP, fenced by `attempts`; false on zero rows (PD-24). */
  finishReady(claim: ClaimedJob, input: { readonly zipFile: string }): Promise<boolean>
  /** Set the job `failed` with its `{ code, … }` error, fenced by `attempts`; false on zero rows (PD-24). */
  finishFailed(claim: ClaimedJob, input: { readonly error: unknown }): Promise<boolean>
}
