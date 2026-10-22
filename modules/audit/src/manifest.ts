import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `audit` publishes no events, so it has no outbox
 * and no inbox. It declares no action of its own: reading the log is not audited (DOC-35 §5), and `pii.read` is the one action every module may write (§3.3).
 */
export const auditManifest = {
  name: 'audit',
  dir,
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: null,
  config: undefined,
  auditActions: [],
} as const satisfies ModuleManifest
