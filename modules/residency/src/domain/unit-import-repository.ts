import type { BuildingScope } from '@rms/shared-types'
import type { Occupancy } from '../contracts'
import type { StoredProfile, StoredUnit, StoredUnitType } from './import/plan'

/** What the commit writes to a unit; `null` is a blank cell and keeps the stored value (DOC-18 §1.2). */
export interface UnitFields {
  floor: number | null
  /** `null` is a blank cell: it keeps the stored type, and a new unit has none (DR-315). */
  unitTypeId: string | null
  bedrooms: number | null
  areaM2: string | null
  occupancy: Occupancy | null
}

export interface ProfileFill {
  accountId: string
  fullName: string
  email: string | null
  cccdEnc: string | null
  cccdLast4: string | null
  dateOfBirth: string | null
}

/**
 * The statements of the import that no other use case shares: the three set queries of DOC-18 §1.5 and the writes of DOC-27 §9.2
 * (S8, S9). Every one carries the building (DOC-12 §7).
 */
export interface UnitImportRepository {
  /** Q-U: the units whose lower-case code is in `codesLower`, with the account of their non-removed owner. */
  findUnits(scope: BuildingScope, codesLower: readonly string[]): Promise<StoredUnit[]>
  /** Q-T: the building's unit types, at most 50 (DR-314); matched in code by code, then by Vietnamese name. */
  findUnitTypes(scope: BuildingScope): Promise<StoredUnitType[]>
  /** Q-M: `<unitId>|<accountId>` of the non-removed, non-owner memberships of the accounts in the units. */
  findMembers(
    scope: BuildingScope,
    unitIds: readonly string[],
    accountIds: readonly string[],
  ): Promise<Set<string>>
  /** Q-P. */
  findProfiles(scope: BuildingScope, accountIds: readonly string[]): Promise<StoredProfile[]>
  /** S8, update half: blank cells keep the stored value; returns the occupancy before. */
  updateUnit(scope: BuildingScope, unitId: string, fields: UnitFields, now: Date): Promise<void>
  /** S8, insert half, in one statement per 500. */
  insertUnits(
    scope: BuildingScope,
    units: readonly ({ id: string; code: string } & UnitFields)[],
    now: Date,
  ): Promise<void>
  /**
   * S9, in one statement per 500: inserts the profiles or fills their empty fields; a stored value is never replaced. One
   * entry per account: a statement cannot touch a row twice.
   */
  fillProfiles(scope: BuildingScope, fills: readonly ProfileFill[], now: Date): Promise<void>
  /** DQ-60: the units, among `unitIds`, that have more than one non-removed owner. */
  unitsWithManyOwners(scope: BuildingScope, unitIds: readonly string[]): Promise<string[]>
}
