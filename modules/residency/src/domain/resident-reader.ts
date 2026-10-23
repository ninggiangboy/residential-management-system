import type { BuildingScope, MemberType } from '@rms/shared-types'
import type { MembershipStatus } from '../contracts'

/** The person's record in one building as a list shows it: the ID number is only its last four digits (DOC-35 §6). */
export interface ProfileRow {
  accountId: string
  fullName: string | null
  cccdLast4: string | null
}

export interface ProfileListFilter {
  /** Residents with a non-removed membership of the unit. */
  unitId?: string
  memberType?: MemberType
  /** The status of that membership: `active` or `locked`. */
  status?: 'active' | 'locked'
  /** Restricts the page to these accounts: the phone search and the deletion requests come from `identity`. */
  accountIds?: readonly string[]
}

/** A non-removed membership of an account in the building, with the unit code. */
export interface MembershipOfAccount {
  accountId: string
  membershipId: string
  unitId: string
  unitCode: string
  memberType: MemberType
  status: Exclude<MembershipStatus, 'removed'>
  startedAt: Date
}

/** The profile as the detail view reads it, ID number still sealed. */
export interface ProfileDetail {
  accountId: string
  fullName: string | null
  email: string | null
  cccdEnc: string | null
  dateOfBirth: string | null
  note: string | null
  version: number
}

/** The reads behind the resident routes and `lookup`. Every query carries the building (DOC-12 §7); no state change. */
export interface ResidentReader {
  /** Keyset on `account_id`; the caller reads one more than `limit`. A cleared profile is not listed. */
  list(
    scope: BuildingScope,
    filter: ProfileListFilter,
    after: string | undefined,
    limit: number,
  ): Promise<ProfileRow[]>
  /** The folded-name search of DOC-27 §11.1 through `resident_profile_name_trgm_idx`; `folded` is already folded. */
  searchByName(scope: BuildingScope, folded: string, limit: number): Promise<ProfileRow[]>
  /** The profiles of these accounts; an account with none in this building is absent (DR-136). */
  profilesOf(scope: BuildingScope, accountIds: readonly string[]): Promise<ProfileRow[]>
  /** The person's profile in this building, `null` when there is none or it was cleared. */
  detail(scope: BuildingScope, accountId: string): Promise<ProfileDetail | null>
  /** The non-removed memberships of these accounts in the building, oldest first. */
  membershipsOf(scope: BuildingScope, accountIds: readonly string[]): Promise<MembershipOfAccount[]>
  /** The number of people with a profile in the building, whatever the filters (`summary.total`, DR-212). */
  total(scope: BuildingScope): Promise<number>
  /** The names of the profiles, for the unit pages. */
  namesOf(scope: BuildingScope, accountIds: readonly string[]): Promise<Map<string, string | null>>
}
