import type { BuildingScope } from '@rms/shared-types'

export interface SettingsRecord {
  data: Record<string, unknown>
  version: number
}

export interface SettingsRepository {
  find(scope: BuildingScope): Promise<SettingsRecord | null>
  /** `data = (data || :set) - :remove`, guarded by the version the client read; `null` when it moved on. */
  mergeGuarded(
    scope: BuildingScope,
    expectedVersion: number,
    set: Record<string, unknown>,
    remove: string[],
  ): Promise<SettingsRecord | null>
}
