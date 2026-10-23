import type { Transition } from '@core/kernel'
import type { StaffRole } from '@rms/shared-types'
import type { Language, StaffStatus } from '../contracts'
import { TokenInvalidError } from './errors'

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

/** The columns a transition may name; the fields the rules of this file read or write. */
export type StaffAccountTransition = Transition<StaffAccountRecord>

/** The lockout of the building's settings: `maxAttempts` wrong passwords lock the account for `minutes` (DR-107). */
export interface Lockout {
  maxAttempts: number
  minutes: number
}

/** What one wrong password did: the count after it, the seconds still locked, and the change to store (`null` when none was made). */
export interface FailureOutcome {
  failedAttempts: number
  lockedSeconds: number
  transition: StaffAccountTransition | null
}

const MINUTE_MS = 60_000

/**
 * A staff member (DOC-26 §4, DOC-16 §4.1). The class holds every rule that reads or moves the row; a method that moves it returns
 * a `Transition` and the repository applies it in one guarded statement, so 20 parallel wrong passwords still leave 5 failures
 * (DR-255): each `expect` carries the counters the decision read, and a lost race is decided again by `decide`.
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

  /**
   * Counts one wrong password (DOC-16 §4.1). A lock still running counts nothing. Once `lockedUntil` has passed, the next wrong
   * password starts a new count at 1; the one that reaches `maxAttempts` locks for `minutes`. The status stays `active`.
   */
  recordFailure(lockout: Lockout, now: Date): FailureOutcome {
    const { failedAttempts: before, lockedUntil: until } = this.record
    const stillLocked = this.lockedSeconds(now)
    if (stillLocked > 0)
      return { failedAttempts: before, lockedSeconds: stillLocked, transition: null }
    const failedAttempts = until !== null ? 1 : before + 1
    const lockedUntil =
      failedAttempts >= lockout.maxAttempts
        ? new Date(now.getTime() + lockout.minutes * MINUTE_MS)
        : null
    return {
      failedAttempts,
      lockedSeconds: lockedUntil ? lockout.minutes * 60 : 0,
      transition: {
        id: this.id,
        expect: { failedAttempts: before, lockedUntil: until },
        set: { failedAttempts, lockedUntil },
      },
    }
  }

  /**
   * The right password: the counters clear and `last_login_at` is stamped. A stored hash that needs a rehash is replaced only
   * while it is still the one that was verified, so a password changed in between is not overwritten.
   */
  signedIn(now: Date, rehashed?: string): StaffAccountTransition {
    return {
      id: this.id,
      expect:
        rehashed === undefined
          ? { status: 'active' }
          : { status: 'active', passwordHash: this.record.passwordHash },
      set: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(rehashed === undefined ? {} : { passwordHash: rehashed }),
      },
    }
  }

  /**
   * Sets the password from a link (DOC-26 §4.3, DR-150). An invite needs an `invited` account and activates it; a reset needs an
   * `active` one. A status that moved since the link was issued (locked, disabled) answers `token_invalid`. The counters clear.
   */
  setPassword(passwordHash: string, linkKind: 'invite' | 'reset'): StaffAccountTransition {
    const expected = linkKind === 'invite' ? 'invited' : 'active'
    if (this.record.status !== expected) throw new TokenInvalidError()
    return {
      id: this.id,
      expect: { status: expected, version: this.record.version },
      set: {
        passwordHash,
        status: 'active',
        failedAttempts: 0,
        lockedUntil: null,
        version: this.record.version + 1,
      },
    }
  }
}
