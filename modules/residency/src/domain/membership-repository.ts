import type { BuildingScope } from '@rms/shared-types'
import type { MembershipRecord, MembershipTransition } from './membership'

/** The membership rows as the change use cases move them. Every query carries the building scope (DR-12). */
export interface MembershipRepository {
  /** The row of the building whatever its status; `null` for an unknown id or another building's (404, never 403). */
  find(scope: BuildingScope, id: string): Promise<MembershipRecord | null>
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
