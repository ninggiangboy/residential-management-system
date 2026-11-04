import {
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { ChargeRepository } from '../../domain/charge-repository'
import { InvalidTransitionError, versionConflict } from '../../domain/errors'
import { assertDraft, type ChargeRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const REMOVE_DRAFT_CHARGE_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * `DELETE /staff/charges/{id}` (E-171, DOC-21 §3.2): a draft charge and its lines are deleted (hard: nobody has seen a draft),
 * guarded by its `version`; the batch version moves as for every charge edit.
 */
export class RemoveDraftCharge {
  private readonly auditedRemove: ReturnType<RemoveDraftCharge['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly charges: ChargeRepository,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
  ) {
    this.auditedRemove = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, chargeId: string, version: number | undefined): Promise<void> {
    requireRole(staff, REMOVE_DRAFT_CHARGE_ROLES)
    if (version === undefined) throw new PreconditionRequiredError()
    await this.uow.run(() => this.auditedRemove(staff, chargeId, version))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.charge.update',
        object: (charge: ChargeRecord) => ({ type: 'charge', id: charge.id }),
        details: (charge: ChargeRecord) => ({ op: 'remove', unitCode: charge.unitCode }),
      },
      async (staff: StaffContext, chargeId: string, version: number) => {
        const stored = await this.charges.find(staff.scope, chargeId)
        if (!stored) throw new NotFoundError()
        assertDraft(stored, 'remove')
        if (stored.version !== version) throw versionConflict(stored)
        if (!(await this.charges.deleteDraft(staff.scope, chargeId, version))) {
          const fresh = await this.charges.find(staff.scope, chargeId)
          if (!fresh) throw new NotFoundError()
          assertDraft(fresh, 'remove')
          throw versionConflict(fresh)
        }
        if (!(await this.batches.bumpDraftVersion(staff.scope, stored.batchId)))
          throw new InvalidTransitionError('fee_batch', stored.batchStatus, 'remove')
        return {
          result: stored,
          changes: [{ field: 'amount', before: Number(stored.amount), after: null }],
        }
      },
    )
  }
}
