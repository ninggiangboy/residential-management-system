import {
  type IdGenerator,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { ChargeRepository } from '../../domain/charge-repository'
import { InvalidTransitionError } from '../../domain/errors'
import { assertDraft, type ChargeRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { checkDraftLines, type DraftLineBody } from '../draft-lines'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const REPLACE_DRAFT_CHARGE_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

export interface ReplaceDraftChargeInput {
  readonly lines: readonly DraftLineBody[]
  /** `If-Match`: the charge `version` the Manager saw; absent is 428. */
  readonly version: number | undefined
}

/**
 * `PUT /staff/charges/{id}` (E-94, DOC-21 §3.2): every line of one draft charge is replaced and its amount recomputed, the other
 * units untouched. The first statement is the guarded `UPDATE charge … WHERE status = 'draft' AND version = :v`; of two Managers
 * saving the same version one wins and the other gets 409 `version_conflict` with the fresh charge (FR-02.2). The batch version
 * moves too, so a publish prepared from an older screen is refused (DOC-21 §3.3).
 */
export class ReplaceDraftCharge {
  private readonly auditedReplace: ReturnType<ReplaceDraftCharge['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly charges: ChargeRepository,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
    private readonly ids: IdGenerator,
  ) {
    this.auditedReplace = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    chargeId: string,
    input: ReplaceDraftChargeInput,
  ): Promise<ChargeRecord> {
    requireRole(staff, REPLACE_DRAFT_CHARGE_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    const { lines, amount } = checkDraftLines(input.lines, () => this.ids.next())
    const version = input.version
    return this.uow.run(() => this.auditedReplace(staff, chargeId, { lines, amount }, version))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.charge.update',
        object: (charge: ChargeRecord) => ({ type: 'charge', id: charge.id }),
        details: (charge: ChargeRecord) => ({ op: 'replace', unitCode: charge.unitCode }),
      },
      async (
        staff: StaffContext,
        chargeId: string,
        draft: ReturnType<typeof checkDraftLines>,
        version: number,
      ) => {
        const stored = await this.charges.find(staff.scope, chargeId)
        if (!stored) throw new NotFoundError()
        assertDraft(stored, 'update')
        if (stored.version !== version) throw new VersionConflictError(stored)
        const after = await this.charges.replaceDraftLines(
          staff.scope,
          chargeId,
          version,
          draft.amount,
          draft.lines,
        )
        if (!after) {
          // The other Manager saved first, or an import replaced the charge (404) (DOC-21 §3.2).
          const fresh = await this.charges.find(staff.scope, chargeId)
          if (!fresh) throw new NotFoundError()
          assertDraft(fresh, 'update')
          throw new VersionConflictError(fresh)
        }
        if (!(await this.batches.bumpDraftVersion(staff.scope, after.batchId)))
          throw new InvalidTransitionError('fee_batch', after.batchStatus, 'update')
        const changes = [
          { field: 'amount', before: Number(stored.amount), after: Number(after.amount) },
        ]
        return { result: after, changes }
      },
    )
  }
}
