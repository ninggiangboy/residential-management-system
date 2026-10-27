import { createLogger } from '@core/telemetry'
import { buildApp, buildOpsApp } from './app'
import {
  DATABASE_WAIT_MS,
  DatabaseUnreachableError,
  EXIT_DATABASE_UNREACHABLE,
  waitForDatabase,
} from './bootstrap/boot'
import { EXIT_BOOT_GUARD_FAILED, reportBootGuard, runBootGuard } from './bootstrap/boot-guard'
import { ConfigError, EXIT_CONFIG_INVALID, loadAppConfig } from './bootstrap/config'
import { createContainer } from './bootstrap/container'

const service = (process.env.APP_ROLES ?? 'api,worker').replace(/\s/g, '')

let config: ReturnType<typeof loadAppConfig>
try {
  config = loadAppConfig()
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  // One line naming every failing key and rule, never a value (DOC-41 §17); the code of the boot guard, so Docker does not loop.
  createLogger('error', { service }).error({ problems: error.problems }, 'config_invalid')
  process.exit(EXIT_CONFIG_INVALID)
}

const logger = createLogger(config.core.LOG_LEVEL, { service })
const container = createContainer(config, logger)
const { core } = config

// The ops server answers first: `/health/ready` is 503 while the database is unreachable (DOC-38 §5.1, DR-161).
const ops = buildOpsApp(container).listen({ port: core.OPS_PORT, hostname: '0.0.0.0' })
logger.info({ port: core.OPS_PORT }, 'ops_listening')

try {
  await waitForDatabase(container.database, { logger })
} catch (error) {
  if (!(error instanceof DatabaseUnreachableError)) throw error
  logger.fatal({ err: error, waitedMs: DATABASE_WAIT_MS }, 'database_unreachable')
  process.exit(EXIT_DATABASE_UNREACHABLE)
}

// The boot guard (DOC-36 §10.1): a deployment that would let the fixed demo code open a real unit does not start in production or staging.
if (reportBootGuard(await runBootGuard(container.bootGuard), core.APP_ENV, logger)) {
  process.exit(EXIT_BOOT_GUARD_FAILED)
}

// Before anything is served: a process started in the middle of a deploy comes up already in maintenance mode.
await container.maintenance.refresh()
container.maintenance.start()
if (container.maintenance.active) logger.warn({}, 'maintenance_on')

const api = core.APP_ROLES.includes('api')
  ? buildApp(container).listen({ port: core.PORT, hostname: '0.0.0.0' })
  : null
if (api) logger.info({ port: core.PORT }, 'api_listening')

const worker = core.APP_ROLES.includes('worker')
if (worker) {
  await container.runtime.startWorker()
  logger.info({ jobs: container.runtime.jobs.names }, 'worker_started')
}

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting_down')
  // Readiness answers 503 `stopping` from here on, so the proxy drains this process before it stops (DOC-38 §5.4).
  container.lifecycle.stopping = true
  if (api) {
    // The proxy sees the 503 within one health interval: the port stays open until then, and the streams that hold the server
    // open are closed after it, so that their clients reconnect to the other process and not to this one (DR-272).
    if (core.SHUTDOWN_DRAIN_SECONDS > 0) await Bun.sleep(core.SHUTDOWN_DRAIN_SECONDS * 1000)
    await container.runtime.closeLive()
    await api.stop()
  }
  // The relay finishes the batch in flight and running jobs get WORKER_STOP_TIMEOUT_SECONDS to return (DOC-38 §5.4).
  const stillRunning = worker
    ? await container.runtime.stopWorker(core.WORKER_STOP_TIMEOUT_SECONDS * 1000)
    : []
  if (stillRunning.length > 0) logger.error({ jobs: stillRunning }, 'worker_stop_timed_out')
  await container.close()
  await ops.stop()
  process.exit(stillRunning.length > 0 ? 1 : 0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
