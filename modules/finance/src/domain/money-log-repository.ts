/**
 * The money log (DOC-22 §9): `gateway_event` rows by outcome and reviewable `statement_line` rows. A port in `domain/` (DOC-12
 * §4.5); the Drizzle adapter is in `infrastructure/persistence/`. Every method carries the building scope. Nothing here links a
 * row to a charge, period or payment (DR-84, DR-16); `relatedPaymentId` of a `refunded`/`disputed` row is read-only (DR-327).
 */
import type { BuildingScope, Money } from '@rms/shared-types'

export type MoneyLogKind = 'gateway_event' | 'statement_line'

/** One row of the viewer (DOC-22 §9.4): `status` is the event's outcome or the line's match status. */
export interface MoneyLogRow {
  readonly kind: MoneyLogKind
  readonly id: string
  readonly at: Date
  readonly amount: Money
  readonly status: string
  readonly unitId: string | null
  readonly reviewedAt: Date | null
}

/** The filters of E-108 (FR-47.1); `after` is the keyset `(at, id)` of the last row of the previous page. */
export interface MoneyLogFilter {
  readonly outcome?: string
  readonly unitId?: string
  readonly from?: Date
  readonly to?: Date
  readonly openOnly?: boolean
  readonly includePosted?: boolean
  readonly after?: { readonly at: Date; readonly id: string }
  readonly limit: number
}

/** The drawer of a row (FR-47.2): only the whitelisted payload fields (DR-267 item 7), never the payer's account. */
export interface MoneyLogDetail extends MoneyLogRow {
  readonly reference: string | null
  readonly orderCode: number | null
  readonly intentId: string | null
  readonly paymentId: string | null
  readonly relatedPaymentId: string | null
  readonly payload: Readonly<Record<string, unknown>>
  readonly reviewedBy: string | null
  readonly reviewNote: string | null
}

/** The row as a review reads it after 0 rows, to name the refusal (DOC-22 §9.2). */
export interface ReviewableState {
  readonly status: string
  readonly reviewedAt: Date | null
}

export interface MoneyLogRepository {
  /** The conditional update of DOC-22 §9.2 for the kind; `true` when it returned a row. */
  review(
    scope: BuildingScope,
    kind: MoneyLogKind,
    id: string,
    staffId: string,
    note: string,
  ): Promise<boolean>
  state(scope: BuildingScope, kind: MoneyLogKind, id: string): Promise<ReviewableState | null>
  /** The union of DOC-22 §9.4, newest first, at most `limit` rows. */
  list(scope: BuildingScope, filter: MoneyLogFilter): Promise<readonly MoneyLogRow[]>
  /** `UnitMoneyPanel` (E-110): the unit's `gateway_event` rows, newest first. */
  byUnit(scope: BuildingScope, unitId: string, limit: number): Promise<readonly MoneyLogRow[]>
  detail(scope: BuildingScope, kind: MoneyLogKind, id: string): Promise<MoneyLogDetail | null>
}
