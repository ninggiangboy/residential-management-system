import type { BuildingScope } from '@rms/shared-types'
import type { UnitTypeRecord, UnitTypeStatus } from './unit-type'

/** A type with the number of units that have it, whatever their occupancy (DOC-51 E-180). */
export interface UnitTypeRow {
  unitType: UnitTypeRecord
  unitCount: number
}

/** The reads behind E-180. Every query carries the building (DOC-12 §7); no state change. */
export interface UnitTypeReader {
  /** Ordered by the lower-case Vietnamese name; at most 50 rows (DR-314). */
  list(scope: BuildingScope, status: UnitTypeStatus | undefined): Promise<UnitTypeRow[]>
  /** The units that have this type, for the answer of E-181 and E-182 (a new type has 0). */
  unitCountOf(scope: BuildingScope, unitTypeId: string): Promise<number>
  /** The units of the building with no type, for the "Chưa phân loại" line of the screen. */
  countWithoutType(scope: BuildingScope): Promise<number>
  /** The count of each status over the building, whatever the filter (the `summary` of E-180). */
  countByStatus(scope: BuildingScope): Promise<Record<UnitTypeStatus, number>>
}
