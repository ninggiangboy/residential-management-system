import { requestContext } from '@core/context'
import type { Logger } from '@core/telemetry'
import { Elysia } from 'elysia'
import { errorCodes } from './error-codes'

const started = new WeakMap<Request, number>()

/** 401 codes that are worth a `warn` (DOC-42 §8.2); a plain `unauthenticated` is routine. */
const WARN_UNAUTHORIZED = new Set(['invalid_signature', 'invalid_credentials', 'step_up_failed'])

type Level = 'debug' | 'info' | 'warn' | 'error'

/** DOC-42 §8.2: expected outcomes of normal use are `info`, abuse signals `warn`, 5xx `error`; probes `debug`. */
export function levelOf(status: number, code: string | undefined, probe: boolean): Level {
  if (status >= 500) return 'error'
  if (probe) return 'debug'
  if (status === 429 || status === 426 || status === 423) return 'warn'
  if (status === 403 && code === 'forbidden') return 'warn'
  if (status === 401 && code !== undefined && WARN_UNAUTHORIZED.has(code)) return 'warn'
  return 'info'
}

export interface RequestLogOptions {
  logger: Logger
  /** `clientIp` of `createClientIp`; asked only for the lines that carry an address. */
  clientIp: (
    request: Request,
    server: { requestIP(request: Request): { address: string } | null } | null,
  ) => string
}

/**
 * One line per request, at the end (DOC-42 §8.1): `msg: "request"`, the route **template**, status, duration, the error
 * code of a non-2xx answer and the ids of the context. Never a query string, a header or a body.
 */
export const requestLogPlugin = ({ logger, clientIp }: RequestLogOptions) =>
  new Elysia({ name: 'request-log' })
    .onRequest(({ request }) => {
      started.set(request, performance.now())
    })
    .onAfterResponse({ as: 'global' }, ({ request, route, set, server }) => {
      const status = typeof set.status === 'number' ? set.status : 200
      const code = errorCodes.get(request)
      const path = new URL(request.url).pathname
      const probe = path.includes('/health/')
      const level = levelOf(status, code, probe)
      const begin = started.get(request)
      const context = requestContext.get()
      const showIp = path.includes('/auth/') || [401, 403, 423, 429].includes(status)
      logger[level](
        {
          method: request.method,
          route: route || 'unmatched',
          status,
          ...(code ? { code } : {}),
          durationMs: begin === undefined ? undefined : Math.round(performance.now() - begin),
          accountKind: context?.accountKind,
          accountId: context?.accountId,
          role: context?.role,
          buildingId: context?.buildingId,
          unitId: context?.unitId,
          ...(showIp ? { ip: clientIp(request, server) } : {}),
        },
        'request',
      )
    })
