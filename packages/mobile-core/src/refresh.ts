import type { RefreshResult } from '@rms/client-core'
import type { MobileTokenStore } from './token-store'

export interface RefreshTransportOptions {
  /** Ends in `/api/v1`. */
  baseUrl: string
  tokens: MobileTokenStore
  app: 'resident' | 'staff'
  appVersion: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * The platform transport of DOC-55 §5.2 for the apps: `POST /auth/refresh` with the stored refresh token in the body. It uses the
 * plain `fetch`, never the authenticated fetcher, so a refresh cannot start a refresh. 401 and 403 end the session; no answer
 * (network, 429, 5xx) is `unknown` and never a sign-out (DR-189).
 */
export function createRefreshTransport(
  options: RefreshTransportOptions,
): () => Promise<RefreshResult> {
  const send = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  return async () => {
    const refreshToken = await options.tokens.refreshCredential()
    if (!refreshToken) return { status: 'denied' }
    let response: Response
    try {
      response = await send(`${options.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-id': options.app,
          'x-app-version': options.appVersion,
        },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      return { status: 'unknown' }
    }
    if (response.status === 401 || response.status === 403) return { status: 'denied' }
    if (!response.ok) return { status: 'unknown' }
    try {
      const body = (await response.json()) as {
        accessToken: string
        expiresIn: number
        refreshToken?: string
      }
      return {
        status: 'ok',
        accessToken: body.accessToken,
        expiresAt: now() + body.expiresIn * 1000,
        refreshToken: body.refreshToken,
      }
    } catch {
      return { status: 'unknown' }
    }
  }
}
