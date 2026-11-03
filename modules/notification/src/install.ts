import type { ModuleHost } from '@core/runtime'
import { createNotificationModule, type NotificationDeps } from './notification.module'

/** The host narrowed to what `notification` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type NotificationHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> &
  NotificationDeps

export function installNotification(host: NotificationHost) {
  return createNotificationModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    integrations: host.integrations,
    residency: host.residency,
    identity: host.identity,
    guards: host.guards,
    config: host.config,
    metrics: host.metrics,
    sender: host.sender,
    fetch: host.fetch,
  })
}
