import { homeScreenOf, screenOfSegments } from '@rms/mobile-core'
import type { UsageScreen } from '@rms/shared-types'

/**
 * The route-to-screen map of the resident app (DOC-104 §5.1): the segments of a route without its groups, to a section of DOC-56. A
 * route that is not here is not tracked: the sign-in, the terms, the unit picker and the offline screen are never recorded (§4.1).
 */
export const RESIDENT_SCREENS = {
  account: 'Account',
  'account/sessions': 'Sessions',
  contact: 'Contact',
} as const satisfies Record<string, UsageScreen>

type Home = Parameters<typeof homeScreenOf>[0]

/** The home is one route and five sections: it reads the member type of the unit in front (DOC-57). */
export function screenOfRoute(
  segments: readonly string[],
  membership: Home | null,
): UsageScreen | null {
  if (segments.length === 1 && segments[0] === '(app)')
    return membership ? homeScreenOf(membership) : null
  return screenOfSegments(RESIDENT_SCREENS, segments)
}
