import type { RefreshResult } from '@rms/client-core'
import { env } from '../env'
import { tokenStore } from './token-store'

/** Tabs share one refresh: the cookie rotates for all of them, the access token does not (DOC-55 §5.2, CL-21, CL-22). */
type Message = { type: 'token'; accessToken: string; expiresAt: number } | { type: 'signed_out' }

const CHANNEL = 'rms-auth'
const LOCK = 'rms-refresh'
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
let newest: { accessToken: string; expiresAt: number } | null = null

/** Called once by the session: another tab refreshed, or signed out. */
export function listenToOtherTabs(onSignedOut: () => void): void {
  if (!channel) return
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data
    if (message.type === 'token') {
      newest = { accessToken: message.accessToken, expiresAt: message.expiresAt }
      const own = tokenStore.accessExpiresAt()
      if (tokenStore.accessToken() !== null && (own === null || message.expiresAt > own))
        tokenStore.setAccessToken({ token: message.accessToken, expiresAt: message.expiresAt })
    } else if (message.type === 'signed_out') {
      onSignedOut()
    }
  }
}

/**
 * The token another tab (or this one) refreshed is remembered so that a tab waiting for the lock can use it. A sign-out must forget
 * it, or the next refresh would hand the ended session back (UIWO-05).
 */
export function forgetSharedToken(): void {
  newest = null
}

export const announceSignedOut = () =>
  channel?.postMessage({ type: 'signed_out' } satisfies Message)

const FRESH_MS = 30_000

async function refreshWithCookie(): Promise<RefreshResult> {
  // A tab that got the lock after another tab refreshed uses that token instead of refreshing again.
  if (newest && newest.expiresAt - Date.now() > FRESH_MS) {
    const own = tokenStore.accessExpiresAt()
    if (own === null || newest.expiresAt > own)
      return { status: 'ok', accessToken: newest.accessToken, expiresAt: newest.expiresAt }
  }
  let response: Response
  try {
    response = await fetch(`${env.apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'rms' },
    })
  } catch {
    return { status: 'unknown' }
  }
  if (response.status === 401 || response.status === 403) return { status: 'denied' }
  if (!response.ok) return { status: 'unknown' }
  try {
    const body = (await response.json()) as { accessToken: string; expiresIn: number }
    const expiresAt = Date.now() + body.expiresIn * 1000
    newest = { accessToken: body.accessToken, expiresAt }
    channel?.postMessage({ type: 'token', ...newest } satisfies Message)
    return { status: 'ok', accessToken: body.accessToken, expiresAt }
  } catch {
    return { status: 'unknown' }
  }
}

/** The platform transport of DOC-55 §5.2 for the web: the refresh cookie, one refresh at a time across tabs (Web Locks). */
export function refreshSession(): Promise<RefreshResult> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(LOCK, refreshWithCookie)
  return refreshWithCookie()
}
