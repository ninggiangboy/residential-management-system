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
    [FINANCE_EVENTS.batchPublished]: 'default',
    [FINANCE_EVENTS.batchDueExtended]: 'default',
    [FINANCE_EVENTS.batchRecalled]: 'default',
    [FINANCE_EVENTS.chargeVoided]: 'default',
    [FINANCE_EVENTS.paymentPosted]: 'default',
    [FINANCE_EVENTS.moneyUnposted]: 'default',
    // DOC-09 §4: its own retry class, 8 attempts (DR-31).
    [FINANCE_EVENTS.intentCancelRequested]: 'intent_cancel',
  },
  config: undefined,
  // DOC-21 §2.3, DOC-22 §2.4, DOC-23 §2.4, DOC-35 §4.1; the payment void and money-log review join with P2-09.
  auditActions: [
    'finance.batch.create',
    'finance.batch.import_commit',
    'finance.batch.update',
    'finance.batch.discard',
    'finance.batch.publish',
    'finance.batch.extend_due',
    'finance.batch.close',
    'finance.batch.reissue',
    'finance.batch.recall',
    'finance.charge.update',
    'finance.charge.void',
    'finance.payment.post',
  ],
} as const satisfies ModuleManifest
