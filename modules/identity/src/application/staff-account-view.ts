import type { Language, StaffStatus } from '../contracts'
import type { StaffAccountRecord } from '../domain/staff-account'

/** The account object of E-39…E-46 (DOC-51 §8). The hash, the attempt counter and the avatar key are never returned. */
export interface StaffAccountView {
  id: string
  email: string
  fullName: string
  role: StaffAccountRecord['role']
  status: StaffStatus
  language: Language
  lockedUntil: string | null
  lastLoginAt: string | null
  createdAt: string
  version: number
}

export const toStaffAccountView = (staff: StaffAccountRecord): StaffAccountView => ({
  id: staff.id,
  email: staff.email,
  fullName: staff.fullName,
  role: staff.role,
  status: staff.status,
  language: staff.language,
  lockedUntil: staff.lockedUntil?.toISOString() ?? null,
  lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
  createdAt: staff.createdAt.toISOString(),
  version: staff.version,
})
