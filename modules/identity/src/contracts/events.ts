/**
 * The events `identity` writes to its own outbox (DOC-09 §6.3). `mail_requested` is a command for the worker (retry class
 * `default`); `session_revoked` is a fact that `realtime` and `notification` consume. The resident `sms_requested` and
 * `account_deletion_executed` join with P1-11 and P1-16.
 */
export const IDENTITY_EVENTS = {
  mailRequested: 'identity.mail_requested.v1',
  sessionRevoked: 'identity.session_revoked.v1',
} as const

/** The ten words of DOC-26 §3.8, shared by `refresh_family.revoked_reason` and the event. */
export const REVOCATION_REASONS = [
  'sign_out',
  'user_revoked',
  'token_reuse',
  'cap_exceeded',
  'account_locked',
  'account_disabled',
  'role_changed',
  'phone_changed',
  'password_changed',
  'deleted',
] as const
export type RevocationReason = (typeof REVOCATION_REASONS)[number]

export type MailKind = 'staff_invite' | 'password_reset' | 'step_up_code' | 'step_up_notice'

/** No address and no plaintext secret: the handler reads the address from `staff_account` and opens `secretEnc` (DR-117). */
export interface MailRequestedPayload {
  buildingId: string
  staffId: string
  kind: MailKind
  locale: 'vi' | 'en'
  params: Record<string, string>
  secretEnc: string | null
  expiresAt: string | null
}

export interface SessionRevokedPayload {
  buildingId: string | null
  accountKind: 'staff' | 'resident'
  accountId: string
  sessionId: string
  reason: RevocationReason
}
