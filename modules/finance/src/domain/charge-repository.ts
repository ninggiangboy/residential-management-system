import type { BuildingScope, Money } from '@rms/shared-types'
import type { ChargeLine } from './charge-line'
import type { ChargeRecord, DraftChargeInsert } from './fee-batch'

/** `finance.charge` and `finance.charge_line` for the draft charge edits of DOC-21 §3.2. */
export interface ChargeRepository {
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
}
