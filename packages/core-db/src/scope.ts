import { eq } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * The predicate every query on a scoped table carries (DOC-12 §7.2, DR-12): the typed form of `building_id = :scope`. The scope
 * is built at the edge of a use case, never inside a repository; it is structural here because a core package may not import
 * `@rms/shared-types`, whose `BuildingScope` satisfies it. `bun run check:scope` fails a query on a scoped table that lacks it.
 */
export const inBuilding = <T extends { buildingId: PgColumn }>(
  table: T,
  scope: { readonly buildingId: string },
) => eq(table.buildingId, scope.buildingId)
