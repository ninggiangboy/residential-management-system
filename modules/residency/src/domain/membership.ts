import { ForbiddenError, NotFoundError, type Transition } from '@core/kernel'
import type { MemberType } from '@rms/shared-types'
import type { MembershipStatus } from '../contracts'
import {
  CanPayTenantOnlyError,
  InvalidMembershipTransitionError,
  OwnerMustTransferError,
} from './errors'

export type LockedBy = 'owner' | 'manager'

export interface MembershipRecord {
  id: string
  buildingId: string
  accountId: string
  unitId: string
  memberType: MemberType
  canPay: boolean
  status: MembershipStatus
  lockedBy: LockedBy | null
  /** Bumped by any change of status or type (DR-48); `can_pay` alone never bumps it. */
  credentialVersion: number
  addedByKind: 'staff' | 'resident'
  addedBy: string
  invitedAt: Date | null
  note: string | null
  removedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type MembershipTransition = Transition<MembershipRecord>

/** Who asks for the change: the owner of the unit (`/me/members`) or the Manager and Admin (`/staff/memberships`). */
export type MembershipActor =
  | { kind: 'manager' }
  | { kind: 'owner'; accountId: string; unitId: string }

/** What a change did, for the event and the history (`DOC-27 §2.3`, §10). */
export type MembershipChangeKind =
  | 'type_changed'
  | 'can_pay_changed'
  | 'locked'
  | 'unlocked'
  | 'removed'

/** A decided change: the guarded statement to run and what it means. */
export interface MembershipChange {
  change: MembershipChangeKind
  transition: MembershipTransition
}

/**
 * One person's right in one unit (DOC-16 §5.3, DOC-27 §6). The class holds the rules of who may change what and decides the
 * new state; a repository applies it in one statement guarded by the state the rule read, so two actors that race get an
 * answer from the database (DR-255). Every change of status or type moves `credentialVersion` in the same statement, which is
 * what kills a QR code issued before it (DR-48).
 */
export class Membership {
  constructor(readonly record: MembershipRecord) {}

  get id(): string {
    return this.record.id
  }

  get isOwner(): boolean {
    return this.record.memberType === 'owner'
  }

  /** A resident reaches only the memberships of their own unit: another unit's looks missing (DOC-27 §6.1). */
  private scoped(actor: MembershipActor): void {
    if (actor.kind === 'owner' && actor.unitId !== this.record.unitId) throw new NotFoundError()
  }

  private bump(set: Partial<MembershipRecord>): MembershipTransition {
    const { status, lockedBy, memberType, credentialVersion } = this.record
    return {
      id: this.id,
      expect: { status, lockedBy, memberType, credentialVersion },
      set: { ...set, credentialVersion: credentialVersion + 1 },
    }
  }

  /** An owner acting on their own row is refused whatever the action (FR-17.3). */
  private notSelf(actor: MembershipActor): void {
    if (actor.kind === 'owner' && actor.accountId === this.record.accountId)
      throw new ForbiddenError()
  }

  private invalid(action: string): never {
    throw new InvalidMembershipTransitionError(this.record.status, action)
  }

  /**
   * The owner locks a non-owner member that is active; the Manager locks any membership, also one the owner locked, so the
   * Manager's lock wins; a lock the Manager already holds changes nothing (409).
   */
  lock(actor: MembershipActor): MembershipChange {
    this.scoped(actor)
    this.notSelf(actor)
    const { status, lockedBy } = this.record
    if (actor.kind === 'owner') {
      if (status !== 'active') this.invalid('lock')
      return { change: 'locked', transition: this.bump({ status: 'locked', lockedBy: 'owner' }) }
    }
    if (status === 'removed' || (status === 'locked' && lockedBy === 'manager'))
      this.invalid('lock')
    return { change: 'locked', transition: this.bump({ status: 'locked', lockedBy: 'manager' }) }
  }

  /** The owner unlocks only a lock of their own; the Manager unlocks any (FR-17.4). */
  unlock(actor: MembershipActor): MembershipChange {
    this.scoped(actor)
    this.notSelf(actor)
    const { status, lockedBy } = this.record
    if (status !== 'locked') this.invalid('unlock')
    if (actor.kind === 'owner' && lockedBy !== 'owner') this.invalid('unlock')
    return { change: 'unlocked', transition: this.bump({ status: 'active', lockedBy: null }) }
  }

  /** `family` ↔ `tenant` only: an owner row changes by transfer, a helper is removed and added again (DR-139). */
  retype(to: MemberType, actor: MembershipActor): MembershipChange {
    this.scoped(actor)
    if (this.isOwner) throw new OwnerMustTransferError()
    this.notSelf(actor)
    const { memberType, status } = this.record
    if (status === 'removed' || (memberType !== 'family' && memberType !== 'tenant'))
      this.invalid('retype')
    if ((to !== 'family' && to !== 'tenant') || to === memberType) this.invalid('retype')
    return { change: 'type_changed', transition: this.bump({ memberType: to }) }
  }

  /** The tenant's right to pay. It changes what a request may do, not what a QR code means, so `credentialVersion` stays. */
  setCanPay(canPay: boolean, actor: MembershipActor): MembershipChange {
    this.scoped(actor)
    this.notSelf(actor)
    const { memberType, status, credentialVersion, lockedBy } = this.record
    if (memberType !== 'tenant') throw new CanPayTenantOnlyError()
    if (status === 'removed') this.invalid('can_pay')
    return {
      change: 'can_pay_changed',
      transition: {
        id: this.id,
        expect: { status, lockedBy, memberType, credentialVersion },
        set: { canPay },
      },
    }
  }

  /** A removed person added again is a new row with a new `created_at`, so the history window restarts (DR-40). */
  remove(actor: MembershipActor, now: Date): MembershipChange {
    this.scoped(actor)
    if (this.isOwner) throw new OwnerMustTransferError()
    this.notSelf(actor)
    if (this.record.status === 'removed') this.invalid('remove')
    return {
      change: 'removed',
      transition: this.bump({ status: 'removed', lockedBy: null, removedAt: now }),
    }
  }
}
