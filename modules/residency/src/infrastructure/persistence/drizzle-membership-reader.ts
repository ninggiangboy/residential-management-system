import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, asc, eq, exists, gt, inArray, ne, or, sql } from 'drizzle-orm'
import type {
  ActiveMembershipView,
  MembershipReader,
  MembershipView,
  RecipientFilter,
  RecipientView,
  UnitOwnerNameView,
  UnitView,
} from '../../domain/membership-reader'
import { membership, residentProfile, unit } from './schema'

const toView = (row: typeof membership.$inferSelect): MembershipView => ({
  id: row.id,
  buildingId: row.buildingId,
  unitId: row.unitId,
  accountId: row.accountId,
  memberType: row.memberType as MembershipView['memberType'],
  canPay: row.canPay,
  status: row.status as MembershipView['status'],
  credentialVersion: row.credentialVersion,
  createdAt: row.createdAt,
})

/**
 * The reads of `ResidencyApi` and the request guard. Most carry no building scope because the key identifies the row by itself
 * (an account and a unit, a membership id): the guard runs before the building is known and the row gives it (DOC-27 §3.1).
 * `unitOwnerNames` is the exception: it lists the units of a building, so it takes the scope (DR-292).
 */
// scope-ok: see above; the calls are authorised by the token, the event or the contract caller
export class DrizzleMembershipReader implements MembershipReader {
  constructor(private readonly database: Database) {}

