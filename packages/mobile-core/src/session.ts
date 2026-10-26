import type { RefreshResult } from '@rms/client-core'
import type { MobileTokenStore } from './token-store'

/**
 * `booting`: the stored token is being refreshed. `signedOut`: no session. `signedIn`: a live session. `unknown`: the refresh
 * got no answer, so the token is kept and the app shows what it has cached (DOC-55 §5.2 rule 4).
 */
export type SessionStatus = 'booting' | 'signedOut' | 'signedIn' | 'unknown'
export type SignOutReason = 'user' | 'revoked' | 'refresh_failed'

export interface SessionState {
  status: SessionStatus
  /** Why the last session ended; the sign-in screen reads it for `auth.signed_out`. */
  reason: SignOutReason | null
}

/** What a sign-in answer (E-05 with `client: "app"`, E-10) hands over. */
export interface IssuedTokens {
  accessToken: string
  expiresIn: number
  refreshToken: string
}

export interface SessionStoreOptions {
  tokens: MobileTokenStore
  /** The platform refresh (`createRefreshTransport`). */
  refresh: () => Promise<RefreshResult>
  /** `POST /auth/logout` with the stored refresh token; any failure is ignored. */
  logout: (refreshToken: string) => Promise<void>
  /** Best-effort removal of this device's push token before the logout (E-23, E-35). */
  removeDevice?: () => Promise<void>
  /** The local steps that are not the tokens: `queryClient.clear()`, the persisted cache, the unit (DOC-55 §5.4). */
  onEnded: (reason: SignOutReason) => void | Promise<void>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

const BOOT_RETRY_DELAYS_MS = [1000, 3000] as const
const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * The session of an app as an external store: the boot of DOC-55 §5.1, a sign-in, a sign-out and the forced sign-out. It owns
 * no screen; the root layout reads `getState()` through `useSession` and the route guards follow it.
 */
export function createSessionStore(options: SessionStoreOptions) {
  const { tokens } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  let state: SessionState = { status: 'booting', reason: null }
  const listeners = new Set<() => void>()
  const set = (next: SessionState) => {
    state = next
    for (const listener of listeners) listener()
  }

  async function ended(reason: SignOutReason) {
    await tokens.clear()
    set({ status: 'signedOut', reason })
    await options.onEnded(reason)
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * The cold start (DOC-55 §5.1): no stored token is sign-in; a refused token is a sign-out; a refresh with no answer is retried
     * on the same token after 1 s and 3 s (inside the grace window of DOC-26 §3.5) and then leaves the state `unknown`.
     */
    async boot(): Promise<void> {
      set({ status: 'booting', reason: null })
      if ((await tokens.refreshCredential()) === null)
        return set({ status: 'signedOut', reason: null })
      let result = await options.refresh()
      for (const delay of BOOT_RETRY_DELAYS_MS) {
        if (result.status !== 'unknown') break
        await sleep(delay)
        result = await options.refresh()
      }
      if (result.status === 'ok') {
        // The rotated refresh token is written before anything else runs (CL-17).
        if (result.refreshToken) await tokens.saveRefreshCredential(result.refreshToken)
        tokens.setAccessToken({ token: result.accessToken, expiresAt: result.expiresAt })
        return set({ status: 'signedIn', reason: null })
      }
      if (result.status === 'denied') return ended('refresh_failed')
      set({ status: 'unknown', reason: null })
    },

    /** A sign-in answer: the refresh token goes to the keychain first, then the access token to memory. */
    async signedIn(issued: IssuedTokens): Promise<void> {
      await tokens.saveRefreshCredential(issued.refreshToken)
      tokens.setAccessToken({
        token: issued.accessToken,
        expiresAt: now() + issued.expiresIn * 1000,
      })
      set({ status: 'signedIn', reason: null })
    },

    /** The user signs out: the device and the session are ended best effort, then the local steps run even if both fail. */
    async signOut(): Promise<void> {
      const refreshToken = await tokens.refreshCredential()
      try {
        await options.removeDevice?.()
      } catch {
        // The server drops the token with the session.
      }
      if (refreshToken) {
        try {
          await options.logout(refreshToken)
        } catch {
          // The family ends at its expiry; the session list can end it earlier (DOC-26 §3.7).
        }
      }
      await ended('user')
    },

    /** A refused refresh, a revoked session or a replay that was 401 again: the local steps only, at once. */
    endLocally(reason: Exclude<SignOutReason, 'user'>): Promise<void> {
      return ended(reason)
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>
