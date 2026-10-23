import type {
  LinkKind,
  PasswordTokenRecord,
  PasswordTokenTransition,
  StepUpAction,
} from './password-token'

export type { LinkKind, StepUpAction }

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

/**
 * The single-use credentials of DOC-16 §4.4: reset and invite links, and step-up codes. The rules live in `PasswordToken`; a
 * write is an issue, or the guarded `apply` of what the aggregate decided (DR-255).
 */
export interface PasswordTokenRepository {
  /**
   * Set-based (DR-255 item 5): spends the live link of `(staff, kind)` and inserts the new one, so a newer link voids the older
   * (DOC-26 §4.4).
   */
  issueLink(link: NewLink, now: Date): Promise<void>
  /** The same for the live code of `(staff, action)`. */
  issueStepUp(code: NewStepUpCode, now: Date): Promise<void>
  /** The link with that hash, in any state. */
  findLink(tokenHash: string): Promise<PasswordTokenRecord | null>
  /** The newest unspent code of `(staff, action)`, in any state of expiry. */
  findStepUp(staffId: string, action: StepUpAction): Promise<PasswordTokenRecord | null>
  /** `false`: the token was spent, or counted, since it was loaded. */
  apply(transition: PasswordTokenTransition): Promise<boolean>
}
