import type { BuildingScope, MemberType } from '@rms/shared-types'
import type { MembershipStatus, Occupancy } from '../contracts'

/** The columns of a membership that the guard and the contract calls read. */
export interface MembershipView {
  id: string
  buildingId: string
  unitId: string
  accountId: string
  memberType: MemberType
  canPay: boolean
  status: MembershipStatus
  credentialVersion: number
  createdAt: Date
}

export interface ActiveMembershipView {
  membershipId: string
  buildingId: string
  unitId: string
  unitCode: string
  memberType: MemberType
  canPay: boolean
}

export interface UnitView {
  id: string
  code: string
  floor: number | null
  occupancy: Occupancy
}

/** The active owner's name of a unit for the fee notice, `null` when the unit has none (DR-292, DOC-34 §6.1). */
export interface UnitOwnerNameView {
  unitId: string
  ownerName: string | null
}

/**
 * Which memberships of a unit hold a capability: the types that always do, and the types that do only with `can_pay` (the tenant
 * for `pay`). Derived from the policy table, so the table stays the only place that says who may do what (DOC-27 §3.2).
 */
export interface RecipientFilter {
  always: readonly MemberType[]
  whenCanPay: readonly MemberType[]
}

export interface RecipientView {
  accountId: string
  membershipId: string
  memberType: MemberType
  canPay: boolean
}

/**
 * The reads behind `ResidencyApi` and the request guard (DOC-27 §2.1, §3.1). A call that carries no building asks by a key that
 * identifies the row by itself (an account and a unit, a membership id): the caller was authorised by the token or the event,
 * and the answer never names a building to the resident that asked.
 */
export interface MembershipReader {
  /** The guard's lookup: one statement through `membership_one_per_account_unit` (S12). `removed` is never returned. */
  findByAccountAndUnit(accountId: string, unitId: string): Promise<MembershipView | null>
  /** The membership by id whatever its status (the QR scan). */
  findById(id: string): Promise<MembershipView | null>
  /** Active ones of a unit that hold the capability, keyset on the membership id. */
  listRecipients(
    unitId: string,
    filter: RecipientFilter,
    after: string | null,
    limit: number,
  ): Promise<RecipientView[]>
  /** Distinct accounts with an active membership in the building, keyset on the account id. */
  listNoticeAccounts(buildingId: string, after: string | null, limit: number): Promise<string[]>
  /** At most `limit` rows; the caller treats more than 500 as a data defect. */
  activeUnitIds(accountId: string, limit: number): Promise<string[]>
  listActive(accountId: string, limit: number): Promise<ActiveMembershipView[]>
  ownedUnitIds(accountId: string): Promise<string[]>
  buildingIdsOfAccounts(
    accountIds: readonly string[],
  ): Promise<Array<{ accountId: string; buildingId: string }>>
  findUnits(ids: readonly string[]): Promise<UnitView[]>
  /** The units of the building by `lower(code)`, with whether a non-removed owner membership exists (DOC-27 §2.1). */
  findUnitsByCodes(
    buildingId: string,
    codesLower: readonly string[],
  ): Promise<Array<UnitView & { hasActiveOwner: boolean }>>
  /**
   * The active owner's name of each of these units of the building, one row per unit that has one, in the order given; a unit of
   * another building is not returned (DR-292, DOC-34 §6.1).
   */
  unitOwnerNames(scope: BuildingScope, unitIds: readonly string[]): Promise<UnitOwnerNameView[]>
}
