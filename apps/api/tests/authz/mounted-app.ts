import { createLogger } from '@core/telemetry'
import { buildApp } from '../../src/app'
import { loadAppConfig } from '../../src/bootstrap/config'
import { localEnv } from '../../src/bootstrap/config/support'
import { createContainer } from '../../src/bootstrap/container'

/** The `App` as `main.ts` mounts it, with no reachable database: reading the routes sends no request (DOC-39 §4.1). */
export function mountedApp() {
  const config = loadAppConfig(localEnv({ DATABASE_URL: 'postgres://rms_app:x@127.0.0.1:1/rms' }))
  return buildApp(createContainer(config, createLogger('silent')))
}
