import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'

/**
 * Static data, importable without building the container (DOC-12 §4.2). `realtime` publishes no events of its own, so it has no
 * outbox and no inbox (its handlers use the natural key `source_message_id`, DOC-52 §9.1), and it writes no audit row: an event
 * on the stream is not an act of a person.
 */
export const realtimeManifest = {
  name: 'realtime',
  dir: fileURLToPath(new URL('..', import.meta.url)),
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: null,
  config: undefined,
  auditActions: [],
} as const satisfies ModuleManifest
