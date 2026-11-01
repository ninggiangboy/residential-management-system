import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { RESIDENCY_EVENTS } from './contracts/events'
import { residencyOutbox } from './infrastructure/persistence/schema'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `residency` writes two facts to its own outbox, both of
 * the `default` retry class (DOC-09 §6.2), and declares the audit actions of DOC-27 §2.4 that its use cases write so far; the
 * import commit joins with P1-13; the unit, transfer and phone-change actions with P1-14.
 */
export const residencyManifest = {
  name: 'residency',
  dir,
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: residencyOutbox,
  config: undefined,
  outboxPolicies: {
    [RESIDENCY_EVENTS.membershipChanged]: 'default',
    [RESIDENCY_EVENTS.ownerChanged]: 'default',
  },
  auditActions: [
    'residency.unit.create',
    'residency.unit.update',
    'residency.unit_type.create',
    'residency.unit_type.update',
    'residency.profile.update',
    'residency.membership.add',
    'residency.membership.update',
    'residency.membership.lock',
    'residency.membership.unlock',
    'residency.membership.remove',
    'residency.owner.transfer',
    'residency.login_phone.change',
    'residency.import.commit',
  ],
} as const satisfies ModuleManifest
