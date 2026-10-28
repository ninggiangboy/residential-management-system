import { ApiException, networkError } from '@rms/client-core'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { unwrap } from '../api/errors'
import { type StaffMe, staffMeQuery } from '../api/hooks/staff-me'
import { languageStore } from '../lib/i18n'
import { usage } from '../lib/usage'
import { announceSignedOut, forgetSharedToken, refreshSession } from './refresh'
import { tokenStore } from './token-store'

export type SignOutReason = 'user' | 'revoked' | 'refresh_failed' | 'expired'

let inflight: Promise<StaffMe | null> | null = null
let goToLogin: (reason: SignOutReason) => void = () => {}

/** The router installs where a signed-out tab goes (DOC-55 §5.4): `/login` with the reason. */
export function setLoginRedirect(redirect: (reason: SignOutReason) => void): void {
  goToLogin = redirect
}

function adoptProfile(me: StaffMe): StaffMe {
  // Signed in, the language is the account's (DOC-55 §11).
  languageStore.set(me.language)
  return me
}

/**
 * The boot of the `_app` layout (DOC-55 §5.1, §17, CL-20): a token in memory is used as it is; without one, `POST /auth/refresh`
 * with the cookie runs before anything renders. `null` is "no session". A refresh that got no answer throws, so the layout shows a
 * retry and not the sign-in page: the user may still have a session (DOC-55 §5.2 rule 4).
 */
export function ensureSession(queryClient: QueryClient): Promise<StaffMe | null> {
  inflight ??= (async () => {
    if (tokenStore.accessToken() === null) {
      const refreshed = await refreshSession()
      if (refreshed.status === 'denied') return null
      if (refreshed.status === 'unknown') throw new ApiException(networkError(''))
      tokenStore.setAccessToken({ token: refreshed.accessToken, expiresAt: refreshed.expiresAt })
    }
    return adoptProfile(await queryClient.fetchQuery(staffMeQuery()))
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** E-05 in cookie mode (`client: "web"`), then E-30; the refresh token never reaches the script. */
export async function signInWithPassword(
  queryClient: QueryClient,
  credentials: { email: string; password: string },
): Promise<StaffMe> {
  const session = unwrap(await api.auth.staff.login.post({ ...credentials, client: 'web' }))
  tokenStore.setAccessToken({
    token: session.accessToken,
    expiresAt: Date.now() + session.expiresIn * 1000,
  })
  queryClient.clear()
  return adoptProfile(await queryClient.fetchQuery(staffMeQuery()))
}

/** The local steps of DOC-55 §5.4, always run, even when E-12 fails. */
export async function signOut(queryClient: QueryClient, reason: SignOutReason): Promise<void> {
  // The queue goes before the token does, so nothing leaves with the token of the next account (DOC-104 §5.3).
  usage.setSignedIn(false)
  if (reason === 'user') {
    try {
      await api.auth.logout.post()
    } catch {
      // The family ends at its expiry; the user can end it from the session list (DOC-26 §3.7).
    }
  }
  tokenStore.setAccessToken(null)
  forgetSharedToken()
  queryClient.clear()
  if (reason === 'user' || reason === 'refresh_failed') announceSignedOut()
  goToLogin(reason)
}

/** A refused refresh (or a revoked session) ends this tab's session without another call. */
export function endSessionLocally(queryClient: QueryClient, reason: SignOutReason): void {
  usage.setSignedIn(false)
  tokenStore.setAccessToken(null)
  forgetSharedToken()
  queryClient.clear()
  goToLogin(reason)
}
