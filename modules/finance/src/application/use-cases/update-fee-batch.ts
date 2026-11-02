import {
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { LocalDate, StaffContext, StaffRole } from '@rms/shared-types'
import { BatchNameInvalidError, InvalidTransitionError } from '../../domain/errors'
import { type BilingualName, type FeeBatchRecord, normalizeBatchName } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const UPDATE_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface UpdateFeeBatchInput {
  readonly name?: BilingualName
  readonly dueDate?: LocalDate
  /** `If-Match`: the batch `version` the Manager saw; absent is 428. */
  readonly version: number | undefined
}

/**
 * `PATCH /staff/fee-batches/{id}` on a draft (DOC-21 §3.2): the name and the due date; the fee month never changes (DR-265). One
 * guarded `UPDATE … WHERE status = 'draft' AND version = :v`; on 0 rows the row is read to answer 409 `version_conflict` with the
 * fresh batch or 409 `invalid_transition`. The extension of a published batch's due date is the published path of P2-05.
 */
export class UpdateFeeBatch {
  private readonly auditedUpdate: ReturnType<UpdateFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
  ) {
    this.auditedUpdate = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    input: UpdateFeeBatchInput,
  ): Promise<FeeBatchRecord> {
    requireRole(staff, UPDATE_FEE_BATCH_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    const name = input.name === undefined ? undefined : normalizeBatchName(input.name)
    if (name === null) throw new BatchNameInvalidError()
    const version = input.version
    return this.uow.run(() =>
      this.auditedUpdate(staff, batchId, { name, dueDate: input.dueDate }, version),
    )
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.update',
        object: (batch: FeeBatchRecord) => ({ type: 'fee_batch', id: batch.id }),
      },
      async (
        staff: StaffContext,
        batchId: string,
        edit: { name: BilingualName | undefined; dueDate: LocalDate | undefined },
        version: number,
      ) => {
        const stored = editable(await this.batches.find(staff.scope, batchId), version)
        const next = { name: edit.name ?? stored.name, dueDate: edit.dueDate ?? stored.dueDate }
        const after = await this.batches.updateDraftHeader(staff.scope, batchId, next, version)
        if (!after) {
          // Another request changed the batch between the read and the guarded write: tell which (DOC-21 §3.2).
          throw new VersionConflictError(
            editable(await this.batches.find(staff.scope, batchId), version),
          )
        }
        return { result: after, changes: headerChanges(stored, after) }
      },
    )
  }
}

/** The batch a header edit may change: found (404), a draft (409 `invalid_transition`) and at `version` (409 `version_conflict`). */
function editable(batch: FeeBatchRecord | null, version: number): FeeBatchRecord {
  if (!batch) throw new NotFoundError()
  if (batch.status !== 'draft')
    throw new InvalidTransitionError('fee_batch', batch.status, 'update')
  if (batch.version !== version) throw new VersionConflictError(batch)
  return batch
}

function headerChanges(before: FeeBatchRecord, after: FeeBatchRecord): AuditChange[] {
  const changes: AuditChange[] = []
  if (before.name.vi !== after.name.vi || before.name.en !== after.name.en)
    changes.push({ field: 'name', before: before.name.vi, after: after.name.vi })
  if (before.dueDate !== after.dueDate)
    changes.push({ field: 'dueDate', before: before.dueDate, after: after.dueDate })
  return changes
}
