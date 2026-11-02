/**
 * The reads and writes the all-or-nothing allocation needs (DOC-22 §4, DR-14, ADR-0006). A port in `domain/` (DOC-12 §4.5):
 * the application layer depends on this, the Drizzle adapter lives in `infrastructure/persistence/`.
 */
import type { BuildingScope, ChargeStatus, Money } from '@rms/shared-types'
import type { ReceiptCharge, ReceiptSnapshot } from './receipt-snapshot'

/** An allocation the allocator inserts: the charge's full amount, `live` (DOC-15 §7.2). */
export interface NewAllocation {
  readonly id: string
  readonly paymentId: string
  readonly chargeId: string
  readonly amount: Money
}

/** A receipt the allocator inserts with its frozen snapshot (DOC-15 §7.3, DR-17). */
export interface NewReceipt {
  readonly id: string
  readonly number: string
  readonly allocationId: string
  readonly paymentId: string
  readonly chargeId: string
  readonly unitId: string
  readonly amount: Money
  readonly snapshot: ReceiptSnapshot
  readonly issuedAt: Date
}

/** A posted payment (DOC-15 §7.1); each caller fills the columns its source's `CHECK` allows. */
export interface NewPayment {
  readonly id: string
  readonly unitId: string
  readonly source: 'cash' | 'bank_transfer' | 'online'
  readonly amount: Money
  readonly receivedAt: Date
  readonly payerName: string | null
  readonly provider: string | null
  readonly gatewayReference: string | null
  readonly intentId: string | null
  readonly clientKey: string | null
  readonly recordedBy: string | null
  readonly bankReference: string | null
  readonly statementLineId: string | null
  readonly note: string | null
}

/** The fresh state of a charge the allocator reads after a 0-row update, to map the failure reason (DOC-22 §4.3). */
export interface ChargeState {
  readonly chargeId: string
  readonly status: ChargeStatus
  readonly amount: Money
}

/**
 * The allocation's writes and reads (DOC-22 §4). Every method runs in the caller's ambient transaction through the shared
 * `Database.executor`, carries the building scope first, and lets a database error propagate (`40001`/`40P01` are the
 * transaction wrapper's, DOC-12 §8.1).
 */
export interface LedgerRepository {
  /** The conditional update of DOC-22 §4.1; `true` when it returned a row, so the charge was `open` at this amount. */
  payOpenCharge(scope: BuildingScope, chargeId: string, expected: Money): Promise<boolean>
  /** The charge as it is now, for the reason of a failed update (DOC-22 §4.3). */
  readChargeState(scope: BuildingScope, chargeId: string): Promise<ChargeState | null>
  /** The charge, its batch and its lines in position order: the inputs of the receipt snapshot (DOC-22 §7). */
  readChargeForReceipt(scope: BuildingScope, chargeId: string): Promise<ReceiptCharge | null>
  insertAllocation(scope: BuildingScope, allocation: NewAllocation): Promise<void>
  insertReceipt(scope: BuildingScope, receipt: NewReceipt): Promise<void>
  /** The caller inserts the payment before it allocates (DOC-22 §5.2 step 4, DR-23). */
  insertPayment(scope: BuildingScope, payment: NewPayment): Promise<void>
}
