import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, asc, count, eq, gt, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm'
import type {
  MembershipOfAccount,
  ProfileDetail,
  ProfileListFilter,
  ProfileRow,
  ResidentReader,
} from '../../domain/resident-reader'
import { membership, residentProfile, unit } from './schema'

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

const profileRow = {
  accountId: residentProfile.accountId,
  fullName: residentProfile.fullName,
  cccdLast4: residentProfile.cccdLast4,
}

/** The name as the index stores it: lower case, diacritics removed (`platform.immutable_unaccent`, DR-41). */
const folded = (value: SQL | typeof residentProfile.fullName) =>
  sql`lower(platform.immutable_unaccent(${value}))`

export class DrizzleResidentReader implements ResidentReader {
  constructor(private readonly database: Database) {}

  private inBuilding(scope: BuildingScope) {
    return and(eq(residentProfile.buildingId, scope.buildingId), isNull(residentProfile.clearedAt))
  }

  async list(
    scope: BuildingScope,
    filter: ProfileListFilter,
    after: string | undefined,
    limit: number,
  ): Promise<ProfileRow[]> {
    // A person is listed when any non-removed membership matches every membership filter together.
    const byMembership =
      filter.unitId === undefined && filter.memberType === undefined && filter.status === undefined
        ? undefined
        : sql`EXISTS (SELECT 1 FROM residency.membership m
             WHERE m.building_id = ${residentProfile.buildingId} AND m.account_id = ${residentProfile.accountId}
               AND m.status <> 'removed'
               ${filter.unitId === undefined ? sql`` : sql`AND m.unit_id = ${filter.unitId}`}
               ${filter.memberType === undefined ? sql`` : sql`AND m.member_type = ${filter.memberType}`}
               ${filter.status === undefined ? sql`` : sql`AND m.status = ${filter.status}`})`
    return this.database.executor
      .select(profileRow)
      .from(residentProfile)
      .where(
        and(
          this.inBuilding(scope),
          after === undefined ? undefined : gt(residentProfile.accountId, after),
          filter.accountIds === undefined
            ? undefined
            : inArray(residentProfile.accountId, [...filter.accountIds]),
          byMembership,
        ),
      )
      .orderBy(asc(residentProfile.accountId))
      .limit(limit)
  }

  async searchByName(scope: BuildingScope, text: string, limit: number): Promise<ProfileRow[]> {
    return this.database.executor
      .select(profileRow)
      .from(residentProfile)
      .where(
        and(
          this.inBuilding(scope),
          sql`${folded(residentProfile.fullName)} LIKE '%' || ${folded(sql`${escapeLike(text)}`)} || '%'`,
        ),
      )
      .orderBy(asc(residentProfile.accountId))
      .limit(limit)
  }

  async profilesOf(scope: BuildingScope, accountIds: readonly string[]): Promise<ProfileRow[]> {
    if (accountIds.length === 0) return []
    return this.database.executor
      .select(profileRow)
      .from(residentProfile)
      .where(and(this.inBuilding(scope), inArray(residentProfile.accountId, [...accountIds])))
      .orderBy(asc(residentProfile.accountId))
  }

  async detail(scope: BuildingScope, accountId: string): Promise<ProfileDetail | null> {
    const [row] = await this.database.executor
      .select({
        accountId: residentProfile.accountId,
        fullName: residentProfile.fullName,
        email: residentProfile.email,
        cccdEnc: residentProfile.cccdEnc,
        dateOfBirth: residentProfile.dateOfBirth,
        note: residentProfile.note,
        version: residentProfile.version,
      })
      .from(residentProfile)
      .where(and(this.inBuilding(scope), eq(residentProfile.accountId, accountId)))
    return row ?? null
  }

  async membershipsOf(
    scope: BuildingScope,
    accountIds: readonly string[],
  ): Promise<MembershipOfAccount[]> {
    if (accountIds.length === 0) return []
    const rows = await this.database.executor
      .select({
        accountId: membership.accountId,
        membershipId: membership.id,
        unitId: membership.unitId,
        unitCode: unit.code,
        memberType: membership.memberType,
        status: membership.status,
        startedAt: membership.createdAt,
      })
      .from(membership)
      .innerJoin(unit, eq(unit.id, membership.unitId))
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          inArray(membership.accountId, [...accountIds]),
          ne(membership.status, 'removed'),
        ),
      )
      .orderBy(asc(membership.createdAt), asc(membership.id))
    return rows as MembershipOfAccount[]
  }

  async total(scope: BuildingScope): Promise<number> {
    const [row] = await this.database.executor
      .select({ people: count() })
      .from(residentProfile)
      .where(this.inBuilding(scope))
    return row?.people ?? 0
  }

  async namesOf(
    scope: BuildingScope,
    accountIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const rows = await this.profilesOf(scope, accountIds)
    return new Map(rows.map((row) => [row.accountId, row.fullName]))
  }
}
