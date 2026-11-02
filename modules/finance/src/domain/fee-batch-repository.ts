import type { BuildingScope, LocalDate } from '@rms/shared-types'
import type { BilingualName, FeeBatchRecord } from './fee-batch'

/** `finance.fee_batch` for the draft use cases of DOC-21 §3.1, §3.2 and §3.8; every method runs in the caller's transaction. */
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
}
