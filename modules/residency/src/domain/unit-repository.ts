import type { BuildingScope } from '@rms/shared-types'
import type { NewUnit, UnitRecord, UnitTransition } from './unit'

/** The units as the create, edit and transfer use cases move them. Every query carries the building scope (DR-12). */
export interface UnitRepository {
  /** The unit of the building; `null` for an unknown id or another building's (404, never 403). */
  find(scope: BuildingScope, id: string): Promise<UnitRecord | null>
  /**
   * Holds the unit row until the transaction ends, so two owners added to an ownerless unit at once are decided in turn (the unique
   * index is only the second net, DOC-27 §5.1 step 3). `false` for an unknown unit.
   */
  lock(scope: BuildingScope, id: string): Promise<boolean>
  /** `null` when the code, matched without case, is taken: `unit_code_key` decides (409 `unit_code_in_use`). */
  insert(scope: BuildingScope, unit: NewUnit, now: Date): Promise<UnitRecord | null>
  /**
   * One guarded statement on `version`. The unit after the change, or `null` when the version moved. A code that is taken throws
   * `UnitCodeInUseError`.
   */
  apply(scope: BuildingScope, transition: UnitTransition, now: Date): Promise<UnitRecord | null>
}
