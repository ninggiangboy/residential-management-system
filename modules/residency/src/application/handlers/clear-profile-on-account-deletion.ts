import type { Clock, IdGenerator, Log } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler, OutboxWriter } from '@core/messaging'
import { type AccountDeletionExecutedPayload, IDENTITY_EVENTS } from '@mod/identity/contracts'
import { type MembershipChangedPayload, RESIDENCY_EVENTS } from '../../contracts'
import type { AccountDeletionRepository } from '../../domain/account-deletion-repository'
import type { UnitHistoryRepository } from '../../domain/unit-history-repository'
import { scopeOf } from '../scope-of'

/**
 * `residency.clear_profile_on_identity_account_deletion_executed` (DOC-27 §12, DOC-09 §5.2): identity has already cleared the
 * account, sessions and phone; this removes every membership of it, in any building, with a history row by `system` for each,
 * clears its profiles and tells the others with `membership_changed` `removed`. One transaction in the inbox pattern, so a
 * second delivery, or a second run, changes nothing. An owner row removed here (a transfer that landed after the job) is logged
 * and leaves the unit without an owner for the Manager to fill.
 */
export class ClearProfileOnAccountDeletionHandler implements IntegrationEventHandler {
  readonly name = 'residency.clear_profile_on_identity_account_deletion_executed'
  readonly eventType = IDENTITY_EVENTS.accountDeletionExecuted

  constructor(
    private readonly deletion: AccountDeletionRepository,
    private readonly history: UnitHistoryRepository,
    private readonly outbox: OutboxWriter,
    private readonly inbox: InboxGuard,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { accountId } = message.payload as unknown as AccountDeletionExecutedPayload
    const { deletion, history, outbox, clock, ids, logger } = this
    await this.inbox.transactional(message.id, this.name, async () => {
      const now = clock.now()
      const removed = await deletion.removeMemberships(accountId, now)
      for (const row of removed) {
        await history.add(
          scopeOf(row.buildingId),
          {
            id: ids.next(),
            unitId: row.unitId,
            kind: 'member_removed',
            actor: { kind: 'system', id: null },
            details: { source: 'account_deletion', memberType: row.memberType },
          },
          now,
        )
        if (row.memberType === 'owner')
          logger.warn({ unitId: row.unitId }, 'deleted_owner_membership')
      }
      await deletion.clearProfiles(accountId, now)
      await outbox.add(
        removed.map((row) => ({
          type: RESIDENCY_EVENTS.membershipChanged,
          aggregateId: row.unitId,
          payload: {
            buildingId: row.buildingId,
            unitId: row.unitId,
            membershipId: row.id,
            accountId: row.accountId,
            change: 'removed',
            memberType: row.memberType,
          } satisfies MembershipChangedPayload,
          occurredAt: now,
        })),
      )
    })
  }
}
