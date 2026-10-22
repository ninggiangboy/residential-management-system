import type { StaffRole } from '@rms/shared-types'
import type { Language, StaffStatus } from '../contracts'

export interface StaffAccountRecord {
  id: string
  buildingId: string
  email: string
  fullName: string
  role: StaffRole
  status: StaffStatus
  /** `null` only while `invited` (the `CHECK` of DOC-16 §4.1). */
  passwordHash: string | null
  failedAttempts: number
  /** The temporary lockout; the status stays `active` (DR-107). */
  lockedUntil: Date | null
  language: Language
  pushEnabled: boolean
  avatarKey: string | null
  lastLoginAt: Date | null
  version: number
}

/**
 * A staff member as the sign-in sees them (DOC-26 §4.1, DOC-16 §4.1). The counters are moved by single SQL statements, not by
 * this class, because 20 parallel wrong passwords must leave 5 failures: the class holds the rules that read the row.
 */
export class StaffAccount {
  constructor(readonly record: StaffAccountRecord) {}

  get id(): string {
    return this.record.id
  }

  /**
   * Only an `active` account with a password may sign in or reset a password. An unknown email, an `invited`, a manually
   * `locked` and a `disabled` account all look the same from outside (DOC-26 §4.1 step 3, §4.4 rule 6).
   */
  get canSignIn(): boolean {
    return this.record.status === 'active' && this.record.passwordHash !== null
  }

  /** Seconds left of the temporary lockout at `now`, or 0. The correct password is refused while it is above 0 (FR-13.1). */
  lockedSeconds(now: Date): number {
    const until = this.record.lockedUntil
    if (!until || until <= now) return 0
    return Math.ceil((until.getTime() - now.getTime()) / 1000)
  }
}
