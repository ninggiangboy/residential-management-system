import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@opentelemetry/api'

export interface RequestContext {
  requestId: string
  correlationId: string
  userId?: string
  /** Who the request acts for, filled by the guards once the token is verified; ids only, never a name, phone or email (DOC-42 §8.1). */
  accountKind?: 'staff' | 'resident'
  accountId?: string
  role?: string
  buildingId?: string
  unitId?: string
  /** The client address by the rule of DOC-39 §5.3, `null` when it is absent or not an address; read by `AuditApi.record` (DOC-35 §3.2). */
  ip?: string | null
  /** `User-Agent`, cut at 500 characters. */
  userAgent?: string | null
  /** OTel context holding the request's span (set by the tracing plugin; new spans and outbox writes hang under it). */
  otel?: Context
}

const storage = new AsyncLocalStorage<RequestContext>()

export const requestContext = {
  get: () => storage.getStore(),
  run: <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn),
  /** For use in HTTP framework hooks (where the handler cannot be wrapped in a callback). */
  enter: (ctx: RequestContext) => storage.enterWith(ctx),
}
