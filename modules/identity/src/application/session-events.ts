import type { OutboxWriter } from '@core/messaging'
import { IDENTITY_EVENTS, type RevocationReason, type SessionRevokedPayload } from '../contracts'
import type { RevokedFamily } from '../domain/session-repository'

/**
 * One `identity.session_revoked.v1` per revoked family, in the transaction of the revocation (DOC-26 §3.8). `realtime` closes
 * the streams of the session and `notification` drops its device token.
 */
export class SessionEvents {
  constructor(private readonly outbox: OutboxWriter) {}

  async revoked(
    families: readonly RevokedFamily[],
    reason: RevocationReason,
    at: Date,
  ): Promise<void> {
    await this.outbox.add(
      families.map((family) => ({
        type: IDENTITY_EVENTS.sessionRevoked,
        aggregateId: family.accountId,
        payload: {
          buildingId: family.buildingId,
          accountKind: family.kind,
          accountId: family.accountId,
          sessionId: family.id,
          reason,
        } satisfies SessionRevokedPayload,
        occurredAt: at,
      })),
    )
  }
}
