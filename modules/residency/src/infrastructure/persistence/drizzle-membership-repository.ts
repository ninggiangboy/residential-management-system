import { applyTransition, type Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq } from 'drizzle-orm'
import type { MembershipRecord, MembershipTransition } from '../../domain/membership'
import type { MembershipRepository } from '../../domain/membership-repository'
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
