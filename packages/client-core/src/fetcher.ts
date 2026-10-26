import { classify } from './classify'
import { HEADERS, REFRESH_AHEAD_MS } from './constants'
import { ApiException, networkError, parseApiError } from './errors'
import { retryPlan } from './retry'
import { singleFlight } from './single-flight'

export interface ClientEnv {
  app: 'web' | 'resident' | 'staff'
  appVersion?: string
  /** Ends in `/api/v1` (DOC-41 §15). */
  baseUrl: string
}

/** The access token lives in memory only, on every platform (DOC-55 §5.1, DR-189). */
export interface TokenStore {
  accessToken(): string | null
  /** Milliseconds since the epoch, or `null` when no token. */
  accessExpiresAt(): number | null
  setAccessToken(token: { token: string; expiresAt: number } | null): void
  /** Mobile only: the new refresh token is written before any waiting call is replayed (CL-17). */
  saveRefreshCredential?(token: string): Promise<void>
}

/** UI hooks the fetcher awaits or calls (DOC-55 §4.1). */
export interface Gates {
  termsRequired(details: unknown): Promise<void>
  upgradeRequired(details: { minVersion?: string; storeUrl?: string }): void
  signedOut(reason: 'refresh_failed' | 'revoked' | 'user'): void
  language(): 'vi' | 'en'
  unitId(): string | null
}

/** What the platform transport answers to a refresh (DOC-55 §5.2). */
export type RefreshResult =
  | { status: 'ok'; accessToken: string; expiresAt: number; refreshToken?: string }
  /** 401 or 403: the session is over (reuse, revoked, locked). */
  | { status: 'denied' }
  /** No answer (network, timeout, 429, 5xx): not a sign-out. */
  | { status: 'unknown' }

