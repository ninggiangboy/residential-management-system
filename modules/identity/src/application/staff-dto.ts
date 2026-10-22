import type { Language, StaffDto } from '../contracts'
import type { StaffAccountRecord } from '../domain/staff-account'

/** The `staff` object of the sign-in answer and of `GET /staff/me` (DOC-26 §3.4). */
export interface StaffProfile {
  id: string
  fullName: string
  role: StaffAccountRecord['role']
  buildingId: string
  language: Language
}

export const toStaffProfile = (staff: StaffAccountRecord): StaffProfile => ({
  id: staff.id,
  fullName: staff.fullName,
  role: staff.role,
  buildingId: staff.buildingId,
  language: staff.language,
})

export const toStaffDto = (staff: StaffAccountRecord): StaffDto => ({
  staffId: staff.id,
  buildingId: staff.buildingId,
  fullName: staff.fullName,
  role: staff.role,
  status: staff.status,
  language: staff.language,
  pushEnabled: staff.pushEnabled,
})
