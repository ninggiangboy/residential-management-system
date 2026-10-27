import type { BuildingId, BuildingScope } from '@rms/shared-types'

/** A scope from a building id that a contract or an event carried: the id was authorised by whoever sent it. */
export const scopeOf = (buildingId: string): BuildingScope => ({
  buildingId: buildingId as BuildingId,
})
