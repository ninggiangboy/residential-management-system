import { type Clock, NotFoundError } from '@core/kernel'
import {
  type BuildingScope,
  buildingToday,
  type LocalDate,
  type Money,
  money,
  type StaffRole,
} from '@rms/shared-types'
import { AGING_BUCKETS, type AgingBucket, bucketOf } from '../../domain/aging'
import type {
  AgingRow,
  CollectionRow,
  DebtFilter,
  DebtRepository,
  DebtRow,
  OpenChargeOfUnit,
  UnitDebt,
} from '../../domain/debt-repository'
import { RequestRuleError } from '../../domain/errors'
import type { BilingualName } from '../../domain/fee-batch'
import type {
  UnitPaymentCursor,
  UnitPaymentRow,
  UnitPaymentsReader,
} from '../../domain/unit-payments-reader'
import type { BuildingCalendar, DebtUnitDirectory } from '../ports'

/** The page size of E-101 when the caller does not ask (DOC-22 §8.2, FR-12.5). */
const DEFAULT_PAGE_LIMIT = 50

/** The largest page E-101 serves. */
const MAX_PAGE_LIMIT = 100

/** E-102's payments page size (DOC-66 §5, DR-324 item 5). */
const PAYMENTS_PAGE = 20

/** `byUnits` serves `FinanceApi.getOutstandingByUnit`, at most 500 ids (DOC-22 §2.2, §8.2, DR-267 item 5). */
const MAX_UNIT_IDS = 500

/** The Manager's and the Admin's alone (DOC-66 §5); the route reads the same list for its guard and audience. */
export const DEBT_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** A query service with no unit or payments port yet (a test, or the module before the container wires the adapters). */
const NO_UNITS: DebtUnitDirectory = { units: async () => [] }
const NO_PAYMENTS: UnitPaymentsReader = { payments: async () => [] }

/** E-101's keyset: the last row of the previous page, ordered `outstanding DESC, unit_id DESC` (DOC-22 §8.2). */
export interface DebtCursor {
  readonly outstanding: Money
  readonly unitId: string
}

/** The page E-101 is asked for (DOC-66 §5): `limit` defaults to 50 and never exceeds 100; `summary` adds the first-page tiles. */
export interface DebtPage {
  readonly after?: DebtCursor
  readonly limit?: number
  /** The filters of DOC-66 §5: a fee month, a unit-code search and the "more than 30 days overdue" switch. */
  readonly filter?: DebtFilter
  /** Ask for the `summary` and `asOf` of the first page (DOC-66 §5); ignored once `after` is set. */
  readonly summary?: boolean
}

/** One row of E-101's list as the route sends it (DOC-66 §5): the debt aggregate with the unit code, the owner and the reminder. */
export interface DebtRowView extends DebtRow {
  readonly ownerName: string | null
  readonly ownerPhone: string | null
}

/** E-101's first-page tiles (DOC-66 §5); `ownedUnits` is `null` when no contract read offers the count. */
export interface DebtSummary {
  readonly outstanding: Money
  readonly units: number
  readonly ownedUnits: number | null
  readonly overdue30: { readonly amount: Money; readonly units: number }
  readonly collected: {
    readonly feeMonth: LocalDate
    readonly amount: Money
    readonly rate: number
  } | null
}

