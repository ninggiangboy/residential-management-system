import { type Database, inBuilding } from '@core/db'
import type { BuildingScope, StaffRole } from '@rms/shared-types'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { StaffAccountRecord } from '../../domain/staff-account'
import type {
  FailureCount,
  Lockout,
  StaffAccountRepository,
} from '../../domain/staff-account-repository'
import { asDateOrNull } from './dates'
import { staffAccount } from './schema'

const toRecord = (row: typeof staffAccount.$inferSelect): StaffAccountRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  email: row.email,
  fullName: row.fullName,
  role: row.role as StaffAccountRecord['role'],
  status: row.status as StaffAccountRecord['status'],
  passwordHash: row.passwordHash,
  failedAttempts: row.failedAttempts,
  lockedUntil: row.lockedUntil,
  language: row.language as StaffAccountRecord['language'],
  pushEnabled: row.pushEnabled,
  avatarKey: row.avatarKey,
  lastLoginAt: row.lastLoginAt,
  version: row.version,
})

type Failure = { failed_attempts: number; locked_until: Date | string | null }
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

export class DrizzleStaffAccountRepository implements StaffAccountRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: the sign-in screen does not know the building; the email is unique across buildings (DOC-16 §4.1)
  async findByEmail(email: string): Promise<StaffAccountRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(staffAccount)
      .where(eq(staffAccount.email, email))
    return row ? toRecord(row) : null
  }

  // scope-ok: a lookup by primary key whose caller has authorised the row (the token's own subject, or a checked building)
  async findById(id: string): Promise<StaffAccountRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(staffAccount)
      .where(eq(staffAccount.id, id))
    return row ? toRecord(row) : null
  }

  // scope-ok: ids come from rows the caller already holds, which carry their own building (IdentityApi.getStaff, DOC-09 §7.3)
  async findByIds(ids: readonly string[]): Promise<StaffAccountRecord[]> {
    if (ids.length === 0) return []
    // scope-ok: see above
    const rows = await this.database.executor
      .select()
      .from(staffAccount)
      .where(inArray(staffAccount.id, [...ids]))
    return rows.map(toRecord)
  }

  async listActive(
    scope: BuildingScope,
    roles: readonly StaffRole[],
    after: string | undefined,
    limit: number,
  ): Promise<StaffAccountRecord[]> {
    if (roles.length === 0) return []
    const rows = await this.database.executor
      .select()
      .from(staffAccount)
      .where(
        and(
          inBuilding(staffAccount, scope),
          eq(staffAccount.status, 'active'),
          inArray(staffAccount.role, [...roles]),
          after === undefined ? undefined : gt(staffAccount.id, after),
        ),
      )
      .orderBy(asc(staffAccount.id))
      .limit(limit + 1)
    return rows.map(toRecord)
  }

  async activeAdminIds(scope: BuildingScope): Promise<string[]> {
    const rows = await this.database.executor
      .select({ id: staffAccount.id })
      .from(staffAccount)
      .where(
        and(
          inBuilding(staffAccount, scope),
          eq(staffAccount.role, 'admin'),
          eq(staffAccount.status, 'active'),
        ),
      )
      .orderBy(asc(staffAccount.id))
    return rows.map((row) => row.id)
  }

  // scope-ok: the sign-in has no building yet; the email names the row
  recordFailureByEmail(email: string, lockout: Lockout, now: Date): Promise<FailureCount | null> {
    return this.recordFailure(sql`email = ${email}::citext`, lockout, now)
  }

  // scope-ok: a step-up proof acts on the staff member's own row, whose building the guard has checked
  recordFailureById(id: string, lockout: Lockout, now: Date): Promise<FailureCount | null> {
    return this.recordFailure(sql`id = ${id}::uuid`, lockout, now)
  }

  /**
   * The lockout statement of DOC-16 §4.1, one statement so that 20 parallel wrong passwords leave 5 failures. The `WHERE` makes
   * a locked account answer no row; once `locked_until` has passed, the next wrong password starts a new count at 1.
   */
  private async recordFailure(
    target: ReturnType<typeof sql>,
    { maxAttempts, minutes }: Lockout,
    now: Date,
  ): Promise<FailureCount | null> {
    const next = sql`(CASE WHEN locked_until <= ${ts(now)} THEN 1 ELSE failed_attempts + 1 END)`
    // scope-ok: the callers above name the row by email or by id
    const rows = await this.database.executor.execute<Failure>(sql`
      UPDATE identity.staff_account
         SET failed_attempts = ${next},
             locked_until = CASE WHEN ${next} >= ${maxAttempts}::int
                                 THEN ${ts(now)} + make_interval(mins => ${minutes}::int)
                                 WHEN locked_until <= ${ts(now)} THEN NULL
                                 ELSE locked_until END,
             updated_at = ${ts(now)}
       WHERE ${target} AND (locked_until IS NULL OR locked_until <= ${ts(now)})
      RETURNING failed_attempts, locked_until`)
    const [row] = rows
    return row
      ? { failedAttempts: row.failed_attempts, lockedUntil: asDateOrNull(row.locked_until) }
      : null
  }

  // scope-ok: the id is the row the sign-in just authenticated
  async markSignedIn(id: string, now: Date, rehashed?: string): Promise<void> {
    // scope-ok: see above
    await this.database.executor
      .update(staffAccount)
      .set({
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        updatedAt: now,
        ...(rehashed === undefined ? {} : { passwordHash: rehashed }),
      })
      .where(eq(staffAccount.id, id))
  }

  // scope-ok: the id comes from a consumed link, which carries its own building
  async setPassword(
    id: string,
    passwordHash: string,
    expectedStatus: 'invited' | 'active',
    now: Date,
  ): Promise<boolean> {
    // scope-ok: see above
    const rows = await this.database.executor
      .update(staffAccount)
      .set({
        passwordHash,
        status: 'active',
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
        version: sql`${staffAccount.version} + 1`,
      })
      .where(and(eq(staffAccount.id, id), eq(staffAccount.status, expectedStatus)))
      .returning({ id: staffAccount.id })
    return rows.length > 0
  }
}
