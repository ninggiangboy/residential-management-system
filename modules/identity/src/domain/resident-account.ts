import { NotFoundError, type Transition } from '@core/kernel'
import type { Language, ResidentStatus } from '../contracts'

export interface ResidentAccountRecord {
  id: string
  /** E.164, or `deleted:<id>` after the deletion job (DOC-16 §4.2). */
  phone: string
  displayName: string | null
  language: Language
  pushEnabled: boolean
  status: ResidentStatus
  /** Only the demo building's accounts take the fixed code and receive no SMS (DR-37, DR-60). */
  isDemo: boolean
  lastAppOpenAt: Date | null
  version: number
}

/** What a new account is born with; the language is the default (`vi`) and the account is active (DOC-16 §4.2). */
export interface NewResidentAccount {
  id: string
  phone: string
  displayName: string
}

/** One pending deletion (DOC-35 §10.2). */
export interface DeletionRequest {
  accountId: string
  requestedAt: Date
  approvedAt: Date | null
}

/** The dates of the deletion workflow of one account, read for the approval (DOC-35 §10.1). */
export interface DeletionState {
  status: ResidentStatus
  requestedAt: Date | null
  approvedAt: Date | null
}

export type ResidentAccountTransition = Transition<ResidentAccountRecord>

const HOUR_MS = 3_600_000

/**
 * A resident account (DOC-26 §1.2, DOC-16 §4.2): one phone, no rights of its own. The class holds the rules that read the row;
 * a change it decides is applied by the repository in one guarded statement (DR-255).
 */
export class ResidentAccount {
  constructor(readonly record: ResidentAccountRecord) {}

  get id(): string {
    return this.record.id
  }

  /**
   * An account that has requested its deletion is still usable until the job runs (DOC-16 §4.2), so it signs in and refreshes;
   * a deleted one has no phone to ask for a code.
   */
  get canSignIn(): boolean {
    return this.record.status === 'active' || this.record.status === 'deletion_requested'
  }

  /**
   * `last_app_open_at`, written at most once an hour per account (DOC-26 §5.2, AU-54): a resident who opens the app often does
   * not produce a write per refresh. `null` inside the hour.
   */
  appOpened(now: Date): ResidentAccountTransition | null {
    const last = this.record.lastAppOpenAt
    if (last !== null && now.getTime() - last.getTime() < HOUR_MS) return null
    return { id: this.id, expect: { lastAppOpenAt: last }, set: { lastAppOpenAt: now } }
  }

  /**
   * The language and the push setting the resident sets for themselves (E-14, DOC-51 §5): a person's own preferences, last write
   * wins (DR-146), so the guard names only the status. A deleted account has nothing to edit and looks missing. `null` when
   * nothing changes.
   */
  editPreferences(
    changes: Partial<Pick<ResidentAccountRecord, 'language' | 'pushEnabled'>>,
  ): ResidentAccountTransition | null {
    if (this.record.status === 'deleted') throw new NotFoundError()
    const set: Partial<ResidentAccountRecord> = {}
    if (changes.language !== undefined && changes.language !== this.record.language)
      set.language = changes.language
    if (changes.pushEnabled !== undefined && changes.pushEnabled !== this.record.pushEnabled)
      set.pushEnabled = changes.pushEnabled
    if (Object.keys(set).length === 0) return null
    return {
      id: this.id,
      expect: { status: this.record.status },
      set: { ...set, version: this.record.version + 1 },
    }
  }

  /**
   * The login phone moves to `phone` (DOC-26 §2.2). A deleted account has no phone to change, so it looks missing; the same number
   * decides nothing (`null`). The guard names the old phone, so a parallel change of the same account is decided again.
   */
  changePhone(phone: string): ResidentAccountTransition | null {
    if (this.record.status === 'deleted') throw new NotFoundError()
    if (this.record.phone === phone) return null
    return {
      id: this.id,
      expect: { phone: this.record.phone, status: this.record.status },
      set: { phone, version: this.record.version + 1 },
    }
  }
}
