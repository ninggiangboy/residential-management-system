import { isIP } from 'node:net'
import { requestContext } from '@core/context'
import { Elysia } from 'elysia'

type ClientIp = (
  request: Request,
  server: { requestIP(request: Request): { address: string } | null } | null,
) => string

const MAX_USER_AGENT = 500

/**
 * Puts the client address (the rule of DOC-39 §5.3, `createClientIp`) and the user agent on the request context, where
 * `AuditApi.record` reads them (DOC-35 §3.2). An address that is not an IP (`unknown`) is `null`, because the column is `inet`.
 * Mounted right after `requestContextPlugin`, which enters the context.
 */
export const clientInfoPlugin = (clientIp: ClientIp) =>
  new Elysia({ name: 'client-info' }).onRequest(({ request, server }) => {
    const context = requestContext.get()
    if (!context) return
    const ip = clientIp(request, server)
    context.ip = isIP(ip) === 0 ? null : ip
    context.userAgent = request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null
  })
