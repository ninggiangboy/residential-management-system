import type { BuildingScope, LocalDate } from '@rms/shared-types'
import type { BilingualName, DraftChargeInsert, FeeBatchRecord } from './fee-batch'

/** What the publish checks of DOC-21 §3.3 read of the draft's charges. */
export interface DraftChargeSummary {
  readonly count: number
  /** Unit codes of the charges whose total is not above zero (`ck_charge_amount` makes this empty; the check stays, DOC-21 §3.3). */
  readonly nonPositive: readonly string[]
}

/** `finance.fee_batch` for the use cases of DOC-21 §3; every method runs in the caller's transaction. */
export interface FeeBatchRepository {
  insert(
    scope: BuildingScope,
    batch: Omit<FeeBatchRecord, 'status' | 'version' | 'createdAt'>,
  ): Promise<FeeBatchRecord>
  find(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord | null>
  /** The guarded header edit of DOC-21 §3.2: `… WHERE status = 'draft' AND version = :expected`; `null` on 0 rows. */
  updateDraftHeader(
    scope: BuildingScope,
    batchId: string,
    edit: { readonly name: BilingualName; readonly dueDate: LocalDate },
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null>
  /** `version + 1 … WHERE status = 'draft'` after a charge edit, so a publish prepared earlier is refused; `false` on 0 rows. */
  bumpDraftVersion(scope: BuildingScope, batchId: string): Promise<boolean>
  /** The guarded discard of DOC-21 §3.8: the lines and charges cascade; `null` on 0 rows. */
  deleteDraft(
    scope: BuildingScope,
    batchId: string,
    expectedVersion: number,
  ): Promise<{ readonly code: string; readonly chargeCount: number } | null>
  /** Counted before the publish (DOC-21 §3.3). */
  draftChargeSummary(scope: BuildingScope, batchId: string): Promise<DraftChargeSummary>
  /**
   * The publish of DOC-15 §5.1: the batch `… WHERE status = 'draft' AND version = :expected` and its charges `draft → open` in
   * one statement; answers the batch and the charged unit ids, or `null` when the batch row did not match.
   */
  publish(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<{ readonly batch: FeeBatchRecord; readonly unitIds: readonly string[] } | null>
  /** The extension of DOC-21 §3.4: `… WHERE status = 'published' AND version = :v AND due_date < :new`; `null` on 0 rows. */
  extendDueDate(
    scope: BuildingScope,
    batchId: string,
    dueDate: LocalDate,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null>
  /** Distinct units with an `open` charge in the batch: the recipients of an extension (DOC-09 §6.1). */
  openChargeUnits(scope: BuildingScope, batchId: string): Promise<readonly string[]>
  /** The close of DOC-21 §3.6: `… WHERE status = 'published' AND version = :v`; `null` on 0 rows. */
  close(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null>
  /** Step 1 of the recall (DOC-21 §3.5): `… WHERE status = 'published' AND version = :v`, which locks the row; `null` on 0 rows. */
  markRecalled(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null>
  /** The charges of the batch that are not `void`, counted after the batch row is locked (DR-97). */
  countNotVoid(scope: BuildingScope, batchId: string): Promise<number>
  /** The charges of the batch that are `paid` (the `paidCount` of a refused recall, FR-04.2). */
  countPaid(scope: BuildingScope, batchId: string): Promise<number>
  /** Step 3 of the recall: `open → void` with `void_kind = 'recall'` for the whole batch; answers the charge and unit ids. */
  voidOpenCharges(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
  ): Promise<ReadonlyArray<{ readonly chargeId: string; readonly unitId: string }>>
  /**
   * The charges a re-issue copies (DOC-21 §3.7, DR-265): every charge of the batch but those voided alone, with their lines in
   * position order, already given the new ids and the new batch id by `newIds`.
   */
  copyableCharges(
    scope: BuildingScope,
    batchId: string,
    toBatchId: string,
    newId: () => string,
  ): Promise<readonly DraftChargeInsert[]>
  /** Bulk insert of draft charges and their lines (the re-issue copy). */
  insertDraftCharges(scope: BuildingScope, charges: readonly DraftChargeInsert[]): Promise<void>
}
