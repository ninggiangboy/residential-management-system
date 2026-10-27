import { type Database, inBuilding } from '@core/db'
import type { BuildingScope, DemoCounts } from '@rms/shared-types'
import type {
  DemoMembershipRow,
  DemoProfileRow,
  DemoRepository,
  DemoUnitRow,
} from '../../domain/demo-repository'
import { chunks } from './chunks'
import { importJob, membership, residentProfile, unit, unitHistory } from './schema'

export class DrizzleDemoRepository implements DemoRepository {
  constructor(private readonly database: Database) {}

  async deleteAll(scope: BuildingScope): Promise<DemoCounts> {
    const { executor } = this.database
    const history = await executor
      .delete(unitHistory)
      .where(inBuilding(unitHistory, scope))
      .returning({ id: unitHistory.id })
    const memberships = await executor
      .delete(membership)
      .where(inBuilding(membership, scope))
      .returning({ id: membership.id })
    const profiles = await executor
      .delete(residentProfile)
      .where(inBuilding(residentProfile, scope))
      .returning({ accountId: residentProfile.accountId })
    const imports = await executor
      .delete(importJob)
      .where(inBuilding(importJob, scope))
      .returning({ id: importJob.id })
    const units = await executor
      .delete(unit)
      .where(inBuilding(unit, scope))
      .returning({ id: unit.id })
    return {
      'residency.unit_history': history.length,
      'residency.membership': memberships.length,
      'residency.resident_profile': profiles.length,
      'residency.import_job': imports.length,
      'residency.unit': units.length,
    }
  }

  async insertUnits(scope: BuildingScope, rows: readonly DemoUnitRow[]): Promise<void> {
    for (const batch of chunks(rows))
      await this.database.executor.insert(unit).values(
        batch.map((row) => ({
          id: row.id,
          buildingId: scope.buildingId,
          code: row.code,
          floor: row.floor,
          bedrooms: row.bedrooms,
          areaM2: row.areaM2.toFixed(2),
          occupancy: row.occupancy,
        })),
      )
  }

  async insertProfiles(scope: BuildingScope, rows: readonly DemoProfileRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.database.executor.insert(residentProfile).values(
      rows.map((row) => ({
        buildingId: scope.buildingId,
        accountId: row.accountId,
        fullName: row.fullName,
      })),
    )
  }

  async insertMemberships(scope: BuildingScope, rows: readonly DemoMembershipRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.database.executor.insert(membership).values(
      rows.map((row) => ({
        id: row.id,
        buildingId: scope.buildingId,
        accountId: row.accountId,
        unitId: row.unitId,
        memberType: row.memberType,
        canPay: row.canPay,
        status: 'active',
        addedByKind: 'staff',
        addedBy: row.addedBy,
      })),
    )
  }
}
