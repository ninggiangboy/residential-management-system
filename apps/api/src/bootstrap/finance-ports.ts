import { NotFoundError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { FinanceModuleDeps } from '@mod/finance'
import type { IdentityApi } from '@mod/identity/contracts'
import type { ResidencyApi } from '@mod/residency/contracts'

/**
 * The ports `finance` reads other modules through (DOC-21 §2.1, DOC-22 §7, DOC-23 §2.2), adapted here from their contracts so the
 * module states its needs without importing them (DOC-12 §4.2).
 */
export function financePorts(apis: {
  building: Pick<BuildingApi, 'getBuilding' | 'listBuildings' | 'getSettings'>
  identity: Pick<IdentityApi, 'getResidentAccounts'>
  residency: Pick<ResidencyApi, 'getMembership'>
}): Pick<
  FinanceModuleDeps,
  'calendar' | 'receiptBuildings' | 'payers' | 'ledgerCheckBuildings' | 'noticeLanguage'
> {
  const buildingOf = async (buildingId: string) => {
    const building = await apis.building.getBuilding(buildingId)
    if (!building) throw new NotFoundError()
    return building
  }
  return {
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
  }
}
