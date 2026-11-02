import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { FINANCE_EVENTS } from './contracts/events'
import { financeOutbox } from './infrastructure/persistence/schema'

/**
 * Static data, importable without building the container (DOC-12 §4.2). The outbox exists from the first migration because
 * every money mutation writes its events in its own transaction (DOC-22 §2.3, DOC-21 §2.2); the use cases of P2-03…P2-08
 * declare their audit actions here (DOC-21 §2.3, DOC-22 §2.4) as they are written.
 */
export const financeManifest = {
  name: 'finance',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: financeOutbox,
  outboxPolicies: {
    [FINANCE_EVENTS.receiptIssued]: 'default',
    [FINANCE_EVENTS.receiptRenderRequested]: 'default',
  },
  config: undefined,
  auditActions: [],
} as const satisfies ModuleManifest
