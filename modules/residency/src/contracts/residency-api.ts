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

/** A unit found by its code for the fee import (DOC-27 §2.1, DOC-21 §2.1, DR-265). */
export interface FoundUnitDto {
  unitId: string
  /** The code as the unit stores it, whatever the case of the code asked for. */
  code: string
  occupancy: Occupancy
  /** A non-removed owner membership exists: a charge needs someone to notify (DQ-78). */
  hasActiveOwner: boolean
}

/** The active owner's name of a unit for the fee notice, `null` when it has none (DR-292, DOC-34 §6.1). */
export interface UnitOwnerNameDto {
  unitId: string
  ownerName: string | null
}

export interface UnitHitDto {
  unitId: string
  code: string
  floor: number | null
  occupancy: Occupancy
  owner: { accountId: string; fullName: string | null; phone: string } | null
}

export interface ResidentHitDto {
  accountId: string
  fullName: string | null
  /** The full E.164 phone: the caller maps it to its audience (a Guard gets it masked, DOC-12 §10) and never logs the DTO. */
  phone: string
  memberships: Array<{
    unitId: string
    unitCode: string
    memberType: MemberType
    status: 'active' | 'locked'
  }>
}

export interface LookupDto {
  units: UnitHitDto[]
  residents: ResidentHitDto[]
}

/**
 * What the other modules call (DOC-27 §2.1, DOC-09 §7.2): plain DTOs, no `Date`, a call joins the caller's transaction. `lookup`
 * (the union search of DOC-27 §11) is the call of `access` (P5-05); it is built with P1-14 because the staff lists share its strategies.
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
  /**
   * The units of the building whose `lower(code)` is one of `codes` (at most 5,000), one row per code that exists, none for a
   * missing code: the `db` layer of the fee import in one call (DOC-21 §4.3, DR-265).
   */
  findUnitsByCodes(buildingId: string, codes: readonly string[]): Promise<FoundUnitDto[]>
  /**
   * The full name of the active owner of each unit, for the fee notice (DR-292, DOC-34 §6.1): one entry per requested id, in the
   * input order and once each, `ownerName` null when the unit has no active owner or belongs to another building; more than 500
   * throws. The name is for the caller only: never logged, never put in an error.
   */
  unitOwnerNames(buildingId: string, unitIds: string[]): Promise<UnitOwnerNameDto[]>
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
  /**
   * The ids of the keys that seal the stored CCCD numbers (`cccd_enc`), distinct and across buildings: boot guard check 6 compares
   * them with the PII ring (DOC-36 §10.1). An id is not a secret.
   */
  piiKeyIds(): Promise<string[]>
  /**
   * The union search of DOC-27 §11 for units and residents: every strategy whose condition holds runs, each kind is capped at
   * `limitPerKind` (1…20, default 20). The phone is the full one; the caller maps it to its audience.
   */
  lookup(buildingId: string, q: string, opts?: { limitPerKind?: number }): Promise<LookupDto>
}
