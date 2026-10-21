import { createLogger } from '@core/telemetry'
import { buildApp, buildOpsApp } from './app'
import {
  DATABASE_WAIT_MS,
  DatabaseUnreachableError,
  EXIT_DATABASE_UNREACHABLE,
  waitForDatabase,
} from './bootstrap/boot'
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

// Before anything is served: a process started in the middle of a deploy comes up already in maintenance mode.
await container.maintenance.refresh()
container.maintenance.start()
if (container.maintenance.active) logger.warn({}, 'maintenance_on')

const api = core.APP_ROLES.includes('api')
  ? buildApp(container).listen({ port: core.PORT, hostname: '0.0.0.0' })
  : null
if (api) logger.info({ port: core.PORT }, 'api_listening')

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting_down')
  // Readiness answers 503 `stopping` from here on, so the proxy drains this process before it stops (DOC-38 §5.4).
  container.lifecycle.stopping = true
  await api?.stop()
  await container.close()
  await ops.stop()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
