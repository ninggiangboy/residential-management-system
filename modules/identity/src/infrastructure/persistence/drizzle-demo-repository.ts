import { type Database, inBuilding } from '@core/db'
import type { BuildingScope, DemoCounts } from '@rms/shared-types'
import { and, eq, inArray } from 'drizzle-orm'
import type { DemoRepository, DemoResidentRow, DemoStaffRow } from '../../domain/demo-repository'
import { otpChallenge, passwordToken, refreshFamily, residentAccount, staffAccount } from './schema'

export class DrizzleDemoRepository implements DemoRepository {
  constructor(private readonly database: Database) {}

  /** A family goes with its tokens (`ON DELETE CASCADE`); the count is the families. */
  private async deleteFamilies(kind: 'staff' | 'resident', accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0
    // scope-ok: the accounts are named by the caller: the building's staff, or the residents flagged `is_demo` (a resident family has no building)
    const families = await this.database.executor
      .delete(refreshFamily)
      .where(and(eq(refreshFamily.kind, kind), inArray(refreshFamily.accountId, accountIds)))
      .returning({ id: refreshFamily.id })
    return families.length
  }

  async deleteStaff(scope: BuildingScope): Promise<DemoCounts> {
    const staff = await this.database.executor
      .select({ id: staffAccount.id })
      .from(staffAccount)
      .where(inBuilding(staffAccount, scope))
    const families = await this.deleteFamilies(
      'staff',
      staff.map((row) => row.id),
    )
    const tokens = await this.database.executor
      .delete(passwordToken)
      .where(inBuilding(passwordToken, scope))
      .returning({ id: passwordToken.id })
    const accounts = await this.database.executor
      .delete(staffAccount)
      .where(inBuilding(staffAccount, scope))
      .returning({ id: staffAccount.id })
    return {
      'identity.refresh_family': families,
      'identity.password_token': tokens.length,
      'identity.staff_account': accounts.length,
    }
  }

  // scope-ok: a resident account has no building; the demo's accounts are the ones flagged `is_demo`
  async deleteResidents(): Promise<DemoCounts> {
    const flagged = await this.database.executor
      .select({ id: residentAccount.id, phone: residentAccount.phone })
      .from(residentAccount)
      .where(eq(residentAccount.isDemo, true))
    const families = await this.deleteFamilies(
      'resident',
      flagged.map((row) => row.id),
    )
    const challenges =
      flagged.length === 0
        ? []
        : await this.database.executor
            .delete(otpChallenge)
            .where(
              inArray(
                otpChallenge.phone,
                flagged.map((row) => row.phone),
              ),
            )
            .returning({ id: otpChallenge.id })
    const accounts = await this.database.executor
      .delete(residentAccount)
      .where(eq(residentAccount.isDemo, true))
      .returning({ id: residentAccount.id })
    return {
      'identity.refresh_family': families,
      'identity.otp_challenge': challenges.length,
      'identity.resident_account': accounts.length,
    }
  }

  async insertStaff(scope: BuildingScope, rows: readonly DemoStaffRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.database.executor.insert(staffAccount).values(
      rows.map((row) => ({
        id: row.id,
        buildingId: scope.buildingId,
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        status: 'active',
        passwordHash: row.passwordHash,
        language: 'vi',
      })),
    )
  }

  async insertResidents(rows: readonly DemoResidentRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.database.executor.insert(residentAccount).values(
      rows.map((row) => ({
        id: row.id,
        phone: row.phone,
        displayName: row.displayName,
        status: 'active',
        isDemo: true,
      })),
    )
  }
}
