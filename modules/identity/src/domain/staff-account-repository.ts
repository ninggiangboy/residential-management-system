import type { BuildingScope, StaffRole } from '@rms/shared-types'
import type { StaffAccountRecord } from './staff-account'

export interface Lockout {
  maxAttempts: number
  minutes: number
}

/** The row after a wrong password was counted. */
export interface FailureCount {
  failedAttempts: number
  lockedUntil: Date | null
}

/**
 * Staff accounts as `identity` reads and moves them. Every time-dependent statement takes `now` from the `Clock`, so a test
 * with a fake clock decides when a lock ends (DOC-26 §12). The writes of DOC-16 §4.1 are single statements: the database
 * arbitrates a race, not the code.
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
   * The lockout statement of DOC-16 §4.1 for the sign-in: counts one wrong password, or starts a new count once the lock has
   * ended. `null` means the account is locked right now (a parallel attempt locked it first, or the email is unknown).
   */
  recordFailureByEmail(email: string, lockout: Lockout, now: Date): Promise<FailureCount | null>
  /** The same statement by id, for a wrong password in a step-up proof (DOC-26 §4.5). */
  recordFailureById(id: string, lockout: Lockout, now: Date): Promise<FailureCount | null>
  /** Clears the counters, stamps `last_login_at`, and stores `passwordHash` when the stored one needs a rehash. */
  markSignedIn(id: string, now: Date, rehashed?: string): Promise<void>
  /**
   * Sets the password where the status is still `expectedStatus`; an invite also activates. Clears `failed_attempts` and
   * `locked_until`. `false` means zero rows: the status changed since the link was issued (DR-150).
   */
  setPassword(
    id: string,
    passwordHash: string,
    expectedStatus: 'invited' | 'active',
    now: Date,
  ): Promise<boolean>
}
