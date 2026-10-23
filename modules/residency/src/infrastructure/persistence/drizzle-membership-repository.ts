import { applyTransition, type Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { MembershipRecord, MembershipTransition } from '../../domain/membership'
import type { MembershipRepository, NewMembership } from '../../domain/membership-repository'
import { chunks } from './chunks'
import { membership } from './schema'

export const toMembershipRecord = (row: typeof membership.$inferSelect): MembershipRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  accountId: row.accountId,
  unitId: row.unitId,
  memberType: row.memberType as MembershipRecord['memberType'],
  canPay: row.canPay,
  status: row.status as MembershipRecord['status'],
  lockedBy: row.lockedBy as MembershipRecord['lockedBy'],
  credentialVersion: row.credentialVersion,
  addedByKind: row.addedByKind as MembershipRecord['addedByKind'],
  addedBy: row.addedBy,
  invitedAt: row.invitedAt,
  note: row.note,
  removedAt: row.removedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export class DrizzleMembershipRepository implements MembershipRepository {
  constructor(private readonly database: Database) {}

  async find(scope: BuildingScope, id: string): Promise<MembershipRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(membership)
      .where(and(eq(membership.id, id), eq(membership.buildingId, scope.buildingId)))
    return row ? toMembershipRecord(row) : null
  }

  async findLive(
    scope: BuildingScope,
    unitId: string,
    accountId: string,
  ): Promise<MembershipRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          eq(membership.unitId, unitId),
          eq(membership.accountId, accountId),
          ne(membership.status, 'removed'),
        ),
      )
    return row ? toMembershipRecord(row) : null
  }

  async findOwner(scope: BuildingScope, unitId: string): Promise<MembershipRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          eq(membership.unitId, unitId),
          eq(membership.memberType, 'owner'),
          ne(membership.status, 'removed'),
        ),
      )
    return row ? toMembershipRecord(row) : null
  }

  async listOfUnit(scope: BuildingScope, unitId: string): Promise<MembershipRecord[]> {
    const rows = await this.database.executor
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          eq(membership.unitId, unitId),
          ne(membership.status, 'removed'),
        ),
      )
      .orderBy(
        sql`(${membership.memberType} = 'owner') DESC`,
        asc(membership.createdAt),
        asc(membership.id),
      )
    return rows.map(toMembershipRecord)
  }

  async insert(
    scope: BuildingScope,
    new_: NewMembership,
    now: Date,
  ): Promise<MembershipRecord | null> {
    const [row] = await this.database.executor
      .insert(membership)
      .values({
        id: new_.id,
        buildingId: scope.buildingId,
        accountId: new_.accountId,
        unitId: new_.unitId,
        memberType: new_.memberType,
        canPay: new_.canPay ?? false,
        addedByKind: new_.addedByKind,
        addedBy: new_.addedBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [membership.accountId, membership.unitId],
        where: ne(membership.status, 'removed'),
      })
      .returning()
    return row ? toMembershipRecord(row) : null
  }

  async removeForTransfer(
    scope: BuildingScope,
    unitId: string,
    keep: { accountId: string; keepMembers: boolean },
    now: Date,
  ): Promise<MembershipRecord[]> {
    const rows = await this.database.executor
      .update(membership)
      .set({
        status: 'removed',
        lockedBy: null,
        removedAt: now,
        credentialVersion: sql`${membership.credentialVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          eq(membership.unitId, unitId),
          ne(membership.status, 'removed'),
          ne(membership.accountId, keep.accountId),
          keep.keepMembers ? eq(membership.memberType, 'owner') : undefined,
        ),
      )
      .returning()
    return rows.map(toMembershipRecord)
  }

  async promoteToOwner(
    scope: BuildingScope,
    unitId: string,
    accountId: string,
    now: Date,
  ): Promise<MembershipRecord | null> {
    const [row] = await this.database.executor
      .update(membership)
      .set({
        memberType: 'owner',
        status: 'active',
        lockedBy: null,
        credentialVersion: sql`${membership.credentialVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(membership.buildingId, scope.buildingId),
          eq(membership.unitId, unitId),
          eq(membership.accountId, accountId),
          ne(membership.status, 'removed'),
        ),
      )
      .returning()
    return row ? toMembershipRecord(row) : null
  }

  async insertMany(
    scope: BuildingScope,
    memberships: readonly NewMembership[],
    now: Date,
  ): Promise<void> {
    for (const chunk of chunks(memberships))
      await this.database.executor.insert(membership).values(
        chunk.map((new_) => ({
          id: new_.id,
          buildingId: scope.buildingId,
          accountId: new_.accountId,
          unitId: new_.unitId,
          memberType: new_.memberType,
          addedByKind: new_.addedByKind,
          addedBy: new_.addedBy,
          createdAt: now,
          updatedAt: now,
        })),
      )
  }

  async apply(
    scope: BuildingScope,
    transition: MembershipTransition,
    now: Date,
  ): Promise<MembershipRecord | null> {
    const row = await applyTransition(this.database, membership, transition, {
      stamp: { updatedAt: now },
      also: eq(membership.buildingId, scope.buildingId),
    })
    return row ? toMembershipRecord(row) : null
  }
}
