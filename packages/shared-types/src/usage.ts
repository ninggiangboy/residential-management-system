/**
 * The closed lists of the usage record (DR-279, DOC-104 §3, §4). A client can only name a screen of `USAGE_SCREENS` and a control
 * of `USAGE_TARGETS`; the server drops any other name (`unknown_name`), and the metric labels take their values from the same
 * types, so the set of series is closed. A name never holds data: no id, no amount, no path (DOC-104 §2.1).
 */

export const USAGE_APPS = ['resident', 'staff', 'web'] as const
export type UsageApp = (typeof USAGE_APPS)[number]

export const USAGE_PLATFORMS = ['ios', 'android', 'web'] as const
export type UsagePlatform = (typeof USAGE_PLATFORMS)[number]

/** The kind of the token: never the role (DOC-104 §2). */
export const USAGE_AUDIENCES = ['resident', 'staff'] as const
export type UsageAudience = (typeof USAGE_AUDIENCES)[number]

export const USAGE_EVENTS = ['screen_view', 'tap', 'app_open', 'app_close'] as const
export type UsageEventKind = (typeof USAGE_EVENTS)[number]

/** The names of `app_open` and `app_close` (DOC-104 §3). */
export const USAGE_OPEN_NAMES = ['Launch', 'Resume'] as const
export const USAGE_CLOSE_NAMES = ['Background'] as const
export type UsageLifecycleName =
  | (typeof USAGE_OPEN_NAMES)[number]
  | (typeof USAGE_CLOSE_NAMES)[number]

/**
 * The section ids of DOC-56 that the apps have when the code is written. A screen is added with the task that builds it, and the
 * test UA-15 fails when an id is not a section of DOC-56 or is one of `USAGE_EXCLUDED_SCREENS`.
 */
export const USAGE_SCREENS = [
  // Resident app: the home of each member type, the account and the contact (DOC-57, DOC-60).
  'Main',
  'Home-Member',
  'Home-Tenant-Pay',
  'Home-Tenant-NoPay',
  'Home-Helper',
  'Account',
  'Sessions',
  'Contact',
  // Staff app (DOC-61).
  'S-Account',
  // Web CMS (DOC-64, DOC-65, DOC-67).
  'W-Profile',
  'W-Residents',
  'W-Resident-Add',
  'W-Units',
  'W-Unit-Detail',
  'W-Import',
  'W-Staff',
  'W-Staff-New',
  'W-Building',
] as const
export type UsageScreen = (typeof USAGE_SCREENS)[number]

/**
 * Sections of DOC-56 that are never recorded (DOC-104 §4.1): every screen shown without a session, the consent screens (the person
 * has not yet accepted the notice that describes this record) and `Unit-Pick` (no unit is chosen, so there is no building).
 */
export const USAGE_EXCLUDED_SCREENS = [
  'Login',
  'Login-Error',
  'OTP',
  'Terms',
  'Terms-Update',
  'Unit-Pick',
  'S-Login',
  'S-Login-Error',
  'S-Forgot',
  'S-Forgot-Sent',
  'W-Login',
  'W-Forgot-Sent',
  'W-Reset',
] as const

/** `<Screen>.<control>`: the controls that start an action that matters to the building (DOC-104 §4.2.1). */
export const USAGE_TARGETS = [
  'Account.language',
  'Account.push',
  'S-Account.language',
  'S-Account.push',
  'W-Profile.language',
  'W-Profile.reset_link',
  'W-Import.save',
  'W-Resident-Add.submit',
  'W-Staff-New.submit',
  'W-Building.save',
] as const
export type UsageTarget = (typeof USAGE_TARGETS)[number]

/** What `name` may be, whatever the event: a metric label takes any of them (DOC-104 §11). */
export type UsageName = UsageScreen | UsageTarget | UsageLifecycleName

/** The length and the form of a name, as the check `ck_usage_event_name` of DOC-17 §9A.1 says it. */
export const USAGE_NAME_MAX = 60
export const USAGE_NAME_PATTERN = /^[A-Z][A-Za-z0-9-]*(\.[a-z][a-z0-9_]*)?$/

/** The limits of one batch (DOC-104 §6.2). */
export const USAGE_BATCH_MAX_EVENTS = 50
export const USAGE_BATCH_MAX_BYTES = 16 * 1024
export const USAGE_AGE_MAX_MS = 3_600_000
export const USAGE_DURATION_MAX_SEC = 86_400

const SCREENS: ReadonlySet<string> = new Set(USAGE_SCREENS)
const TARGETS: ReadonlySet<string> = new Set(USAGE_TARGETS)
const OPEN_NAMES: ReadonlySet<string> = new Set(USAGE_OPEN_NAMES)
const CLOSE_NAMES: ReadonlySet<string> = new Set(USAGE_CLOSE_NAMES)

/**
 * Whether `name` is allowed for `event`: a screen for `screen_view`, a target for `tap`, `Launch` or `Resume` for `app_open` and
 * `Background` for `app_close` (DOC-104 §6.1 step 8). The same function serves the server and the tests of the clients.
 */
export function isUsageName(event: UsageEventKind, name: string): name is UsageName {
  switch (event) {
    case 'screen_view':
      return SCREENS.has(name)
    case 'tap':
      return TARGETS.has(name)
    case 'app_open':
      return OPEN_NAMES.has(name)
    case 'app_close':
      return CLOSE_NAMES.has(name)
  }
}
