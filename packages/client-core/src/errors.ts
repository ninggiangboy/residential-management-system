/** What every non-2xx answer becomes (DOC-55 §6, DOC-42 §3). */
export interface ApiError {
  status: number
  /** `unknown` when the body is not the project's shape (an HTML 502 from a proxy, a network failure). */
  code: string
  /** The server's text, used only as a fallback when the catalog has no `error.<code>`. */
  message: string
  details?: unknown
  requestId: string
  /** Seconds, from `Retry-After`. */
  retryAfter?: number
  replayed: boolean
}

export const NETWORK_STATUS = 0

/** A thrown error that carries the parsed answer, so a caller can `catch` it and a mutation hook can read `.error`. */
export class ApiException extends Error {
  constructor(readonly error: ApiError) {
    super(error.message)
    this.name = 'ApiException'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const retryAfterOf = (header: string | null): number | undefined => {
  if (header === null) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** The same as `parseApiError` for a body that is already parsed (Eden Treaty hands over `error.status` and `error.value`). */
export function apiErrorFromBody(
  status: number,
  body: unknown,
  extra: { requestId?: string; retryAfter?: number; replayed?: boolean } = {},
): ApiError {
  const inner = isRecord(body) && isRecord(body.error) ? body.error : undefined
  return {
    status,
    code: typeof inner?.code === 'string' ? inner.code : 'unknown',
    message: typeof inner?.message === 'string' ? inner.message : '',
    details: inner?.details,
    requestId: extra.requestId || (typeof inner?.requestId === 'string' ? inner.requestId : ''),
    retryAfter: extra.retryAfter,
    replayed: extra.replayed ?? false,
  }
}

/**
 * Turns a non-2xx `Response` into an `ApiError` (CL-09). The body is the error shape of DOC-42 §3, `{ error: { code, message,
 * details?, requestId? } }`; anything else (HTML from a proxy, an empty body) keeps its status and gets the code `unknown`.
 */
export async function parseApiError(response: Response, fallbackRequestId = ''): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    body = undefined
  }
  const parsed = apiErrorFromBody(response.status, body, {
    requestId: response.headers.get('x-request-id') ?? fallbackRequestId,
    retryAfter: retryAfterOf(response.headers.get('retry-after')),
    replayed: response.headers.get('idempotent-replayed') === 'true',
  })
  return parsed.message === '' ? { ...parsed, message: response.statusText } : parsed
}

/** The error of a call that got no answer at all (DNS, offline, a reset connection, a timeout). */
export const networkError = (requestId: string, message = 'Network error'): ApiError => ({
  status: NETWORK_STATUS,
  code: 'network',
  message,
  requestId,
  replayed: false,
})
