import { requestContext } from '@core/context'
import { Elysia } from 'elysia'

/** `X-Request-Id`: 1…64 characters of `[A-Za-z0-9._-]` (DOC-50 §5.1). */
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/

function pick(value: string | null): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined
}

/**
 * Assigns requestId/correlationId to each request (taken from a valid header, else a generated UUIDv7) and returns the
 * request id in `X-Request-Id` (DOC-50 gate 1, DOC-42 §3).
 */
export const requestContextPlugin = new Elysia({ name: 'request-context' }).onRequest(
  ({ request, set }) => {
    const requestId = pick(request.headers.get('x-request-id')) ?? Bun.randomUUIDv7()
    const correlationId = pick(request.headers.get('x-correlation-id')) ?? requestId
    requestContext.enter({ requestId, correlationId })
    set.headers['x-request-id'] = requestId
  },
)
