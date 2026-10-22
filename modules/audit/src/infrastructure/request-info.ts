import { requestContext } from '@core/context'
import type { RequestInfoProvider } from '../application/ports'
import { MAX_USER_AGENT_LENGTH } from '../domain/entry'

/** The request context set by the HTTP plugins; a job or an inbox handler has none, so every field is `null` (DOC-35 §3.2). */
export const requestInfoFromContext: RequestInfoProvider = () => {
  const context = requestContext.get()
  return {
    requestId: context?.requestId ?? null,
    ip: context?.ip ?? null,
    userAgent: context?.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
  }
}
