import type { StaffRole } from '@rms/shared-types'

/** What the notification wire says about who an event is for (DOC-52 §9.2). */
export interface EventTarget {
  buildingId: string
  accountId: string | null
  roles: readonly StaffRole[] | null
}

export interface StreamIdentity {
  buildingId: string
  accountId: string
  role: StaffRole
}

/**
 * DOC-52 §7: a stream receives an event when the building is the same and either the account is the target or the stream's role
 * is among the target roles. An event names an account or roles, never both.
 */
export function reaches(target: EventTarget, stream: StreamIdentity): boolean {
  if (target.buildingId !== stream.buildingId) return false
  if (target.accountId !== null) return target.accountId === stream.accountId
  return target.roles?.includes(stream.role) ?? false
}
