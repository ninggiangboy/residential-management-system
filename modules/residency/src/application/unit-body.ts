import type { UnitRecord } from '../domain/unit'

/** `UnitDto` of DOC-51 §10: what E-58, E-60 and the `current` of a `version_conflict` answer. */
export const unitBody = (unit: UnitRecord) => ({
  unitId: unit.id,
  code: unit.code,
  floor: unit.floor,
  bedrooms: unit.bedrooms,
  areaM2: unit.areaM2,
  occupancy: unit.occupancy,
  note: unit.note,
  version: unit.version,
})

export type UnitBody = ReturnType<typeof unitBody>
