import { type Clock, type IdGenerator, SystemClock, UuidV7Generator } from '@core/core'
import { Database } from '@core/db'
import { MaintenanceMode, MaintenanceStore } from '@core/runtime'
import type { Logger } from '@core/telemetry'
import type { Config } from './config'

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

  // Not started here (tests build containers too): `main.ts` reads it once before serving, then polls.
  const maintenance = new MaintenanceMode(
    overrides.maintenanceStore ?? new MaintenanceStore(database),
    logger,
    config.core.MAINTENANCE_POLL_INTERVAL_MS,
  )
  const lifecycle: Lifecycle = { stopping: false }

  return {
    config,
    logger,
    clock,
    ids,
    database,
    maintenance,
    lifecycle,
    /** Stops the timers and closes the pool. The HTTP servers are stopped first by the caller. */
    async close() {
      maintenance.stop()
      await database.close()
    },
  }
}

export type Container = ReturnType<typeof createContainer>
