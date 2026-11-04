/**
 * The payments read of E-102 (DOC-66 §5): the payments of one unit, newest first by `(received_at, id)`, each with its receipts
 * and the money-log flags of DR-327. A port in `domain/` (DOC-12 §4.5); the Drizzle adapter is
 * `infrastructure/persistence/drizzle-unit-payments-reader.ts`. Every read carries the building scope. The flags are the unit's
 * open `gateway_event` rows that name the payment in `related_payment_id` (`refunded` or `disputed`, DR-327); a payment with none
 * answers `[]`, and no row of the money log is otherwise linked to a payment (DR-84, DR-16).
 */
import type { BuildingScope, Money } from '@rms/shared-types'
import type { PaymentSource } from './receipt-snapshot'

/** The keyset of E-102's payments page: the last row of the previous page, `(payment.received_at, payment id)`. */
export interface UnitPaymentCursor {
  readonly receivedAt: Date
  readonly paymentId: string
}

/** A money-log flag of a payment (DOC-66 §5, DR-327): the row and its `refunded` or `disputed` outcome. */
export interface UnitMoneyLogFlag {
  readonly rowId: string
  readonly outcome: string
}

/** One receipt of a payment (DOC-66 §5): `void` ones are shown rather than hidden, with their number kept. */
export interface UnitPaymentReceipt {
  readonly id: string
  readonly number: string
  readonly chargeId: string
  readonly status: 'issued' | 'void'
}

/** One payment of the unit (DOC-66 §5, DR-324 item 5), with its receipts and the refund/dispute flags of DR-327. */
export interface UnitPaymentRow {
  readonly paymentId: string
  readonly source: PaymentSource
  readonly amount: Money
  readonly receivedAt: Date
  readonly payerName: string | null
  readonly status: 'posted' | 'void'
  readonly moneyLogFlags: readonly UnitMoneyLogFlag[]
  readonly receipts: readonly UnitPaymentReceipt[]
}

export interface UnitPaymentsReader {
  /** E-102: the unit's payments after `after`, newest first, at most `limit` rows, `void` ones included. */
  payments(
    scope: BuildingScope,
    unitId: string,
    after: UnitPaymentCursor | undefined,
    limit: number,
  ): Promise<readonly UnitPaymentRow[]>
}
