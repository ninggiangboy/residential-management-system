import type { MemberType, StaffRole } from './people'
import type { LocalDate } from './time'

/**
 * The contract of the demo reset (DOC-36 §10.2, ADR-0026): every module that owns demo rows exposes a `DemoResettable`, and
 * `building` runs them all in one transaction. The seed is data, not code: `apps/api` builds one `DemoPlan` and each module reads
 * its own part, so no module imports another's ids (DOC-12 §4.4).
 */

/** Bumped when the content of the seed changes (DOC-36 §9.1). */
export const DEMO_SEED_VERSION = 2

export interface DemoBuildingSeed {
  id: string
  code: string
  name: { vi: string; en: string }
  company: Record<string, unknown>
  address: string
  hotline: string
  email: string
  workingHours: { vi: string; en: string }
  timeZone: string
}

export interface DemoGatewaySeed {
  id: string
  provider: 'payos'
  driver: 'fake'
  receivingAccount: { bankBin: string; accountNumber: string; accountName: string }
}

export interface DemoTermsSeed {
  id: string
  kind: 'terms' | 'privacy'
  text: { vi: string }
}

/** A unit type of the demo building (DOC-36 §9, DR-314). */
export interface DemoUnitTypeSeed {
  id: string
  code: string
  name: { vi: string; en: string }
  defaultBedrooms: number | null
  defaultAreaM2: number | null
}

export interface DemoUnitSeed {
  id: string
  code: string
  floor: number
  /** The code of the unit's type, the plan's key as for the memberships (DR-314). */
  unitTypeCode: string
  /** `null` for a shophouse, which has no bedroom default (DOC-36 §9). */
  bedrooms: number | null
  areaM2: number
  occupancy: 'occupied' | 'rented' | 'vacant'
}

export interface DemoStaffSeed {
  id: string
  email: string
  fullName: string
  role: StaffRole
}

export interface DemoMembershipSeed {
  id: string
  unitCode: string
  memberType: MemberType
  canPay: boolean
}

export interface DemoResidentSeed {
  /** The `resident_account` id. */
  id: string
  phone: string
  displayName: string
  memberships: readonly DemoMembershipSeed[]
}

export interface DemoPlan {
  building: DemoBuildingSeed
  gateway: DemoGatewaySeed
  /** Published once and kept across resets: terms versions are write-once (DOC-36 §9.1). */
  terms: readonly DemoTermsSeed[]
  /** The staff member who "published" the terms: the demo Admin, a fixed id. */
  termsPublisherId: string
  unitTypes: readonly DemoUnitTypeSeed[]
  units: readonly DemoUnitSeed[]
  staff: readonly DemoStaffSeed[]
  residents: readonly DemoResidentSeed[]
}

export interface DemoSeedContext {
  /** Today in the demo building's time zone: every date of the seed is relative to it (BD-31). */
  today: LocalDate
  plan: DemoPlan
  /** `DEMO_STAFF_PASSWORD`, in clear: only `identity` hashes it. */
  password: string
}

/** Rows deleted or created, per `schema.table`. */
export type DemoCounts = Record<string, number>

export interface DemoResettable {
  readonly module: string
  /** Asserts first that the building is a demo building (`BuildingApi.assertDemo`), then deletes this module's rows of it. */
  resetDemo(buildingId: string): Promise<DemoCounts>
  seedDemo(buildingId: string, ctx: DemoSeedContext): Promise<DemoCounts>
}
