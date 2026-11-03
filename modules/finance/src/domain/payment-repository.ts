/**
 * The reads and writes of the manual payment and of its void (DOC-22 §5, §6) beside the allocation's own (`LedgerRepository`).
 * A port in `domain/` (DOC-12 §4.5); the Drizzle adapter is in `infrastructure/persistence/`. Every method runs in the caller's
 * ambient transaction and carries the building scope.
 */
import type { BuildingScope, ChargeStatus, Money } from '@rms/shared-types'

/** A selected charge as the manual payment reads it at step 3 (DOC-22 §5.2), without a lock. */
export interface PayableCharge {
  readonly id: string
  readonly unitId: string
  readonly status: ChargeStatus
  readonly amount: Money
  readonly version: number
  readonly batchCode: string
  /** `created_at` of the active intent (`creating`, `pending`, `cancelling`) holding the charge, or `null` (FR-05.6). */
  readonly activeIntentSince: Date | null
}

/** One receipt of a posted payment, in ascending `charge_id` order (DOC-22 §5.2 response). */
export interface PaymentReceiptView {
  readonly receiptId: string
  readonly number: string
  readonly chargeId: string
  readonly amount: Money
}

/** A payment and its receipts: the body of E-104's answer, built the same way the first time and on a replay. */
export interface PaymentView {
  readonly paymentId: string
  readonly unitId: string
  readonly source: 'cash' | 'bank_transfer' | 'online'
  readonly status: 'posted' | 'void'
  readonly amount: Money
  readonly receivedAt: Date
  readonly payerName: string | null
  readonly receipts: readonly PaymentReceiptView[]
}

/** The receipts and charges a void touched, for the audit row's `details` and the outbox (DOC-22 §6). */
export interface VoidedPaymentParts {
  readonly chargeIds: readonly string[]
  readonly receipts: ReadonlyArray<{ readonly receiptId: string; readonly number: string }>
}

export interface PaymentRepository {
  /** The selected charges of the unit in the building, any status; ids of another unit or building are absent (404). */
  readCharges(
    scope: BuildingScope,
    unitId: string,
    chargeIds: readonly string[],
  ): Promise<readonly PayableCharge[]>
  /** The fresh `{chargeId, status, version}` of the charges, for the 409 `charge_changed` answer (DOC-22 §4.3). */
  chargeStates(
    scope: BuildingScope,
    chargeIds: readonly string[],
  ): Promise<
    ReadonlyArray<{ readonly chargeId: string; readonly status: string; readonly version: number }>
  >
  /** The payment stored under the client key (`uq_payment_building_client_key`, DOC-22 §5.2 step 4), or `null`. */
  findByClientKey(scope: BuildingScope, clientKey: string): Promise<PaymentView | null>
  find(scope: BuildingScope, paymentId: string): Promise<PaymentView | null>
  /** Step 6 of DOC-22 §5.2: `unmatched → matched` with the payment; `false` on 0 rows. */
  matchStatementLine(scope: BuildingScope, lineId: string, paymentId: string): Promise<boolean>
  /**
   * The void of DOC-22 §6 in its statement order: the payment `posted → void` (only `cash`/`bank_transfer`), its live
   * allocations, their `paid` charges back to `open`, its issued receipts, and a linked statement line back to `unmatched`.
   * `null` when the first update returned 0 rows. Throws `InvariantError` when the reopened charges are fewer than the voided
   * allocations (a broken invariant: the caller's transaction rolls back, DOC-22 §6).
   */
  voidPosted(
    scope: BuildingScope,
    paymentId: string,
    reason: string,
    staffId: string,
  ): Promise<VoidedPaymentParts | null>
}
