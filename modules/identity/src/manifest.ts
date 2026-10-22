import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { IDENTITY_EVENTS } from './contracts/events'
import { identityOutbox } from './infrastructure/persistence/schema'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `identity` writes two types to its own outbox, both of
 * the `default` retry class (DOC-09 §4.2); the SMS command and its `sms` class join with P1-11. The audit action of the invite resend is
 * declared; the rest of `identity.staff.*` joins with the staff accounts (P1-14).
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
    [IDENTITY_EVENTS.sessionRevoked]: 'default',
  },
  auditActions: ['identity.staff.update'],
} as const satisfies ModuleManifest
