import type { BuildingScope, StaffRole } from '@rms/shared-types'
import type { StaffAccountRecord, StaffAccountTransition } from './staff-account'

/**
 * Staff accounts as `identity` reads and moves them. Every time-dependent statement takes `now` from the `Clock`, so a test
 * with a fake clock decides when a lock ends (DOC-26 §12). The rules live in `StaffAccount`; a write is one guarded statement
 * (`apply`), so the database arbitrates a race and holds no rule.
 */
export interface StaffAccountRepository {
  findByEmail(email: string): Promise<StaffAccountRecord | null>
  findById(id: string): Promise<StaffAccountRecord | null>
  findByIds(ids: readonly string[]): Promise<StaffAccountRecord[]>
  /** Only `active` staff of the roles, keyset on `id`, one more than `limit` is read to know whether there is a next page. */
  listActive(
    scope: BuildingScope,
    roles: readonly StaffRole[],
    after: string | undefined,
    limit: number,
  ): Promise<StaffAccountRecord[]>
  activeAdminIds(scope: BuildingScope): Promise<string[]>

  /**
   * Applies the change an aggregate decided (DR-255) in one statement, `now` stamping `updated_at`. `false` means no row matched:
   * the state the decision read has moved, and the caller decides again or answers 409.
   */
  apply(transition: StaffAccountTransition, now: Date): Promise<boolean>
}
