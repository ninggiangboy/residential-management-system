import type { Language, StaffStatus } from '../contracts'
import type { StaffAccountRecord } from '../domain/staff-account'

/** The account object of E-30 and E-31 (DOC-51 §7): what the shell of the web CMS and the staff app show about the signed-in member. */
export interface StaffMeView {
  id: string
  email: string
  fullName: string
  role: StaffAccountRecord['role']
  status: StaffStatus
  buildingId: string
  language: Language
  pushEnabled: boolean
  /** The 480 px thumbnail, or the original while it does not exist; `null` without an avatar. */
  avatarUrl: string | null
  lastLoginAt: string | null
  version: number
}

export const toStaffMeView = (
  staff: StaffAccountRecord,
  avatarUrl: string | null,
): StaffMeView => ({
  id: staff.id,
  email: staff.email,
  fullName: staff.fullName,
  role: staff.role,
  status: staff.status,
  buildingId: staff.buildingId,
  language: staff.language,
  pushEnabled: staff.pushEnabled,
  avatarUrl,
  lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
  version: staff.version,
})
