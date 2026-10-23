import type { Clock, SecretBox } from '@core/kernel'
import type { BuildingId } from '@rms/shared-types'
import type {
  GatewayConfigDto,
  GatewayDriver,
  GatewayProvider,
  ReceivingAccount,
} from '../contracts'
import { maskSecret } from '../domain/gateway-config'
import type {
  GatewayConfigRecord,
  GatewayConfigRepository,
} from '../domain/gateway-config-repository'
import { TtlCache } from './ttl-cache'

/** A configuration as the Admin sees it: the secrets masked (DOC-36 §7.1). */
export interface GatewayView {
  id: string
  provider: GatewayProvider
  driver: GatewayDriver
  status: 'active' | 'disabled'
  receivingAccount: ReceivingAccount
  secrets: Record<string, string>
  lastCheckAt: string | null
  lastCheckOk: boolean | null
  version: number
}

/** The place-bound AAD of the encrypted blob: a blob copied to another row does not open (DOC-36 §6). */
export const gatewayAad = (id: string) => `gateway_config|${id}`

/**
 * Reads, decrypts and masks the gateway configuration, for `finance` and the webhook route (through `BuildingQueries`) and for
 * the Admin's view and save. A secret is encrypted with the newest key and a place-bound AAD, shown masked, and never in a log
 * or an audit row.
 */
export class GatewayConfigReader {
  private readonly cache: TtlCache<GatewayConfigDto | null>

  constructor(
    private readonly gateways: GatewayConfigRepository,
    private readonly secretBox: SecretBox,
    clock: Clock,
    cacheSeconds: number,
  ) {
    this.cache = new TtlCache(clock, cacheSeconds * 1000)
  }

  async config(
    buildingId: string,
    provider: GatewayProvider,
    opts: { lock?: 'share' } = {},
  ): Promise<GatewayConfigDto | null> {
    const scope = { buildingId: buildingId as BuildingId }
    const load = async () => {
      const row = await this.gateways.findActive(scope, provider, opts.lock)
      return row ? this.decrypt(row) : null
    }
    // `lock: 'share'` skips the cache and holds the row lock inside the caller's transaction: either the intent holds the lock
    // first and the change of the receiving account waits for it, or the change commits first and the intent reads the new row.
    return opts.lock === 'share' ? load() : this.cache.get(`${buildingId}:${provider}`, load)
  }

  invalidate(buildingId: string, provider: GatewayProvider): void {
    this.cache.invalidate(`${buildingId}:${provider}`)
  }

  async decrypt(row: GatewayConfigRecord): Promise<GatewayConfigDto> {
    const secrets = JSON.parse(
      await this.secretBox.open(gatewayAad(row.id), row.secretsEnc),
    ) as Record<string, string>
    return {
      id: row.id,
      provider: row.provider,
      driver: row.driver,
      status: row.status,
      receivingAccount: row.receivingAccount,
      secrets,
    }
  }

  async view(row: GatewayConfigRecord): Promise<GatewayView> {
    const decrypted = await this.decrypt(row)
    return {
      id: row.id,
      provider: row.provider,
      driver: row.driver,
      status: row.status,
      receivingAccount: row.receivingAccount,
      secrets: Object.fromEntries(
        Object.entries(decrypted.secrets).map(([key, value]) => [key, maskSecret(value)]),
      ),
      lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
      lastCheckOk: row.lastCheckOk,
      version: row.version,
    }
  }
}
