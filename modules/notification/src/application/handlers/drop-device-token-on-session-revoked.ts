import type { Log } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { IDENTITY_EVENTS, type SessionRevokedPayload } from '@mod/identity/contracts'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'

/**
 * `identity.session_revoked.v1` (DOC-31 §5.2, DOC-09 §5.2): the token of a revoked session is deleted, so the account no longer
 * reaches that phone. A repeat deletes nothing (NT-44). The token itself is never logged.
 */
export class DropDeviceTokenOnSessionRevokedHandler implements IntegrationEventHandler {
  readonly name = 'notification.drop_device_token_on_identity_session_revoked'
  readonly eventType = IDENTITY_EVENTS.sessionRevoked

  constructor(
    private readonly devices: DeviceTokenRepository,
    private readonly inbox: InboxGuard,
    private readonly logger: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const event = message.payload as unknown as SessionRevokedPayload
    await this.inbox.transactional(message.id, this.name, async () => {
      const deleted = await this.devices.deleteBySession(
        event.sessionId,
        event.accountKind,
        event.accountId,
      )
      if (deleted > 0)
        this.logger.info(
          { event: 'device_token_deleted', reason: 'session_revoked', count: deleted },
          'device_token_deleted',
        )
    })
  }
}
