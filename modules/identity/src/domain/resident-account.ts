import type { Transition } from '@core/kernel'
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
}
