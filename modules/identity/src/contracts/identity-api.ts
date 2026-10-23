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
  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void>
}
