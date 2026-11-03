import type { StaffContext, StaffRole } from '@rms/shared-types'

export type StaffStatus = 'invited' | 'active' | 'locked' | 'disabled'
export type Language = 'vi' | 'en'
export type StepUpAction = 'gateway_config' | 'admin_change' | 'staff_email'

/** No email: nobody but `identity` mails staff (DOC-09 §7.3). */
export interface StaffDto {
  staffId: string
  buildingId: string
  fullName: string
  role: StaffRole
  status: StaffStatus
  language: Language
  pushEnabled: boolean
}

export type ResidentStatus = 'active' | 'deletion_requested' | 'deleted'

/** The phone is E.164, or `deleted:<id>` once the account is deleted; a caller never logs it (DOC-09 §7.3). */
export interface ResidentAccountDto {
  accountId: string
  phone: string
  displayName: string | null
  language: Language
  pushEnabled: boolean
  status: ResidentStatus
  /** ISO instant of the last app open (written at most once an hour, DOC-26 §5.2); `null` before the first one. */
  lastAppOpenAt: string | null
}

/** One account in `deletion_requested` (DOC-35 §10.2): `approvedAt` is `null` until a Manager approves it. */
export interface DeletionRequestDto {
  accountId: string
  requestedAt: string
  approvedAt: string | null
}

/** The answer of the approval (E-68): the earliest execution is the approval plus `accountDeletionDays` (DOC-35 §10.1). */
export interface DeletionApprovalDto {
  accountId: string
  deletionRequestedAt: string
  deletionApprovedAt: string
  executeAfter: string
}

/** One account found by its phone (DOC-18 §1.5): a `deleted` account has the phone `deleted:<id>` and never matches. */
export interface ResidentPhoneMatch {
  phone: string
  accountId: string
  displayName: string | null
  status: 'active' | 'deletion_requested'
}

/**
 * What the other modules call (DOC-09 §7.3). The resident calls that `residency` still needs (`changeResidentPhone`,
 * `queueMemberInvitation`, the name and fragment lookups) join with P1-14 and P4-10. Like every contract, a call joins the
 * caller's transaction.
 */
export interface IdentityApi {
  getStaff(ids: string[]): Promise<StaffDto[]>
  /** Only `active` staff of the roles asked, keyset on `staffId`. */
  listActiveStaff(
    buildingId: string,
    roles: StaffRole[],
    page?: { after?: string; limit?: number },
  ): Promise<{ items: StaffDto[]; next: string | null }>
  /**
   * Checks the password and consumes the live step-up code in the caller's transaction, counts a wrong password toward the
   * lockout, and queues the notice to every active Admin. Throws `StepUpFailedError` on any failure; the failure counters
   * are committed in their own transaction first (DR-132, DOC-26 §4.5).
   */
  /**
   * The ids of the accounts flagged `is_demo`: the only ones that take the fixed OTP and receive no SMS (DR-37, DR-60). The boot
   * guard asks it to prove that none of them belongs to a building that is not a demo building (DOC-36 §10.1 check 1).
   */
  listDemoAccountIds(): Promise<string[]>
  /**
   * The ids among up to 500 session ids (any kind, any account) whose refresh family is live, with the predicate of the session
   * list (`revoked_at IS NULL AND absolute_expires_at > now()`); an unknown id is absent. The push sender uses it to skip and delete
   * the device tokens of sessions that ended by expiry, which writes no event (DOC-31 §6.2 step 4, DOC-26 §3.7, DR-300).
   */
  liveSessionIds(sessionIds: string[]): Promise<string[]>
  /** Up to 500 ids; a `deleted` account is returned with its `deleted:<id>` phone so a caller can tell. */
  getResidentAccounts(ids: string[]): Promise<ResidentAccountDto[]>
  /**
   * The accounts of up to 5,000 E.164 numbers, one query (the `db` layer of the units-and-owners import, DOC-18 §1.5); a number
   * with no live account is absent.
   */
  findResidentAccountsByPhones(phones: string[]): Promise<ResidentPhoneMatch[]>
  /**
   * The account of a phone, created when there is none (DOC-27 §9.2 step 4, DOC-26 §2.2). Idempotent on the phone: an existing
   * account keeps its name. An invalid number throws `ValidationError` with rule `phone_invalid`. A `deletion_requested`
   * account is returned as it is.
   */
  findOrCreateResidentAccount(
    phone: string,
    displayName: string,
  ): Promise<{ accountId: string; created: boolean }>
  /**
   * Changes the login phone (DOC-26 §2.2, FR-18.4): `NotFoundError` for an unknown or deleted account, 409 `phone_in_use` when the
   * number has an account, `ValidationError` rule `phone_invalid` for a bad number; the same number is a no-op. Every refresh
   * family is revoked (`phone_changed`) with one `identity.session_revoked.v1` each. The caller audits.
   */
  changeResidentPhone(accountId: string, newPhone: string): Promise<void>
  /**
   * Accounts whose phone ends with `fragment` (digits only, at least 4; the Vietnamese leading `0` is dropped by the caller), at
   * most `limit` (≤ 50), deleted accounts excluded (DOC-27 §11.1).
   */
  findResidentAccountsByPhoneFragment(
    fragment: string,
    limit: number,
  ): Promise<ResidentAccountDto[]>
  /**
   * Writes `identity.sms_requested.v1` kind `member_invitation` (expires in 5 minutes) after drawing one token of the phone's
   * bucket `otp:phone:<e164>` in the caller's transaction: an empty bucket is `RateLimitedError` and the add rolls back.
   */
  queueMemberInvitation(accountId: string, params: { unitCode: string }): Promise<void>
  /** The accounts in `deletion_requested`, oldest first, keyset on `accountId` (DOC-09 §7.3, DR-125). */
  listDeletionRequests(page?: {
    after?: string
    limit?: number
  }): Promise<{ items: DeletionRequestDto[]; next: string | null }>
  /**
   * Approves the deletion request of the account (E-68, DOC-35 §10.1) in the caller's transaction and audits it as
   * `identity.account.deletion_approve`. 404 for an unknown or deleted account, 409 `deletion_not_requested` for an `active`
   * one; a second approval answers the existing dates and writes nothing. `cooloffDays` is the building's `accountDeletionDays`.
   * The caller checks the staff scope and the ownership (`owner_must_transfer`) first.
   */
  approveResidentDeletion(
    staff: StaffContext,
    accountId: string,
    cooloffDays: number,
  ): Promise<DeletionApprovalDto>
  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void>
}
