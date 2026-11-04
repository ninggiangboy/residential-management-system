/**
 * The weekly integrity job of `residency` (`integrity_weekly`, DR-62, DR-120, DR-321, DOC-38 §4.1): it looks for memberships that
 * break their rules and for ids that point at nothing it can check. It **reports and never repairs**. A pure port (DOC-12 §4.5);
 * the Drizzle adapter is in `infrastructure/persistence/`.
 */
export const INTEGRITY_KINDS = [
  'membership_two_owners',
  'member_of_removed_account',
  'membership_unit_missing',
  'dangling_reference',
] as const
export type IntegrityKind = (typeof INTEGRITY_KINDS)[number]

/** The ids logged per kind and building (DOC-22 §12 uses the same bound for the nightly check). */
export const INTEGRITY_SAMPLE_LIMIT = 50

/** One kind that has rows in one building: how many, and the first `INTEGRITY_SAMPLE_LIMIT` ids (never a name or a phone). */
export interface IntegrityFinding {
  readonly kind: IntegrityKind
  readonly rows: number
  readonly sampleIds: readonly string[]
}

/** An active or locked membership and the account it names, for the check against `identity`. */
export interface MembershipAccountRef {
  readonly membershipId: string
  readonly accountId: string
}

export interface IntegrityReader {
  /** `membership_two_owners` and `membership_unit_missing` of one building, from the tables of `residency` alone; only the non-empty kinds. */
  checkMemberships(buildingId: string): Promise<readonly IntegrityFinding[]>
  /** The memberships of one building that are not `removed`, with their account ids, for `member_of_removed_account` and `dangling_reference`. */
  liveMembershipAccounts(buildingId: string): Promise<readonly MembershipAccountRef[]>
}
