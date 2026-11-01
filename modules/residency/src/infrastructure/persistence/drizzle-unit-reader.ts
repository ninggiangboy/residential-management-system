import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, count, desc, eq, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { Occupancy } from '../../contracts'
import type {
  HistoryCursor,
  HistoryRow,
  UnitCursor,
  UnitListFilter,
  UnitReader,
  UnitRow,
  UnitSummary,
} from '../../domain/unit-reader'
import { toUnitRecord } from './drizzle-unit-repository'
import { membership, unit, unitHistory, unitType } from './schema'

/** `%` and `_` of the typed text mean themselves (a unit code holds `_`). */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

const owner = sql`${membership.memberType} = 'owner' AND ${membership.status} <> 'removed'`

export class DrizzleUnitReader implements UnitReader {
  constructor(private readonly database: Database) {}

  /** The unit, its owner row and the count of its memberships, in one statement (DOC-27 §4.2, E-57). */
  private rows(scope: BuildingScope, where: SQL | undefined, order: SQL[], limit: number) {
    return this.database.executor
      .select({
        unit,
        unitType,
        ownerMembershipId: membership.id,
        ownerAccountId: membership.accountId,
        memberCount: sql<number>`(SELECT count(*)::int FROM residency.membership c
           WHERE c.building_id = ${unit.buildingId} AND c.unit_id = ${unit.id} AND c.status <> 'removed')`,
      })
      .from(unit)
      .leftJoin(
        unitType,
        and(eq(unitType.buildingId, unit.buildingId), eq(unitType.id, unit.unitTypeId)),
      )
      .leftJoin(
        membership,
        and(
          eq(membership.buildingId, unit.buildingId),
          eq(membership.unitId, unit.id),
          sql`${owner}`,
        ),
      )
      .where(and(eq(unit.buildingId, scope.buildingId), where))
      .orderBy(...order)
      .limit(limit)
  }

  private static row(found: Awaited<ReturnType<DrizzleUnitReader['rows']>>[number]): UnitRow {
    return {
      unit: toUnitRecord(found.unit, found.unitType),
      ownerMembershipId: found.ownerMembershipId,
      ownerAccountId: found.ownerAccountId,
      memberCount: found.memberCount,
    }
  }

  async list(
    scope: BuildingScope,
    filter: UnitListFilter,
    after: UnitCursor | undefined,
    limit: number,
  ): Promise<UnitRow[]> {
    const where = and(
      filter.occupancy === undefined ? undefined : eq(unit.occupancy, filter.occupancy),
      filter.floor === undefined ? undefined : eq(unit.floor, filter.floor),
      filter.bedrooms === undefined ? undefined : eq(unit.bedrooms, filter.bedrooms),
      filter.unitTypeId === undefined ? undefined : eq(unit.unitTypeId, filter.unitTypeId),
      after === undefined
        ? undefined
        : sql`(${unit.code}, ${unit.id}) > (${after.code}, ${after.id})`,
    )
    const rows = await this.rows(scope, where, [sql`${unit.code}`, sql`${unit.id}`], limit)
    return rows.map(DrizzleUnitReader.row)
  }

  async searchByCode(scope: BuildingScope, q: string, limit: number): Promise<UnitRow[]> {
    // `unit_code_prefix_idx` serves the prefix; the exact match is listed first.
    const rows = await this.rows(
      scope,
      sql`lower(${unit.code}) LIKE lower(${escapeLike(q)}) || '%'`,
      [sql`(lower(${unit.code}) = lower(${q})) DESC`, sql`${unit.code}`, sql`${unit.id}`],
      limit,
    )
    return rows.map(DrizzleUnitReader.row)
  }

  async summary(scope: BuildingScope): Promise<UnitSummary> {
    const rows = await this.database.executor
      .select({ occupancy: unit.occupancy, units: count() })
      .from(unit)
      .where(eq(unit.buildingId, scope.buildingId))
      .groupBy(unit.occupancy)
    const by = (occupancy: Occupancy) => rows.find((row) => row.occupancy === occupancy)?.units ?? 0
    const [occupied, rented, vacant] = [by('occupied'), by('rented'), by('vacant')]
    return {
      total: occupied + rented + vacant,
      occupied,
      rented,
      vacant,
      floors: await this.distinct(scope, unit.floor),
      bedrooms: await this.distinct(scope, unit.bedrooms),
    }
  }

  /** The distinct non-null values of one column over the building's units, ascending (DR-309). */
  private async distinct(scope: BuildingScope, column: typeof unit.floor | typeof unit.bedrooms) {
    const rows = await this.database.executor
      .select({ value: column })
      .from(unit)
      .where(and(eq(unit.buildingId, scope.buildingId), isNotNull(column)))
      .groupBy(column)
      .orderBy(column)
    return rows.flatMap((row) => (row.value === null ? [] : [row.value]))
  }

  async history(
    scope: BuildingScope,
    unitId: string,
    after: HistoryCursor | undefined,
    limit: number,
  ): Promise<HistoryRow[]> {
    const rows = await this.database.executor
      .select()
      .from(unitHistory)
      .where(
        and(
          eq(unitHistory.buildingId, scope.buildingId),
          eq(unitHistory.unitId, unitId),
          after === undefined
            ? undefined
            : sql`(${unitHistory.at}, ${unitHistory.id}) < (${after.at.toISOString()}::timestamptz, ${after.id})`,
        ),
      )
      .orderBy(desc(unitHistory.at), desc(unitHistory.id))
      .limit(limit)
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as HistoryRow['kind'],
      actorKind: row.actorKind as HistoryRow['actorKind'],
      actorId: row.actorId,
      details: row.details as Record<string, unknown>,
      at: row.at,
    }))
  }
}
