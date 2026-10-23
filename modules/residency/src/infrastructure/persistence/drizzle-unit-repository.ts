import { type Database, isUniqueViolation } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq } from 'drizzle-orm'
import type { Occupancy } from '../../contracts'
import { UnitCodeInUseError } from '../../domain/errors'
import type { NewUnit, UnitRecord, UnitTransition } from '../../domain/unit'
import type { UnitRepository } from '../../domain/unit-repository'
import { unit } from './schema'

export const toUnitRecord = (row: typeof unit.$inferSelect): UnitRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  code: row.code,
  floor: row.floor,
  bedrooms: row.bedrooms,
  areaM2: row.areaM2,
  occupancy: row.occupancy as Occupancy,
  note: row.note,
  version: row.version,
})

export class DrizzleUnitRepository implements UnitRepository {
  constructor(private readonly database: Database) {}

  async find(scope: BuildingScope, id: string): Promise<UnitRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(unit)
      .where(and(eq(unit.id, id), eq(unit.buildingId, scope.buildingId)))
    return row ? toUnitRecord(row) : null
  }

  async lock(scope: BuildingScope, id: string): Promise<boolean> {
    const rows = await this.database.executor
      .select({ id: unit.id })
      .from(unit)
      .where(and(eq(unit.id, id), eq(unit.buildingId, scope.buildingId)))
      .for('update')
    return rows.length > 0
  }

  async insert(scope: BuildingScope, new_: NewUnit, now: Date): Promise<UnitRecord | null> {
    const [row] = await this.database.executor
      .insert(unit)
      .values({ ...new_, buildingId: scope.buildingId, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: [unit.buildingId, unit.code] })
      .returning()
    return row ? toUnitRecord(row) : null
  }

  async apply(
    scope: BuildingScope,
    transition: UnitTransition,
    now: Date,
  ): Promise<UnitRecord | null> {
    try {
      const [row] = await this.database.executor
        .update(unit)
        .set({ ...transition.set, updatedAt: now })
        .where(
          and(
            eq(unit.id, transition.id),
            eq(unit.buildingId, scope.buildingId),
            eq(unit.version, transition.expect.version as number),
          ),
        )
        .returning()
      return row ? toUnitRecord(row) : null
    } catch (error) {
      // `unit_code_key` is the arbiter of a renamed code; the transaction is rolled back by the caller's throw.
      if (isUniqueViolation(error)) throw new UnitCodeInUseError()
      throw error
    }
  }
}
