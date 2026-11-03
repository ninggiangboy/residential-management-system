/**
 * The reads and writes of `settle()` on `finance.payment_intent`, `payment_intent_item` and `gateway_event` (DOC-23 §6.1). A
 * port in `domain/` (DOC-12 §4.5); the Drizzle adapter is in `infrastructure/persistence/`. Every method runs in the caller's
 * ambient transaction and carries the building scope, except the one cross-building existence read of DR-282.
 */
import type { BuildingScope, Money } from '@rms/shared-types'

export type IntentStatus =
  | 'creating'
  | 'pending'
  | 'cancelling'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'failed'

/** An intent as `settle()` reads it at step 1 (no lock). */
export interface SettlingIntent {
  readonly id: string
  readonly unitId: string
  readonly code: string
  readonly amount: Money
  readonly status: IntentStatus
  readonly createdBy: string
}

/** The outcomes a `gateway_event` row ends with after `settle()` (DOC-15 §7.4, DR-16). */
export type GatewayEventOutcome =
  | 'posted'
  | 'amount_short'
  | 'amount_over'
  | 'duplicate_transfer'
  | 'charge_already_paid'
  | 'charge_recalled'
  | 'unknown_order'

/** The `gateway_event` row of step 2, inserted with outcome `pending`. */
export interface NewGatewayEvent {
  readonly id: string
  readonly provider: string
  readonly reference: string
  readonly orderCode: number | null
  readonly amount: Money
  readonly paidAt: Date
  readonly source: 'webhook' | 'requery' | 'statement'
  readonly payload: Record<string, unknown>
  readonly intentId: string | null
  readonly unitId: string | null
}

export interface SettlementRepository {
  findIntentByOrderCode(scope: BuildingScope, orderCode: number): Promise<SettlingIntent | null>
  /** DR-282 item 1: whether any building has an intent with this order code; one boolean, no row data. */
  orderCodeExistsAnywhere(orderCode: number): Promise<boolean>
  /** Step 2: `INSERT … ON CONFLICT (provider, reference) DO NOTHING`; `false` when the reference was recorded before. */
  recordEvent(scope: BuildingScope, event: NewGatewayEvent): Promise<boolean>
  /** The outcome is set once, from `pending` (`trg_gateway_event_guard`); `paymentId` only with `posted`. */
  setEventOutcome(
    scope: BuildingScope,
    eventId: string,
    outcome: GatewayEventOutcome,
    paymentId: string | null,
  ): Promise<void>
  /** Step 4, the second arbiter (ADR-0008): `… SET status = 'paid' … WHERE status <> 'paid'`; `false` on 0 rows. */
  claimIntent(
    scope: BuildingScope,
    intentId: string,
    paidAt: Date,
    reference: string,
  ): Promise<boolean>
  /** Every item of the intent, released or not: a late confirmation pays the charges its items named (DOC-23 §6.1 step 5). */
  intentItems(
    scope: BuildingScope,
    intentId: string,
  ): Promise<ReadonlyArray<{ readonly chargeId: string; readonly amount: Money }>>
}
