import type { BuildingScope, DemoCounts, MemberType } from '@rms/shared-types'

export interface DemoUnitRow {
  id: string
  code: string
  floor: number
  bedrooms: number
  areaM2: number
  occupancy: 'occupied' | 'rented' | 'vacant'
}

export interface DemoProfileRow {
  accountId: string
  fullName: string
}

export interface DemoMembershipRow {
  id: string
  accountId: string
  unitId: string
  memberType: MemberType
  canPay: boolean
  /** The demo Admin, who "added" every seeded membership. */
  addedBy: string
}

/** The rows of `residency` that the demo reset deletes and seeds (DOC-36 §10.2). The caller has asserted `building.is_demo`. */
export interface DemoRepository {
  /** Unit history, memberships, profiles, import jobs and units of the building, in that order. */
  deleteAll(scope: BuildingScope): Promise<DemoCounts>
  insertUnits(scope: BuildingScope, rows: readonly DemoUnitRow[]): Promise<void>
  insertProfiles(scope: BuildingScope, rows: readonly DemoProfileRow[]): Promise<void>
  insertMemberships(scope: BuildingScope, rows: readonly DemoMembershipRow[]): Promise<void>
}
