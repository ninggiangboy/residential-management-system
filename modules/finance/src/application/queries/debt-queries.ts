import type { Clock } from '@core/kernel'
import {
  type BuildingScope,
  buildingToday,
  type LocalDate,
  type Money,
  money,
} from '@rms/shared-types'
import { AGING_BUCKETS, type AgingBucket, bucketOf } from '../../domain/aging'
import type {
  AgingRow,
  CollectionRow,
  DebtRepository,
  OpenChargeOfUnit,
  UnitDebt,
} from '../../domain/debt-repository'
import { RequestRuleError } from '../../domain/errors'
import type { BuildingCalendar } from '../ports'

/** The page size of E-101 when the caller does not ask (DOC-22 §8.2, FR-12.5). */
const DEFAULT_PAGE_LIMIT = 50

/** The largest page E-101 serves. */
const MAX_PAGE_LIMIT = 100

/** `byUnits` serves `FinanceApi.getOutstandingByUnit`, at most 500 ids (DOC-22 §2.2, §8.2, DR-267 item 5). */
const MAX_UNIT_IDS = 500

/** E-101's keyset: the last row of the previous page, ordered `outstanding DESC, unit_id DESC` (DOC-22 §8.2). */
export interface DebtCursor {
  readonly outstanding: Money
  readonly unitId: string
}

/** The page E-101 is asked for; `limit` defaults to 50 and never exceeds 100. */
export interface DebtPage {
  readonly after?: DebtCursor
  readonly limit?: number
}

export interface DebtList {
  readonly rows: readonly UnitDebt[]
  readonly next: DebtCursor | null
}

/** One open charge with its aging bucket and overdue flag (DOC-22 §8.1). */
export interface OpenChargeView extends OpenChargeOfUnit {
  readonly bucket: AgingBucket
  readonly overdue: boolean
}

export interface UnitDebtView {
  readonly unitId: string
  readonly charges: readonly OpenChargeView[]
  readonly total: Money
  readonly count: number
}

/** A fee month with its collection rate in percent to one decimal (DOC-22 §8.1, DR-267 item 4). */
export type CollectedMonth = CollectionRow & { readonly rate: number }

/**
 * The debt reads of E-101, E-102, the aging report, the collection rate and `FinanceApi.getOutstandingByUnit` (DOC-22 §8, §2.2).
 * A query service (DOC-12 §4.5): no use case file per read. Debt is computed, never stored; each method computes the building's
 * today once and passes it down (DR-09).
 */
export class DebtQueries {
  constructor(
    private readonly debts: DebtRepository,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
  ) {}

  /** E-101: one row per unit with debt, `outstanding DESC, unit_id DESC`, keyset paged (DOC-22 §8.2). */
  async list(scope: BuildingScope, page: DebtPage): Promise<DebtList> {
    const limit = pageLimit(page.limit)
    const today = await this.today(scope)
    const rows = await this.debts.list(scope, today, { after: page.after, limit: limit + 1 })
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    return {
      rows: items,
      next: last ? { outstanding: last.outstanding, unitId: last.unitId } : null,
    }
  }

  /** E-102 and the manual-payment form: the open charges of a unit; nothing open answers an empty list, not 404. */
  async unit(scope: BuildingScope, unitId: string): Promise<UnitDebtView> {
    const today = await this.today(scope)
    const charges = await this.debts.openChargesOfUnit(scope, today, unitId)
    const views = charges.map((charge) => ({
      ...charge,
      bucket: bucketOf(charge.daysPastDue),
      overdue: charge.daysPastDue > 0,
    }))
    return {
      unitId,
      charges: views,
      total: money(views.reduce((sum, charge) => sum + charge.amount, 0n)),
      count: views.length,
    }
  }

  /** The aging of the building: all five buckets in `AGING_BUCKETS` order, a missing one filled with zeros (DOC-22 §8.1). */
  async aging(scope: BuildingScope): Promise<readonly AgingRow[]> {
    const today = await this.today(scope)
    const rows = await this.debts.aging(scope, today)
    const byBucket = new Map(rows.map((row) => [row.bucket, row] as const))
    return AGING_BUCKETS.map(
      (bucket) => byBucket.get(bucket) ?? { bucket, units: 0, charges: 0, amount: money(0) },
    )
  }

  /** The collection rate of every billed fee month, `paid ÷ billed` as a percentage to one decimal (DOC-22 §8.1, LG-42). */
  async collectionByMonth(scope: BuildingScope): Promise<readonly CollectedMonth[]> {
    const rows = await this.debts.collectionByMonth(scope)
    return rows
      .filter((row) => row.billed > 0n)
      .map((row) => ({ ...row, rate: collectionRate(row.paid, row.billed) }))
  }

  /** `FinanceApi.getOutstandingByUnit(unitIds)` for a later reader (DOC-22 §2.2): at most 500 ids. */
  async byUnits(scope: BuildingScope, unitIds: readonly string[]): Promise<readonly UnitDebt[]> {
    if (unitIds.length > MAX_UNIT_IDS)
      throw new RequestRuleError('unitIds', 'too_many_units', `At most ${MAX_UNIT_IDS} units`)
    const today = await this.today(scope)
    return this.debts.byUnits(scope, today, unitIds)
  }

  private async today(scope: BuildingScope): Promise<LocalDate> {
    const timeZone = await this.calendar.timeZone(scope.buildingId)
    return buildingToday(this.clock.now(), timeZone)
  }
}

/** The rate is a percentage to one decimal (100.0, 0.0); a month with nothing billed is filtered out first. */
const collectionRate = (paid: Money, billed: Money): number =>
  Math.round((Number(paid) / Number(billed)) * 1000) / 10

const pageLimit = (limit: number | undefined): number =>
  Math.min(limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
