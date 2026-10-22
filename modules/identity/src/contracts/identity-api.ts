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

/**
 * What the other modules call (DOC-09 §7.3). The resident calls (`getResidentAccounts`, `findOrCreateResidentAccount`…) join
 * with P1-11. Like every contract, a call joins the caller's transaction.
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
  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void>
}
