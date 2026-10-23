import {
  type Clock,
  decide,
  type IdGenerator,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { MemberType, StaffContext, StaffRole } from '@rms/shared-types'
import { type MembershipChangedPayload, RESIDENCY_EVENTS } from '../../contracts'
import {
  Membership,
  type MembershipActor,
  type MembershipChange,
  type MembershipRecord,
} from '../../domain/membership'
import type { MembershipRepository } from '../../domain/membership-repository'
import type { UnitHistoryRepository } from '../../domain/unit-history-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). The route reads this list for its `audience` (DOC-12 §5.3). */
export const CHANGE_MEMBERSHIP_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** Exactly one change per request (DR-139): the body has one of `memberType`, `canPay`, `status`. */
export type MembershipEdit =
  | { memberType: MemberType }
  | { canPay: boolean }
  | { status: 'active' | 'locked' | 'removed' }

type Action = 'update' | 'lock' | 'unlock' | 'remove'

const actionOf = (edit: MembershipEdit): Action => {
  if (!('status' in edit)) return 'update'
  return edit.status === 'locked' ? 'lock' : edit.status === 'active' ? 'unlock' : 'remove'
}

function changeOf(membership: Membership, edit: MembershipEdit, actor: MembershipActor, now: Date) {
  if ('memberType' in edit) return membership.retype(edit.memberType, actor)
  if ('canPay' in edit) return membership.setCanPay(edit.canPay, actor)
  if (edit.status === 'locked') return membership.lock(actor)
  if (edit.status === 'active') return membership.unlock(actor)
  return membership.remove(actor, now)
}

const fieldsOf = (before: MembershipRecord, after: MembershipRecord): AuditChange[] => {
  const changes: AuditChange[] = []
  if (before.status !== after.status)
    changes.push({ field: 'status', before: before.status, after: after.status })
  if (before.memberType !== after.memberType)
    changes.push({ field: 'memberType', before: before.memberType, after: after.memberType })
  if (before.canPay !== after.canPay)
    changes.push({ field: 'canPay', before: before.canPay, after: after.canPay })
  return changes
}

/**
 * `PATCH /staff/memberships/{id}` (DOC-27 §6.1, §6.3): the Manager or Admin locks, unlocks, retypes, sets `can_pay` or removes a
 * membership of the building. The rules are the aggregate's; one guarded statement applies the change, and when two actors race
 * the loser loads again and decides on what the winner left (DR-255). The change, its event, its history row and its audit row
 * commit together. The owner's variant of the same change (`/me/members`) comes with P4-10 and reuses the aggregate.
 */
export class ChangeMembership {
  private readonly audited: Record<Action, ReturnType<ChangeMembership['buildAudited']>>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly memberships: MembershipRepository,
    private readonly history: UnitHistoryRepository,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.audited = {
      update: this.buildAudited(audited, 'residency.membership.update'),
      lock: this.buildAudited(audited, 'residency.membership.lock'),
      unlock: this.buildAudited(audited, 'residency.membership.unlock'),
      remove: this.buildAudited(audited, 'residency.membership.remove'),
    }
  }

  /** The membership after the change, as `PATCH /staff/memberships/{id}` answers it (E-69). */
  async execute(
    staff: StaffContext,
    membershipId: string,
    edit: MembershipEdit,
  ): Promise<MembershipRecord> {
    requireRole(staff, CHANGE_MEMBERSHIP_ROLES)
    return this.uow.run(() => this.audited[actionOf(edit)](staff, membershipId, edit))
  }

  private buildAudited(audited: Audited, action: string) {
    return audited(
      { action, object: (after: MembershipRecord) => ({ type: 'membership', id: after.id }) },
      async (staff: StaffContext, membershipId: string, edit: MembershipEdit) => {
        const { after, changes } = await this.apply(staff, membershipId, edit)
        return { result: after, changes }
      },
    )
  }

  private apply(staff: StaffContext, membershipId: string, edit: MembershipEdit) {
    const { memberships, history, outbox, clock, ids } = this
    const actor: MembershipActor = { kind: 'manager' }
    return decide<{ after: MembershipRecord; changes: AuditChange[] }>(async () => {
      const now = clock.now()
      const before = await memberships.find(staff.scope, membershipId)
      if (!before) throw new NotFoundError()
      const { change, transition }: MembershipChange = changeOf(
        new Membership(before),
        edit,
        actor,
        now,
      )
      const after = await memberships.apply(staff.scope, transition, now)
      if (!after) return { done: false as const }
      if (change === 'removed')
        await history.add(
          staff.scope,
          {
            id: ids.next(),
            unitId: after.unitId,
            kind: 'member_removed',
            actor: { kind: 'staff', id: staff.staffId },
            details: { accountId: after.accountId, memberType: after.memberType },
          },
          now,
        )
      await outbox.add([
        {
          type: RESIDENCY_EVENTS.membershipChanged,
          aggregateId: after.unitId,
          payload: {
            buildingId: after.buildingId,
            unitId: after.unitId,
            membershipId: after.id,
            accountId: after.accountId,
            change,
            memberType: after.memberType,
          } satisfies MembershipChangedPayload,
          occurredAt: now,
        },
      ])
      return { done: true as const, value: { after, changes: fieldsOf(before, after) } }
    })
  }
}
