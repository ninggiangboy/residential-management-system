import type { ResidencyApi } from '@mod/residency/contracts'

/**
 * The `apps/api` adapter of `finance`'s `DebtUnitDirectory` port (DOC-66 §5): a unit's code and floor come from
 * `ResidencyApi.getUnits` and the active owner's name from `ResidencyApi.unitOwnerNames`. `getUnits` is not building-scoped, so
 * `findUnitsByCodes` keeps only the units of the building (a code is unique per building, so a foreign unit of the same code is
 * dropped). `areaM2` and `ownerPhone` stay `null`: `ResidencyApi` exposes neither (the port carries the fields for the day it
 * does). Only `apps/api` imports this file, through `@mod/finance/integrations/residency`.
 */
export function debtUnitDirectory(
  residency: Pick<ResidencyApi, 'getUnits' | 'findUnitsByCodes' | 'unitOwnerNames'>,
) {
  return {
    async units(buildingId: string, unitIds: readonly string[]) {
      if (unitIds.length === 0) return []
      const units = await residency.getUnits([...new Set(unitIds)])
      if (units.length === 0) return []
      const [found, names] = await Promise.all([
        residency.findUnitsByCodes(
          buildingId,
          units.map((unit) => unit.code),
        ),
        residency.unitOwnerNames(buildingId, [...new Set(unitIds)]),
      ])
      const inBuilding = new Set(found.map((unit) => unit.unitId))
      const ownerName = new Map(names.map((row) => [row.unitId, row.ownerName] as const))
      return units
        .filter((unit) => inBuilding.has(unit.unitId))
        .map((unit) => ({
          unitId: unit.unitId,
          code: unit.code,
          floor: unit.floor,
          areaM2: null as string | null,
          ownerName: ownerName.get(unit.unitId) ?? null,
          ownerPhone: null as string | null,
        }))
    },
  }
}
