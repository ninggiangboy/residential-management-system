import type { ModuleManifest } from '@core/runtime'
import { analyticsManifest } from '@mod/analytics/manifest'
import { auditManifest } from '@mod/audit/manifest'
import { buildingManifest } from '@mod/building/manifest'
import { identityManifest } from '@mod/identity/manifest'
import { residencyManifest } from '@mod/residency/manifest'

/**
 * The modules this app installs, as static data: it builds nothing, so `db:migrate`, `outbox:list`, drizzle-kit and the
 * configuration loader read it without pulling in the container (DOC-12 §5.2). Each module package exports its manifest
 * from `@mod/<name>/manifest`; the order is dependency order, and it is the order migrations run in (DOC-07 §5.2).
 * One line per module: a module's task adds its manifest here, its `install…` call to `container.ts` and its `.use()` to `app.ts`.
 */
export const MODULE_CATALOG: readonly ModuleManifest[] = [
  // audit is installed before the modules that write to it, building after it, identity after building because it reads the
  // lockout settings (the step-up stays a port that building declares, DOC-12 §4.4), and residency after identity because it asks
  // for accounts (identity asks residency for memberships through a port it declares).
  auditManifest,
  buildingManifest,
  identityManifest,
  residencyManifest,
  // analytics is a leaf that asks building whether a building is a demo one (DR-279), so it comes after it.
  analyticsManifest,
]

export const MODULE_NAMES: readonly string[] = MODULE_CATALOG.map((manifest) => manifest.name)
