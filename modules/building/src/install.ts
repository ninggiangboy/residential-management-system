import type { ModuleHost } from '@core/runtime'
import { type BuildingDeps, type BuildingModule, createBuildingModule } from './building.module'

/** The host narrowed to what `building` needs (DOC-12 §4.2). */
export type BuildingHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> & BuildingDeps

export function installBuilding(host: BuildingHost): BuildingModule {
  return createBuildingModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    storage: host.storage,
    secretBox: host.secretBox,
    stepUp: host.stepUp,
    probe: host.probe,
    audited: host.audited,
    guards: host.guards,
    staffNames: host.staffNames,
    residentBuildings: host.residentBuildings,
    files: host.files,
    settingsCacheSeconds: host.settingsCacheSeconds,
    uploadRatePerHour: host.uploadRatePerHour,
    outboxMaxPayloadBytes: host.outboxMaxPayloadBytes,
    features: host.features,
    thumbnailer: host.thumbnailer,
    usage: host.usage,
  })
}
