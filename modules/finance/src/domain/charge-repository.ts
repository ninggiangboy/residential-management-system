import type { BuildingScope, LocalDate, Money } from '@rms/shared-types'
import type { ChargeLine } from './charge-line'
import type {
  BilingualName,
  ChargeRecord,
  ChargeStatus,
  DraftChargeInsert,
  FeeBatchStatus,
} from './fee-batch'

/** One printed line of a fee notice (DOC-34 §6.1, DR-292): the stored line in `position` order. */
export interface ChargeNoticeLine {
  readonly position: number
  readonly kind: 'fee' | 'adjustment'
  readonly itemName: BilingualName
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
  readonly note: string | null
}

/**
 * The one read of a fee notice (DOC-34 §8.1, DR-292): the charge of the scope with its batch and its lines in
 * `position` order, or `null` (an unknown or another building's charge). The cache key of §8.1 covers every field.
 */
export interface ChargeNoticeRow {
  readonly charge: {
    readonly id: string
    readonly unitId: string
    readonly unitCode: string
    readonly amount: Money
    readonly status: ChargeStatus
  }
  readonly batch: {
    readonly id: string
    readonly code: string
    readonly name: BilingualName
    readonly feeMonth: LocalDate
    readonly dueDate: LocalDate
    readonly publishedAt: Date | null
    readonly status: FeeBatchStatus
  }
  readonly lines: readonly ChargeNoticeLine[]
}

/** `finance.charge` and `finance.charge_line` for the draft charge edits of DOC-21 §3.2. */
export interface ChargeRepository {
  /**
   * The one read of the fee notice (DOC-34 §8.1, DR-292): the charge of the scope with its batch and its lines in
   * `position` order, or `null` (an unknown or another building's charge).
   */
  findForNotice(scope: BuildingScope, chargeId: string): Promise<ChargeNoticeRow | null>
  find(scope: BuildingScope, chargeId: string): Promise<ChargeRecord | null>
  findInBatch(scope: BuildingScope, batchId: string, unitId: string): Promise<ChargeRecord | null>
  /**
   * The first statement of `ReplaceDraftCharge`: `amount` and `version + 1 … WHERE status = 'draft' AND version = :expected`,
   * then the lines are deleted and inserted again; `null` on 0 rows (DOC-21 §3.2).
   */
  replaceDraftLines(
    scope: BuildingScope,
    chargeId: string,
    expectedVersion: number,
    amount: Money,
    lines: readonly (ChargeLine & { readonly id: string })[],
  ): Promise<ChargeRecord | null>
  insertDraft(scope: BuildingScope, charge: DraftChargeInsert): Promise<ChargeRecord>
  /** `DELETE … WHERE status = 'draft' AND version = :expected` (the lines cascade); `false` on 0 rows. */
  deleteDraft(scope: BuildingScope, chargeId: string, expectedVersion: number): Promise<boolean>
  /** A `live` allocation of the charge exists (DOC-21 §3.9: such a charge is not voidable). */
  hasLiveAllocation(scope: BuildingScope, chargeId: string): Promise<boolean>
  /**
   * The single void of DOC-21 §3.9: `open → void`, `void_kind = 'single'`, the reason, `… WHERE status = 'open' AND version = :v`;
   * `null` on 0 rows (paid meanwhile, already void, or stale).
   */
  voidOpen(
    scope: BuildingScope,
    chargeId: string,
    reason: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<ChargeRecord | null>
}