export interface DebtList {
  readonly rows: readonly DebtRowView[]
  readonly next: DebtCursor | null
  /** The tiles of DOC-66 §5, on the first page when asked; `null` on a later page or when `summary` was not asked. */
  readonly summary: DebtSummary | null
  /** The building day of the read; `null` when `summary` was not asked. */
  readonly asOf: LocalDate | null
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

/** One open charge of E-102 (DOC-66 §5): its batch, its age and the active intent holding it when there is one (FR-05.6). */
export interface UnitOpenCharge {
  readonly chargeId: string
  readonly batch: {
    readonly code: string
    readonly name: BilingualName
    readonly feeMonth: LocalDate
  }
  readonly amount: Money
  readonly dueDate: LocalDate
  readonly daysPastDue: number
  readonly version: number
  readonly activeIntent: { readonly since: Date } | null
}

/** E-102's tiles (DOC-66 §5): the outstanding, the open count, the nearest due date and the amount past due. */
export interface UnitDebtSummary {
  readonly outstanding: Money
  readonly openCharges: number
  readonly nearestDue: LocalDate | null
  readonly overdueAmount: Money
}

/** E-102's payments page is asked for with `paymentsAfter` (DOC-66 §5). */
export interface UnitDebtPage {
  readonly paymentsAfter?: UnitPaymentCursor
}

/** E-102 (DOC-66 §5, DR-324 item 5): the unit, its owner, its tiles, its open charges and its payments page. */
export interface UnitDebtDetail {
  readonly unit: {
    readonly id: string
    readonly code: string
    readonly floor: number | null
    readonly areaM2: string | null
  }
  readonly owner: { readonly name: string | null; readonly phone: string | null }
  readonly summary: UnitDebtSummary
  readonly openCharges: readonly UnitOpenCharge[]
  readonly payments: readonly UnitPaymentRow[]
  readonly nextCursor: UnitPaymentCursor | null
}

/** A fee month with its collection rate in percent to one decimal (DOC-22 §8.1, DR-267 item 4). */
export type CollectedMonth = CollectionRow & { readonly rate: number }

/**
 * The debt reads of E-101, E-102, the aging report, the collection rate and `FinanceApi.getOutstandingByUnit` (DOC-22 §8, §2.2,
 * DOC-66 §5). A query service (DOC-12 §4.5): no use case file per read. Debt is computed, never stored; each method computes the
 * building's today once and passes it down (DR-09). Unit codes and owner names come from `DebtUnitDirectory`, never a join.
 */
export class DebtQueries {
  constructor(
    private readonly debts: DebtRepository,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
    /** The unit and owner read of E-101/E-102 (DOC-66 §5); the container wires `debtUnitDirectory(residency.api)`. */
    private readonly units: DebtUnitDirectory = NO_UNITS,
    /** The payments read of E-102 (DOC-66 §5, DR-327). */
    private readonly unitPayments: UnitPaymentsReader = NO_PAYMENTS,
  ) {}

