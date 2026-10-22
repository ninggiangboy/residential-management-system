import type {
  BuildingApi,
  BuildingDto,
  GatewayConfigDto,
  GatewayProvider,
  MissingTerm,
} from '../../contracts'
import type { BuildingDirectory } from '../directory'
import type { BuildingQueries } from '../queries/building-queries'

export interface BuildingApiDeps {
  directory: BuildingDirectory
  queries: BuildingQueries
}

/** `BuildingApi` (DOC-36 §3.1): what the other modules know of a building; reads only, no rule of its own. */
export class BuildingApiImpl implements BuildingApi {
  constructor(private readonly deps: BuildingApiDeps) {}

  getSettings(buildingId: string) {
    return this.deps.directory.getSettings(buildingId)
  }

  getBuilding(buildingId: string): Promise<BuildingDto | null> {
    return this.deps.directory.getBuilding(buildingId)
  }

  listBuildings(): Promise<BuildingDto[]> {
    return this.deps.directory.listBuildings()
  }

  isDemo(buildingId: string): Promise<boolean> {
    return this.deps.directory.isDemo(buildingId)
  }

  getGatewayConfig(
    buildingId: string,
    provider: GatewayProvider,
    opts?: { lock?: 'share' },
  ): Promise<GatewayConfigDto | null> {
    return this.deps.queries.gatewayConfig(buildingId, provider, opts)
  }

  async hasAcceptedLatestTerms(accountId: string, buildingId: string): Promise<boolean> {
    return (await this.missingTerms(accountId, buildingId)).length === 0
  }

  missingTerms(accountId: string, buildingId: string): Promise<MissingTerm[]> {
    return this.deps.queries.missingTerms(accountId, buildingId)
  }
}
