import type { MemberType } from '@rms/shared-types'

/** The events `residency` writes to its own outbox (DOC-09 §6.2). Both are facts and have the `default` retry class. */
export const RESIDENCY_EVENTS = {
  membershipChanged: 'residency.membership_changed.v1',
  ownerChanged: 'residency.owner_changed.v1',
} as const

export type MembershipChange =
  | 'added'
  | 'removed'
  | 'type_changed'
  | 'can_pay_changed'
  | 'locked'
  | 'unlocked'

/** `aggregate_id` is the unit id. Notification reads only `added` (DOC-27 §2.3). */
export interface MembershipChangedPayload {
  buildingId: string
  unitId: string
  membershipId: string
  accountId: string
  change: MembershipChange
  memberType: MemberType
}

export interface OwnerChangedPayload {
  buildingId: string
  unitId: string
  unitCode: string
  newOwnerAccountId: string
  previousOwnerAccountId: string | null
  keepMembers: boolean
}
