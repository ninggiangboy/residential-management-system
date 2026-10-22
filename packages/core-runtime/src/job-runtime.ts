import type { Database } from '@core/db'
import type { Clock, IdGenerator } from '@core/kernel'
import type { Logger } from '@core/telemetry'
import { sql } from 'drizzle-orm'
import {
  JOB_NAME,
  type JobContext,
  type JobDefinition,
  JobLockBusy,
  type JobResult,
  type JobRunStore,
} from './job'
import { decide, isClockSchedule, validateSchedule } from './schedule'

/** What a run came to, for the metrics of DOC-38 §8 (`job_runs_total`, `job_duration_seconds`, `job_last_success_timestamp`). */
export interface JobRunEvent {
  name: string
  status: 'succeeded' | 'failed' | 'skipped_locked'
  durationMs: number
  did: number
  /** A `job_run` row was written (DOC-38 §3.5). */
  recorded: boolean
}

export interface JobRuntimeOptions {
  jobs: readonly JobDefinition[]
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Logger
  store: JobRunStore
  /** `JOBS_TIME_ZONE`. */
  timeZone: string
  /** `JOBS_SCHEDULER_TICK_SECONDS`. */
  tickSeconds: number
  /** The buildings of the deployment, for the jobs that loop over them. */
  buildings?: () => Promise<readonly { readonly buildingId: string }[]>
  onRun?: (event: JobRunEvent) => void
  /** Tests inject a fixed source of randomness for the first-tick delay. */
  random?: () => number
}

const SNAPSHOT_STATEMENT_TIMEOUT = '300s'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500)

/**
 * Starts, runs and stops the jobs of the installed modules (DOC-38 §3). `every` jobs have one timer each and are never
 * overlapped; clock jobs are decided by one scheduler loop (`decide`); every run ends in at most one `job_run` row (§3.5).
 * Maintenance mode pauses it: nothing starts, a run in progress finishes its batch.
 */
export class JobRuntime {
  private readonly byName = new Map<string, JobDefinition>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly timers: ReturnType<typeof setTimeout>[] = []
  private readonly startedSlot = new Map<string, Date>()
  private readonly lastSuccessAt = new Map<string, Date>()
  private abort = new AbortController()
  private paused = false
  private started = false
  private scheduler?: ReturnType<typeof setInterval>

  constructor(private readonly options: JobRuntimeOptions) {
    for (const job of options.jobs) {
      if (!JOB_NAME.test(job.name)) throw new Error(`invalid job name "${job.name}"`)
      if (this.byName.has(job.name)) throw new Error(`duplicate job name "${job.name}"`)
      validateSchedule(job.schedule)
      this.byName.set(job.name, job)
    }
  }

  /** The last success of each job: restored from the store at start, moved by every success (the gauge's value). */
  get lastSuccess(): ReadonlyMap<string, Date> {
    return this.lastSuccessAt
  }

  get names(): string[] {
    return [...this.byName.keys()]
  }

