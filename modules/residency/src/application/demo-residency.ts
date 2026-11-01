import { InvariantError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { DemoCounts, DemoResettable, DemoSeedContext } from '@rms/shared-types'
import type { DemoMembershipRow, DemoRepository } from '../domain/demo-repository'
import { scopeOf } from './scope-of'

/**
 * `residency`'s part of the demo reset (DOC-36 §9.1, §10.2): the units, the people's profiles and the memberships of the demo
 * building, deleted and seeded again with the same ids. The seeded memberships are the eight accounts of the plan; every other
 * unit of the sample has no owner until a staff member imports one.
 */
export class ResidencyDemo implements DemoResettable {
  readonly module = 'residency'

  constructor(
    private readonly building: Pick<BuildingApi, 'assertDemo'>,
    private readonly rows: DemoRepository,
  ) {}

  async resetDemo(buildingId: string): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    return this.rows.deleteAll(scopeOf(buildingId))
  }

  async seedDemo(buildingId: string, ctx: DemoSeedContext): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    const scope = scopeOf(buildingId)
    const { plan } = ctx
    // The memberships name a unit by its code, the plan's key; the ids of the units are fixed (DOC-36 §10.2 item 5).
    const unitIds = new Map(plan.units.map((unit) => [unit.code, unit.id]))
    const admin = plan.staff.find((person) => person.role === 'admin')
    if (!admin) throw new InvariantError('the demo plan has no admin to add the memberships')
    const memberships: DemoMembershipRow[] = plan.residents.flatMap((resident) =>
      resident.memberships.map((member) => {
        const unitId = unitIds.get(member.unitCode)
        if (!unitId) throw new InvariantError(`the demo plan has no unit ${member.unitCode}`)
        return {
          id: member.id,
          accountId: resident.id,
          unitId,
          memberType: member.memberType,
          canPay: member.canPay,
          addedBy: admin.id,
        }
      }),
    )
    // The units name their type by its code, as the memberships name their unit; the types go in first (DR-314).
    const typeIds = new Map(plan.unitTypes.map((type) => [type.code, type.id]))
    await this.rows.insertUnitTypes(scope, plan.unitTypes)
    await this.rows.insertUnits(
      scope,
      plan.units.map((unit) => {
        const unitTypeId = typeIds.get(unit.unitTypeCode)
        if (!unitTypeId)
          throw new InvariantError(`the demo plan has no unit type ${unit.unitTypeCode}`)
        return { ...unit, unitTypeId }
      }),
    )
    await this.rows.insertProfiles(
      scope,
      plan.residents.map((resident) => ({
        accountId: resident.id,
        fullName: resident.displayName,
      })),
    )
    await this.rows.insertMemberships(scope, memberships)
    return {
      'residency.unit_type': plan.unitTypes.length,
      'residency.unit': plan.units.length,
      'residency.resident_profile': plan.residents.length,
      'residency.membership': memberships.length,
    }
  }
}
