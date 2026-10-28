import type { UsageScreen } from '@rms/shared-types'

/**
 * The route-to-screen map of the staff app (DOC-104 §5.1). The landing route redirects to `account`, and the sessions list is part of
 * `S-Account` (DOC-61), so it is not a second screen: a route that is not here is not tracked.
 */
export const STAFF_SCREENS = {
  account: 'S-Account',
} as const satisfies Record<string, UsageScreen>
