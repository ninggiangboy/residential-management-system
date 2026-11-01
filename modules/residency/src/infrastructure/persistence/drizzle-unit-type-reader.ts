import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import type { UnitTypeStatus } from '../../domain/unit-type'
import type { UnitTypeReader, UnitTypeRow } from '../../domain/unit-type-reader'
import { toUnitTypeRecord } from './drizzle-unit-type-repository'
import { unit, unitType } from './schema'

export class DrizzleUnitTypeReader implements UnitTypeReader {
  constructor(private readonly database: Database) {}

  /** The list of E-180: one statement, the unit counts served by `unit_type_idx` (DOC-16 §9.3 IDM-S15). */
  async list(scope: BuildingScope, status: UnitTypeStatus | undefined): Promise<UnitTypeRow[]> {
    const rows = await this.database.executor
      .select({
        unitType,
        // Written with the table name: a single-table select renders `${unitType.id}` unqualified, which the inner `unit` shadows.
        unitCount: sql<number>`(SELECT count(*)::int FROM residency.unit u
           WHERE u.building_id = residency.unit_type.building_id AND u.unit_type_id = residency.unit_type.id)`,
      })
      .from(unitType)
      .where(
        and(
          eq(unitType.buildingId, scope.buildingId),
          status === undefined ? undefined : eq(unitType.status, status),
        ),
      )
      .orderBy(sql`lower(${unitType.name} ->> 'vi')`)
    return rows.map((row) => ({
      unitType: toUnitTypeRecord(row.unitType),
      unitCount: row.unitCount,
    }))
  }

  async unitCountOf(scope: BuildingScope, unitTypeId: string): Promise<number> {
    const [row] = await this.database.executor
      .select({ n: count() })
      .from(unit)
      .where(and(eq(unit.buildingId, scope.buildingId), eq(unit.unitTypeId, unitTypeId)))
    return row?.n ?? 0
  }

  async countWithoutType(scope: BuildingScope): Promise<number> {
    const [row] = await this.database.executor
      .select({ n: count() })
      .from(unit)
      .where(and(eq(unit.buildingId, scope.buildingId), isNull(unit.unitTypeId)))
    return row?.n ?? 0
  }

  async countByStatus(scope: BuildingScope): Promise<Record<UnitTypeStatus, number>> {
    const rows = await this.database.executor
      .select({ status: unitType.status, n: count() })
      .from(unitType)
      .where(eq(unitType.buildingId, scope.buildingId))
      .groupBy(unitType.status)
    const by = (status: UnitTypeStatus) => rows.find((row) => row.status === status)?.n ?? 0
    return { active: by('active'), archived: by('archived') }
  }
}
