import type { BuildingApi } from '@mod/building/contracts'
import type { DemoCounts, DemoResettable, DemoSeedContext } from '@rms/shared-types'
import type { DemoRepository } from '../domain/demo-repository'
import type { PasswordHasher } from './ports'
import { scopeOf } from './scope-of'

/**
 * `identity`'s part of the demo reset (DOC-36 §9.1, §10.2). It deletes the demo building's staff accounts with their tokens and
 * refresh families, and the resident accounts flagged `is_demo` with theirs: every demo session ends with the reset, and the
 * accounts come back with the same ids. The fixed code `123456` and the missing SMS follow from the flag (DR-37), not from here.
 */
export class IdentityDemo implements DemoResettable {
  readonly module = 'identity'

  constructor(
    private readonly building: Pick<BuildingApi, 'assertDemo'>,
    private readonly rows: DemoRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async resetDemo(buildingId: string): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    const staff = await this.rows.deleteStaff(scopeOf(buildingId))
    const residents = await this.rows.deleteResidents()
    return {
      ...staff,
      ...residents,
      // Staff and resident families are both deleted: one figure for the table.
      'identity.refresh_family':
        (staff['identity.refresh_family'] ?? 0) + (residents['identity.refresh_family'] ?? 0),
    }
  }

  async seedDemo(buildingId: string, ctx: DemoSeedContext): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    const passwordHash = await this.hasher.hash(ctx.password)
    await this.rows.insertStaff(
      scopeOf(buildingId),
      ctx.plan.staff.map((person) => ({ ...person, passwordHash })),
    )
    await this.rows.insertResidents(
      ctx.plan.residents.map(({ id, phone, displayName }) => ({ id, phone, displayName })),
    )
    return {
      'identity.staff_account': ctx.plan.staff.length,
      'identity.resident_account': ctx.plan.residents.length,
    }
  }
}
