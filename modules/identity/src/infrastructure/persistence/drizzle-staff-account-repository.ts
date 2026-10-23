import { applyTransition, type Database, inBuilding } from '@core/db'
import type { BuildingScope, StaffRole } from '@rms/shared-types'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import type { StaffAccountRecord, StaffAccountTransition } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
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

  // scope-ok: the transition names the row by id; the aggregate was loaded by a caller that has authorised it
  async apply(transition: StaffAccountTransition, now: Date): Promise<boolean> {
    return (
      (await applyTransition(this.database, staffAccount, transition, {
        stamp: { updatedAt: now },
      })) !== null
    )
  }
}
