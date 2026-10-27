import type { BuildingScope, DemoCounts, StaffRole } from '@rms/shared-types'

export interface DemoStaffRow {
  id: string
  email: string
  fullName: string
  role: StaffRole
  passwordHash: string
}

export interface DemoResidentRow {
  id: string
  phone: string
  displayName: string
}

/**
 * The rows of `identity` that the demo reset deletes and seeds (DOC-36 §10.2). The caller has asserted `building.is_demo`. The staff
 * rows are confined by the scope; a resident account has no building: the demo's accounts are the ones flagged `is_demo`.
 */
export interface DemoRepository {
  /** Refresh families and tokens, password tokens and accounts of the building's staff. */
  deleteStaff(scope: BuildingScope): Promise<DemoCounts>
  /** Refresh families and tokens, challenges and accounts of every resident flagged `is_demo`. */
  deleteResidents(): Promise<DemoCounts>
  insertStaff(scope: BuildingScope, rows: readonly DemoStaffRow[]): Promise<void>
  /** Inserts accounts flagged `is_demo`, active, in the default language. */
  insertResidents(rows: readonly DemoResidentRow[]): Promise<void>
}
