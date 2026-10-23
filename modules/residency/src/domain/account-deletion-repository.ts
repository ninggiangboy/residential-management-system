import type { MemberType } from '@rms/shared-types'

export interface RemovedMembership {
  id: string
  buildingId: string
  unitId: string
  accountId: string
  memberType: MemberType
}

/** What the deletion of an account clears in `residency`, in every building (DOC-27 §12). Not scoped: the account is the key. */
export interface AccountDeletionRepository {
  /** Removes every non-removed membership of the account, bumping `credential_version`; a second run returns none. */
  removeMemberships(accountId: string, now: Date): Promise<RemovedMembership[]>
  /** Clears the personal fields of the account's profiles once; a profile already cleared is left as it is. */
  clearProfiles(accountId: string, now: Date): Promise<void>
}
