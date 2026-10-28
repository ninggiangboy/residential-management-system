import type { ModuleHost } from '@core/runtime'
import { type AnalyticsDeps, createAnalyticsModule } from './analytics.module'

/** The host narrowed to what `analytics` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type AnalyticsHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> &
  AnalyticsDeps

export function installAnalytics(host: AnalyticsHost) {
  return createAnalyticsModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    building: host.building,
    guards: host.guards,
    config: host.config,
    metrics: host.metrics,
  })
}
