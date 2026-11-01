import { type Clock, type IdGenerator, requireRole, type UnitOfWork } from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import {
  UnitCodeInUseError,
  UnitTypeArchivedError,
  UnitTypeUnknownError,
} from '../../domain/errors'
import { type NewUnit, Unit, type UnitRecord } from '../../domain/unit'
import type { UnitRepository } from '../../domain/unit-repository'
import { UnitType } from '../../domain/unit-type'
import type { UnitTypeRepository } from '../../domain/unit-type-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const CREATE_UNIT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export type CreateUnitInput = Partial<Omit<NewUnit, 'id'>> & { code: string }

/** The fields a creation records, as the edit does (DOC-27 §2.4): the note is free text and goes masked. */
export const createdFields = (unit: NewUnit): AuditChange[] =>
  (['code', 'floor', 'bedrooms', 'areaM2', 'unitTypeId', 'occupancy', 'note'] as const)
    .filter((field) => unit[field] !== null)
    .map((field) => ({ field, before: null, after: unit[field] }))

/**
 * `POST /staff/units` (E-58, DOC-27 §4.1): the Manager adds one unit by hand. A unit is never deleted (DR-12), so a unit made by
 * mistake is set `vacant`. The code, matched without case, is unique in the building: `ON CONFLICT DO NOTHING` returns no row and
 * the answer is 409 `unit_code_in_use`. With a `unitTypeId` the type is read in the same transaction, held `FOR SHARE` so an
 * archive racing the create is seen or waited for: an unknown or foreign type is 422 `unit_type_unknown`, an archived one 422
 * `unit_type_archived`, and an **absent** `bedrooms` or `areaM2` takes the type's default, while an explicit `null` stays `null`
 * (DR-315, DOC-27 §4.3 rule 7).
 */
export class CreateUnit {
  private readonly auditedCreate: ReturnType<CreateUnit['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly units: UnitRepository,
    private readonly unitTypes: UnitTypeRepository,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.auditedCreate = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, input: CreateUnitInput): Promise<UnitRecord> {
    requireRole(staff, CREATE_UNIT_ROLES)
    return this.uow.run(() => this.auditedCreate(staff, input))
  }

  /** The input with the defaults of its type for the keys it leaves out; an input with no type is unchanged. */
  private async withDefaults(
    staff: StaffContext,
    input: CreateUnitInput,
  ): Promise<CreateUnitInput> {
    if (input.unitTypeId === undefined || input.unitTypeId === null) return input
    const record = await this.unitTypes.findShared(staff.scope, input.unitTypeId)
    if (!record) throw new UnitTypeUnknownError()
    const type = new UnitType(record)
    if (type.archived) throw new UnitTypeArchivedError()
    return {
      ...input,
      ...('bedrooms' in input ? {} : { bedrooms: type.defaults.bedrooms }),
      ...('areaM2' in input ? {} : { areaM2: type.defaults.areaM2 }),
    }
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.unit.create',
        object: (unit: UnitRecord) => ({ type: 'unit', id: unit.id }),
        masks: { note: 'personal' },
      },
      async (staff: StaffContext, input: CreateUnitInput) => {
        const fresh = Unit.create(this.ids.next(), await this.withDefaults(staff, input))
        const unit = await this.units.insert(staff.scope, fresh, this.clock.now())
        if (!unit) throw new UnitCodeInUseError()
        return { result: unit, changes: createdFields(fresh) }
      },
    )
  }
}
