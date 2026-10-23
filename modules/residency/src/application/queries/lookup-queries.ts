import type { IdentityApi, ResidentAccountDto } from '@mod/identity/contracts'
import type { BuildingScope } from '@rms/shared-types'
import type { LookupDto, ResidentHitDto, UnitHitDto } from '../../contracts'
import { planLookup } from '../../domain/lookup-plan'
import type { ProfileRow, ResidentReader } from '../../domain/resident-reader'
import type { UnitReader } from '../../domain/unit-reader'
import { scopeOf } from '../scope-of'

const DEFAULT_LIMIT = 20
/** The phone strategy asks `identity` for this many accounts and joins its own rows (DOC-27 §11.1). */
const PHONE_CANDIDATES = 50

/** The strategies of DOC-27 §11.1 over units and residents, which the staff lists and `ResidencyApi.lookup` share. */
export class LookupQueries {
  constructor(
    private readonly units: UnitReader,
    private readonly residents: ResidentReader,
    private readonly identity: Pick<
      IdentityApi,
      'findResidentAccountsByPhoneFragment' | 'getResidentAccounts'
    >,
  ) {}

  /**
   * The people whose name or phone matches, in account order, at most `limit`: the name through the trigram index, the phone as a
   * suffix of the digits typed. A text that satisfies neither strategy finds nobody.
   */
  async findResidents(scope: BuildingScope, q: string, limit: number): Promise<ProfileRow[]> {
    const plan = planLookup(q)
    const found = new Map<string, ProfileRow>()
    if (plan.name !== null)
      for (const row of await this.residents.searchByName(scope, plan.name, limit))
        found.set(row.accountId, row)
    if (plan.phoneSuffix !== null) {
      const accounts = await this.identity.findResidentAccountsByPhoneFragment(
        plan.phoneSuffix,
        PHONE_CANDIDATES,
      )
      const profiles = await this.residents.profilesOf(
        scope,
        accounts.map((account) => account.accountId),
      )
      for (const row of profiles) found.set(row.accountId, row)
    }
    return [...found.values()]
      .sort((a, b) => a.accountId.localeCompare(b.accountId))
      .slice(0, limit)
  }

  /** `ResidencyApi.lookup`: the building's units by code prefix and its people by name or phone. */
  async lookup(buildingId: string, q: string, limit = DEFAULT_LIMIT): Promise<LookupDto> {
    const scope = scopeOf(buildingId)
    const size = Math.min(Math.max(limit, 1), DEFAULT_LIMIT)
    const plan = planLookup(q)
    const [unitRows, profiles] = await Promise.all([
      plan.unitCode === null ? [] : this.units.searchByCode(scope, plan.unitCode, size),
      this.findResidents(scope, q, size),
    ])
    const ownerIds = unitRows.flatMap((row) => (row.ownerAccountId ? [row.ownerAccountId] : []))
    const accountIds = [...new Set([...ownerIds, ...profiles.map((row) => row.accountId)])]
    const [accounts, names, memberships] = await Promise.all([
      accountIds.length === 0 ? [] : this.identity.getResidentAccounts(accountIds),
      this.residents.namesOf(scope, ownerIds),
      this.residents.membershipsOf(
        scope,
        profiles.map((row) => row.accountId),
      ),
    ])
    const account = new Map<string, ResidentAccountDto>(accounts.map((a) => [a.accountId, a]))
    const units: UnitHitDto[] = unitRows.map(({ unit, ownerAccountId }) => ({
      unitId: unit.id,
      code: unit.code,
      floor: unit.floor,
      occupancy: unit.occupancy,
      owner:
        ownerAccountId && account.has(ownerAccountId)
          ? {
              accountId: ownerAccountId,
              fullName: names.get(ownerAccountId) ?? null,
              phone: (account.get(ownerAccountId) as ResidentAccountDto).phone,
            }
          : null,
    }))
    const residents: ResidentHitDto[] = profiles.flatMap((row) => {
      const found = account.get(row.accountId)
      return found
        ? [
            {
              accountId: row.accountId,
              fullName: row.fullName,
              phone: found.phone,
              memberships: memberships
                .filter((m) => m.accountId === row.accountId)
                .map(({ unitId, unitCode, memberType, status }) => ({
                  unitId,
                  unitCode,
                  memberType,
                  status,
                })),
            },
          ]
        : []
    })
    return { units, residents }
  }
}
