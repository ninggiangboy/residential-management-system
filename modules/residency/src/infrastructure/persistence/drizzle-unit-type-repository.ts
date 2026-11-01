import { type Database, isUniqueViolation } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, count, eq, sql } from 'drizzle-orm'
import { UnitTypeCodeInUseError, UnitTypeNameInUseError } from '../../domain/errors'
import {
  type NewUnitType,
  nameDocument,
  type UnitTypeRecord,
  type UnitTypeStatus,
  type UnitTypeTransition,
} from '../../domain/unit-type'
import type { UnitTypeRepository } from '../../domain/unit-type-repository'
import { unitType } from './schema'

export const toUnitTypeRecord = (row: typeof unitType.$inferSelect): UnitTypeRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  code: row.code,
  name: { vi: row.name.vi, en: row.name.en ?? null },
  defaultBedrooms: row.defaultBedrooms,
  defaultAreaM2: row.defaultAreaM2,
  status: row.status as UnitTypeStatus,
  archivedAt: row.archivedAt,
  version: row.version,
})

/** The unique index that a 23505 names: the driver puts it in `constraint_name`, drizzle wraps the error in `cause`. */
function constraintOf(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth++) {
    const name = (current as { constraint_name?: string }).constraint_name
    if (name) return name
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

function mapUnique(error: unknown): never {
  if (isUniqueViolation(error)) {
    if (constraintOf(error) === 'unit_type_name_key') throw new UnitTypeNameInUseError()
    throw new UnitTypeCodeInUseError()
  }
  throw error
}

export class DrizzleUnitTypeRepository implements UnitTypeRepository {
  constructor(private readonly database: Database) {}

  async find(scope: BuildingScope, id: string): Promise<UnitTypeRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(unitType)
      .where(and(eq(unitType.id, id), eq(unitType.buildingId, scope.buildingId)))
    return row ? toUnitTypeRecord(row) : null
  }

  async findShared(scope: BuildingScope, id: string): Promise<UnitTypeRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(unitType)
      .where(and(eq(unitType.id, id), eq(unitType.buildingId, scope.buildingId)))
      .for('share')
    return row ? toUnitTypeRecord(row) : null
  }

  async countLocked(scope: BuildingScope): Promise<number> {
    await this.database.executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`unit_type:${scope.buildingId}`}, 0))`,
    )
    const [row] = await this.database.executor
      .select({ n: count() })
      .from(unitType)
      .where(eq(unitType.buildingId, scope.buildingId))
    return row?.n ?? 0
  }

  async insert(scope: BuildingScope, new_: NewUnitType, now: Date): Promise<UnitTypeRecord> {
    try {
      const [row] = await this.database.executor
        .insert(unitType)
        .values({
          id: new_.id,
          buildingId: scope.buildingId,
          code: new_.code,
          name: nameDocument(new_.name),
          defaultBedrooms: new_.defaultBedrooms,
          defaultAreaM2: new_.defaultAreaM2,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      return toUnitTypeRecord(row as typeof unitType.$inferSelect)
    } catch (error) {
      return mapUnique(error)
    }
  }

  async apply(
    scope: BuildingScope,
    transition: UnitTypeTransition,
    now: Date,
  ): Promise<UnitTypeRecord | null> {
    const { name, ...rest } = transition.set
    try {
      const [row] = await this.database.executor
        .update(unitType)
        .set({
          ...rest,
          ...(name === undefined ? {} : { name: nameDocument(name) }),
          updatedAt: now,
        })
        .where(
          and(
            eq(unitType.id, transition.id),
            eq(unitType.buildingId, scope.buildingId),
            eq(unitType.version, transition.expect.version as number),
          ),
        )
        .returning()
      return row ? toUnitTypeRecord(row) : null
    } catch (error) {
      return mapUnique(error)
    }
  }
}
