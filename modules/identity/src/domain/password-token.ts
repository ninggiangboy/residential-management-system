import type { Transition } from '@core/kernel'

export type LinkKind = 'reset' | 'invite'
export type StepUpAction = 'gateway_config' | 'admin_change' | 'staff_email'

/** A single-use credential of DOC-16 §4.4: a reset or invite link, or a step-up code. Only a hash of the secret is stored. */
export interface PasswordTokenRecord {
  id: string
  staffId: string
  kind: LinkKind | 'step_up'
  action: StepUpAction | null
  tokenHash: string
  attempts: number
  expiresAt: Date
  consumedAt: Date | null
}

export type PasswordTokenTransition = Transition<PasswordTokenRecord>

/**
 * A reset link, an invite link or a step-up code. It says when it can still be used, and returns the change that spends it or
 * counts a wrong try; the repository applies the change in one guarded statement, so a link used twice is spent once and a
 * code guessed in parallel is counted once per try (DR-255, DOC-26 §4.3, §4.5).
 */
export class PasswordToken {
  constructor(readonly record: PasswordTokenRecord) {}

  get id(): string {
    return this.record.id
  }

  /** Unused and not expired at `now`. */
  isLive(now: Date): boolean {
    return this.record.consumedAt === null && this.record.expiresAt > now
  }

  /** Spends a link, once. `null` for a link that is used or expired: the two answer the same (DOC-26 §4.3). */
  consumeLink(now: Date): PasswordTokenTransition | null {
    if (!this.isLive(now)) return null
    return { id: this.id, expect: { consumedAt: null }, set: { consumedAt: now } }
  }

  /**
   * Spends a step-up code that is the one the Admin typed. The code of the person and the action is bound by the HMAC, so `null`
   * covers a wrong code, a used or expired one, and one whose five tries are gone. The tries are not part of the guard: a wrong
   * try counted in parallel changes nothing here, and the one that took the last try has consumed the code.
   */
  verifyStepUp(codeHmac: string, now: Date, maxAttempts: number): PasswordTokenTransition | null {
    if (!this.isLive(now) || this.record.attempts >= maxAttempts) return null
    if (this.record.tokenHash !== codeHmac) return null
    return { id: this.id, expect: { consumedAt: null }, set: { consumedAt: now } }
  }

  /** Counts a wrong try; the last allowed try spends the code. `null` when there is no live code to count on. */
  countFailure(now: Date, maxAttempts: number): PasswordTokenTransition | null {
    if (!this.isLive(now)) return null
    const attempts = this.record.attempts + 1
    return {
      id: this.id,
      expect: { consumedAt: null, attempts: this.record.attempts },
      set: { attempts, consumedAt: attempts >= maxAttempts ? now : null },
    }
  }

  /** Tries left of a live code, or 0 (FR-50.2). */
  attemptsLeft(now: Date, maxAttempts: number): number {
    return this.isLive(now) ? Math.max(0, maxAttempts - this.record.attempts) : 0
  }
}