  // scope-ok: see above
  async findByAccountAndUnit(accountId: string, unitId: string): Promise<MembershipView | null> {
    // scope-ok: one lookup through membership_one_per_account_unit (S12)
    const [row] = await this.database.executor
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.accountId, accountId),
          eq(membership.unitId, unitId),
          ne(membership.status, 'removed'),
        ),
      )
    return row ? toView(row) : null
  }

  // scope-ok: see above
  async findById(id: string): Promise<MembershipView | null> {
    // scope-ok: the QR scan names a membership by id
    const [row] = await this.database.executor
      .select()
      .from(membership)
      .where(eq(membership.id, id))
    return row ? toView(row) : null
  }

  // scope-ok: see above
  async listRecipients(
    unitId: string,
    filter: RecipientFilter,
    after: string | null,
    limit: number,
  ): Promise<RecipientView[]> {
    // scope-ok: the unit id is the caller's
    const rows = await this.database.executor
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.unitId, unitId),
          eq(membership.status, 'active'),
          or(
            inArray(membership.memberType, [...filter.always]),
            and(
              inArray(membership.memberType, [...filter.whenCanPay]),
              eq(membership.canPay, true),
            ),
          ),
          after === null ? undefined : gt(membership.id, after),
        ),
      )
      .orderBy(asc(membership.id))
      .limit(limit)
    return rows.map((row) => ({
      accountId: row.accountId,
      membershipId: row.id,
      memberType: row.memberType as RecipientView['memberType'],
      canPay: row.canPay,
    }))
  }

  async listNoticeAccounts(
    buildingId: string,
    after: string | null,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.database.executor
      .select({ accountId: membership.accountId })
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, buildingId),
          eq(membership.status, 'active'),
          after === null ? undefined : gt(membership.accountId, after),
        ),
      )
      .groupBy(membership.accountId)
      .orderBy(asc(membership.accountId))
      .limit(limit)
    return rows.map((row) => row.accountId)
  }

  // scope-ok: see above
  async activeUnitIds(accountId: string, limit: number): Promise<string[]> {
    // scope-ok: by account, through membership_one_per_account_unit
    const rows = await this.database.executor
      .select({ unitId: membership.unitId })
      .from(membership)
      .where(and(eq(membership.accountId, accountId), eq(membership.status, 'active')))
      .limit(limit)
    return rows.map((row) => row.unitId)
  }

  // scope-ok: see above
  async listActive(accountId: string, limit: number): Promise<ActiveMembershipView[]> {
    // scope-ok: by account; the unit row gives the building and the code
    const rows = await this.database.executor
      .select({
        membershipId: membership.id,
        buildingId: membership.buildingId,
        unitId: membership.unitId,
        unitCode: unit.code,
        memberType: membership.memberType,
        canPay: membership.canPay,
      })
      .from(membership)
      .innerJoin(unit, eq(unit.id, membership.unitId))
      .where(and(eq(membership.accountId, accountId), eq(membership.status, 'active')))
      .orderBy(asc(unit.code))
      .limit(limit)
    return rows.map((row) => ({
      ...row,
      memberType: row.memberType as ActiveMembershipView['memberType'],
    }))
  }

  // scope-ok: see above
  async ownedUnitIds(accountId: string): Promise<string[]> {
    // scope-ok: by account
    const rows = await this.database.executor
      .select({ unitId: membership.unitId })
      .from(membership)
      .where(
        and(
          eq(membership.accountId, accountId),
          eq(membership.memberType, 'owner'),
          // A locked owner is still the owner: only a transfer ends it (DOC-16 §5.3, DOC-35 §10.1).
          ne(membership.status, 'removed'),
        ),
      )
    return rows.map((row) => row.unitId)
  }

  // scope-ok: see above
  async buildingIdsOfAccounts(
    accountIds: readonly string[],
  ): Promise<Array<{ accountId: string; buildingId: string }>> {
    if (accountIds.length === 0) return []
    // scope-ok: the boot guard asks which buildings an account is in, across buildings
    return this.database.executor
      .select({ accountId: membership.accountId, buildingId: membership.buildingId })
      .from(membership)
      .where(and(inArray(membership.accountId, [...accountIds]), ne(membership.status, 'removed')))
      .groupBy(membership.accountId, membership.buildingId)
  }

  // scope-ok: see above
  async findUnits(ids: readonly string[]): Promise<UnitView[]> {
    if (ids.length === 0) return []
    // scope-ok: ids come from rows another module already holds
    const rows = await this.database.executor
      .select({ id: unit.id, code: unit.code, floor: unit.floor, occupancy: unit.occupancy })
      .from(unit)
      .where(inArray(unit.id, [...ids]))
    return rows.map((row) => ({ ...row, occupancy: row.occupancy as UnitView['occupancy'] }))
  }

  async findUnitsByCodes(
    buildingId: string,
    codesLower: readonly string[],
  ): Promise<Array<UnitView & { hasActiveOwner: boolean }>> {
    if (codesLower.length === 0) return []
    // `unit_code_prefix_idx` serves `lower(code)` equality (DOC-18 §1.5); the owner is a non-removed owner membership (DOC-27 §2.1).
    const owner = this.database.executor
      .select({ one: sql`1` })
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, unit.buildingId),
          eq(membership.unitId, unit.id),
          eq(membership.memberType, 'owner'),
          ne(membership.status, 'removed'),
        ),
      )
    const rows = await this.database.executor
      .select({
        id: unit.id,
        code: unit.code,
        floor: unit.floor,
        occupancy: unit.occupancy,
        hasActiveOwner: sql<boolean>`${exists(owner)}`,
      })
      .from(unit)
      .where(
        and(eq(unit.buildingId, buildingId), inArray(sql`lower(${unit.code})`, [...codesLower])),
      )
    return rows.map((row) => ({ ...row, occupancy: row.occupancy as UnitView['occupancy'] }))
  }

  /**
   * The full name of the active owner of each of these units of the building (DR-292, DOC-34 §6.1). One row per unit that has an
   * active owner; the caller fills the rest with `null` and keeps the order it asked in. A unit of another building is not here.
   */
  async unitOwnerNames(
    scope: BuildingScope,
    unitIds: readonly string[],
  ): Promise<UnitOwnerNameView[]> {
    if (unitIds.length === 0) return []
    return this.database.executor
      .select({ unitId: membership.unitId, ownerName: residentProfile.fullName })
      .from(membership)
      .innerJoin(
        residentProfile,
        and(
          eq(residentProfile.buildingId, membership.buildingId),
          eq(residentProfile.accountId, membership.accountId),
        ),
      )
      .where(
        and(
          inBuilding(membership, scope),
          inArray(membership.unitId, [...unitIds]),
          eq(membership.memberType, 'owner'),
          eq(membership.status, 'active'),
        ),
      )
  }
}
