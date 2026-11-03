import type { Clock } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { BuildingScope } from '@rms/shared-types'
import { FINANCE_EVENTS, type IntentCancelRequestedPayload } from '../contracts'
import type { CascadeCancelReason, IntentRepository } from '../domain/intent-repository'

/**
 * The port of DOC-21 §2.1 and DOC-23 §5.4: in the caller's transaction, the active intents of the building that hold any of the
 * charges become `cancelling` as a whole, their items are released and one `finance.intent_cancel_requested.v1` is written per
 * intent. Recall (`batch_recalled`), single void (`charge_voided`) and a payment of a held charge (`charge_paid`, DR-283) call it.
 * The command reason equals the column value for these three (DOC-23 §2.3). It opens no transaction: the outbox writer refuses
 * to run outside one (DOC-12 §8.1 item 3).
 */
export class IntentCancellation {
  constructor(
    private readonly intents: IntentRepository,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
  ) {}

  async cancelHolding(
    scope: BuildingScope,
    chargeIds: readonly string[],
    reason: CascadeCancelReason,
  ): Promise<{ readonly intentIds: readonly string[] }> {
    if (chargeIds.length === 0) return { intentIds: [] }
    const intentIds = await this.intents.cancelHolders(scope, chargeIds, reason)
    if (intentIds.length === 0) return { intentIds }
    const now = this.clock.now()
    await this.outbox.add(
      intentIds.map((intentId) => ({
        type: FINANCE_EVENTS.intentCancelRequested,
        aggregateId: intentId,
        payload: {
          buildingId: scope.buildingId,
          intentId,
          reason,
        } satisfies IntentCancelRequestedPayload,
        occurredAt: now,
      })),
    )
    return { intentIds }
  }
}
