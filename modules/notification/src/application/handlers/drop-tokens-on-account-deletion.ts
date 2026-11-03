import type { Log } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { type AccountDeletionExecutedPayload, IDENTITY_EVENTS } from '@mod/identity/contracts'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'

/** `identity.account_deletion_executed.v1` (DOC-31 §5.2): every device token of the resident is deleted (NT-45). */
export class DropTokensOnAccountDeletionHandler implements IntegrationEventHandler {
  readonly name = 'notification.drop_tokens_on_identity_account_deletion_executed'
  readonly eventType = IDENTITY_EVENTS.accountDeletionExecuted

  constructor(
    private readonly devices: DeviceTokenRepository,
    private readonly inbox: InboxGuard,
    private readonly logger: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const event = message.payload as unknown as AccountDeletionExecutedPayload
    await this.inbox.transactional(message.id, this.name, async () => {
      const deleted = await this.devices.deleteByAccount('resident', event.accountId)
      if (deleted > 0)
        this.logger.info(
          { event: 'device_token_deleted', reason: 'account_deleted', count: deleted },
          'device_token_deleted',
        )
    })
  }
}
