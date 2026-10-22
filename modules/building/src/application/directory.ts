import type { Clock, Log } from '@core/kernel'
import type { BuildingId } from '@rms/shared-types'
import type { BuildingDto, BuildingSettings } from '../contracts'
import { resolveSettings } from '../domain/settings'
import type { BuildingRecord, BuildingRepository, SettingsRepository } from './ports'
import { TtlCache } from './ttl-cache'

const toBuildingDto = (record: BuildingRecord): BuildingDto => ({
  buildingId: record.id,
  code: record.code,
  name: record.name,
  timeZone: record.timeZone,
  isDemo: record.isDemo,
})

/**
 * `getSettings`, `getBuilding`, `listBuildings` and `isDemo` of `BuildingApi` (DOC-36 §3.1): one primary-key read each,
 * cached in the process for `SETTINGS_CACHE_SECONDS`. The process that saves a change clears its own entry at once.
 */
export class BuildingDirectory {
  private readonly settingsCache: TtlCache<BuildingSettings>
  private readonly buildingCache: TtlCache<BuildingRecord | null>
  private readonly listCache: TtlCache<BuildingRecord[]>

  constructor(
    private readonly buildings: BuildingRepository,
    private readonly settings: SettingsRepository,
    clock: Clock,
    private readonly logger: Log,
    cacheSeconds: number,
  ) {
    const ttl = cacheSeconds * 1000
    this.settingsCache = new TtlCache(clock, ttl)
    this.buildingCache = new TtlCache(clock, ttl)
    this.listCache = new TtlCache(clock, ttl)
  }

  getSettings(buildingId: string): Promise<BuildingSettings> {
    return this.settingsCache.get(buildingId, async () => {
      const row = await this.settings.find({ buildingId: buildingId as BuildingId })
      // A stored value outside its rule falls back to the default; a hand-edited row cannot break a request (DOC-36 §5.1).
      return resolveSettings(row?.data ?? {}, (path, reason) =>
        this.logger.error({ buildingId, path, reason }, 'setting_invalid_stored'),
      )
    })
  }

  async getBuilding(buildingId: string): Promise<BuildingDto | null> {
    const record = await this.record(buildingId)
    return record ? toBuildingDto(record) : null
  }

  async listBuildings(): Promise<BuildingDto[]> {
    return (await this.listCache.get('all', () => this.buildings.list())).map(toBuildingDto)
  }

  async isDemo(buildingId: string): Promise<boolean> {
    return (await this.record(buildingId))?.isDemo ?? false
  }

  record(buildingId: string): Promise<BuildingRecord | null> {
    return this.buildingCache.get(buildingId, () => this.buildings.find(buildingId))
  }

  invalidate(buildingId: string): void {
    this.settingsCache.invalidate(buildingId)
    this.buildingCache.invalidate(buildingId)
    this.listCache.clear()
  }
}
