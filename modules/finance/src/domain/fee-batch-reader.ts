import type { BuildingScope, LocalDate, Money } from '@rms/shared-types'
import type {
  BilingualName,
  ChargeRecord,
  ChargeStatus,
  FeeBatchRecord,
  FeeBatchStatus,
} from './fee-batch'

/** The reads of a batch and its charges (DOC-21 §3); the screens of P2-15 and P2-16 build on them. */
export interface FeeBatchReader {
  findBatch(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord | null>
  chargesOf(scope: BuildingScope, batchId: string): Promise<readonly ChargeWithLines[]>
  /** E-89 (DOC-66 §5): one keyset page ordered `fee_month DESC, id DESC`, with its row aggregates (P2-15). */
  listBatches(scope: BuildingScope, page: FeeBatchPageQuery): Promise<FeeBatchListResult>
  /** E-91 (DOC-66 §5): the screen fields of one batch, or `null` when it is not in the scope (P2-15). */
  findBatchView(scope: BuildingScope, batchId: string): Promise<FeeBatchView | null>
  /** E-93 (DOC-66 §5): one keyset page of a batch's charges ordered `unit_code, id` (P2-15). */
  chargesPage(
    scope: BuildingScope,
    batchId: string,
    page: BatchChargeQuery,
  ): Promise<readonly BatchChargeItem[]>
}

export interface ChargeWithLines extends ChargeRecord {
  readonly lines: ReadonlyArray<{
    readonly position: number
    readonly kind: 'fee' | 'adjustment'
    readonly itemName: { readonly vi: string; readonly en?: string }
    readonly quantity: string
    readonly unitPrice: number
    readonly amount: number
    readonly note: string | null
  }>
}

/** One item of E-89 (DOC-66 §5). */
export interface FeeBatchListItem {
  readonly id: string
  readonly code: string
  readonly name: BilingualName
  readonly feeMonth: LocalDate
  readonly status: FeeBatchStatus
  /** The number of charges of the batch, one per charged unit (`uq_charge_batch_unit`). */
  readonly unitCount: number
  /** The sum of the charges that are not `void` (DOC-66 §5). */
  readonly total: Money
  /** The sum of the `paid` charges (DOC-66 §5, DOC-22 §8.1). */
  readonly collected: Money
  /** `collected ÷ total` as 0…1, or `null` when nothing is billed (`total` 0). */
  readonly collectedRate: number | null
  readonly dueDate: LocalDate
  /** Only the id: a staff name is `identity`'s and no port reaches it from `finance` (P2-15 slice 1). */
  readonly createdBy: { readonly id: string }
  readonly version: number
}

/** The counts of the first page of E-89: the whole building's, independent of the filters (DOC-66 §4, §5). */
export interface FeeBatchStatusCounts {
  readonly draft: number
  readonly published: number
  readonly closed: number
  readonly recalled: number
}

/** E-89's keyset: the last row of the previous page, ordered `fee_month DESC, id DESC` (DOC-66 §5). */
export interface FeeBatchListCursor {
  readonly feeMonth: LocalDate
  readonly id: string
}

/** The page E-89 is asked for; `limit` is one more than the page size, so the caller can tell whether a next page exists. */
export interface FeeBatchPageQuery {
  /** Absent means every status (DOC-66 §5: `status=all`). */
  readonly status?: FeeBatchStatus
  /** `YYYY-MM` of the fee month (DOC-66 §5). */
  readonly month?: string
  /** Case-insensitive substring of the code or of `name.vi` / `name.en` (DOC-66 §5). */
  readonly q?: string
  readonly after?: FeeBatchListCursor
  readonly limit: number
}

export interface FeeBatchListResult {
  readonly rows: readonly FeeBatchListItem[]
  /** The building's counts, on the first page only (DOC-66 §5). */
  readonly counts?: FeeBatchStatusCounts
  readonly totalCount?: number
}

/** The counts of E-91 (DOC-66 §5, DR-324). */
export interface FeeBatchViewCounts {
  readonly charges: number
  readonly lines: number
  readonly open: number
  readonly paid: number
  readonly void: number
  /**
   * The owned units without a charge in the batch, draft only (DOC-66 §5, DR-324: `ownedUnitCount − chargedUnitCount`). It is
   * `null`: no port of `finance` lists the owned units of a building, so this slice cannot count them (P2-15 slice 1).
   */
  readonly missing: number | null
}

/** The body of E-91 (DOC-66 §5). */
export interface FeeBatchView {
  readonly id: string
  readonly code: string
  readonly name: BilingualName
  readonly feeMonth: LocalDate
  readonly dueDate: LocalDate
  readonly status: FeeBatchStatus
  readonly version: number
  /** Only the id, for the reason of `FeeBatchListItem.createdBy`. */
  readonly createdBy: { readonly id: string }
  readonly publishedAt: Date | null
  /** The recalled batch a re-issue corrects (DOC-21 §3.7); `null` otherwise. */
  readonly replaces: { readonly id: string; readonly code: string } | null
  /** The drafts that correct this recalled batch (DOC-21 §3.7); empty otherwise. */
  readonly replacedBy: ReadonlyArray<{ readonly id: string; readonly code: string }>
  readonly counts: FeeBatchViewCounts
  readonly total: Money
  /** The latest committed import that wrote the batch (DOC-21 §4.5); `null` for a hand-built draft. */
  readonly source: { readonly importedAt: Date } | null
}

/** E-93's keyset: the last row of the previous page, ordered `unit_code, id` (DOC-66 §5). */
export interface BatchChargeCursor {
  readonly unitCode: string
  readonly id: string
}

/** The page E-93 is asked for (DOC-66 §5). `limit` is one more than the page size. */
export interface BatchChargeQuery {
  readonly status?: ChargeStatus
  readonly voidKind?: 'recall' | 'single'
  /** Case-insensitive substring of the unit code; the owner name is not a column of `finance` (P2-15 slice 1). */
  readonly q?: string
  readonly includeLines?: boolean
  readonly after?: BatchChargeCursor
  readonly limit: number
}

export interface BatchChargeLine {
  readonly position: number
  readonly kind: 'fee' | 'adjustment'
  readonly itemName: BilingualName
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
  readonly note: string | null
}

/** One item of E-93 (DOC-66 §5). The query service fills `ownerName` from the owner port; the reader leaves it `null`. */
export interface BatchChargeItem {
  readonly chargeId: string
  readonly unitId: string
  readonly unitCode: string
  readonly ownerName: string | null
  readonly amount: Money
  readonly status: ChargeStatus
  readonly voidKind: 'recall' | 'single' | null
  readonly version: number
  readonly lineCount: number
  /** Present only when `includeLines` (DOC-66 §5). */
  readonly lines?: readonly BatchChargeLine[]
}
