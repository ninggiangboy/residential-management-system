import type { TokenStore } from '@rms/client-core'

/**
 * The access token lives in a module variable and nowhere else: not in `localStorage`, not in a cookie, not in the URL (DOC-55
 * §5.1, UIWO-01). A reload loses it, and the boot refresh gets a new one from the `HttpOnly` cookie.
 */
let token: string | null = null
let expiresAt: number | null = null

export const tokenStore: TokenStore = {
  accessToken: () => token,
  accessExpiresAt: () => expiresAt,
  setAccessToken(next) {
    token = next?.token ?? null
    expiresAt = next?.expiresAt ?? null
  },
}
