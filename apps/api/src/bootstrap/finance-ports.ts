import { NotFoundError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { FinanceModuleDeps } from '@mod/finance'
import { staffDirectory } from '@mod/finance/integrations/identity'
import { debtUnitDirectory } from '@mod/finance/integrations/residency'
import type { IdentityApi } from '@mod/identity/contracts'
import type { ResidencyApi } from '@mod/residency/contracts'

/**
 * The ports `finance` reads other modules through (DOC-21 §2.1, DOC-22 §7, DOC-23 §2.2), adapted here from their contracts so the
 * module states its needs without importing them (DOC-12 §4.2).
 */
export function financePorts(apis: {
  building: Pick<BuildingApi, 'getBuilding' | 'listBuildings' | 'getSettings' | 'getGatewayConfig'>
  identity: Pick<IdentityApi, 'getResidentAccounts' | 'getStaff'>
  residency: Pick<
    ResidencyApi,
    'getMembership' | 'unitOwnerNames' | 'getUnits' | 'findUnitsByCodes'
  >
}): Pick<
  FinanceModuleDeps,
  | 'calendar'
  | 'receiptBuildings'
  | 'payers'
  | 'ledgerCheckBuildings'
  | 'noticeLanguage'
  | 'noticeContext'
  | 'debtUnits'
  | 'staffDirectory'
> {
  const buildingOf = async (buildingId: string) => {
    const building = await apis.building.getBuilding(buildingId)
    if (!building) throw new NotFoundError()
    return building
  }
  /** A gateway is active when any provider's configuration is `active` (DOC-34 §6.1): the QR line prints. */
  const gatewayActive = async (buildingId: string): Promise<boolean> => {
    for (const provider of ['payos', 'vietqr'] as const) {
      const config = await apis.building.getGatewayConfig(buildingId, provider)
      if (config?.status === 'active') return true
    }
    return false
  }
  /** `unitOwnerNames` of DOC-34 §6.1 in parts of 500 (DR-292), flattened to the map the notice reads. */
  const ownerNames = async (buildingId: string, unitIds: string[]) => {
    const names = new Map<string, string | null>()
    for (let index = 0; index < unitIds.length; index += 500) {
      const rows = await apis.residency.unitOwnerNames(
        buildingId,
        unitIds.slice(index, index + 500),
      )
      for (const row of rows) names.set(row.unitId, row.ownerName)
    }
    return names
  }
  return {
    // DOC-66 §5: the unit code, floor and owner of the debt screens.
    debtUnits: debtUnitDirectory(apis.residency),
    // DOC-66 §5, DOC-07 §11A: the creator's name of the batch screens, from `IdentityApi.getStaff`.
    staffDirectory: staffDirectory(apis.identity),
    // DOC-22 §12, DOC-40 §4 rule 4: the nightly ledger check covers the real buildings only.
    ledgerCheckBuildings: {
      liveBuildingIds: async () =>
        (await apis.building.listBuildings()).filter((b) => !b.isDemo).map((b) => b.buildingId),
    },
    calendar: { timeZone: async (buildingId) => (await buildingOf(buildingId)).timeZone },
    receiptBuildings: {
      // DOC-22 §7 reads the company block from the building settings, which hold none yet: the building's own name and
      // hotline stand in until the company profile of DOC-36 exists (open with P2-13).
      forBuilding: async (buildingId) => {
        const building = await buildingOf(buildingId)
        return {
          timeZone: building.timeZone,
          company: {
            name: building.name,
            address: '',
            hotline: building.contact.hotline ?? '',
            logoKey: null,
          },
          building: { name: building.name },
        }
      },
    },
    payers: {
      payer: async (accountId, unitId) => {
        const [account] = await apis.identity.getResidentAccounts([accountId])
        const membership = await apis.residency.getMembership(accountId, unitId)
        return { name: account?.displayName ?? null, memberType: membership?.memberType ?? null }
      },
    },
    // DOC-34 §7.3, DOC-36 §5.2: a receipt prints in the building's fee-notice language as it is at its first render.
    noticeLanguage: {
      language: async (buildingId) =>
        (await apis.building.getSettings(buildingId)).feeNoticeLanguage,
    },
    // DOC-34 §6.1, DR-292: the header block of a fee notice and the active owner's name of each unit.
    noticeContext: {
      building: async (buildingId) => {
        const building = await buildingOf(buildingId)
        return {
          name: building.name,
          // The company profile, the building address and the logo of DOC-36 §4.2 are not exposed by `BuildingApi`
          // yet (open with P2-13): as in `receiptBuildings`, the building name stands in and the notice prints no logo.
          company: { name: building.name, address: null },
          address: '',
          hotline: building.contact.hotline,
          email: building.contact.email,
          workingHours: building.contact.workingHours,
          logoFile: null,
          gatewayActive: await gatewayActive(buildingId),
        }
      },
      ownerNames,
    },
  }
}
