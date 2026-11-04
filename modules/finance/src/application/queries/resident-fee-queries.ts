import { type Clock, NotFoundError } from '@core/kernel'
import {
  buildingToday,
  type LocalDate,
  type Money,
  money,
  type UnitContext,
} from '@rms/shared-types'
import type {
  ResidentChargeView,
  ResidentFeeCursor,
  ResidentFeeReader,
  ResidentHistoryRow,
  ResidentOpenCharge,
  ResidentReceiptCursor,
  ResidentReceiptRow,
} from '../../domain/resident-fee-reader'
import type { BuildingCalendar } from '../ports'

/** The page size of E-82 and E-83 when the caller does not ask (DOC-58 §5). */
const DEFAULT_PAGE_LIMIT = 20

/** The largest page E-82 and E-83 serve (DOC-58 §5). */
const MAX_PAGE_LIMIT = 50

/** E-80 answers at most 100 open charges (DOC-22 §8.4, DR-323). */
const MAX_OPEN_CHARGES = 100

/** The E-80 page: the unit's open charges with the total and the count (DOC-22 §8.4, DR-323). */
export interface ResidentFeesOpen {
  readonly items: readonly ResidentOpenChargeView[]
  readonly total: Money
  readonly count: number
}

/** One open charge with its `overdue` flag (DOC-22 §8.1); `daysPastDue > 0`. */
export interface ResidentOpenChargeView extends ResidentOpenCharge {
  readonly overdue: boolean
}

/** E-82's cursor and page size (`after` is the last row of the previous page, DOC-58 §5). */
export interface ResidentFeePage {
  readonly after?: ResidentFeeCursor
  readonly limit?: number
}

/** The summary card of E-82's first page (DOC-58 §4, DR-323). */
export interface ResidentFeeSummary {
  readonly outstanding: Money
  readonly paidThisYear: Money
}

/** The E-82 page; `summary` is set on the first page only (no `after`), `null` on the later pages (DOC-58 §5). */
export interface ResidentFeeHistory {
  readonly items: readonly ResidentHistoryRow[]
  readonly next: ResidentFeeCursor | null
  readonly summary: ResidentFeeSummary | null
}

/** E-83's cursor and page size (`after` is the last row of the previous page). */
export interface ResidentReceiptPage {
  readonly after?: ResidentReceiptCursor
  readonly limit?: number
}

/** The E-83 page. */
export interface ResidentReceiptList {
  readonly items: readonly ResidentReceiptRow[]
  readonly next: ResidentReceiptCursor | null
}

/**
 * The resident fee reads of E-80…E-83 (DOC-22 §8.4, DOC-58, DR-40, DR-323). A query service (DOC-12 §4.5): no use case file
 * per read. The methods take the `UnitContext` the `unit('view_fees')` guard built (DOC-12 §11.1); the route has already
 * checked the capability, so there is no staff role here and a manager-level gate never applies. Debt follows the unit: the
 * open charges are always visible, and paid history, receipts and a paid/void detail only from `unit.startedAt` (DR-40). Each
 * method reads the building's today once and passes it down (DR-09).
 */
export class ResidentFeeQueries {
  constructor(
    private readonly reader: ResidentFeeReader,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
  ) {}

  /** E-80: the unit's open charges, oldest due first, with the total and the count (DOC-22 §8.4). */
  async open(unit: UnitContext): Promise<ResidentFeesOpen> {
    const today = await this.today(unit)
    const charges = await this.reader.openCharges(unit.scope, today, unit.unitId, MAX_OPEN_CHARGES)
    const items = charges.map((charge) => ({ ...charge, overdue: charge.daysPastDue > 0 }))
    return {
      items,
      total: money(items.reduce((sum, charge) => sum + charge.amount, 0n)),
      count: items.length,
    }
  }

  /** E-81: one charge; an `open` one always, a `paid`/`void` one only inside the DR-40 window, otherwise 404 (DOC-22 §8.4). */
  async detail(unit: UnitContext, chargeId: string): Promise<ResidentChargeView> {
    const today = await this.today(unit)
    const detail = await this.reader.chargeDetail(unit.scope, today, unit.unitId, chargeId)
    if (!detail) throw new NotFoundError()
    if (detail.charge.status === 'open') return detail.charge
    const visibleFrom = detail.visibleFrom
    if (visibleFrom === null || visibleFrom.getTime() < unit.startedAt.getTime())
      throw new NotFoundError()
    return detail.charge
  }

  /** E-82: the paid charges newest first, keyset paged; the first page adds the summary (DOC-22 §8.4, DOC-58 §5). */
  async history(unit: UnitContext, page: ResidentFeePage = {}): Promise<ResidentFeeHistory> {
    const limit = pageLimit(page.limit)
    const { today, timeZone } = await this.now(unit)
    const rows = await this.reader.history(
      unit.scope,
      unit.unitId,
      unit.startedAt,
      page.after,
      limit + 1,
    )
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    return {
      items,
      next: last ? { receivedAt: last.payment.receivedAt, chargeId: last.chargeId } : null,
      summary: page.after ? null : await this.summary(unit, today, timeZone),
    }
  }

  /** E-83: the unit's receipts newest first, keyset paged, `void` ones included (DOC-22 §8.4). */
  async receipts(unit: UnitContext, page: ResidentReceiptPage = {}): Promise<ResidentReceiptList> {
    const limit = pageLimit(page.limit)
    const rows = await this.reader.receipts(
      unit.scope,
      unit.unitId,
      unit.startedAt,
      page.after,
      limit + 1,
    )
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    return {
      items,
      next: last ? { issuedAt: last.issuedAt, receiptId: last.receiptId } : null,
    }
  }

  /** E-82's summary (DR-323): the open total, and the paid total inside the building-local current year (DOC-58 §5). */
  private async summary(
    unit: UnitContext,
    today: LocalDate,
    timeZone: string,
  ): Promise<ResidentFeeSummary> {
    const year = Number(today.slice(0, 4))
    const [outstanding, paidThisYear] = await Promise.all([
      this.reader.openOutstanding(unit.scope, unit.unitId),
      this.reader.paidInRange(
        unit.scope,
        unit.unitId,
        unit.startedAt,
        timeZone,
        `${pad(year, 4)}-01-01` as LocalDate,
        `${pad(year + 1, 4)}-01-01` as LocalDate,
      ),
    ])
    return { outstanding, paidThisYear }
  }

  private async now(unit: UnitContext): Promise<{ today: LocalDate; timeZone: string }> {
    const timeZone = await this.calendar.timeZone(unit.buildingId)
    return { today: buildingToday(this.clock.now(), timeZone), timeZone }
  }

  private async today(unit: UnitContext): Promise<LocalDate> {
    return (await this.now(unit)).today
  }
}

const pageLimit = (limit: number | undefined): number =>
  Math.min(limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)

const pad = (n: number, width: number): string => String(n).padStart(width, '0')
