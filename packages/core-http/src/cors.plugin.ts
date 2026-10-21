import { Elysia } from 'elysia'

export interface CorsOptions {
  /** Origins allowed to call the API from a browser (`CORS_ORIGINS`); any other origin gets no CORS header at all. */
  origins: readonly string[]
  methods: readonly string[]
  allowedHeaders: readonly string[]
  exposedHeaders: readonly string[]
  maxAgeSeconds: number
}

/**
 * CORS as DOC-50 §5.3 states it: one origin per environment, credentials on, a fixed header list. A request from another
 * origin (and the native apps, which send none) gets **no** `Access-Control-*` header, preflight included. The reference
 * `@elysiajs/cors` answers `Allow-Credentials: true` to every origin, which AG-25 forbids, so this is written here.
 */
export const corsPlugin = (options: CorsOptions) => {
  const allowed = new Set(options.origins)
  return new Elysia({ name: 'cors' }).onRequest(({ request, set }) => {
    set.headers.vary = 'Origin'
    const origin = request.headers.get('origin')
    if (!origin || !allowed.has(origin)) {
      // A preflight from an unknown origin is answered here with nothing, so no route sees it.
      if (request.method === 'OPTIONS' && request.headers.has('access-control-request-method'))
        return new Response(null, { status: 204, headers: { vary: 'Origin' } })
      return
    }
    set.headers['access-control-allow-origin'] = origin
    set.headers['access-control-allow-credentials'] = 'true'
    set.headers['access-control-expose-headers'] = options.exposedHeaders.join(', ')
    if (request.method !== 'OPTIONS' || !request.headers.has('access-control-request-method'))
      return
    return new Response(null, {
      status: 204,
      headers: {
        vary: 'Origin',
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': options.methods.join(', '),
        'access-control-allow-headers': options.allowedHeaders.join(', '),
        'access-control-max-age': String(options.maxAgeSeconds),
      },
    })
  })
}
