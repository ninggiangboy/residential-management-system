import { isUniqueViolation } from '@core/db'
import type { IdGenerator } from '@core/kernel'
import type { DevicePlatform } from '../../domain/device-token'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { AccountKind } from '../../domain/inbox-entry'

/** The account and session that register a device; taken from the token, never from the body (DOC-31 §5.1). */
export interface DeviceOwner {
  readonly kind: AccountKind
  readonly accountId: string
  readonly sessionId: string
}

export interface RegisterDeviceInput {
  readonly expoPushToken: string
  readonly platform: DevicePlatform
  readonly appVersion: string
}

/**
 * E-22 and E-34 (DOC-31 §5.1, DR-300): an upsert on the Expo token, one token per session. A token registered by another
 * account moves to the caller; the answer is the row id, the same one for the same token. Two registrations of one session
 * with different tokens race on `uq_device_token_session`: the loser is retried once.
 */
export class RegisterDevice {
  constructor(
    private readonly devices: DeviceTokenRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(owner: DeviceOwner, input: RegisterDeviceInput): Promise<{ id: string }> {
    const attempt = () =>
      this.devices.register({
        id: this.ids.next(),
        accountKind: owner.kind,
        accountId: owner.accountId,
        sessionId: owner.sessionId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        appVersion: input.appVersion,
      })
    try {
      return { id: (await attempt()).id }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      return { id: (await attempt()).id }
    }
  }
}
