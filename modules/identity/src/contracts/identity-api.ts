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

/**
 * What the other modules call (DOC-09 §7.3). The resident calls that `residency` needs (`findOrCreateResidentAccount`,
 * `changeResidentPhone`, `queueMemberInvitation`, the phone lookups) join with P1-12 and P1-14. Like every contract, a call
 * joins the caller's transaction.
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
  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void>
}
