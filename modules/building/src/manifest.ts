import { fileURLToPath } from 'node:url'
import type { ModuleManifest } from '@core/runtime'
import { BUILDING_EVENTS } from './contracts/events'
import { buildingOutbox } from './infrastructure/persistence/schema'

const dir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Static data, importable without building the container (DOC-12 §4.2). `building` writes two commands to its own outbox
 * (DR-122), both of the `default` retry class, and declares the audit actions of DOC-35 §4.2, `building.demo.reset` (P1-21) included.
 */
export const buildingManifest = {
  name: 'building',
  dir,
  migrations: fileURLToPath(new URL('../migrations', import.meta.url)),
  schemaFile: fileURLToPath(new URL('./infrastructure/persistence/schema.ts', import.meta.url)),
  outbox: buildingOutbox,
  config: undefined,
  outboxPolicies: {
    [BUILDING_EVENTS.fileDeleteRequested]: 'default',
    [BUILDING_EVENTS.thumbnailRequested]: 'default',
  },
  auditActions: [
    'building.building.update',
    'building.settings.update',
    'building.gateway.update',
    'building.terms.publish',
    'building.demo.reset',
  ],
} as const satisfies ModuleManifest
