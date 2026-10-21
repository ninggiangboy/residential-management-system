import { Elysia } from 'elysia'
import { API_PREFIX } from './constants'
import { errorCodes } from './error-codes'

const HEALTH_PREFIX = `${API_PREFIX}/health/`

/**
 * While maintenance mode is on, every request but the health probes is answered 503 `maintenance` + `Retry-After` before
 * it reaches a route, so nothing new starts while the process drains (DOC-50 gate 2). Mount it after CORS: the browser must
 * still be able to read the 503. Callers that retry (the payment gateway, the clients) simply come back after the deploy.
 */
export const maintenancePlugin = (mode: { readonly active: boolean }, retryAfterSeconds = 30) =>
  new Elysia({ name: 'maintenance' }).onRequest(({ request, set }) => {
    if (!mode.active) return
    if (new URL(request.url).pathname.startsWith(HEALTH_PREFIX)) return
    errorCodes.set(request, 'maintenance')
    set.status = 503
    set.headers['retry-after'] = String(retryAfterSeconds)
    set.headers['cache-control'] = 'no-store'
    return {
      error: {
        code: 'maintenance',
        message: 'The system is being updated. Try again in a few minutes.',
      },
    }
  })
