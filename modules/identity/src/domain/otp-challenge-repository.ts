import type { OtpChallengeRecord, OtpChallengeTransition } from './otp-challenge'

export interface NewOtpChallenge {
  id: string
  phone: string
  codeHmac: string
  expiresAt: Date
  resendAfter: Date
  /** The client address, kept for abuse review; `null` when it is not an address (DOC-16 §4.3). */
  ip: string | null
}

/**
 * The OTP challenges of DOC-16 §4.3. The rules live in `OtpChallenge`; a write is an issue, or the guarded `apply` of what the
 * aggregate decided (DR-255).
 */
export interface OtpChallengeRepository {
  /**
   * Set-based (DR-255 item 5): spends the live challenge of the phone and inserts the new one, so a newer code voids the older
   * (DOC-26 §5.1 step 7). The partial unique index decides a race: the loser's insert fails with a unique violation.
   */
  issue(challenge: NewOtpChallenge, now: Date): Promise<void>
  findById(id: string): Promise<OtpChallengeRecord | null>
  /** The unspent challenge of the phone, in any state of expiry. */
  findOpen(phone: string): Promise<OtpChallengeRecord | null>
  /** The rolling count of challenges created after `since` (DOC-26 §5.1 step 6). */
  countSince(since: Date): Promise<number>
  /** `false`: the challenge was spent, or counted, since it was loaded. */
  apply(transition: OtpChallengeTransition): Promise<boolean>
  /**
   * The same for the fixed demo code: matches only while the challenge's phone belongs to an account flagged `is_demo`, in the
   * statement itself (DOC-26 §5.3), so no environment and no race can open a real account with it.
   */
  applyDemo(transition: OtpChallengeTransition): Promise<boolean>
}
