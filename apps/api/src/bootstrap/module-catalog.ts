import type { ModuleManifest } from '@core/runtime'

/**
 * The modules this app installs, as static data: it builds nothing, so `db:migrate`, `outbox:list`, drizzle-kit and the
 * configuration loader read it without pulling in the container (DOC-12 §5.2). Each module package exports its manifest
 * from `@mod/<name>/manifest`; the order is dependency order, and it is the order migrations run in (DOC-07 §5.2).
 * One line per module: a module's task adds its manifest here, its `install…` call to `container.ts` and its `.use()` to `app.ts`.
 */
export const MODULE_CATALOG: readonly ModuleManifest[] = [
  // building, audit, identity, residency … land in P1-07 to P1-12
]

export const MODULE_NAMES: readonly string[] = MODULE_CATALOG.map((manifest) => manifest.name)
