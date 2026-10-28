import { createUsageTracker, type UsageAnswer, type UsageBatchBody } from '@rms/client-core'
import type { UsageScreen, UsageTarget } from '@rms/shared-types'
import { useEffect, useSyncExternalStore } from 'react'
import { authenticatedFetch } from '../api/client'
import { env } from '../env'

/**
 * The usage tracker of the web CMS (DOC-104 §5): `@rms/client-core`'s tracker bound to `localStorage` for the switch (key
 * `rms.usage.enabled`, read in a `try/catch`), to `performance.now()` for the time of use, to `visibilitychange` and `pagehide` for
 * the stretch, and to the one authenticated fetcher. A batch is sent with `keepalive` so that closing the tab does not cancel it. The
 * fetcher treats the route as a quiet call: no retry, and no screen opens for an answer.
 */
const KEY = 'rms.usage.enabled'

const read = (): boolean | null => {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null ? null : stored === '1'
  } catch {
    return null
  }
}

const write = (enabled: boolean): void => {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0')
  } catch {
    // The choice holds for this page.
  }
}

async function send(body: UsageBatchBody): Promise<UsageAnswer> {
  const response = await authenticatedFetch(`${env.apiBaseUrl}/staff/usage-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
  return { stop: response.headers.get('x-usage-enabled') === 'false' }
}

/** `1.0.3-beta` is sent as `1.0.3`: the server takes digits only (DOC-104 §6.2). */
const appVersion = /^\d{1,4}\.\d{1,4}\.\d{1,4}/.exec(env.appVersion)?.[0] ?? '0.0.0'

export const usage = createUsageTracker({
  app: 'web',
  platform: 'web',
  appVersion,
  now: () => performance.now(),
  newId: () => crypto.randomUUID(),
  store: { read, write },
  send,
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
})

// The stretch of DOC-104 §5.6: `visible` opens it, `hidden` closes it, and `pagehide` closes one that `hidden` has not already closed.
if (typeof document !== 'undefined') {
  if (document.visibilityState === 'visible') usage.foreground(true)
  document.addEventListener('visibilitychange', () =>
    usage.foreground(document.visibilityState === 'visible'),
  )
  window.addEventListener('pagehide', () => usage.foreground(false))
  window.addEventListener('pageshow', () => {
    if (document.visibilityState === 'visible') usage.foreground(true)
  })
}

/** The press that starts the action of a listed control. The argument is typed, so a misspelled id does not compile. */
export const trackTap = (target: UsageTarget): void => usage.tap(target)

/** The route templates of the web CMS to the sections of DOC-56 (DOC-104 §5.1); a route that is not here is not tracked. */
const WEB_SCREENS: Readonly<Record<string, UsageScreen>> = {
  '/profile': 'W-Profile',
  '/residents': 'W-Residents',
  '/residents/new': 'W-Resident-Add',
  '/units': 'W-Units',
  '/units/$unitId': 'W-Unit-Detail',
  '/import': 'W-Import',
  '/staff': 'W-Staff',
  '/staff/new': 'W-Staff-New',
  '/building': 'W-Building',
}

export const screenOfRoute = (fullPath: string | undefined): UsageScreen | null =>
  WEB_SCREENS[(fullPath ?? '').replace(/(.)\/$/, '$1')] ?? null

/**
 * Called by the `_app` layout, which is only rendered with a session: the person is recorded while it is mounted, and the screen of
 * the deepest route is queued when it changes (DOC-104 §5.1). Leaving the layout (a sign-out) clears the queue.
 */
export function useUsageRecording(fullPath: string | undefined): void {
  const screen = screenOfRoute(fullPath)
  useEffect(() => {
    usage.setSignedIn(true)
    return () => usage.setSignedIn(false)
  }, [])
  useEffect(() => {
    if (screen) usage.screen(screen)
  }, [screen])
}

/** The switch of `W-Profile` (DOC-104 §5.4). */
export function useUsageEnabled(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(usage.subscribe, usage.isEnabled, usage.isEnabled)
  return [enabled, usage.setEnabled] as const
}
