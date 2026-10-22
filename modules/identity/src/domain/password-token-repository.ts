export type LinkKind = 'reset' | 'invite'
export type StepUpAction = 'gateway_config' | 'admin_change' | 'staff_email'

export interface NewLink {
  id: string
  buildingId: string
  staffId: string
  kind: LinkKind
  /** SHA-256 of the raw token (DOC-16 §4.4). */
  tokenHash: string
  expiresAt: Date
}

export interface NewStepUpCode {
  id: string
  buildingId: string
  staffId: string
  action: StepUpAction
  /** HMAC of the code, bound to the staff member and the action (DR-132). */
  codeHmac: string
  expiresAt: Date
}

/** The single-use credentials of DOC-16 §4.4: reset and invite links, and step-up codes. */
export interface PasswordTokenRepository {
  /** Consumes the live token of `(staff, kind)` and inserts the new one, so a newer link voids the older. */
  issueLink(link: NewLink, now: Date): Promise<void>
  /** The atomic statement of DOC-26 §4.3: a row on first use, none for an unknown, expired or used link. */
  consumeLink(tokenHash: string, now: Date): Promise<{ staffId: string; kind: LinkKind } | null>
  /** Consumes the live code of `(staff, action)` and inserts the new one. */
  issueStepUp(code: NewStepUpCode, now: Date): Promise<void>
  /** The atomic statement of DOC-16 §4.4, bound to the staff member and the action. */
  consumeStepUp(
    staffId: string,
    action: StepUpAction,
    codeHmac: string,
    now: Date,
    maxAttempts: number,
  ): Promise<boolean>
  /** Counts a wrong code on the live code; the last allowed attempt consumes it. */
  countStepUpFailure(
    staffId: string,
    action: StepUpAction,
    maxAttempts: number,
    now: Date,
  ): Promise<void>
  /** `maxAttempts - attempts` of the live code, or 0 when there is none. */
  stepUpAttemptsLeft(
    staffId: string,
    action: StepUpAction,
    maxAttempts: number,
    now: Date,
  ): Promise<number>
}
