import {
  createUsageTracker,
  type UsageAnswer,
  type UsageBatchBody,
  type UsageTracker,
} from '@rms/client-core'
import type { UsageApp, UsagePlatform, UsageScreen, UsageTarget } from '@rms/shared-types'
import { readSafelySync, type SecureStorage, STORAGE_KEYS } from './storage'

export interface MobileUsageOptions {
  app: Exclude<UsageApp, 'web'>
  platform: Exclude<UsagePlatform, 'web'>
  appVersion: string
  /** Ends in `/api/v1`. */
  apiBaseUrl: string
  storage: SecureStorage
  /** The one authenticated fetcher: the token, the unit header and the refresh are its business (DOC-55 §4.1). */
  authenticatedFetch: typeof fetch
  /** The resident app sends nothing while no unit is chosen (DOC-104 §5.3); the staff app has none to choose. */
  unitId: () => string | null
  /** A UUID v4 from the platform's random source. */
  randomId: () => string
}

/** E-173 for the resident app and E-174 for the staff app (DOC-104 §6.1). */
export const usagePath = (app: MobileUsageOptions['app']) =>
  app === 'resident' ? '/me/usage-events' : '/staff/usage-events'

/**
 * The usage tracker of an app on a device (DOC-104 §5): `@rms/client-core`'s tracker bound to the device storage for the switch, to the
 * monotonic clock `performance.now()` and to the one authenticated fetcher. It sends through the fetcher without an idempotency key,
 * and the fetcher treats the route as a quiet call: no retry, no terms or upgrade screen (`QUIET` in `fetcher.ts`).
 */
export function createMobileUsage(options: MobileUsageOptions): UsageTracker {
  const url = `${options.apiBaseUrl}${usagePath(options.app)}`
  return createUsageTracker({
    app: options.app,
    platform: options.platform,
    appVersion: options.appVersion,
    now: () => performance.now(),
    newId: options.randomId,
    canSend: () => options.app === 'staff' || options.unitId() !== null,
    store: {
      read: () => {
        const stored = readSafelySync(options.storage, STORAGE_KEYS.usageEnabled)
        return stored === null ? null : stored === '1'
      },
      write: (enabled) => options.storage.setSync(STORAGE_KEYS.usageEnabled, enabled ? '1' : '0'),
    },
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    send: async (body: UsageBatchBody): Promise<UsageAnswer> => {
      // A network error is thrown by the fetcher and keeps the events; any answer, 204 or an error, ends the batch.
      const response = await options.authenticatedFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { stop: response.headers.get('x-usage-enabled') === 'false' }
    },
  })
}

let current: UsageTracker | null = null

/** The runtime registers its tracker once, so a press handler can call `trackTap` without a hook (DOC-104 §4.3 step 3). */
export function registerUsage(tracker: UsageTracker): void {
  current = tracker
}

/** The press that starts the action of a listed control. The argument is typed, so a misspelled id does not compile. */
export function trackTap(target: UsageTarget): void {
  current?.tap(target)
}

export function trackScreen(id: UsageScreen): void {
  current?.screen(id)
}

/**
 * The id of the screen that a route stands for, or `null` for a route that is not in the map (DOC-104 §5.1). The key is the
 * segments of the route without the groups (`(app)`), so a parameter is `[id]` and never reaches the id; the root is `''`.
 */
export function screenOfSegments(
  map: Readonly<Record<string, UsageScreen>>,
  segments: readonly string[],
): UsageScreen | null {
  const key = segments.filter((segment) => !segment.startsWith('(')).join('/')
  return map[key] ?? null
}

/** A membership as the home screen needs it; `memberType` and `canPay` are what DOC-57 splits the home by. */
export interface HomeMembership {
  memberType: 'owner' | 'family' | 'tenant' | 'helper'
  canPay: boolean
}

/** The section of DOC-57 that the home shows for a member type (DOC-104 §4.1: a screen with several states is several ids). */
export function homeScreenOf(membership: HomeMembership): UsageScreen {
  switch (membership.memberType) {
    case 'owner':
      return 'Main'
    case 'family':
      return 'Home-Member'
    case 'tenant':
      return membership.canPay ? 'Home-Tenant-Pay' : 'Home-Tenant-NoPay'
    case 'helper':
      return 'Home-Helper'
  }
}
