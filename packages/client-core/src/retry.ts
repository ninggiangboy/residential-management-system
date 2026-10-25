import type { ApiError } from './errors'

/** What `retryPlan` needs to know about the request that failed. */
export interface RetryRequest {
  method: string
  /** The request carries an `Idempotency-Key`. */
  hasKey: boolean
}

export type RetryPlan =
  | { retry: true; afterMs: number }
  | { retry: false; reason: 'not_sent' | 'exhausted' | 'final' }

const GET_DELAYS_MS = [1000, 3000] as const
const DEFAULT_WAIT_S = 2

const isRead = (method: string) => method === 'GET' || method === 'HEAD'
const waitMs = (error: Pick<ApiError, 'retryAfter'>, fallbackSeconds = DEFAULT_WAIT_S) =>
  (error.retryAfter ?? fallbackSeconds) * 1000

/**
 * The retry table of DOC-55 §4.3 (mirrors DOC-42 §9), a pure function so it has a table test (CL-01…CL-05). `attempt` is the number of
 * retries already made. The fetcher owns retries: the query library never retries (`retry: 0`).
 */
export function retryPlan(
  request: RetryRequest,
  error: Pick<ApiError, 'status' | 'code' | 'retryAfter'>,
  attempt: number,
): RetryPlan {
  const { status, code } = error
  const network = status === 0
  if (isRead(request.method)) {
    if (network || status === 502 || status === 503 || status === 504) {
      const delay = GET_DELAYS_MS[attempt]
      if (delay === undefined) return { retry: false, reason: 'exhausted' }
      return { retry: true, afterMs: error.retryAfter === undefined ? delay : waitMs(error) }
    }
    if (status === 500) return attempt < 1 ? { retry: true, afterMs: 1000 } : exhausted()
    if (status === 429) return attempt < 2 ? { retry: true, afterMs: waitMs(error) } : exhausted()
    return { retry: false, reason: 'final' }
  }
  if (request.hasKey) {
    const retriable = status === 429 || status === 503 || network || code === 'request_in_progress'
    if (!retriable) return { retry: false, reason: 'final' }
    if (attempt >= 3) return exhausted()
    return {
      retry: true,
      afterMs: code === 'request_in_progress' ? waitMs(error, 1) : waitMs(error),
    }
  }
  // A write without a key: only a 429 is safe to repeat (the bucket refused it before the use case ran).
  if (status === 429) return attempt < 1 ? { retry: true, afterMs: waitMs(error) } : exhausted()
  if (network || status >= 500) return { retry: false, reason: 'not_sent' }
  return { retry: false, reason: 'final' }
}

const exhausted = (): RetryPlan => ({ retry: false, reason: 'exhausted' })