export interface AuthenticatedFetchOptions {
  env: ClientEnv
  tokens: TokenStore
  gates: Gates
  refresh: () => Promise<RefreshResult>
  /** UUIDv4; injected so no global `crypto` is assumed. */
  randomId: () => string
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

const REFRESH_RETRY_DELAYS_MS = [1000, 3000] as const
const NO_BEARER = /\/(public\/|auth\/|client-errors)/
const COOKIE_AUTH = /\/auth\/(refresh|logout)$/

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

type Input = string | URL | Request

const urlOf = (input: Input): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** `error.requestId` is added from `X-Request-Id`, so the Eden `error.value` carries the "Reference: …" of the error screen (DOC-42 §9). */
async function withRequestId(response: Response): Promise<Response> {
  const id = response.headers.get('x-request-id')
  if (!id || !(response.headers.get('content-type') ?? '').includes('json')) return response
  try {
    const body: unknown = await response.clone().json()
    if (typeof body !== 'object' || body === null) return response
    const inner = (body as { error?: unknown }).error
    if (typeof inner !== 'object' || inner === null) return response
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response(JSON.stringify({ ...body, error: { ...inner, requestId: id } }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return response
  }
}

/**
 * The one fetcher of a client (DOC-55 §4.1): headers, the single-flight refresh, the replay after it, the retries of the retry
 * table, the terms and upgrade gates. A screen never repeats any of it. A non-2xx answer is returned as a `Response` (Eden turns it
 * into `error`); a call that got no answer after its retries throws `ApiException` with code `network`.
 */
export function createAuthenticatedFetch(options: AuthenticatedFetchOptions): typeof fetch {
  const { env, tokens, gates, randomId } = options
  const send = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep

  const refreshOnce = singleFlight(async (): Promise<RefreshResult> => {
    let result = await options.refresh()
    for (const delay of REFRESH_RETRY_DELAYS_MS) {
      if (result.status !== 'unknown') break
      await sleep(delay)
      result = await options.refresh()
    }
    if (result.status === 'ok') {
      if (result.refreshToken) await tokens.saveRefreshCredential?.(result.refreshToken)
      tokens.setAccessToken({ token: result.accessToken, expiresAt: result.expiresAt })
    } else if (result.status === 'denied') {
      tokens.setAccessToken(null)
      gates.signedOut('refresh_failed')
    }
    return result
  })

  const authenticatedFetch = async (input: Input, init: RequestInit = {}) => {
    const url = urlOf(input)
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const needsBearer = !NO_BEARER.test(url)
    const cookieAuth = env.app === 'web' && COOKIE_AUTH.test(url)
    const inherited = input instanceof Request ? input.headers : undefined
    const base = new Headers(inherited)
    for (const [name, value] of new Headers(init.headers)) base.set(name, value)
    // One key per intent: kept across every retry and the replay of this call (DOC-55 §4.3).
    const hasKey = base.has(HEADERS.idempotencyKey)

    let retries = 0
    let replayedAfterRefresh = false
    let termsHandled = false

    for (;;) {
      if (needsBearer && !replayedAfterRefresh) {
        const expiresAt = tokens.accessExpiresAt()
        if (
          tokens.accessToken() !== null &&
          expiresAt !== null &&
          expiresAt - now() < REFRESH_AHEAD_MS
        )
          await refreshOnce()
      }
      const requestId = randomId()
      const headers = new Headers(base)
      headers.set(HEADERS.language, gates.language())
      headers.set(HEADERS.appId, env.app)
      if (env.appVersion) headers.set(HEADERS.appVersion, env.appVersion)
      headers.set(HEADERS.requestId, requestId)
      const unitId = gates.unitId()
      if (unitId && url.includes('/me/')) headers.set(HEADERS.unitId, unitId)
      const token = tokens.accessToken()
      if (needsBearer && token) headers.set(HEADERS.authorization, `Bearer ${token}`)
      if (cookieAuth) headers.set(HEADERS.requestedWith, 'rms')

      let response: Response
      try {
        response = await send(url, {
          ...init,
          method,
          headers,
          ...(cookieAuth || env.app === 'web' ? { credentials: 'include' as const } : {}),
        })
      } catch (thrown) {
        if (thrown instanceof ApiException) throw thrown
        const error = networkError(requestId, thrown instanceof Error ? thrown.message : undefined)
        const plan = retryPlan({ method, hasKey }, error, retries)
        if (!plan.retry) throw new ApiException(error)
        retries++
        await sleep(plan.afterMs)
        continue
      }

      if (response.ok) return response
      const error = await parseApiError(response, requestId)

      if (error.code === 'unauthenticated' && needsBearer) {
        // A replay that is 401 again is a sign-out, never a second refresh (CL-12).
        if (replayedAfterRefresh) {
          tokens.setAccessToken(null)
          gates.signedOut('refresh_failed')
          return withRequestId(response)
        }
        const refreshed = await refreshOnce()
        if (refreshed.status === 'ok') {
          replayedAfterRefresh = true
          continue
        }
        if (refreshed.status === 'unknown')
          throw new ApiException(networkError(requestId, 'The session could not be refreshed'))
        return withRequestId(response)
      }
      if (error.code === 'terms_required' && !termsHandled) {
        termsHandled = true
        await gates.termsRequired(error.details)
        continue
      }
      if (error.code === 'upgrade_required') {
        const details = (error.details ?? {}) as { minVersion?: string; storeUrl?: string }
        gates.upgradeRequired(details)
        return withRequestId(response)
      }
      if (classify(error).kind !== 'conflict_refetch') {
        const plan = retryPlan({ method, hasKey }, error, retries)
        if (plan.retry) {
          retries++
          await sleep(plan.afterMs)
          continue
        }
      }
      return withRequestId(response)
    }
  }
  // Bun's `typeof fetch` also has `preconnect`; the DOM one does not, so the property is read without naming the type.
  const preconnect = (send as { preconnect?: unknown }).preconnect
  return Object.assign(authenticatedFetch, { preconnect }) as unknown as typeof fetch
}
