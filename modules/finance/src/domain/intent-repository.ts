/**
 * The writes on `finance.payment_intent` and `finance.payment_intent_item` that cancel the holders of charges (DOC-23 §5.4). A
 * port in `domain/` (DOC-12 §4.5); the Drizzle adapter is in `infrastructure/persistence/`. Every method runs in the caller's
 * ambient transaction and carries the building scope.
 */
import type { BuildingScope } from '@rms/shared-types'

/** The `cancel_reason` a cascade writes (DOC-15 §6.1, DOC-23 §2.3); a member, staff and a supersede are P3-02's and P3-06's. */
export type CascadeCancelReason = 'batch_recalled' | 'charge_voided' | 'charge_paid'

export interface IntentRepository {
  /**
   * The statement of DOC-23 §5.4: every `creating` or `pending` intent of the building that holds one of the charges becomes
   * `cancelling` as a whole, then each one's items are released. Answers the intent ids, in ascending order.
   */
  cancelHolders(
    scope: BuildingScope,
    chargeIds: readonly string[],
    reason: CascadeCancelReason,
  ): Promise<readonly string[]>
  /** The release of DOC-23 §3: `released_at = now()` on the intent's live items. */
  releaseItems(scope: BuildingScope, intentId: string): Promise<void>
}
