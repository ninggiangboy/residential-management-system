import {
  type Clock,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { UnitType, type UnitTypeEdit, type UnitTypeRecord } from '../../domain/unit-type'
import type { UnitTypeReader } from '../../domain/unit-type-reader'
import type { UnitTypeRepository } from '../../domain/unit-type-repository'
import { unitTypeBody } from '../unit-type-body'

/** The Manager's and the Admin's alone (DOC-27 §4.3 rule 1). */
export const UPDATE_UNIT_TYPE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface UpdateUnitTypeInput {
  edit: UnitTypeEdit
  /** `If-Match`: the type `version` the Manager saw; absent is 428. */
  version: number | undefined
}

/**
 * `PATCH /staff/unit-types/{id}` (E-182, DOC-27 §4.3, DR-314, DR-315): the Manager renames a type, changes its defaults, archives
 * it or restores it. The code cannot change. Changing a default changes no unit. One guarded statement on `version` applies the
 * change; of two edits with the same `If-Match` one wins and the other is 409 `version_conflict` with the fresh type.
 */
export class UpdateUnitType {
  private readonly auditedUpdate: ReturnType<UpdateUnitType['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly unitTypes: UnitTypeRepository,
    private readonly reader: Pick<UnitTypeReader, 'unitCountOf'>,
    audited: Audited,
    private readonly clock: Clock,
  ) {
    this.auditedUpdate = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    unitTypeId: string,
    input: UpdateUnitTypeInput,
  ): Promise<{ unitType: UnitTypeRecord; unitCount: number }> {
    requireRole(staff, UPDATE_UNIT_TYPE_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    if (Object.keys(input.edit).length === 0)
      throw new ValidationError([
        { path: '', code: 'min_properties', message: 'at least one field' },
      ])
    return this.uow.run(() =>
      this.auditedUpdate(staff, unitTypeId, input.edit, input.version as number),
    )
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.unit_type.update',
        object: (result: { unitType: UnitTypeRecord }) => ({
          type: 'unit_type',
          id: result.unitType.id,
        }),
      },
      async (staff: StaffContext, unitTypeId: string, edit: UnitTypeEdit, version: number) => {
        const { unitTypes, reader, clock } = this
        const stored = await unitTypes.find(staff.scope, unitTypeId)
        if (!stored) throw new NotFoundError()
        const conflict = async (current: UnitTypeRecord | null) =>
          new VersionConflictError(
            current
              ? unitTypeBody(current, await reader.unitCountOf(staff.scope, current.id))
              : undefined,
          )
        if (stored.version !== version) throw await conflict(stored)
        const now = clock.now()
        const change = new UnitType(stored).edit(edit, now)
        if (!change)
          return {
            result: {
              unitType: stored,
              unitCount: await reader.unitCountOf(staff.scope, stored.id),
            },
            changes: [],
          }
        const after = await unitTypes.apply(staff.scope, change.transition, now)
        if (!after) throw await conflict(await unitTypes.find(staff.scope, unitTypeId))
        const changes: AuditChange[] = change.fields.map(({ field, before, after }) => ({
          field,
          before,
          after,
        }))
        return {
          result: { unitType: after, unitCount: await reader.unitCountOf(staff.scope, after.id) },
          changes,
        }
      },
    )
  }
}
