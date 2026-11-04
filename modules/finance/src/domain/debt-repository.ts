/**
 * Debt is computed, never stored (DOC-22 §8, DR-18): the reads of §8.2, the E-101 filters and summary of DOC-66 §5, the payments
 * page of E-102 and the reminder rows of §8.5. A port in `domain/` (DOC-12 §4.5); the Drizzle adapter is in
 * `infrastructure/persistence/`. "Open" means an `open` charge of a `published` or `closed` batch. Every read takes the building's
 * today, computed once per request by the caller (DR-09).
 */
import type { BuildingScope, LocalDate, Money } from '@rms/shared-types'
import type { AgingBucket } from './aging'

/** One row of the debt list (E-101): the debt aggregate of a unit, without its code or owner. */
export interface UnitDebt {
  readonly unitId: string
  readonly outstanding: Money
  readonly openCharges: number
  readonly oldestDue: LocalDate
  readonly maxDaysPastDue: number
  readonly overdue30: Money
}

/**
 * One row of E-101 (DOC-66 §5): the debt aggregate with the unit code (from the charge snapshot) and the last reminder instant
 * of the unit. `unitCode` and `lastReminderAt` are finance's own columns; the owner is added by the query service through a port.
 */
export interface DebtRow extends UnitDebt {
  readonly unitCode: string
  readonly lastReminderAt: Date | null
}

/** The filters of E-101 (DOC-66 §5): `month` a fee month `YYYY-MM`, `q` a unit-code substring, `overdue30` the switch. */
export interface DebtFilter {
  /** Only the charges of the batches of this fee month (DOC-66 §5); `undefined` is "all months". */
  readonly month?: string
  /** A case-insensitive unit-code substring (the screen's "Tìm mã căn, chủ hộ", DOC-66 §5). */
  readonly q?: string
  /** Only the units with an open charge more than 30 days past due (the switch of DOC-66 §5). */
  readonly overdue30?: boolean
}

/** The building-wide totals of E-101's first page (DOC-66 §5), over the same filter as the list. */
export interface DebtSummaryRow {
  readonly outstanding: Money
  readonly units: number
  readonly overdue30: Money
  readonly overdue30Units: number
}

/** One open charge of a unit (E-102 and the manual-payment form), with the active intent when there is one (FR-05.6). */
export interface OpenChargeOfUnit {
  readonly chargeId: string
  readonly amount: Money
  readonly version: number
  readonly batchCode: string
  readonly batchName: { readonly vi: string; readonly en?: string }
  readonly feeMonth: LocalDate
  readonly dueDate: LocalDate
  readonly daysPastDue: number
  readonly activeIntentSince: Date | null
}

export interface AgingRow {
  readonly bucket: AgingBucket
  readonly units: number
  readonly charges: number
  readonly amount: Money
}

/** The collection rate of a fee month (DOC-22 §8.1, DR-267 item 4): `paid ÷ billed`, both `published`/`closed` batches. */
export interface CollectionRow {
  readonly feeMonth: LocalDate
  readonly billed: Money
  readonly paid: Money
}

export interface DebtRepository {
  /**
   * E-101: one row per unit, `outstanding DESC, unit_id DESC`, keyset after `(outstanding, unitId)`, at most `limit` rows,
   * narrowed by the `filter` of DOC-66 §5.
   */
  list(
    scope: BuildingScope,
    today: LocalDate,
    page: {
      readonly after?: { readonly outstanding: Money; readonly unitId: string }
      readonly limit: number
      readonly filter?: DebtFilter
    },
  ): Promise<readonly DebtRow[]>
  /** E-101's first page totals over the same filter (DOC-66 §5): the sum, the unit count and the over-30 days figures. */
  summary(scope: BuildingScope, today: LocalDate, filter?: DebtFilter): Promise<DebtSummaryRow>
  /** The same per-unit debt for the given ids; units with nothing open are absent (FinanceApi.getOutstandingByUnit). */
  byUnits(
    scope: BuildingScope,
    today: LocalDate,
    unitIds: readonly string[],
  ): Promise<readonly UnitDebt[]>
  /** E-102: `fee_month, id` order. */
  openChargesOfUnit(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
  ): Promise<readonly OpenChargeOfUnit[]>
  /** The five buckets of DR-18 that have rows. */
  aging(scope: BuildingScope, today: LocalDate): Promise<readonly AgingRow[]>
  collectionByMonth(scope: BuildingScope): Promise<readonly CollectionRow[]>
  /**
   * DOC-22 §8.5 step 3: `INSERT … ON CONFLICT (building_id, unit_id, reminder_day) DO NOTHING RETURNING`; answers the rows
   * written (a unit absent from the answer was reminded on this building day already).
   */
  insertReminders(
    scope: BuildingScope,
    day: LocalDate,
    sentBy: string,
    reminders: ReadonlyArray<{
      readonly id: string
      readonly unitId: string
      readonly chargeCount: number
      readonly amount: Money
    }>,
  ): Promise<ReadonlyArray<{ readonly reminderId: string; readonly unitId: string }>>
}
