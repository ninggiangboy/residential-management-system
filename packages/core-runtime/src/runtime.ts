import type { Database } from '@core/db'
import type { Clock, IdGenerator } from '@core/kernel'
import {
  InProcessMessageBus,
  OutboxRelay,
  type OutboxSettings,
  type RetryClass,
} from '@core/messaging'
import type { Logger } from '@core/telemetry'
import type { AppModule, ModuleManifest } from './app-module'
import type { HealthCheck } from './health'
import type { JobRunStore } from './job'
import { type JobRunEvent, JobRuntime } from './job-runtime'
import { MaintenanceMode, MaintenanceStore } from './maintenance-mode'

/** Attempts per retry class (DOC-09 §4.2, `OUTBOX_*_MAX_ATTEMPTS`). */
export type AttemptsByClass = Record<RetryClass, number>

export interface RuntimeOptions {
  /** The installed modules, in install order. */
  modules: readonly AppModule[]
  /** Their manifests: the retry class of each event type. */
  manifests: readonly ModuleManifest[]
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Logger
  relay: OutboxSettings & { attempts: AttemptsByClass }
  jobs: {
    store: JobRunStore
    timeZone: string
    tickSeconds: number
    buildings?: () => Promise<readonly { readonly buildingId: string }[]>
    onRun?: (event: JobRunEvent) => void
  }
  /** The pool size: the relay keeps its parallelism below it. */
  dbPoolMax: number
  /** `handler_outcomes_total` (DOC-40 §4.1): called once per handler per message. */
  onHandler?: (handler: string, outcome: 'ok' | 'deferred' | 'failed') => void
  maintenance: {
    pollIntervalMs: number
    /** Replaces where the maintenance flag is read from (tests: no shared state with other processes on the database). */
    store?: Pick<MaintenanceStore, 'read'>
  }
}

/**
 * What runs the installed modules: the in-process bus with their handlers, the outbox relay over their outboxes, the job
 * runtime, the maintenance flag and the shutdown. The same for every app, whichever modules it installs.
 */
export function createRuntime({
  modules,
  manifests,
  database,
  clock,
  ids,
  logger,
  relay: relaySettings,
  jobs: jobSettings,
  dbPoolMax,
  onHandler,
  maintenance: m,
}: RuntimeOptions) {
  const docs = modules.flatMap((module) => module.docs ?? [])

  const bus = new InProcessMessageBus(logger, onHandler)
  for (const handler of modules.flatMap((module) => module.handlers ?? [])) bus.subscribe(handler)

  // A type that is not named in any `outboxPolicies` is `default`.
  const classOf = new Map<string, RetryClass>(
    manifests.flatMap((manifest) => Object.entries(manifest.outboxPolicies ?? {})),
  )
  const relay = new OutboxRelay(
    database,
    modules.flatMap((module) => (module.outbox ? [module.outbox] : [])),
    bus,
    logger,
    {
      pollIntervalMs: relaySettings.pollIntervalMs,
      batchSize: relaySettings.batchSize,
      concurrency: Math.min(relaySettings.concurrency, Math.max(1, dbPoolMax - 4)),
      leaseSeconds: relaySettings.leaseSeconds,
      policy: (type) => ({ maxAttempts: relaySettings.attempts[classOf.get(type) ?? 'default'] }),
      backoffBaseSeconds: relaySettings.backoffBaseSeconds,
      backoffMaxSeconds: relaySettings.backoffMaxSeconds,
      deferBudgetMs: relaySettings.deferBudgetHours * 3600_000,
      retentionDays: relaySettings.retentionDays,
      cleanupIntervalMs: relaySettings.cleanupIntervalMinutes * 60_000,
    },
  )

  const jobs = new JobRuntime({
    jobs: modules.flatMap((module) => module.jobs ?? []),
    database,
    clock,
    ids,
    logger,
    store: jobSettings.store,
    timeZone: jobSettings.timeZone,
    tickSeconds: jobSettings.tickSeconds,
    buildings: jobSettings.buildings,
    onRun: jobSettings.onRun,
  })

  // Not started here (tests build containers too): `main.ts` reads it once before serving, then polls.
  const maintenance = new MaintenanceMode(
    m.store ?? new MaintenanceStore(database),
    logger,
    m.pollIntervalMs,
  )

  /** The readiness check of the worker: the relay finished a pass in the last `max(10 × poll, 10 s)` (DOC-38 §5.2). */
  const relayCheck: HealthCheck = {
    name: 'relay',
    ping: async () => {
      const maxAgeMs = Math.max(10 * relaySettings.pollIntervalMs, 10_000)
      if (!relay.isFresh(maxAgeMs)) throw new Error('the relay has not finished a pass recently')
    },
  }

  /** Maintenance mode stops everything that starts work on its own: the relay and the jobs (a run in progress finishes its batch). */
  const pauseWorker = async () => {
    jobs.pause()
    await relay.pause()
  }
  const resumeWorker = () => {
    relay.resume()
    jobs.resume()
  }
  /** Closes what holds the HTTP server open (SSE streams). Idempotent; call it before stopping the server. */
  const closeLive = async () => {
    for (const module of modules) await module.close?.()
  }

  return {
    /** The API doc sections the modules describe. */
    docs,
    bus,
    relay,
    jobs,
    maintenance,
    relayCheck,
    /**
     * Starts what a worker-role process runs: the outbox relay and the jobs. Follows maintenance mode from then on: paused
     * while it is on (right away if it already is), running again when it ends.
     */
    async startWorker() {
      // Paused before `start`, so the first batch is not claimed and no job starts (DOC-38 §5.1 step 5).
      if (maintenance.active) await pauseWorker()
      relay.start()
      await jobs.start()
      // One transition at a time: on → off → on in quick succession must not interleave.
      let transition: Promise<unknown> = Promise.resolve()
      maintenance.onChange((active) => {
        transition = transition
          .then(active ? pauseWorker : resumeWorker)
          .catch((err) => logger.error({ err, active }, 'worker_maintenance_switch_failed'))
      })
    },
    /**
     * The shutdown order of DOC-38 §5.4: no run starts, the relay finishes the batch in flight, running jobs get `timeoutMs`
     * to return. Returns the jobs still running when the time was up; the caller exits 1 then.
     */
    async stopWorker(timeoutMs: number): Promise<string[]> {
      await relay.pause()
      const stillRunning = await jobs.stop(timeoutMs)
      await relay.stop()
      return stillRunning
    },
    closeLive,
    async close() {
      maintenance.stop()
      await closeLive()
      await database.close()
    },
  }
}

export type Runtime = ReturnType<typeof createRuntime>
