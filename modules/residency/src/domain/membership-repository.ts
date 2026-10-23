import type { BuildingScope, MemberType } from '@rms/shared-types'
import type { MembershipRecord, MembershipTransition } from './membership'

/** A membership that starts now: the owner row an import writes (DOC-27 §9.2 step 6). `can_pay` is off and the status active. */
export interface NewMembership {
  id: string
  accountId: string
  unitId: string
  memberType: MemberType
  addedByKind: 'staff' | 'resident'
  addedBy: string
}

/** The membership rows as the change use cases move them. Every query carries the building scope (DR-12). */
export interface MembershipRepository {
  /** The row of the building whatever its status; `null` for an unknown id or another building's (404, never 403). */
  find(scope: BuildingScope, id: string): Promise<MembershipRecord | null>
  /** Inserts active memberships in one statement per 500; the unique indexes of DOC-16 §5.3 refuse a second owner or a second row of the pair. */
  insertMany(scope: BuildingScope, memberships: readonly NewMembership[], now: Date): Promise<void>
  /**
   * One guarded statement (DR-255). The row after the change, or `null` when it moved since it was loaded: the caller loads
   * and decides again on what the winner left.
   */
  apply(
    scope: BuildingScope,
    transition: MembershipTransition,
    now: Date,
  ): Promise<MembershipRecord | null>
}
