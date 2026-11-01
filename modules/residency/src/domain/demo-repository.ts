import type { BuildingScope, DemoCounts, MemberType } from '@rms/shared-types'

export interface DemoUnitTypeRow {
  id: string
  code: string
  name: { vi: string; en: string }
  defaultBedrooms: number | null
  defaultAreaM2: number | null
}

export interface DemoUnitRow {
  id: string
  code: string
  floor: number
  unitTypeId: string
  bedrooms: number | null
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
  /** Unit history, memberships, profiles, import jobs, units and unit types of the building, in that order: the units hold the types. */
  deleteAll(scope: BuildingScope): Promise<DemoCounts>
  insertUnitTypes(scope: BuildingScope, rows: readonly DemoUnitTypeRow[]): Promise<void>
  insertUnits(scope: BuildingScope, rows: readonly DemoUnitRow[]): Promise<void>
  insertProfiles(scope: BuildingScope, rows: readonly DemoProfileRow[]): Promise<void>
  insertMemberships(scope: BuildingScope, rows: readonly DemoMembershipRow[]): Promise<void>
}
