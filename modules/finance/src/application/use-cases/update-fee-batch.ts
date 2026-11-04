import {
  type Clock,
  type Log,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  ValidationError,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { LocalDate, StaffContext, StaffRole } from '@rms/shared-types'
import { type BatchDueExtendedPayload, FINANCE_EVENTS } from '../../contracts'
import {
  BatchNameInvalidError,
  DueDateNotLaterError,
  InvalidTransitionError,
  versionConflict,
} from '../../domain/errors'
import { type BilingualName, type FeeBatchRecord, normalizeBatchName } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { unitChunks } from '../fan-out'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const UPDATE_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface UpdateFeeBatchInput {
  readonly name?: BilingualName
  readonly dueDate?: LocalDate
  /** `If-Match`: the batch `version` the Manager saw; absent is 428. */
  readonly version: number | undefined
}

/**
 * `PATCH /staff/fee-batches/{id}` (DOC-21 §3.2, §3.4). On a draft: the name and the due date; the fee month never changes
 * (DR-265); one guarded `UPDATE … WHERE status = 'draft' AND version = :v`, and on 0 rows the row is read to answer 409
 * `version_conflict` with the fresh batch or 409 `invalid_transition`. On a published batch: only a later `dueDate` (FR-44, DR-20),
 * `… AND due_date < :new` in the statement so racing Managers never move it back; another field is 409 `invalid_transition`
 * (FR-44.2), the same or an earlier date 400 `due_date_not_later`. The extension writes `finance.batch_due_extended.v1` to the
 * units that still have an open charge and the audit row `finance.batch.extend_due`. A closed or recalled batch is 409.
 */
export class UpdateFeeBatch {
  private readonly auditedUpdate: ReturnType<UpdateFeeBatch['buildAudited']>
  private readonly auditedExtend: ReturnType<UpdateFeeBatch['buildExtend']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {
    this.auditedUpdate = this.buildAudited(audited)
    this.auditedExtend = this.buildExtend(audited)
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
    const out = await this.uow.run(async () => {
      const stored = await this.batches.find(staff.scope, batchId)
      if (stored?.status === 'published') {
        if (input.name !== undefined)
          throw new InvalidTransitionError('fee_batch', stored.status, 'update')
        if (input.dueDate === undefined)
          throw new ValidationError([
            { path: 'dueDate', code: 'required', message: 'the new due date' },
          ])
        const dueDate = input.dueDate
        return { batch: await this.auditedExtend(staff, batchId, dueDate, version), extended: true }
      }
      const batch = await this.auditedUpdate(
        staff,
        batchId,
        { name, dueDate: input.dueDate },
        version,
      )
      return { batch, extended: false }
    })
    if (out.extended)
      this.logger.info(
        {
          event: 'fee_batch.due_extended',
          buildingId: staff.scope.buildingId,
          batchId,
          actor: staff.staffId,
        },
        'fee batch due date extended',
      )
    return out.batch
  }

  /** A concurrent extension won between the read and the statement (DOC-21 §3.4): tell which rule it broke. */
  private async extendRefusal(staff: StaffContext, batchId: string, version: number) {
    const fresh = await this.batches.find(staff.scope, batchId)
    if (!fresh) return new NotFoundError()
    if (fresh.status !== 'published')
      return new InvalidTransitionError('fee_batch', fresh.status, 'extend_due')
    if (fresh.version !== version) return versionConflict(fresh)
    return new DueDateNotLaterError()
  }

  private buildExtend(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.extend_due',
        object: (batch: FeeBatchRecord) => ({ type: 'fee_batch', id: batch.id }),
      },
      async (staff: StaffContext, batchId: string, dueDate: LocalDate, version: number) => {
        const stored = await this.batches.find(staff.scope, batchId)
        if (!stored) throw new NotFoundError()
        if (stored.status !== 'published')
          throw new InvalidTransitionError('fee_batch', stored.status, 'extend_due')
        if (stored.version !== version) throw versionConflict(stored)
        if (dueDate <= stored.dueDate) throw new DueDateNotLaterError()
        const after = await this.batches.extendDueDate(staff.scope, batchId, dueDate, version)
        if (!after) throw await this.extendRefusal(staff, batchId, version)
        const unitIds = await this.batches.openChargeUnits(staff.scope, batchId)
        const now = this.clock.now()
        await this.outbox.add(
          unitChunks(unitIds).map((chunk) => ({
            type: FINANCE_EVENTS.batchDueExtended,
            aggregateId: after.id,
            payload: {
              buildingId: staff.scope.buildingId,
              batchId: after.id,
              code: after.code,
              previousDueDate: stored.dueDate,
              dueDate: after.dueDate,
              ...chunk,
            } satisfies BatchDueExtendedPayload,
            occurredAt: now,
          })),
        )
        return {
          result: after,
          changes: [{ field: 'dueDate', before: stored.dueDate, after: after.dueDate }],
        }
      },
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
          throw versionConflict(editable(await this.batches.find(staff.scope, batchId), version))
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
  if (batch.version !== version) throw versionConflict(batch)
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
