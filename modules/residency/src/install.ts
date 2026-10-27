import type { ModuleHost } from '@core/runtime'
import { createResidencyModule, type ResidencyDeps, type ResidencyModule } from './residency.module'

/** The host narrowed to what `residency` needs (DOC-12 §4.2). */
export type ResidencyHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> &
  ResidencyDeps

export function installResidency(host: ResidencyHost): ResidencyModule {
  return createResidencyModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    building: host.building,
    files: host.files,
    identity: host.identity,
    guards: host.guards,
    idempotent: host.idempotent,
    metrics: host.metrics,
    pii: host.pii,
    audited: host.audited,
    outboxMaxPayloadBytes: host.outboxMaxPayloadBytes,
  })
}
