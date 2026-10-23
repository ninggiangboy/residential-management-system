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
  /** Only a tenant may hold it (DR-139); `false` when absent. */
  canPay?: boolean
}

/** The membership rows as the change use cases move them. Every query carries the building scope (DR-12). */
export interface MembershipRepository {
  /** The row of the building whatever its status; `null` for an unknown id or another building's (404, never 403). */
  find(scope: BuildingScope, id: string): Promise<MembershipRecord | null>
  /** The non-removed membership of the pair, `locked` included. */
  findLive(
    scope: BuildingScope,
    unitId: string,
    accountId: string,
  ): Promise<MembershipRecord | null>
  /** The non-removed owner row of the unit. */
  findOwner(scope: BuildingScope, unitId: string): Promise<MembershipRecord | null>
  /** The non-removed rows of the unit, owner first and then oldest first (DOC-27 §4.2). */
  listOfUnit(scope: BuildingScope, unitId: string): Promise<MembershipRecord[]>
  /**
   * One active membership, or `null` when the pair already has a non-removed one (`ON CONFLICT … DO NOTHING`, DOC-27 §5.1). An
   * owner row of a unit that has one is the unique index `membership_one_owner_per_unit`'s to refuse, so the caller locks the unit first.
   */
  insert(
    scope: BuildingScope,
    membership: NewMembership,
    now: Date,
  ): Promise<MembershipRecord | null>
  /**
   * The transfer's removal (DOC-27 §7 step 3): the old owner, and every other non-removed member unless `keepMembers`, except
   * the new owner's own account; `credential_version` moves with the status.
   */
  removeForTransfer(
    scope: BuildingScope,
    unitId: string,
    keep: { accountId: string; keepMembers: boolean },
    now: Date,
  ): Promise<MembershipRecord[]>
  /** The transfer's promotion (DOC-27 §7 step 4): the row of the new owner's account becomes the owner row and keeps its `created_at`. */
  promoteToOwner(
    scope: BuildingScope,
    unitId: string,
    accountId: string,
    now: Date,
  ): Promise<MembershipRecord | null>
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
