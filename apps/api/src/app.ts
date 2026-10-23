import {
  API_PREFIX,
  clientInfoPlugin,
  corsPlugin,
  createClientIp,
  errorHandlerPlugin,
  maintenancePlugin,
  openapiDocumentation,
  requestContextPlugin,
  requestLogPlugin,
  routePlugin,
} from '@core/http'
import { liveRoute, readyRoute } from '@core/runtime'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import type { Container } from './bootstrap/container'

/** DOC-50 §5.3: the headers the web CMS may send and read. */
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'If-Match',
  'Idempotency-Key',
  'X-Unit-Id',
  'X-App-Id',
  'X-App-Version',
  'X-Request-Id',
  'X-Requested-With',
  'Accept-Language',
]
const EXPOSED_HEADERS = [
  'X-Request-Id',
  'ETag',
  'Retry-After',
  'Idempotent-Replayed',
  'Location',
  'Content-Disposition',
]

/**
 * The client IP rule of DOC-39 §5.3, built once from the configuration. A fallback to a proxy address means the deployment
 * is misconfigured, so it is logged.
 */
export const clientIpOf = ({ config, logger }: Pick<Container, 'config' | 'logger'>) =>
  createClientIp({
    trustedProxyHops: config.core.TRUSTED_PROXY_HOPS,
    trustedProxyCidrs: config.core.TRUSTED_PROXY_CIDRS,
    onFallback: (fields) => logger.warn(fields, 'client_ip_fallback'),
  })

/**
 * Shared by `main.ts` and the tests. `App` is the type the clients infer their Eden Treaty client from, and the only thing
 * they may import from this package (`import type`, DOC-12 §5.4). The plugins are mounted in the order of the gates of
 * DOC-50 §7: request context → error handler → CORS → maintenance → OpenAPI → health → one `.use()` per module.
 */
export function buildApp(container: Container) {
  const { config, logger, maintenance, database, lifecycle } = container
  return (
    routePlugin({ prefix: API_PREFIX })
      .use(requestContextPlugin)
      .use(clientInfoPlugin(clientIpOf(container)))
      .use(requestLogPlugin({ logger, clientIp: clientIpOf(container) }))
      .use(errorHandlerPlugin({ logger }))
      .use(
        corsPlugin({
          origins: config.http.CORS_ORIGINS,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ALLOWED_HEADERS,
          exposedHeaders: EXPOSED_HEADERS,
          maxAgeSeconds: 600,
        }),
      )
      .use(maintenancePlugin(maintenance))
      .use(
        openapi({
          enabled: config.http.OPENAPI_ENABLED,
          path: '/docs',
          specPath: '/openapi.json',
          documentation: openapiDocumentation([]),
        }),
      )
      // The public readiness route names no dependency (DR-145); the ops port lists every check (ops.ts).
      .group('/health', (health) =>
        health.use(
          readyRoute({
            database,
            maintenance,
            stopping: () => lifecycle.stopping,
            timeoutMs: config.core.READINESS_DB_TIMEOUT_MS,
            exposeChecks: false,
          }),
        ),
      )
      .use(container.identity.routes)
      .use(container.building.routes)
    // One static `.use()` per module on purpose: Eden Treaty infers the client types from this chain, and a loop over the
    // module list would turn them into `any`. A test fails when a module with routes is not mounted here.
  )
}

export type App = ReturnType<typeof buildApp>

/**
 * The ops port (`OPS_PORT`): `/health/live`, `/health/ready` with every check, and later `/metrics` (P1-18). Bound to the
 * Docker network and never routed by Caddy or the Tunnel (DR-07), so it has no prefix, no CORS and no maintenance gate.
 */
export function buildOpsApp({ config, database, maintenance, lifecycle, runtime }: Container) {
  // The worker also answers for its relay: a stalled loop is not ready (DOC-38 §5.2).
  const checks = config.core.APP_ROLES.includes('worker') ? [runtime.relayCheck] : []
  return new Elysia().group('/health', (health) =>
    health.use(liveRoute()).use(
      readyRoute({
        database,
        checks,
        maintenance,
        stopping: () => lifecycle.stopping,
        timeoutMs: config.core.READINESS_DB_TIMEOUT_MS,
        exposeChecks: true,
      }),
    ),
  )
}
