import type { GatewayConfigDto, GatewayProvider } from '../../contracts'
import type { GatewayConfigReader } from '../gateway-config-reader'

/** `BuildingApi.getGatewayConfig` (DOC-36 §3.1): the active row of `(building, provider)`, decrypted, from a short cache unless it takes the lock. */
export class GetGatewayConfig {
  constructor(private readonly reader: GatewayConfigReader) {}

  execute(
    buildingId: string,
    provider: GatewayProvider,
    opts: { lock?: 'share' } = {},
  ): Promise<GatewayConfigDto | null> {
    return this.reader.config(buildingId, provider, opts)
  }
}
