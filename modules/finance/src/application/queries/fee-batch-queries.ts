import { NotFoundError, requireRole } from '@core/kernel'
import type { BuildingScope, StaffContext, StaffRole } from '@rms/shared-types'
import type { ChargeStatus, FeeBatchRecord, FeeBatchStatus } from '../../domain/fee-batch'
import type {
  BatchChargeCursor,
  BatchChargeItem,
  ChargeWithLines,
  FeeBatchListCursor,
  FeeBatchListItem,
  FeeBatchReader,
  FeeBatchStatusCounts,
  FeeBatchView,
} from '../../domain/fee-batch-reader'

/** The Manager's and the Admin's (EP:181-185, DOC-21 §3); the routes read the same list for their guard and audience. */
export const FEE_BATCH_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** The page size of E-89 when the caller does not ask (DOC-66 §5). */
const DEFAULT_LIST_LIMIT = 20

/** The largest page E-89 serves. */
const MAX_LIST_LIMIT = 100

/** The page size of E-93 when the caller does not ask (DOC-66 §5). */
const DEFAULT_CHARGE_LIMIT = 50

/** The largest page E-93 serves. */
const MAX_CHARGE_LIMIT = 200

/**
 * The active owner name of each unit (DOC-34 §6.1, DR-292), as the charge list of E-93 needs it. It is
 * `NoticeContextSource.ownerNames`; the owner name is not a column of `finance` (P2-15 slice 1). Optional so a caller without it
 * still reads the batch screens; the routes of P2-15 wire it.
 */
export interface OwnerNames {
  ownerNames(buildingId: string, unitIds: string[]): Promise<Map<string, string | null>>
}

/** The query of E-89 (DOC-66 §5); `limit` defaults to 20 and never exceeds 100. */
export interface FeeBatchListQuery {
  readonly status?: FeeBatchStatus
  readonly month?: string
  readonly q?: string
  readonly after?: FeeBatchListCursor
  readonly limit?: number
}

export interface FeeBatchListPage {
  readonly items: readonly FeeBatchListItem[]
  readonly next: FeeBatchListCursor | null
  /** Present on the first page only (DOC-66 §5). */
  readonly counts?: FeeBatchStatusCounts
  readonly totalCount?: number
}

/** The query of E-93 (DOC-66 §5); `limit` defaults to 50 and never exceeds 200. */
export interface BatchChargePageQuery {
  /** `missing` lists the owned units without a charge; the default is `all`. */
  readonly view?: 'all' | 'missing'
  readonly q?: string
  readonly status?: ChargeStatus
  readonly voidKind?: 'recall' | 'single'
  readonly includeLines?: boolean
  readonly after?: BatchChargeCursor
  readonly limit?: number
}

export interface BatchChargePage {
  readonly items: readonly BatchChargeItem[]
  readonly next: BatchChargeCursor | null
}

/** Query service of the batch screens (DOC-12 §4.5): no use case file per read. */
export class FeeBatchQueries {
  constructor(
    private readonly reader: FeeBatchReader,
    private readonly owners?: OwnerNames,
  ) {}

  async batch(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord> {
    const batch = await this.reader.findBatch(scope, batchId)
    if (!batch) throw new NotFoundError()
    return batch
  }

  async charges(scope: BuildingScope, batchId: string): Promise<readonly ChargeWithLines[]> {
    await this.batch(scope, batchId)
    return this.reader.chargesOf(scope, batchId)
  }

  /** E-89: the batch list of the staff screen, keyset paged, with the building's status counts on the first page (DOC-66 §5). */
  async list(staff: StaffContext, query: FeeBatchListQuery): Promise<FeeBatchListPage> {
    requireRole(staff, FEE_BATCH_READ_ROLES)
    const limit = pageLimit(query.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
    const page = await this.reader.listBatches(staff.scope, {
      status: query.status,
      month: query.month,
      q: query.q,
      after: query.after,
      limit: limit + 1,
    })
    const items = page.rows.slice(0, limit)
    const last = page.rows.length > limit ? items.at(-1) : undefined
    const next = last ? { feeMonth: last.feeMonth, id: last.id } : null
    return page.counts
      ? { items, next, counts: page.counts, totalCount: page.totalCount ?? 0 }
      : { items, next }
  }

  /** E-91: the header, the counts and the provenance of one batch; a foreign id is 404 like an unknown one (DOC-66 §5). */
  async view(staff: StaffContext, batchId: string): Promise<FeeBatchView> {
    requireRole(staff, FEE_BATCH_READ_ROLES)
    const view = await this.reader.findBatchView(staff.scope, batchId)
    if (!view) throw new NotFoundError()
    return view
  }

  /** E-93: the charges of a batch, keyset by unit code, lines on demand (DOC-66 §5). */
  async chargesPage(
    staff: StaffContext,
    batchId: string,
    query: BatchChargePageQuery,
  ): Promise<BatchChargePage> {
    requireRole(staff, FEE_BATCH_READ_ROLES)
    const batch = await this.reader.findBatch(staff.scope, batchId)
    if (!batch) throw new NotFoundError()
    // `view=missing` (DOC-66 §5, DR-324: `ownedUnitCount − chargedUnitCount`) needs the building's owned units, which no port of
    // `finance` lists in this slice; it answers an empty page (P2-15 slice 1).
    if (query.view === 'missing') return { items: [], next: null }
    const limit = pageLimit(query.limit, DEFAULT_CHARGE_LIMIT, MAX_CHARGE_LIMIT)
    const rows = await this.reader.chargesPage(staff.scope, batchId, {
      status: query.status,
      voidKind: query.voidKind,
      q: query.q,
      includeLines: query.includeLines,
      after: query.after,
      limit: limit + 1,
    })
    const items = rows.slice(0, limit)
    const last = rows.length > limit ? items.at(-1) : undefined
    return {
      items: await this.withOwners(staff.scope, items),
      next: last ? { unitCode: last.unitCode, id: last.chargeId } : null,
    }
  }

  /** The owner name of each item, in one call (DOC-34 §6.1, DR-292); `null` when no owner port was wired. */
  private async withOwners(
    scope: BuildingScope,
    items: readonly BatchChargeItem[],
  ): Promise<readonly BatchChargeItem[]> {
    if (!this.owners || items.length === 0) return items
    const names = await this.owners.ownerNames(
      scope.buildingId,
      items.map((item) => item.unitId),
    )
    return items.map((item) => ({ ...item, ownerName: names.get(item.unitId) ?? null }))
  }
}

const pageLimit = (limit: number | undefined, fallback: number, max: number): number =>
  Math.min(limit ?? fallback, max)
