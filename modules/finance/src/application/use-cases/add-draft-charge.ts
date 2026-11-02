import { type IdGenerator, NotFoundError, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { ChargeRepository } from '../../domain/charge-repository'
import {
  ChargeExistsError,
  InvalidTransitionError,
  UnitNotFoundError,
  UnitWithoutOwnerError,
} from '../../domain/errors'
import type { ChargeRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { checkDraftLines, type DraftLineBody } from '../draft-lines'
import type { UnitDirectory } from '../ports'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const ADD_DRAFT_CHARGE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface AddDraftChargeInput {
  readonly unitCode: string
  readonly lines: readonly DraftLineBody[]
}

/**
 * `POST /staff/fee-batches/{id}/charges` (E-170, DOC-21 §3.2, DR-332): one charge for a unit that has none yet in the draft. The
 * unit is resolved like an import row (DOC-21 §4.3): unknown code 404 `unit_not_found`, no active owner 422
 * `unit_without_owner`, a charge already there 409 `charge_exists`, a batch that is not a draft 409 `invalid_transition`; nothing
 * is written in any of the four. `uq_charge_batch_unit` is the last net against two adds at once.
 */
export class AddDraftCharge {
  private readonly auditedAdd: ReturnType<AddDraftCharge['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly charges: ChargeRepository,
    private readonly batches: FeeBatchRepository,
    private readonly units: UnitDirectory,
    audited: Audited,
    private readonly ids: IdGenerator,
  ) {
    this.auditedAdd = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    input: AddDraftChargeInput,
  ): Promise<ChargeRecord> {
    requireRole(staff, ADD_DRAFT_CHARGE_ROLES)
    const draft = checkDraftLines(input.lines, () => this.ids.next())
    const code = input.unitCode.trim()
    const [unit] = await this.units.findUnitsByCodes(staff.buildingId, [code.toLowerCase()])
    if (!unit) throw new UnitNotFoundError()
    if (!unit.hasActiveOwner) throw new UnitWithoutOwnerError()
    return this.uow.run(() => this.auditedAdd(staff, batchId, unit, draft))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.charge.update',
        object: (charge: ChargeRecord) => ({ type: 'charge', id: charge.id }),
        details: (charge: ChargeRecord) => ({ op: 'add', unitCode: charge.unitCode }),
      },
      async (
        staff: StaffContext,
        batchId: string,
        unit: { readonly unitId: string; readonly code: string },
        draft: ReturnType<typeof checkDraftLines>,
      ) => {
        const batch = await this.batches.find(staff.scope, batchId)
        if (!batch) throw new NotFoundError()
        if (batch.status !== 'draft')
          throw new InvalidTransitionError('fee_batch', batch.status, 'add_charge')
        const existing = await this.charges.findInBatch(staff.scope, batchId, unit.unitId)
        if (existing) throw new ChargeExistsError(existing.id)
        if (!(await this.batches.bumpDraftVersion(staff.scope, batchId)))
          throw new InvalidTransitionError('fee_batch', batch.status, 'add_charge')
        const charge = await this.charges.insertDraft(staff.scope, {
          id: this.ids.next(),
          batchId,
          unitId: unit.unitId,
          unitCode: unit.code,
          amount: draft.amount,
          lines: draft.lines,
        })
        return {
          result: charge,
          changes: [{ field: 'amount', before: null, after: Number(charge.amount) }],
        }
      },
    )
  }
}
