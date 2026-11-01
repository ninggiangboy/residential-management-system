import type { UnitTypeRecord } from '../domain/unit-type'

/** `UnitTypeDto` of DOC-51 §10 without the count: what E-181 and E-182 answer, and the `current` of a `version_conflict`. */
export const unitTypeBody = (unitType: UnitTypeRecord, unitCount = 0) => ({
  unitTypeId: unitType.id,
  code: unitType.code,
  name: unitType.name,
  defaultBedrooms: unitType.defaultBedrooms,
  defaultAreaM2: unitType.defaultAreaM2,
  status: unitType.status,
  unitCount,
  version: unitType.version,
})

export type UnitTypeBody = ReturnType<typeof unitTypeBody>
