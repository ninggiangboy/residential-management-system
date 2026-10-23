import type { Capability, MemberType } from '@rms/shared-types'

export type MembershipStatus = 'active' | 'locked' | 'removed'
export type Occupancy = 'occupied' | 'rented' | 'vacant'

/** Keyset paging as the contracts of DOC-09 §7.1 do it: `after` is the last key of the previous page. */
export interface PageRequest {
  after?: string
  limit?: number
}
export interface Page<T> {
  items: T[]
  next: string | null
}

/** What the request guard reads on every request (DOC-27 §3.1). A `removed` row is never returned; a `locked` one is. */
export interface MembershipDto {
  membershipId: string
  buildingId: string
  unitId: string
  accountId: string
  memberType: MemberType
  canPay: boolean
  status: 'active' | 'locked'
  /** `membership.created_at`: the history filter of DR-40. */
  startedAt: string
}

/** The sign-in answer and `GET /me` (DOC-27 §2.1). */
export interface ActiveMembershipDto {
  membershipId: string
  buildingId: string
  unitId: string
  unitCode: string
  memberType: MemberType
  canPay: boolean
}

export interface RecipientDto {
  accountId: string
  membershipId: string
  memberType: MemberType
  canPay: boolean
}

export interface NoticeRecipientDto {
  accountId: string
}

export interface UnitDto {
  unitId: string
  code: string
  floor: number | null
  occupancy: Occupancy
}

export interface ScanMembershipDto {
  membershipId: string
  buildingId: string
  unitId: string
  accountId: string
  memberType: MemberType
  status: MembershipStatus
  credentialVersion: number
}

/**
 * What the other modules call (DOC-27 §2.1, DOC-09 §7.2): plain DTOs, no `Date`, a call joins the caller's transaction. `lookup`
 * (the union search of DOC-27 §11) joins with P1-14, which adds the phone and name calls it needs to `IdentityApi`.
 */
export interface ResidencyApi {
  /** The row of `(accountId, unitId)` that is not `removed`, `locked` included, so the guard can answer `membership_inactive`. */
  getMembership(accountId: string, unitId: string): Promise<MembershipDto | null>
  /** Active memberships of the unit whose type holds `capability`, keyset on the membership id. */
  listRecipients(
    unitId: string,
    capability: Capability,
    page?: PageRequest,
  ): Promise<Page<RecipientDto>>
  /** Distinct accounts with an active membership in the building, keyset on `account_id`, `limit` up to 500. */
  listNoticeRecipients(
    buildingId: string,
    cursor: string | null,
    limit: number,
  ): Promise<Page<NoticeRecipientDto>>
  /** Units where the account has an `active` membership; more than 500 is a data defect and the call throws. */
  activeUnitIds(accountId: string): Promise<string[]>
  /** Up to 500 ids. */
  getUnits(ids: string[]): Promise<UnitDto[]>
  /** The membership by id with its `credentialVersion`, whatever its status. */
  getMembershipForScan(membershipId: string): Promise<ScanMembershipDto | null>
  /** The units whose active owner is the account (DOC-35 §10.1). */
  ownedUnitIds(accountId: string): Promise<string[]>
  /** Active memberships with the unit code, ordered by code; a `locked` one is not returned; more than 500 throws. */
  listActiveMemberships(accountId: string): Promise<ActiveMembershipDto[]>
  /** The distinct buildings of the non-removed memberships of up to 500 accounts; an account with none is absent. */
  buildingIdsOfAccounts(
    accountIds: string[],
  ): Promise<Array<{ accountId: string; buildingId: string }>>
}
