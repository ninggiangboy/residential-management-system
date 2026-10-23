import { applyTransition, type Database } from '@core/db'
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import type {
  DeletionRequest,
  NewResidentAccount,
  ResidentAccountRecord,
  ResidentAccountTransition,
} from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import { residentAccount } from './schema'

const toRecord = (row: typeof residentAccount.$inferSelect): ResidentAccountRecord => ({
  id: row.id,
  phone: row.phone,
  displayName: row.displayName,
  language: row.language as ResidentAccountRecord['language'],
  pushEnabled: row.pushEnabled,
  status: row.status as ResidentAccountRecord['status'],
  isDemo: row.isDemo,
  lastAppOpenAt: row.lastAppOpenAt,
  version: row.version,
})

/**
 * A resident account has no building (DOC-16 §4.2): the phone is the sign-in key and the id is the token's own subject, so no
 * query here carries a scope.
 */
// scope-ok: identity.resident_account is global by nature; a resident account spans buildings (DOC-14 §5.3)
export class DrizzleResidentAccountRepository implements ResidentAccountRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: see above
  async findSignInByPhone(phone: string): Promise<ResidentAccountRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(residentAccount)
      .where(
        and(
          eq(residentAccount.phone, phone),
          inArray(residentAccount.status, ['active', 'deletion_requested']),
        ),
      )
    return row ? toRecord(row) : null
  }

  // scope-ok: see above
  async findById(id: string): Promise<ResidentAccountRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(residentAccount)
      .where(eq(residentAccount.id, id))
    return row ? toRecord(row) : null
  }

  // scope-ok: see above
  async findByIds(ids: readonly string[]): Promise<ResidentAccountRecord[]> {
    if (ids.length === 0) return []
    // scope-ok: see above
    const rows = await this.database.executor
      .select()
      .from(residentAccount)
      .where(inArray(residentAccount.id, [...ids]))
    return rows.map(toRecord)
  }

  // scope-ok: see above
  async findByPhones(phones: readonly string[]): Promise<ResidentAccountRecord[]> {
    if (phones.length === 0) return []
    // scope-ok: see above
    const rows = await this.database.executor
      .select()
      .from(residentAccount)
      .where(
        and(inArray(residentAccount.phone, [...phones]), ne(residentAccount.status, 'deleted')),
      )
    return rows.map(toRecord)
  }

  // scope-ok: see above
  async findByPhoneSuffix(digits: string, limit: number): Promise<ResidentAccountRecord[]> {
    // The caller passes digits only; the reversed pattern is a prefix match on `resident_account_phone_suffix_idx` (DR-41).
    const reversed = digits.split('').reverse().join('')
    // scope-ok: see above
    const rows = await this.database.executor
      .select()
      .from(residentAccount)
      .where(
        and(
          sql`reverse(${residentAccount.phone}) LIKE ${`${reversed}%`}`,
          ne(residentAccount.status, 'deleted'),
        ),
      )
      .orderBy(asc(residentAccount.id))
      .limit(limit)
    return rows.map(toRecord)
  }

  // scope-ok: see above
  async listDeletionRequests(after: string | undefined, limit: number): Promise<DeletionRequest[]> {
    // scope-ok: see above
    const rows = await this.database.executor
      .select({
        accountId: residentAccount.id,
        requestedAt: residentAccount.deletionRequestedAt,
        approvedAt: residentAccount.deletionApprovedAt,
      })
      .from(residentAccount)
      .where(
        and(
          eq(residentAccount.status, 'deletion_requested'),
          after === undefined ? undefined : gt(residentAccount.id, after),
        ),
      )
      .orderBy(asc(residentAccount.id))
      .limit(limit)
    return rows.map((row) => ({
      accountId: row.accountId,
      requestedAt: row.requestedAt as Date,
      approvedAt: row.approvedAt,
    }))
  }

  // scope-ok: see above
  async insertIfAbsent(account: NewResidentAccount, now: Date): Promise<boolean> {
    // scope-ok: see above
    const rows = await this.database.executor
      .insert(residentAccount)
      .values({
        id: account.id,
        phone: account.phone,
        displayName: account.displayName,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: residentAccount.phone })
      .returning({ id: residentAccount.id })
    return rows.length === 1
  }

  // scope-ok: see above
  async demoAccountIds(): Promise<string[]> {
    // scope-ok: see above
    const rows = await this.database.executor
      .select({ id: residentAccount.id })
      .from(residentAccount)
      .where(eq(residentAccount.isDemo, true))
    return rows.map((row) => row.id)
  }

  // scope-ok: the transition names the row by id
  async apply(transition: ResidentAccountTransition, now: Date): Promise<boolean> {
    return (
      (await applyTransition(this.database, residentAccount, transition, {
        stamp: { updatedAt: now },
      })) !== null
    )
  }
}
