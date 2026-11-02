import {
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { InvalidTransitionError } from '../../domain/errors'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const DISCARD_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

interface Discarded {
  readonly id: string
  readonly code: string
  readonly chargeCount: number
}

/**
 * `DELETE /staff/fee-batches/{id}` (E-172, DOC-21 §3.8, DR-265): a draft and, by cascade, its charges and lines are deleted,
 * guarded by its `version`. Its code is never issued again: the counter only moves forward (FR-02.4). `trg_fee_batch_guard`
 * refuses the delete of a published batch as a second net.
 */
export class DiscardFeeBatch {
  private readonly auditedDiscard: ReturnType<DiscardFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
  ) {
    this.auditedDiscard = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    version: number | undefined,
  ): Promise<Discarded> {
    requireRole(staff, DISCARD_FEE_BATCH_ROLES)
    if (version === undefined) throw new PreconditionRequiredError()
    return this.uow.run(() => this.auditedDiscard(staff, batchId, version))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.discard',
        object: (batch: Discarded) => ({ type: 'fee_batch', id: batch.id }),
        details: (batch: Discarded) => ({ code: batch.code, chargeCount: batch.chargeCount }),
      },
      async (staff: StaffContext, batchId: string, version: number) => {
        const stored = await this.batches.find(staff.scope, batchId)
        if (!stored) throw new NotFoundError()
        if (stored.status !== 'draft')
          throw new InvalidTransitionError('fee_batch', stored.status, 'discard')
        if (stored.version !== version) throw new VersionConflictError(stored)
        const deleted = await this.batches.deleteDraft(staff.scope, batchId, version)
        if (!deleted) {
          const fresh = await this.batches.find(staff.scope, batchId)
          if (!fresh) throw new NotFoundError()
          if (fresh.status !== 'draft')
            throw new InvalidTransitionError('fee_batch', fresh.status, 'discard')
          throw new VersionConflictError(fresh)
        }
        return { result: { id: batchId, ...deleted }, changes: [] }
      },
    )
  }
}
