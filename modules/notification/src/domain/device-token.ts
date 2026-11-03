import type { AccountKind } from './inbox-entry'

/** The platform a token was issued on (DOC-17 §6.2, ck_device_token_platform). */
export type DevicePlatform = 'ios' | 'android'

/** One registration from E-22/E-34 (DOC-31 §5.1). */
export interface NewDeviceToken {
  readonly id: string
  readonly accountKind: AccountKind
  readonly accountId: string
  readonly sessionId: string
  readonly expoPushToken: string
  readonly platform: DevicePlatform
  readonly appVersion: string
}

/** A token as `SendExpoPush` reads it (DOC-31 §6.2 step 3, OPM-S21). */
export interface PushDevice {
  readonly id: string
  readonly accountId: string
  readonly sessionId: string
  readonly expoPushToken: string
  readonly platform: DevicePlatform
}
