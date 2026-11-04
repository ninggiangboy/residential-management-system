import { NotFoundError } from '@core/kernel'
import type { BuildingScope, StaffRole } from '@rms/shared-types'
import type {
  MoneyLogDetail,
  MoneyLogFilter,
  MoneyLogKind,
  MoneyLogRepository,
  MoneyLogRow,
} from '../../domain/money-log-repository'
import type { DebtUnitDirectory } from '../ports'

/** The Manager's and the Admin's: the money log is staff only (DOC-22 §9.4, FR-47.3). */
export const MONEY_LOG_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** No directory wired (a unit test): no unit belongs to the building. */
const NO_UNITS: DebtUnitDirectory = { units: async () => [] }

/** The page size of the viewer when the caller does not ask (DOC-22 §9.4, FR-47.1). */
const DEFAULT_PAGE_LIMIT = 50

/** The largest page the viewer serves. */
const MAX_PAGE_LIMIT = 100

/** E-108's filters with the page size optional (DOC-22 §9.4). */
export type MoneyLogListFilter = Omit<MoneyLogFilter, 'limit'> & { readonly limit?: number }

export interface MoneyLogList {
  readonly rows: readonly MoneyLogRow[]
  readonly next: { readonly at: Date; readonly id: string } | null
}

/**
 * The money-log reads of E-108, E-110 and the drawer (DOC-22 §9.4, §9.2). A query service (DOC-12 §4.5): no use case file per
 * read. Nothing here links a row to a charge, period or payment (DR-84, DR-16).
 */
export class MoneyLogQueries {
  constructor(
    private readonly log: MoneyLogRepository,
    /** Tells whether a unit belongs to the building: `finance` has no unit table (DOC-66 §5). */
    private readonly units: DebtUnitDirectory = NO_UNITS,
  ) {}

  /** E-108: the union of §9.4, newest first, keyset paged at most 100 rows (FR-47.1). */
  async list(scope: BuildingScope, filter: MoneyLogListFilter): Promise<MoneyLogList> {
    const limit = pageLimit(filter.limit)
    const rows = await this.log.list(scope, { ...filter, limit: limit + 1 })
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    return {
      rows: items,
      next: last ? { at: last.at, id: last.id } : null,
    }
  }

  /**
   * E-110 `UnitMoneyPanel`: the unit's `gateway_event` rows, newest first (DOC-22 §9.4). An unknown unit, or one of another
   * building, is 404 and not an empty list (DOC-39 §4.4).
   */
  async byUnit(
    scope: BuildingScope,
    unitId: string,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<readonly MoneyLogRow[]> {
    const [unit] = await this.units.units(scope.buildingId, [unitId])
    if (!unit) throw new NotFoundError()
    return this.log.byUnit(scope, unitId, limit)
  }

  /** The drawer of a row (FR-47.2); an unknown or foreign id is 404. */
  async detail(scope: BuildingScope, kind: MoneyLogKind, id: string): Promise<MoneyLogDetail> {
    const row = await this.log.detail(scope, kind, id)
    if (!row) throw new NotFoundError()
    return row
  }
}

const pageLimit = (limit: number | undefined): number =>
  Math.min(limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
