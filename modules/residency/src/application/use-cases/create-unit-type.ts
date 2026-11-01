import { type Clock, type IdGenerator, requireRole, type UnitOfWork } from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { UnitTypeLimitError } from '../../domain/errors'
import {
  UNIT_TYPE_LIMIT,
  UnitType,
  type UnitTypeCreateInput,
  type UnitTypeRecord,
} from '../../domain/unit-type'
import type { UnitTypeRepository } from '../../domain/unit-type-repository'

/** The Manager's and the Admin's alone (DOC-27 §4.3 rule 1). */
export const CREATE_UNIT_TYPE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/unit-types` (E-181, DOC-27 §4.3, DR-314): the Manager adds a kind of unit to the building. A building has at most
 * 50 types, archived ones counted; the creates of one building take an advisory lock before they count, so two at the 50th are
 * decided in turn. A duplicate code or Vietnamese name is the unique index (409).
 */
export class CreateUnitType {
  private readonly auditedCreate: ReturnType<CreateUnitType['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly unitTypes: UnitTypeRepository,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.auditedCreate = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, input: UnitTypeCreateInput): Promise<UnitTypeRecord> {
    requireRole(staff, CREATE_UNIT_TYPE_ROLES)
    return this.uow.run(() => this.auditedCreate(staff, input))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.unit_type.create',
        object: (unitType: UnitTypeRecord) => ({ type: 'unit_type', id: unitType.id }),
      },
      async (staff: StaffContext, input: UnitTypeCreateInput) => {
        const fresh = UnitType.create(this.ids.next(), input)
        if ((await this.unitTypes.countLocked(staff.scope)) >= UNIT_TYPE_LIMIT)
          throw new UnitTypeLimitError(UNIT_TYPE_LIMIT)
        const created = await this.unitTypes.insert(staff.scope, fresh, this.clock.now())
        const changes: AuditChange[] = [
          { field: 'code', before: null, after: created.code },
          { field: 'name', before: null, after: created.name.vi },
          ...(created.defaultBedrooms === null
            ? []
            : [{ field: 'defaultBedrooms', before: null, after: created.defaultBedrooms }]),
          ...(created.defaultAreaM2 === null
            ? []
            : [{ field: 'defaultAreaM2', before: null, after: created.defaultAreaM2 }]),
        ]
        return { result: created, changes }
      },
    )
  }
}
