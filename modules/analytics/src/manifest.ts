import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `analytics` publishes no events, so it has no outbox and
 * no inbox, and it writes no audit row: a batch is not an act of a person (DOC-104 §6.3).
 */
export const analyticsManifest = {
  name: 'analytics',
  dir,
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: null,
  config: undefined,
  auditActions: [],
} as const satisfies ModuleManifest
