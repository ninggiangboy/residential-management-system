import type { ModuleHost } from '@core/runtime'
import { createRealtimeModule, type RealtimeDeps } from './realtime.module'

/** The host narrowed to what `realtime` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type RealtimeHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> & RealtimeDeps

export function installRealtime(host: RealtimeHost) {
  return createRealtimeModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    mappings: host.mappings,
    config: host.config,
    metrics: host.metrics,
  })
}
