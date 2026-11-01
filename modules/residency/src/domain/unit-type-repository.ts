import type { BuildingScope } from '@rms/shared-types'
import type { NewUnitType, UnitTypeRecord, UnitTypeTransition } from './unit-type'

/** The unit types as the create and edit use cases move them. Every query carries the building scope (DR-12). */
export interface UnitTypeRepository {
  /** `null` for an unknown id or another building's (the same answer, DOC-27 §4.3 rule 4). */
  find(scope: BuildingScope, id: string): Promise<UnitTypeRecord | null>
  /**
   * As `find`, holding the row against an archive until the transaction ends, so a unit created while the type is archived sees
   * the archive or waits for it (DOC-27 §4.3 rule 7).
   */
  findShared(scope: BuildingScope, id: string): Promise<UnitTypeRecord | null>
  /**
   * Serialises the creates of one building and returns how many types it has, archived ones included (DOC-27 §4.3 rule 5).
   * The lock is released at the end of the transaction.
   */
  countLocked(scope: BuildingScope): Promise<number>
  /** Throws `UnitTypeCodeInUseError` or `UnitTypeNameInUseError` when `unit_type_code_key` or `unit_type_name_key` decides. */
  insert(scope: BuildingScope, unitType: NewUnitType, now: Date): Promise<UnitTypeRecord>
  /**
   * One guarded statement on `version`: the type after the change, or `null` when the version moved. A name that is taken throws
   * `UnitTypeNameInUseError`.
   */
  apply(
    scope: BuildingScope,
    transition: UnitTypeTransition,
    now: Date,
  ): Promise<UnitTypeRecord | null>
}
