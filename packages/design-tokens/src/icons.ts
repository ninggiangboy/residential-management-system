/**
 * The Phosphor icon names the product uses (DR-181, DOC-54 §7.3): the 50 of the canvas bundle (`IconName` of the
 * Hiên components) without the three amenity icons the product has no screen for (§7.4). The web and the native
 * `Icon` registries map exactly these names (test DS-06 in P1-16 and P1-17); a new icon is added here first.
 */
export const ICON_NAMES = [
  // navigation
  'house',
  'receipt',
  'squares-four',
  'bell',
  'user-circle',
  // actions
  'plus',
  'minus',
  'x',
  'check',
  'caret-left',
  'caret-right',
  'caret-down',
  'magnifying-glass',
  'pencil-simple',
  'trash',
  'camera',
  'image',
  'qr-code',
  'phone',
  'chat-circle-dots',
  'sign-out',
  'gear',
  // time and place
  'calendar-blank',
  'clock',
  'map-pin',
  // status
  'info',
  'warning',
  'check-circle',
  'x-circle',
  'star',
  // building
  'buildings',
  'elevator',
  'key',
  'door-open',
  'package',
  'fire-extinguisher',
  'broom',
  'wrench',
  'megaphone',
  'headset',
  'note-pencil',
  'users-three',
  'wallet',
  // utilities
  'drop',
  'lightning',
  // vehicles
  'car',
  'motorcycle',
] as const
export type IconName = (typeof ICON_NAMES)[number]

/** Tag tones: what the viewer should do (DR-183). */
export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

/** Icon-well tones: decoration that groups a kind of thing, never a state (DOC-54 §6.5). */
export const WELL_TONES = ['teal', 'gold', 'coral', 'sky', 'violet'] as const
export type WellTone = (typeof WELL_TONES)[number]
