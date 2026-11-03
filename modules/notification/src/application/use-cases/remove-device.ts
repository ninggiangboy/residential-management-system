import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { DeviceOwner } from './register-device'

/**
 * E-23 and E-35 (DOC-31 §5.2, DR-146, DR-300): the caller removes its own token. Nothing is revealed: an unknown id, an
 * already removed one and another account's device all delete nothing and answer the same.
 */
export class RemoveDevice {
  constructor(private readonly devices: DeviceTokenRepository) {}

  async execute(owner: Pick<DeviceOwner, 'kind' | 'accountId'>, id: string): Promise<void> {
    await this.devices.removeOwn(id, owner.kind, owner.accountId)
  }
}
