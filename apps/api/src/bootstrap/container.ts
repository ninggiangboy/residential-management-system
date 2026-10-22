import { Database } from '@core/db'
import { type Clock, type IdGenerator, SystemClock, UuidV7Generator } from '@core/kernel'
import { type AppModule, createRuntime, type MaintenanceStore, SqlJobRunStore } from '@core/runtime'
import type { Logger } from '@core/telemetry'
import type { Config } from './config'
import { MODULE_CATALOG } from './module-catalog'

/**
 * Replacements for what a test must not share with the real world (DOC-12 §5.1). The mailer, SMS sender, payment gateway,
 * storage and clock join this list with the tasks that add them.
 */
export interface ContainerOverrides {
  clock?: Clock
  ids?: IdGenerator
  /** Where the maintenance flag is read from (tests: no shared state with other processes on the database). */
  maintenanceStore?: Pick<MaintenanceStore, 'read'>
}

/** What the process says about its own life, read by `/health/ready` and by the shutdown. */
interface Lifecycle {
  /** True from the moment shutdown starts: readiness answers 503 `stopping` so the proxy drains the process first. */
  stopping: boolean
}

/**
 * The composition root: the only place that knows concrete adapters and how modules are wired together (DOC-12 §5.1).
 * Providers first, in the contract graph's order; a module's `install…` call goes in as its task lands.
 */
export function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const clock = overrides.clock ?? new SystemClock()
  const ids = overrides.ids ?? new UuidV7Generator()

  // One pool + one transaction context for all modules; modules differ only by PostgreSQL schema.
  const database = new Database({
    url: config.db.DATABASE_URL,
    poolMax: config.db.DB_POOL_MAX,
    prepare: config.db.DB_PREPARE,
  })

  /** Modules in install order. A module that needs others takes them from the `modules` of its own install call. */
  const installed: AppModule[] = []

  const { jobs: jobsConfig, db, core } = config
  const runtime = createRuntime({
    modules: installed,
    manifests: MODULE_CATALOG,
    database,
    clock,
    ids,
    logger,
    relay: {
      pollIntervalMs: jobsConfig.OUTBOX_POLL_INTERVAL_MS,
      batchSize: jobsConfig.OUTBOX_BATCH_SIZE,
      concurrency: jobsConfig.OUTBOX_CONCURRENCY,
      leaseSeconds: jobsConfig.OUTBOX_LEASE_SECONDS,
      backoffBaseSeconds: jobsConfig.OUTBOX_BACKOFF_BASE_SECONDS,
      backoffMaxSeconds: jobsConfig.OUTBOX_BACKOFF_MAX_SECONDS,
      deferBudgetHours: jobsConfig.OUTBOX_DEFER_BUDGET_HOURS,
      retentionDays: jobsConfig.OUTBOX_RETENTION_DAYS,
      cleanupIntervalMinutes: jobsConfig.OUTBOX_CLEANUP_INTERVAL_MINUTES,
      attempts: {
        default: jobsConfig.OUTBOX_MAX_ATTEMPTS,
        sms: jobsConfig.OUTBOX_SMS_MAX_ATTEMPTS,
        push: jobsConfig.OUTBOX_PUSH_MAX_ATTEMPTS,
        intent_cancel: jobsConfig.OUTBOX_INTENT_CANCEL_MAX_ATTEMPTS,
      },
    },
    jobs: {
      store: new SqlJobRunStore(database),
      timeZone: core.JOBS_TIME_ZONE,
      tickSeconds: jobsConfig.JOBS_SCHEDULER_TICK_SECONDS,
    },
    dbPoolMax: db.DB_POOL_MAX,
    maintenance: {
      pollIntervalMs: core.MAINTENANCE_POLL_INTERVAL_MS,
      store: overrides.maintenanceStore,
    },
  })
  const lifecycle: Lifecycle = { stopping: false }

  return {
    config,
    logger,
    clock,
    ids,
    database,
    runtime,
    maintenance: runtime.maintenance,
    lifecycle,
    /** Stops the timers and closes the pool. The HTTP servers and the worker are stopped first by the caller. */
    close: () => runtime.close(),
  }
}

export type Container = ReturnType<typeof createContainer>
