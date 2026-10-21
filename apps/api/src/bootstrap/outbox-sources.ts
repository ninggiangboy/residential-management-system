import type { ModuleManifest } from '@core/runtime'

/** The outboxes of the modules in a catalog, in catalog order: what the relay reads and what `outbox:list` reads (JB-24). */
export const outboxSourcesOf = (manifests: readonly ModuleManifest[]) =>
  manifests.flatMap((manifest) =>
    manifest.outbox ? [{ name: manifest.name, table: manifest.outbox }] : [],
  )
