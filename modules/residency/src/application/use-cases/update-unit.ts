import {
  type Clock,
  type IdGenerator,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { UnitTypeArchivedError, UnitTypeUnknownError } from '../../domain/errors'
import { Unit, type UnitEdit, type UnitRecord } from '../../domain/unit'
import type { UnitHistoryRepository } from '../../domain/unit-history-repository'
import type { UnitRepository } from '../../domain/unit-repository'
import type { UnitTypeRepository } from '../../domain/unit-type-repository'
import { unitBody } from '../unit-body'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const UPDATE_UNIT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface UpdateUnitInput {
  edit: UnitEdit
  /** `If-Match`: the unit `version` the Manager saw; absent is 428. */
  version: number | undefined
}

/**
 * `PATCH /staff/units/{id}` (E-60, DOC-27 §4.1): the Manager edits the code (the typo case), floor, bedrooms, area, occupancy or
 * note, or gives it another type (which changes nothing else: no default is applied, DR-315). One guarded statement on `version` applies the change; of two edits with the same `If-Match` one wins and the other is
 * 409 `version_conflict` with the fresh unit. An occupancy change across the vacancy boundary writes its `unit_history` row in the
 * same transaction (DR-141); `occupied` and `rented` swap without one, and the audit row is their record.
 */
export class UpdateUnit {
  private readonly auditedUpdate: ReturnType<UpdateUnit['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly units: UnitRepository,
    private readonly unitTypes: UnitTypeRepository,
    private readonly history: UnitHistoryRepository,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.auditedUpdate = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, unitId: string, input: UpdateUnitInput): Promise<UnitRecord> {
    requireRole(staff, UPDATE_UNIT_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    if (Object.keys(input.edit).length === 0)
      throw new ValidationError([
        { path: '', code: 'min_properties', message: 'at least one field' },
      ])
    return this.uow.run(() =>
      this.auditedUpdate(staff, unitId, input.edit, input.version as number),
    )
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.unit.update',
        object: (unit: UnitRecord) => ({ type: 'unit', id: unit.id }),
        masks: { note: 'personal' },
      },
      async (staff: StaffContext, unitId: string, edit: UnitEdit, version: number) => {
        const { units, unitTypes, history, clock, ids } = this
        const stored = await units.find(staff.scope, unitId)
        if (!stored) throw new NotFoundError()
        if (stored.version !== version) throw new VersionConflictError(unitBody(stored))
        const change = new Unit(stored).edit(edit)
        // A type is checked when the unit is given one it does not have: keeping an archived type of its own is allowed.
        if (edit.unitTypeId && edit.unitTypeId !== stored.unitTypeId) {
          const type = await unitTypes.findShared(staff.scope, edit.unitTypeId)
          if (!type) throw new UnitTypeUnknownError()
          if (type.status === 'archived') throw new UnitTypeArchivedError()
        }
        if (!change) return { result: stored, changes: [] }
        const now = clock.now()
        // A second edit with the same `If-Match` finds the version moved: 409, nothing written.
        const after = await units.apply(staff.scope, change.transition, now)
        if (!after) {
          const current = await units.find(staff.scope, unitId)
          throw new VersionConflictError(current ? unitBody(current) : undefined)
        }
        if (change.vacancy)
          await history.add(
            staff.scope,
            {
              id: ids.next(),
              unitId,
              kind: change.vacancy,
              actor: { kind: 'staff', id: staff.staffId },
              details: { from: stored.occupancy, to: after.occupancy },
            },
            now,
          )
        const changes: AuditChange[] = change.fields.map(({ field, before, after }) => ({
          field,
          before,
          after,
        }))
        return { result: after, changes }
      },
    )
  }
}