  /** Names of the runs in progress. */
  get active(): string[] {
    return [...this.running.keys()]
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  /** Reads the restart query once, starts the interval timers and the scheduler loop; the first tick does the catch-up. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.abort = new AbortController()
    const { store, logger } = this.options
    try {
      for (const [name, at] of await store.lastSuccesses()) this.lastSuccessAt.set(name, at)
    } catch (err) {
      // A missing history only costs a repeated run inside the grace window: every job is idempotent (DR-121).
      logger.error({ err }, 'job_restart_query_failed')
    }
    for (const job of this.byName.values())
      if (job.schedule.kind === 'every') this.startInterval(job)
    if ([...this.byName.values()].some((job) => isClockSchedule(job.schedule))) {
      this.scheduler = setInterval(() => this.tick(), this.options.tickSeconds * 1000)
      this.scheduler.unref()
      this.tick()
    }
  }

  /**
   * Stops starting runs and waits for the ones in progress, at most `timeoutMs`. Returns the jobs that were still running
   * when the time was up (the caller logs them and exits 1, DOC-38 §5.4).
   */
  async stop(timeoutMs: number): Promise<string[]> {
    this.started = false
    if (this.scheduler) clearInterval(this.scheduler)
    this.scheduler = undefined
    for (const timer of this.timers.splice(0)) clearTimeout(timer)
    this.abort.abort()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    await Promise.race([Promise.allSettled([...this.running.values()]), timedOut])
    clearTimeout(timer)
    return this.active
  }

  /** `jobs:run`: one run now, under the same lock, with `details.manual = true`; resolves with its event. */
  async runNow(name: string): Promise<JobRunEvent> {
    const job = this.byName.get(name)
    if (!job) throw new Error(`unknown job "${name}"`)
    return this.execute(job, true)
  }

  private startInterval(job: JobDefinition): void {
    if (job.schedule.kind !== 'every') return
    const interval = job.schedule.seconds * 1000
    const random = this.options.random ?? Math.random
    // The first tick comes after a random delay so a restart does not start every job in the same second.
    const first = setTimeout(
      () => {
        this.launch(job)
        const timer = setInterval(() => this.launch(job), interval)
        timer.unref()
        this.timers.push(timer as unknown as ReturnType<typeof setTimeout>)
      },
      Math.floor(random() * interval),
    )
    first.unref()
    this.timers.push(first)
  }

  /** One scheduler tick: every clock job whose last slot is owed a run starts it. */
  private tick(): void {
    if (this.paused || !this.started) return
    const now = this.options.clock.now()
    for (const job of this.byName.values()) {
      if (!isClockSchedule(job.schedule) || this.running.has(job.name)) continue
      const decision = decide({
        now,
        schedule: job.schedule,
        timeZone: this.options.timeZone,
        graceMs: job.graceMinutes * 60_000,
        lastSuccess: this.lastSuccessAt.get(job.name) ?? null,
        startedSlot: this.startedSlot.get(job.name) ?? null,
      })
      if (!decision.run) continue
      this.startedSlot.set(job.name, decision.slot)
      this.options.logger.info(
        { job: job.name, slot: decision.slot.toISOString(), reason: decision.reason },
        'job_slot_due',
      )
      this.launch(job)
    }
  }

  /** Starts a run unless one is in progress or maintenance is on; a dropped tick is not queued. */
  private launch(job: JobDefinition): void {
    if (this.paused || this.running.has(job.name)) return
    const run = this.execute(job, false)
      .then(() => undefined)
      .catch((err) => this.options.logger.error({ err, job: job.name }, 'job_runtime_failed'))
      .finally(() => this.running.delete(job.name))
    this.running.set(job.name, run)
  }

  private context(job: JobDefinition, manual: boolean): JobContext {
    const { database, clock, logger } = this.options
    const lockKey = `job:${job.name}`
    const takeLock = async () => {
      const rows = await database.executor.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked`,
      )
      if (!rows[0]?.locked) throw new JobLockBusy(job.name)
    }
    return {
      clock,
      signal: this.abort.signal,
      logger: logger.child({ job: job.name }),
      manual,
      paused: () => this.paused,
      buildings: () => this.options.buildings?.() ?? Promise.resolve([]),
      withLock: (fn) =>
        database.run(async () => {
          await takeLock()
          return fn()
        }),
      snapshot: (fn) =>
        database.transaction(
          async () => {
            await database.executor.execute(
              sql`select set_config('statement_timeout', ${SNAPSHOT_STATEMENT_TIMEOUT}, true)`,
            )
            await takeLock()
            return fn()
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        ),
    }
  }

  private async execute(job: JobDefinition, manual: boolean): Promise<JobRunEvent> {
    const { clock, logger, onRun } = this.options
    const startedAt = clock.now()
    const begin = performance.now()
    let result: JobResult | undefined
    let failure: unknown
    try {
      result = await job.run(this.context(job, manual))
    } catch (err) {
      failure = err
    }
    const durationMs = Math.round(performance.now() - begin)
    if (failure instanceof JobLockBusy) {
      // Another worker is inside a transaction of this job: nothing is written, the gauge does not move (DOC-38 §3.5).
      const event: JobRunEvent = {
        name: job.name,
        status: 'skipped_locked',
        durationMs,
        did: 0,
        recorded: false,
      }
      onRun?.(event)
      return event
    }
    const status = failure === undefined ? 'succeeded' : 'failed'
    const did = result?.did ?? 0
    // A schedule of one hour or longer always writes a row; a sub-hourly job only when it worked or failed.
    const recorded = status === 'failed' || job.schedule.kind !== 'every' || did > 0
    if (status === 'failed') logger.error({ err: failure, job: job.name }, 'job_failed')
    if (recorded)
      await this.record(
        job,
        startedAt,
        status,
        status === 'failed' ? { error: errorText(failure) } : (result?.details ?? {}),
        manual,
      )
    if (status === 'succeeded') this.lastSuccessAt.set(job.name, clock.now())
    const event: JobRunEvent = { name: job.name, status, durationMs, did, recorded }
    onRun?.(event)
    return event
  }

  private async record(
    job: JobDefinition,
    startedAt: Date,
    status: 'succeeded' | 'failed',
    details: Record<string, unknown>,
    manual: boolean,
  ): Promise<void> {
    const { store, clock, ids, logger } = this.options
    try {
      await store.record({
        id: ids.next(),
        name: job.name,
        startedAt,
        finishedAt: clock.now(),
        status,
        details: manual ? { ...details, manual: true } : details,
      })
    } catch (err) {
      logger.error({ err, job: job.name }, 'job_run_record_failed')
    }
  }
}
