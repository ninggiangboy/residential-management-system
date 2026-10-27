import type {
  BuildingApi,
  BuildingDto,
  GatewayConfigDto,
  GatewayProvider,
  MissingTerm,
} from '../../contracts'
import type { BuildingDirectory } from '../directory'
import type { BuildingQueries } from '../queries/building-queries'

/** `BuildingApi` (DOC-36 §3.1): what the other modules know of a building; reads only, no rule of its own. */
export class BuildingApiImpl implements BuildingApi {
  constructor(
    private readonly directory: BuildingDirectory,
    private readonly queries: BuildingQueries,
  ) {}

  getSettings(buildingId: string) {
    return this.directory.getSettings(buildingId)
  }

  getBuilding(buildingId: string): Promise<BuildingDto | null> {
    return this.directory.getBuilding(buildingId)
  }

  listBuildings(): Promise<BuildingDto[]> {
    return this.directory.listBuildings()
  }

  isDemo(buildingId: string): Promise<boolean> {
    return this.directory.isDemo(buildingId)
  }

  assertDemo(buildingId: string): Promise<void> {
    return this.directory.assertDemo(buildingId)
  }

  fakeGatewaysOutsideDemo(): Promise<string[]> {
    return this.queries.fakeGatewaysOutsideDemo()
  }

  gatewayKeyIds(): Promise<string[]> {
    return this.queries.gatewayKeyIds()
  }

  getGatewayConfig(
    buildingId: string,
    provider: GatewayProvider,
    opts?: { lock?: 'share' },
  ): Promise<GatewayConfigDto | null> {
    return this.queries.gatewayConfig(buildingId, provider, opts)
  }

  async hasAcceptedLatestTerms(accountId: string, buildingId: string): Promise<boolean> {
    return (await this.missingTerms(accountId, buildingId)).length === 0
  }

  missingTerms(accountId: string, buildingId: string): Promise<MissingTerm[]> {
    return this.queries.missingTerms(accountId, buildingId)
  }
}
