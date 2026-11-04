/**
 * The resident fee reads of E-80, E-81, E-82 and E-83 (DOC-22 §8.4, DOC-58, DR-40, DR-323). A port in `domain/` (DOC-12 §4.5);
 * the Drizzle adapter is `infrastructure/persistence/drizzle-resident-fee-reader.ts`, the query service
 * `application/queries/resident-fee-queries.ts`. `startedAt` is `membership.created_at` (DR-40): open charges are always
 * visible and paid charges and receipts only when their payment's `received_at` is at or after it. Every read takes the
 * building's today, computed once per request by the caller (DR-09).
 */
import type { BuildingScope, LocalDate, Money } from '@rms/shared-types'
import type { BilingualName, ChargeStatus } from './fee-batch'
import type { PaymentSource } from './receipt-snapshot'

/** One printed line of a charge as a resident reads it (DOC-22 §8.4, DOC-58 §4; DR-323 adds `lines[]` to the list). */
export interface ResidentChargeLine {
  readonly position: number
  readonly kind: 'fee' | 'adjustment'
  readonly itemName: BilingualName
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
  readonly note: string | null
}

/**
 * The batch of a resident charge (DOC-58 §4). `ordinal` is the batch's rank within its fee month — the sequence of
 * `fee_batch.code` (`PH-YYMM-NN`, `document-codes.ts`), which the gapless counter assigns per `(building, 'batch', YYMM)`.
 */
export interface ResidentFeeBatch {
  readonly code: string
  readonly name: BilingualName
  readonly feeMonth: LocalDate
  readonly ordinal: number
}

/** The batch of E-81, which also prints the issue date and the due date (DOC-58 §4). */
export interface ResidentFeeBatchDetail extends ResidentFeeBatch {
  readonly dueDate: LocalDate
  readonly publishedAt: Date | null
}

/** One open charge of the unit (E-80, DOC-22 §8.4): the oldest due first, at most 100. */
export interface ResidentOpenCharge {
  readonly chargeId: string
  readonly batch: ResidentFeeBatch
  readonly amount: Money
  readonly dueDate: LocalDate
  /** Signed building days past due: 0 on the due day, negative before it (DOC-22 §8.1, `aging.ts`); `overdue` is `> 0`. */
  readonly daysPastDue: number
  readonly lines: readonly ResidentChargeLine[]
}

/** The charge of E-81 as the resident sees it (DOC-22 §8.4, DOC-58 §4); `payment` and `receipt` exist only for `paid`. */
export interface ResidentChargeView {
  readonly chargeId: string
  readonly status: ChargeStatus
  readonly batch: ResidentFeeBatchDetail
  readonly amount: Money
  readonly dueDate: LocalDate
  readonly daysPastDue: number
  readonly lines: readonly ResidentChargeLine[]
  readonly payment: { readonly receivedAt: Date; readonly method: PaymentSource } | null
  readonly receipt: { readonly id: string; readonly number: string } | null
}

/**
 * The E-81 read with the instant the DR-40 window compares against (DOC-22 §8.4): the payment's `received_at` for a `paid`
 * charge and `charge.voided_at` for a `void` one (a void charge was never paid, so it has no payment); `null` for `open`.
 * The query service turns a missing or too-old instant into 404. `visibleFrom` is never sent to the client.
 */
export interface ResidentChargeDetail {
  readonly charge: ResidentChargeView
  readonly visibleFrom: Date | null
}

/** One paid charge of E-82 (DOC-22 §8.4, DOC-58 §4): newest first by `(payment.received_at, charge id)`. */
export interface ResidentHistoryRow {
  readonly chargeId: string
  readonly batch: ResidentFeeBatch
  readonly amount: Money
  readonly payment: { readonly receivedAt: Date; readonly method: PaymentSource }
  readonly receipt: { readonly id: string; readonly number: string }
}

/**
 * One receipt of E-83 (DOC-22 §8.4). The shape is UNSPECIFIED in the documents, so it is decided here (P2-15): the
 * receipt, its charge, its amount, the issue instant and the payment's method and instant, with `status` so a `void`
 * receipt is shown rather than hidden. Newest first by `(issued_at, id)`.
 */
export interface ResidentReceiptRow {
  readonly receiptId: string
  readonly number: string
  readonly chargeId: string
  readonly amount: Money
  readonly issuedAt: Date
  readonly receivedAt: Date
  readonly method: PaymentSource
  readonly status: 'issued' | 'void'
}

/** The keyset of E-82: the last row of the previous page, `(payment.received_at, charge id)` (DOC-58 §5). */
export interface ResidentFeeCursor {
  readonly receivedAt: Date
  readonly chargeId: string
}

/** The keyset of E-83: the last row of the previous page, `(receipt.issued_at, id)`. */
export interface ResidentReceiptCursor {
  readonly issuedAt: Date
  readonly receiptId: string
}

/** The `finance.charge`, `finance.charge_line`, `finance.fee_batch`, `finance.payment`, `finance.allocation` and `finance.receipt` reads. */
export interface ResidentFeeReader {
  /** E-80: the `open` charges of the unit, oldest due first, at most `limit` (DOC-22 §8.4). */
  openCharges(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
    limit: number,
  ): Promise<readonly ResidentOpenCharge[]>
  /** E-81: the charge of the unit with its lines, or `null` (unknown, another unit's or another building's). */
  chargeDetail(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
    chargeId: string,
  ): Promise<ResidentChargeDetail | null>
  /** E-82: the paid charges of the unit after `after`, newest first, at most `limit`, all with `received_at >= startedAt`. */
  history(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    after: ResidentFeeCursor | undefined,
    limit: number,
  ): Promise<readonly ResidentHistoryRow[]>
  /** E-82's summary: the sum of the `open` charges of the unit (the same definition as E-80). */
  openOutstanding(scope: BuildingScope, unitId: string): Promise<Money>
  /**
   * E-82's summary: the sum of the unit's paid charges whose payment's `received_at` is at or after `startedAt` and inside
   * the building-local range `[from, to)` (the current year). The range is tested in `timeZone`, not UTC (DR-09).
   */
  paidInRange(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    timeZone: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Money>
  /** E-83: the receipts of the unit after `after`, newest first, at most `limit`, all with `received_at >= startedAt`. */
  receipts(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    after: ResidentReceiptCursor | undefined,
    limit: number,
  ): Promise<readonly ResidentReceiptRow[]>
}
