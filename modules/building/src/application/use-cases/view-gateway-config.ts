import type { StaffContext } from '@rms/shared-types'
import type { GatewayDriver } from '../../contracts'
import { GATEWAY_DRIVERS } from '../../domain/gateway-config'
import type { GatewayConfigRepository } from '../../domain/gateway-config-repository'
import { assertAdmin } from '../assert-admin'
import type { BuildingDirectory } from '../directory'
import type { GatewayConfigReader, GatewayView } from '../gateway-config-reader'

export interface ViewGatewayConfigDeps {
  gateways: GatewayConfigRepository
  directory: BuildingDirectory
  reader: GatewayConfigReader
}

/** `GET /staff/gateway`: the active configurations with masked secrets and the drivers this building may use (DOC-36 §7.1). */
export class ViewGatewayConfig {
  constructor(private readonly deps: ViewGatewayConfigDeps) {}

  async execute(staff: StaffContext) {
    assertAdmin(staff)
    const { gateways, directory, reader } = this.deps
    const isDemo = await directory.isDemo(staff.buildingId)
    const configs: GatewayView[] = []
    for (const provider of ['payos', 'vietqr'] as const) {
      const row = await gateways.findActive(staff.scope, provider)
      if (row) configs.push(await reader.view(row))
    }
    const drivers = Object.fromEntries(
      (Object.keys(GATEWAY_DRIVERS) as GatewayDriver[]).map((driver) => [
        driver,
        { fields: GATEWAY_DRIVERS[driver].fields, allowed: driver !== 'fake' || isDemo },
      ]),
    ) as Record<GatewayDriver, { fields: readonly string[]; allowed: boolean }>
    return { configs, drivers }
  }
}