  /** E-101: one row per unit with debt, `outstanding DESC, unit_id DESC`, keyset paged (DOC-22 §8.2, DOC-66 §5). */
  async list(scope: BuildingScope, page: DebtPage): Promise<DebtList> {
    const limit = pageLimit(page.limit)
    const today = await this.today(scope)
    const rows = await this.debts.list(scope, today, {
      after: page.after,
      limit: limit + 1,
      filter: page.filter,
    })
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    const firstPage = page.summary === true && page.after === undefined
    const [views, summary] = await Promise.all([
      this.withOwners(scope, items),
      firstPage ? this.summary(scope, today, page.filter) : Promise.resolve(null),
    ])
    return {
      rows: views,
      next: last ? { outstanding: last.outstanding, unitId: last.unitId } : null,
      summary,
      asOf: firstPage ? today : null,
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

  /**
   * E-102 (DOC-66 §5): the unit (code, floor, area from `DebtUnitDirectory`), its owner, its tiles, its open charges and its
   * payments page. An unknown unit, or one of another building, is 404 — the debt and the payments are building-scoped and the
   * unit read keeps only the building (DR-324 item 5).
   */
  async unitView(
    scope: BuildingScope,
    unitId: string,
    page: UnitDebtPage = {},
  ): Promise<UnitDebtDetail> {
    const today = await this.today(scope)
    const [profiles, charges] = await Promise.all([
      this.units.units(scope.buildingId, [unitId]),
      this.debts.openChargesOfUnit(scope, today, unitId),
    ])
    const profile = profiles.find((entry) => entry.unitId === unitId)
    if (!profile) throw new NotFoundError()
    const rows = await this.unitPayments.payments(
      scope,
      unitId,
      page.paymentsAfter,
      PAYMENTS_PAGE + 1,
    )
    const payments = rows.slice(0, PAYMENTS_PAGE)
    const last = rows.length > PAYMENTS_PAGE ? payments.at(-1) : undefined
    return {
      unit: {
        id: profile.unitId,
        code: profile.code,
        floor: profile.floor,
        areaM2: profile.areaM2,
      },
      owner: { name: profile.ownerName, phone: profile.ownerPhone },
      summary: summaryOfUnit(charges),
      openCharges: charges.map(toOpenCharge),
      payments,
      nextCursor: last ? { receivedAt: last.receivedAt, paymentId: last.paymentId } : null,
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

  /** Adds the owner of each row from `DebtUnitDirectory` (DOC-66 §5); a row without a profile keeps `null` owner fields. */
  private async withOwners(
    scope: BuildingScope,
    rows: readonly DebtRow[],
  ): Promise<readonly DebtRowView[]> {
    if (rows.length === 0) return []
    const profiles = await this.units.units(
      scope.buildingId,
      rows.map((row) => row.unitId),
    )
    const byUnit = new Map(profiles.map((profile) => [profile.unitId, profile] as const))
    return rows.map((row) => ({
      ...row,
      ownerName: byUnit.get(row.unitId)?.ownerName ?? null,
      ownerPhone: byUnit.get(row.unitId)?.ownerPhone ?? null,
    }))
  }

  /** E-101's first-page tiles (DOC-66 §5): the filtered totals and the collected amount of the month or the latest one. */
  private async summary(
    scope: BuildingScope,
    today: LocalDate,
    filter: DebtFilter | undefined,
  ): Promise<DebtSummary> {
    const [totals, collected] = await Promise.all([
      this.debts.summary(scope, today, filter),
      this.collected(scope, filter?.month),
    ])
    return {
      outstanding: totals.outstanding,
      units: totals.units,
      // DOC-66 §5: `ResidencyApi` exposes no building-wide count of units with an active owner, so the tile has no figure.
      ownedUnits: null,
      overdue30: { amount: totals.overdue30, units: totals.overdue30Units },
      collected,
    }
  }

  /** The collected tile (DOC-66 §5): the `month` filter, or the latest fee month that has a published or closed batch. */
  private async collected(
    scope: BuildingScope,
    month: string | undefined,
  ): Promise<DebtSummary['collected']> {
    const rows = await this.debts.collectionByMonth(scope)
    if (rows.length === 0) return null
    const shown = month ? rows.find((row) => row.feeMonth === firstOf(month)) : rows.at(-1)
    if (!shown) return null
    return {
      feeMonth: shown.feeMonth,
      amount: shown.paid,
      rate: collectionRate(shown.paid, shown.billed),
    }
  }

  private async today(scope: BuildingScope): Promise<LocalDate> {
    const timeZone = await this.calendar.timeZone(scope.buildingId)
    return buildingToday(this.clock.now(), timeZone)
  }
}

/** The rate is a percentage to one decimal (100.0, 0.0); a month with nothing billed is filtered out first. */
const collectionRate = (paid: Money, billed: Money): number =>
  Math.round((Number(paid) / Number(billed)) * 1000) / 10

/** `YYYY-MM` → `YYYY-MM-01`; a full day is left as it is (the fee month is the first of its month). */
const firstOf = (month: string): string => (month.length === 7 ? `${month}-01` : month)

/** One open charge of E-102 (DOC-66 §5): the batch, the age and the active intent as the object it prints. */
const toOpenCharge = (charge: OpenChargeOfUnit): UnitOpenCharge => ({
  chargeId: charge.chargeId,
  batch: { code: charge.batchCode, name: charge.batchName, feeMonth: charge.feeMonth },
  amount: charge.amount,
  dueDate: charge.dueDate,
  daysPastDue: charge.daysPastDue,
  version: charge.version,
  activeIntent: charge.activeIntentSince ? { since: charge.activeIntentSince } : null,
})

/** E-102's tiles from the unit's open charges (DOC-66 §5): a charge due today is not overdue (FR-12.1). */
function summaryOfUnit(charges: readonly OpenChargeOfUnit[]): UnitDebtSummary {
  let nearestDue: LocalDate | null = null
  let overdueAmount = 0n
  let outstanding = 0n
  for (const charge of charges) {
    outstanding += charge.amount
    if (nearestDue === null || charge.dueDate < nearestDue) nearestDue = charge.dueDate
    if (charge.daysPastDue > 0) overdueAmount += charge.amount
  }
  return {
    outstanding: money(outstanding),
    openCharges: charges.length,
    nearestDue,
    overdueAmount: money(overdueAmount),
  }
}

const pageLimit = (limit: number | undefined): number =>
  Math.min(limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
