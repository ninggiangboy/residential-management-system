import type { Clock } from '@core/core'
import type { Logger } from '@core/telemetry'
import type { Schedule } from './schedule'

/** How a job stays safe when two workers run it (DOC-38 §3.2). */
export type JobMode = 'claim' | 'lock' | 'snapshot'

/** Thrown by `ctx.withLock` / `ctx.snapshot` when another worker is inside a transaction of this job: the run stops and writes nothing. */
export class JobLockBusy extends Error {
  constructor(readonly job: string) {
    super(`another worker holds the lock of job ${job}`)
    this.name = 'JobLockBusy'
  }
}

export interface JobContext {
  readonly clock: Clock
  /** Aborted at shutdown: a batch job checks it between batches and returns. */
  readonly signal: AbortSignal
  readonly logger: Logger
  /** True when an operator started the run (`jobs:run`); the row gets `details.manual = true`. */
  readonly manual: boolean
  /** True while maintenance mode is on: finish the batch in hand and return (DOC-38 §5.3). */
  paused(): boolean
  /** The buildings the job loops over, each with the id to build its `BuildingScope` from. */
  buildings(): Promise<readonly { readonly buildingId: string }[]>
  /**
   * `lock` mode: runs `fn` in one transaction whose first statement is `pg_try_advisory_xact_lock(hashtext('job:<name>'))`;
   * throws `JobLockBusy` when the lock is taken. Call it once per batch: the lock goes with the transaction (DR-121).
   */
  withLock<T>(fn: () => Promise<T>): Promise<T>
  /** `snapshot` mode: one `REPEATABLE READ READ ONLY` transaction that sets its own `statement_timeout`, takes the lock, runs `fn`, commits. */
  snapshot<T>(fn: () => Promise<T>): Promise<T>
}

/** `did` is the rows or objects worked on (0 = idle); `details` is the counts of the run (`{"deleted": 1204}`). */
export interface JobResult {
  did: number
  details: Record<string, unknown>
}

/** A job: a function with a name, a schedule and a mode, declared in its module's `jobs` (DOC-12 §4.2, DOC-38 §3). */
export interface JobDefinition {
  /** `^[a-z][a-z0-9_]{2,40}$`, unique; also the lock key and `job_run.name`. */
  readonly name: string
  readonly schedule: Schedule
  readonly mode: JobMode
  /** Catch-up window of a clock job (`JOB_<NAME>_GRACE_MINUTES`); 0 = none. */
  readonly graceMinutes: number
  run(ctx: JobContext): Promise<JobResult>
}

export const JOB_NAME = /^[a-z][a-z0-9_]{2,40}$/

/** One row of `building.job_run` (DOC-17 §3.2), written once at the end of a run. */
export interface JobRunRecord {
  id: string
  name: string
  startedAt: Date
  finishedAt: Date
  status: 'succeeded' | 'failed'
  details: Record<string, unknown>
}

/** The port the runner writes through; `building` owns the table (DOC-07 §6.2). */
export interface JobRunStore {
  record(run: JobRunRecord): Promise<void>
  /** The latest `finished_at` of a succeeded run of each job: the restart query (DOC-38 §3.3, JB-11). */
  lastSuccesses(): Promise<ReadonlyMap<string, Date>>
}
