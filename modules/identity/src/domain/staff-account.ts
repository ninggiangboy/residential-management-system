import { ForbiddenError, type Transition } from '@core/kernel'
import type { StaffRole } from '@rms/shared-types'
import type { Language, StaffStatus } from '../contracts'
import { InvalidStaffTransitionError, StaffSelfActionError, TokenInvalidError } from './errors'

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
  createdAt: Date
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

/** Who asks for a change of a staff account: the role decides what they may touch (DOC-26 §4.4). */
export interface StaffActor {
  staffId: string
  role: StaffRole
}

/** What `PATCH /staff/accounts/{id}` may change (E-42); an absent key is kept. */
export interface StaffEdit {
  fullName?: string
  language?: Language
  role?: StaffRole
  email?: string
}

/**
 * What `PATCH /staff/me` may change (E-31); an absent key is kept. `avatarKey` is the `file_object` id as text (DR-146), `null`
 * removes the avatar. The email, the role and the status are never here.
 */
export interface StaffSelfEdit {
  fullName?: string
  language?: Language
  pushEnabled?: boolean
  avatarKey?: string | null
}

/** A Manager creates and touches only these two roles (DR-133, FR-14.1). */
const MANAGER_MAY_TOUCH: readonly StaffRole[] = ['technician', 'guard']

/** `true` for the roles whose accounts `actor` may create or act on: an Admin all, a Manager Technician and Guard only. */
export const mayManageRole = (actor: Pick<StaffActor, 'role'>, role: StaffRole): boolean =>
  actor.role === 'admin' || (actor.role === 'manager' && MANAGER_MAY_TOUCH.includes(role))

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

  /** Whether the row is the active Admin that the last-Admin rule counts (DOC-26 §4.4 rule 3). */
  get isActiveAdmin(): boolean {
    return this.record.role === 'admin' && this.record.status === 'active'
  }

  /** A Manager acts on a Technician or a Guard only; an Admin on anyone (DR-133). Anything else is 403 and reveals nothing more. */
  assertManagedBy(actor: StaffActor): void {
    if (!mayManageRole(actor, this.record.role)) throw new ForbiddenError()
  }

  /** Nobody locks, disables or changes the role of their own account (DOC-26 §4.4 rule 2). Checked before the role rule. */
  assertNotSelf(actor: StaffActor): void {
    if (actor.staffId === this.id) throw new StaffSelfActionError()
  }

  private invalid(action: string): never {
    throw new InvalidStaffTransitionError(this.record.status, action)
  }

  /** A change of the row guarded by the version and status the rule read; `version` moves with it (the `ETag` of E-41). */
  private move(set: Partial<StaffAccountRecord>): StaffAccountTransition {
    const { status, version } = this.record
    return { id: this.id, expect: { status, version }, set: { ...set, version: version + 1 } }
  }

  /**
   * Name, language, role and email (E-42). A Manager edits only the name and the language of a Technician or a Guard; the role
   * and the email are the Admin's (DR-133). `null` when nothing would change. The guard is the version the caller read.
   */
  edit(actor: StaffActor, changes: StaffEdit): StaffAccountTransition | null {
    if (changes.role !== undefined) this.assertNotSelf(actor)
    this.assertManagedBy(actor)
    if ((changes.role !== undefined || changes.email !== undefined) && actor.role !== 'admin')
      throw new ForbiddenError()
    const { fullName, language, role, email } = this.record
    const set: Partial<StaffAccountRecord> = {}
    if (changes.fullName !== undefined && changes.fullName !== fullName)
      set.fullName = changes.fullName
    if (changes.language !== undefined && changes.language !== language)
      set.language = changes.language
    if (changes.role !== undefined && changes.role !== role) set.role = changes.role
    if (changes.email !== undefined && changes.email.toLowerCase() !== email.toLowerCase())
      set.email = changes.email
    return Object.keys(set).length === 0 ? null : this.move(set)
  }

  /**
   * The member edits their own profile (E-31, DOC-26 §7): name, language, push setting and avatar. No role rule applies, since
   * the caller is the row's owner. `null` when nothing would change. The guard is the version the caller read.
   */
  editSelf(changes: StaffSelfEdit): StaffAccountTransition | null {
    const { fullName, language, pushEnabled, avatarKey } = this.record
    const set: Partial<StaffAccountRecord> = {}
    if (changes.fullName !== undefined && changes.fullName !== fullName)
      set.fullName = changes.fullName
    if (changes.language !== undefined && changes.language !== language)
      set.language = changes.language
    if (changes.pushEnabled !== undefined && changes.pushEnabled !== pushEnabled)
      set.pushEnabled = changes.pushEnabled
    if (changes.avatarKey !== undefined && changes.avatarKey !== avatarKey)
      set.avatarKey = changes.avatarKey
    return Object.keys(set).length === 0 ? null : this.move(set)
  }

  /** Manual lock: only an `active` account (the temporary lockout is not this one), by someone who may touch it. */
  lock(actor: StaffActor): StaffAccountTransition {
    this.assertNotSelf(actor)
    this.assertManagedBy(actor)
    if (this.record.status !== 'active') this.invalid('lock')
    return this.move({ status: 'locked' })
  }

  /**
   * One endpoint lifts both locks (FR-13.6): the manual `locked` becomes `active`, and a temporary lockout still running is
   * cleared. Anything else is 409 (DR-147).
   */
  unlock(actor: StaffActor, now: Date): StaffAccountTransition {
    this.assertManagedBy(actor)
    const { status } = this.record
    if (status !== 'locked' && !(status === 'active' && this.lockedSeconds(now) > 0))
      this.invalid('unlock')
    return this.move({
      status: status === 'locked' ? 'active' : status,
      failedAttempts: 0,
      lockedUntil: null,
    })
  }

  /** From `invited`, `active` or `locked`; the email stays reserved (DOC-20 §2.1). The Admin's alone, never on oneself. */
  disable(actor: StaffActor): StaffAccountTransition {
    this.assertNotSelf(actor)
    this.assertManagedBy(actor)
    if (this.record.status === 'disabled') this.invalid('disable')
    return this.move({ status: 'disabled' })
  }

  /** `disabled` only; it returns `invited` when no password was ever set (the table's check `ck_staff_account_password`). */
  enable(actor: StaffActor): StaffAccountTransition {
    this.assertManagedBy(actor)
    if (this.record.status !== 'disabled') this.invalid('enable')
    return this.move({ status: this.record.passwordHash === null ? 'invited' : 'active' })
  }
}
