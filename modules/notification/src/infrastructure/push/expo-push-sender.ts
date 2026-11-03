import type { Log } from '@core/kernel'
import { RetryLaterError } from '@core/messaging'
import { type MetricsPort, NO_METRICS, PUSH_CHUNK_SIZE_MAX } from '@rms/shared-types'
import type {
  ExpoMessage,
  ExpoReceipt,
  ExpoTicket,
  PushSender,
} from '../../application/push-sender'

/** The slice of `fetch` this client needs, so a test injects a plain function (DOC-31 §6.3). */
export type PushFetch = (url: string, init: RequestInit) => Promise<Response>

/** The two waits inside one attempt of §6.2 step 6: after 1 s and after 5 s, then the classification below. */
const RETRY_WAITS_MS = [1_000, 5_000] as const
/** The deferral of a 401: the token is wrong and a person must fix it (DOC-31 §6.2 step 6). */
const AUTH_RETRY_AFTER_MS = 300_000
/** `Retry-After` when Expo does not send a usable value (DOC-31 §6.2 step 6). */
const DEFAULT_RATE_LIMIT_MS = 30_000

/**
 * The Expo push client of DOC-31 §6.3 (DR-301): two `POST`s, one header and its own retry rule, instead of
 * `expo-server-sdk`. A network error, a 429 or a 5xx is retried inside the attempt after 1 s and after 5 s; a 429 that still
 * fails defers the message (`RetryLaterError` with `Retry-After` or 30 s), a 401 defers it 300 s and raises
 * `provider_auth_failed`, a 5xx or a network error throws, and any other 4xx is a defect and throws. The token is never
 * logged. The two `Authorization` and `Accept` headers and the timeout are those of §6.3.
 */
export class ExpoPushSender implements PushSender {
  constructor(
    private readonly fetch: PushFetch,
    private readonly baseUrl: string,
    private readonly accessToken: string | null,
    private readonly requestTimeoutMs: number,
    private readonly delay: (milliseconds: number) => Promise<void>,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  /** Sends `messages` in requests of at most `PUSH_CHUNK_SIZE_MAX` (100), one at a time, and joins the answers' tickets. */
  async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const tickets: ExpoTicket[] = []
    for (let i = 0; i < messages.length; i += PUSH_CHUNK_SIZE_MAX) {
      const chunk = messages.slice(i, i + PUSH_CHUNK_SIZE_MAX)
      const answer = await this.post<{ data?: ExpoTicket[] }>('/send', chunk)
      if (!Array.isArray(answer.data)) throw new Error('expo push /send: answer has no data array')
      tickets.push(...answer.data)
    }
    return tickets
  }

  /** Reads the receipts of up to 1,000 ticket ids in one request (DOC-31 §7 step 2). */
  async getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
    if (ids.length === 0) return {}
    const answer = await this.post<{ data?: Record<string, ExpoReceipt> }>('/getReceipts', { ids })
    return answer.data ?? {}
  }

  /** One `POST` with the retry rule of §6.2 step 6; the body is read only on a 2xx. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      if (attempt > 0) await this.delay(RETRY_WAITS_MS[attempt - 1]!)
      let response: Response
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        })
      } catch (error) {
        if (attempt < RETRY_WAITS_MS.length) continue
        throw new Error(`expo push ${path}: network error`, { cause: error })
      }
      if (response.status === 429) {
        if (attempt < RETRY_WAITS_MS.length) continue
        throw new RetryLaterError('expo push: rate limited', this.retryAfterMs(response))
      }
      if (response.status >= 500) {
        if (attempt < RETRY_WAITS_MS.length) continue
        throw new Error(`expo push ${path}: status ${response.status}`)
      }
      if (response.status === 401) {
        this.logger.error(
          { event: 'provider_auth_failed', provider: 'push', status: response.status },
          'provider_auth_failed',
        )
        this.metrics.inc('provider_auth_failed_total', { provider: 'push' })
        throw new RetryLaterError('expo push: authentication failed', AUTH_RETRY_AFTER_MS)
      }
      if (!response.ok) throw new Error(`expo push ${path}: status ${response.status}`)
      return (await response.json()) as T
    }
    // Unreachable: every branch above returns or throws on the last attempt; this satisfies the compiler.
    throw new Error(`expo push ${path}: exhausted retries`)
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`
    return headers
  }

  /** `Retry-After` in seconds, or the 30 s default when Expo does not send a usable value (DOC-31 §6.2 step 6). */
  private retryAfterMs(response: Response): number {
    const seconds = Number(response.headers.get('retry-after'))
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_MS
  }
}
