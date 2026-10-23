import type { Database } from '@core/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type {
  AccountDeletionRepository,
  RemovedMembership,
} from '../../domain/account-deletion-repository'
import { membership, residentProfile } from './schema'

/**
 * The statements of DOC-27 §12 and DOC-16 §5.2, across buildings: the account is the key, and the rows name their own building.
 */
// scope-ok: an account's rows in every building are the point (FR-39.3); the event came from identity, which authorised the account
export class DrizzleAccountDeletionRepository implements AccountDeletionRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: see above
  async removeMemberships(accountId: string, now: Date): Promise<RemovedMembership[]> {
    // scope-ok: see above
    const rows = await this.database.executor
      .update(membership)
      .set({
        status: 'removed',
        lockedBy: null,
        removedAt: now,
        credentialVersion: sql`${membership.credentialVersion} + 1`,
        updatedAt: now,
      })
      .where(and(eq(membership.accountId, accountId), ne(membership.status, 'removed')))
      .returning({
        id: membership.id,
        buildingId: membership.buildingId,
        unitId: membership.unitId,
        accountId: membership.accountId,
        memberType: membership.memberType,
      })
    return rows.map((row) => ({
      ...row,
      memberType: row.memberType as RemovedMembership['memberType'],
    }))
  }

  // scope-ok: see above
  async clearProfiles(accountId: string, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor
      .update(residentProfile)
      .set({
        fullName: null,
        email: null,
        cccdEnc: null,
        cccdLast4: null,
        dateOfBirth: null,
        note: null,
        clearedAt: now,
        updatedAt: now,
        version: sql`${residentProfile.version} + 1`,
      })
      .where(and(eq(residentProfile.accountId, accountId), isNull(residentProfile.clearedAt)))
  }
}
