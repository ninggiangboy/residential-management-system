import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { NOTIFICATION_EVENTS } from './contracts/events'
import { notificationOutbox } from './infrastructure/persistence/schema'

/**
 * Static data, importable without building the container (DOC-12 §4.2). The outbox exists from the first migration because
 * the inbox handlers write their events in the transaction that inserts the entries (DOC-09 §4.3, DOC-31 §4.1 step 7); the
 * config slice and the audit actions arrive with the handlers of a later part.
 */
export const notificationManifest = {
  name: 'notification',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: notificationOutbox,
  outboxPolicies: {
    [NOTIFICATION_EVENTS.pushRequested]: 'push',
    [NOTIFICATION_EVENTS.staffInboxCreated]: 'default',
  },
  config: undefined,
  auditActions: [],
} as const satisfies ModuleManifest
