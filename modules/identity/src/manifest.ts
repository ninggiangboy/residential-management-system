import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { IDENTITY_EVENTS } from './contracts/events'
import { identityOutbox } from './infrastructure/persistence/schema'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `identity` writes three types to its own outbox: the mail
 * command and the revocation fact of the `default` retry class, and the SMS command of the `sms` class, which a late send makes
 * useless (DOC-09 §4.2). The audit actions of the staff accounts (DOC-35 §4) are declared here; the invite resend writes
 * `identity.staff.update` too.
 */
export const identityManifest = {
  name: 'identity',
  dir,
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: identityOutbox,
  config: undefined,
  outboxPolicies: {
    [IDENTITY_EVENTS.mailRequested]: 'default',
    [IDENTITY_EVENTS.smsRequested]: 'sms',
    [IDENTITY_EVENTS.sessionRevoked]: 'default',
  },
  auditActions: [
    'identity.staff.create',
    'identity.staff.update',
    'identity.staff.lock',
    'identity.staff.force_lock',
    'identity.staff.unlock',
    'identity.staff.disable',
    'identity.staff.enable',
  ],
} as const satisfies ModuleManifest
