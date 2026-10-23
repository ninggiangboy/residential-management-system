import { API_PREFIX } from '@core/http'
import { ForbiddenError } from '@core/kernel'

/** DOC-26 §3.3. `__Secure-` and not `__Host-`, because `__Host-` forces `Path=/` and the cookie must stay on `/api/v1/auth`. */
const REFRESH_COOKIE = '__Secure-rms_refresh'
const ATTRIBUTES = `Path=${API_PREFIX}/auth; Secure; HttpOnly; SameSite=Strict`

/** The web CMS never sees the refresh token: the API sets it here. No `Domain`, so it is host-only on `api.<domain>`. */
export function refreshCookie(token: string, expiresAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
  return `${REFRESH_COOKIE}=${token}; ${ATTRIBUTES}; Max-Age=${seconds}`
}

export const clearedRefreshCookie = (): string => `${REFRESH_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`

function cookieOf(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === REFRESH_COOKIE && value.length > 0) return value.join('=') || null
  }
  return null
}

/**
 * Which credential a refresh or a logout uses (DOC-26 §3.3): the `refreshToken` of the body if there is one; else the cookie,
 * and then the request must carry `X-Requested-With: rms`, else 403 `forbidden` (a cross-site form post has the cookie but
 * cannot set the header). With neither, `null`.
 */
export function refreshCredential(request: Request, bodyToken: string | undefined): string | null {
  if (bodyToken) return bodyToken
  const cookie = cookieOf(request)
  if (!cookie) return null
  if (request.headers.get('x-requested-with') !== 'rms') throw new ForbiddenError()
  return cookie
}
