import type {
  BuildingScope,
  DemoBuildingSeed,
  DemoCounts,
  DemoGatewaySeed,
  DemoTermsSeed,
} from '@rms/shared-types'

/**
 * The rows of the demo building that `building` owns (DOC-36 §9.1, §10.2). Every method but `ensureBuilding` is confined by the
 * scope; the caller has asserted `building.is_demo` before it calls any of them.
 */
export interface DemoRepository {
  /**
   * Creates the building row of the seed when no row has its id. `false` when it existed. A row with that id that is not a demo
   * building throws (`DemoResetRefusedError`): the seed never turns a real building into a demo one.
   */
  ensureBuilding(seed: DemoBuildingSeed): Promise<boolean>
  /** Puts the editable fields back to the seed, clears the logo and counts one more version. */
  restoreBuilding(scope: BuildingScope, seed: DemoBuildingSeed): Promise<void>
  /** Terms acceptances, gateway configuration and settings of the building. Terms versions stay: they are write-once. */
  deleteRows(scope: BuildingScope): Promise<DemoCounts>
  insertSettings(scope: BuildingScope): Promise<void>
  insertGateway(scope: BuildingScope, seed: DemoGatewaySeed, secretsEnc: string): Promise<void>
  /** Inserts a version 1 published by `publishedBy` unless the kind has one already. `true` when it inserted. */
  insertTermsOnce(scope: BuildingScope, seed: DemoTermsSeed, publishedBy: string): Promise<boolean>
}
