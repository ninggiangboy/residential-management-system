import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Occupancy } from '../../contracts'
import type { StoredProfile, StoredUnit } from '../../domain/import/plan'
import type {
  ProfileFill,
  UnitFields,
  UnitImportRepository,
} from '../../domain/unit-import-repository'
import { chunks } from './chunks'
import { membership, residentProfile, unit } from './schema'

export class DrizzleUnitImportRepository implements UnitImportRepository {
  constructor(private readonly database: Database) {}

  async findUnits(scope: BuildingScope, codesLower: readonly string[]): Promise<StoredUnit[]> {
    if (codesLower.length === 0) return []
    // Q-U: `unit_code_prefix_idx` serves `lower(code)` equality.
    const rows = await this.database.executor
      .select({
        unitId: unit.id,
        code: unit.code,
        occupancy: unit.occupancy,
        ownerAccountId: membership.accountId,
      })
      .from(unit)
      .leftJoin(
        membership,
        and(
          eq(membership.buildingId, unit.buildingId),
          eq(membership.unitId, unit.id),
          eq(membership.memberType, 'owner'),
          ne(membership.status, 'removed'),
        ),
      )
      .where(
        and(
          eq(unit.buildingId, scope.buildingId),
          inArray(sql`lower(${unit.code})`, [...codesLower]),
        ),
      )
    return rows.map((row) => ({ ...row, occupancy: row.occupancy as Occupancy }))
  }

  async findMembers(
    scope: BuildingScope,
    unitIds: readonly string[],
    accountIds: readonly string[],
  ): Promise<Set<string>> {
    if (unitIds.length === 0 || accountIds.length === 0) return new Set()
    const rows = await this.database.executor
      .select({ unitId: membership.unitId, accountId: membership.accountId })
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          inArray(membership.unitId, [...unitIds]),
          inArray(membership.accountId, [...accountIds]),
          ne(membership.status, 'removed'),
          ne(membership.memberType, 'owner'),
        ),
      )
    return new Set(rows.map((row) => `${row.unitId}|${row.accountId}`))
  }

  async findProfiles(
    scope: BuildingScope,
    accountIds: readonly string[],
  ): Promise<StoredProfile[]> {
    if (accountIds.length === 0) return []
    return this.database.executor
      .select({
        accountId: residentProfile.accountId,
        fullName: residentProfile.fullName,
        email: residentProfile.email,
        cccdLast4: residentProfile.cccdLast4,
        dateOfBirth: residentProfile.dateOfBirth,
      })
      .from(residentProfile)
      .where(
        and(
          eq(residentProfile.buildingId, scope.buildingId),
          inArray(residentProfile.accountId, [...accountIds]),
        ),
      )
  }

  async updateUnit(
    scope: BuildingScope,
    unitId: string,
    fields: UnitFields,
    now: Date,
  ): Promise<void> {
    // S8: a blank cell keeps the stored value.
    await this.database.executor
      .update(unit)
      .set({
        floor: sql`COALESCE(${fields.floor}::smallint, ${unit.floor})`,
        bedrooms: sql`COALESCE(${fields.bedrooms}::smallint, ${unit.bedrooms})`,
        areaM2: sql`COALESCE(${fields.areaM2}::numeric, ${unit.areaM2})`,
        occupancy: sql`COALESCE(${fields.occupancy}::text, ${unit.occupancy})`,
        updatedAt: now,
        version: sql`${unit.version} + 1`,
      })
      .where(and(eq(unit.id, unitId), eq(unit.buildingId, scope.buildingId)))
  }

  async insertUnits(
    scope: BuildingScope,
    units: readonly ({ id: string; code: string } & UnitFields)[],
    now: Date,
  ): Promise<void> {
    for (const chunk of chunks(units))
      await this.database.executor.insert(unit).values(
        chunk.map((new_) => ({
          id: new_.id,
          buildingId: scope.buildingId,
          code: new_.code,
          floor: new_.floor,
          bedrooms: new_.bedrooms,
          areaM2: new_.areaM2,
          occupancy: new_.occupancy ?? 'vacant',
          createdAt: now,
          updatedAt: now,
        })),
      )
  }

  async fillProfiles(
    scope: BuildingScope,
    fills: readonly ProfileFill[],
    now: Date,
  ): Promise<void> {
    // S9: insert, or fill the empty fields only; nothing stored is replaced, and `version` moves only when something was filled.
    for (const chunk of chunks(fills))
      await this.database.executor
        .insert(residentProfile)
        .values(
          chunk.map((fill) => ({
            buildingId: scope.buildingId,
            accountId: fill.accountId,
            fullName: fill.fullName,
            email: fill.email,
            cccdEnc: fill.cccdEnc,
            cccdLast4: fill.cccdLast4,
            dateOfBirth: fill.dateOfBirth,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [residentProfile.buildingId, residentProfile.accountId],
          set: {
            fullName: sql`COALESCE(${residentProfile.fullName}, excluded.full_name)`,
            email: sql`COALESCE(${residentProfile.email}, excluded.email)`,
            cccdEnc: sql`COALESCE(${residentProfile.cccdEnc}, excluded.cccd_enc)`,
            cccdLast4: sql`CASE WHEN ${residentProfile.cccdEnc} IS NULL THEN excluded.cccd_last4 ELSE ${residentProfile.cccdLast4} END`,
            dateOfBirth: sql`COALESCE(${residentProfile.dateOfBirth}, excluded.date_of_birth)`,
            updatedAt: now,
            version: sql`${residentProfile.version} + 1`,
          },
          setWhere: sql`(${residentProfile.fullName} IS NULL AND excluded.full_name IS NOT NULL)
            OR (${residentProfile.email} IS NULL AND excluded.email IS NOT NULL)
            OR (${residentProfile.cccdEnc} IS NULL AND excluded.cccd_enc IS NOT NULL)
            OR (${residentProfile.dateOfBirth} IS NULL AND excluded.date_of_birth IS NOT NULL)`,
        })
  }

  async unitsWithManyOwners(scope: BuildingScope, unitIds: readonly string[]): Promise<string[]> {
    if (unitIds.length === 0) return []
    const rows = await this.database.executor
      .select({ unitId: membership.unitId })
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          inArray(membership.unitId, [...unitIds]),
          eq(membership.memberType, 'owner'),
          ne(membership.status, 'removed'),
        ),
      )
      .groupBy(membership.unitId)
      .having(sql`count(*) > 1`)
    return rows.map((row) => row.unitId)
  }
}
