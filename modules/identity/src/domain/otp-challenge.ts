import type { Transition } from '@core/kernel'

/**
 * The fixed code of a demo account (DR-37, DR-60). A constant in the code and not configuration, so no environment can change
 * it; it works only for a challenge whose phone belongs to a flagged account (DOC-26 §5.3).
 */
export const DEMO_FIXED_OTP = '123456'

export interface OtpChallengeRecord {
  id: string
  phone: string
  /** `HMAC-SHA256(OTP_HMAC_KEY, "otp:" || id || ":" || code)` in hex (DOC-26 §5.1). */
  codeHmac: string
  expiresAt: Date
  resendAfter: Date
  attempts: number
  consumedAt: Date | null
}

export type OtpChallengeTransition = Transition<OtpChallengeRecord>

/**
 * One SMS code sent to one phone (DOC-16 §4.3). It says when it can still be used, what a right code and a wrong one do, and
 * when the next code may be asked for; the repository applies the change in one guarded statement, so two taps on "verify" sign
 * in once and five guesses in parallel are five tries (DR-255, DOC-26 §5.2).
 */
export class OtpChallenge {
  constructor(readonly record: OtpChallengeRecord) {}

  get id(): string {
    return this.record.id
  }

  /** Unused and not expired at `now`. A fifth wrong code consumes the challenge, so a live one has tries left. */
  isLive(now: Date): boolean {
    return this.record.consumedAt === null && this.record.expiresAt > now
  }

  /** Seconds before another code may be asked for this phone, or 0 (DOC-26 §5.1 step 3, FR-15.2). */
  resendWait(now: Date): number {
    if (!this.isLive(now) || this.record.resendAfter <= now) return 0
    return Math.ceil((this.record.resendAfter.getTime() - now.getTime()) / 1000)
  }

  /**
   * The right code: spends the challenge, once. `null` for a wrong code, and for a challenge that is used, expired or out of
   * tries. The tries are not part of the guard: a wrong try counted in parallel changes nothing here, and the one that took the
   * last try has already consumed the challenge.
   */
  verify(codeHmac: string, now: Date): OtpChallengeTransition | null {
    if (!this.isLive(now) || this.record.codeHmac !== codeHmac) return null
    return this.consume(now)
  }

  /** The fixed code of a demo account: the same change, whatever the stored hash; the repository adds the flag check. */
  verifyDemo(now: Date): OtpChallengeTransition | null {
    return this.isLive(now) ? this.consume(now) : null
  }

  /** Counts a wrong code; the last allowed try spends the challenge (FR-15.3). `null` when there is no live challenge to count on. */
  countFailure(now: Date, maxAttempts: number): OtpChallengeTransition | null {
    if (!this.isLive(now)) return null
    const attempts = this.record.attempts + 1
    return {
      id: this.id,
      expect: { consumedAt: null, attempts: this.record.attempts },
      set: { attempts, consumedAt: attempts >= maxAttempts ? now : null },
    }
  }

  /** Tries left of a live challenge, or 0 (FR-15.3). */
  attemptsLeft(now: Date, maxAttempts: number): number {
    return this.isLive(now) ? Math.max(0, maxAttempts - this.record.attempts) : 0
  }

  private consume(now: Date): OtpChallengeTransition {
    return { id: this.id, expect: { consumedAt: null }, set: { consumedAt: now } }
  }
}
