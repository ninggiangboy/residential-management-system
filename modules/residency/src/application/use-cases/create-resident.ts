import {
  type Clock,
  type IdGenerator,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { MemberType, StaffContext, StaffRole } from '@rms/shared-types'
import {
  type MembershipChangedPayload,
  type OwnerChangedPayload,
  RESIDENCY_EVENTS,
} from '../../contracts'
import { CanPayTenantOnlyError, MemberExistsError, UnitHasOwnerError } from '../../domain/errors'
import type { MembershipRecord } from '../../domain/membership'
import type { MembershipRepository } from '../../domain/membership-repository'
import { personNameOf } from '../../domain/person-name'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'
import type { UnitRecord } from '../../domain/unit'
import type { UnitHistoryRepository } from '../../domain/unit-history-repository'
import type { UnitRepository } from '../../domain/unit-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const CREATE_RESIDENT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface CreateResidentInput {
  unitId: string
  phone: string
  fullName: string
  memberType: MemberType
  canPay: boolean
  email: string | null
  note: string | null
}

export interface CreateResidentResult {
  accountId: string
  membershipId: string
  accountCreated: boolean
  /** What the profile was given, for the second audit row. */
  profileFilled: boolean
}

/**
 * `POST /staff/residents` (E-64, DOC-27 §5.1): the Manager adds a person to a unit in one transaction: the account through
 * `IdentityApi`, the profile (`ON CONFLICT DO NOTHING`, DR-136), the membership, the `unit_history` row, the event and the audit
 * rows. `owner` is allowed only for a unit with no owner (409 `unit_has_owner` otherwise: replacing an owner is a transfer), and the
 * unit row is held first so two owners added at once are decided in turn. No invitation SMS goes (DR-137): the Manager tells the person.
 */
export class CreateResident {
  private readonly auditedAdd: ReturnType<CreateResident['buildAuditedAdd']>
  private readonly auditedProfile: ReturnType<CreateResident['buildAuditedProfile']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly units: UnitRepository,
    private readonly memberships: MembershipRepository,
    private readonly profiles: ResidentProfileRepository,
    private readonly history: UnitHistoryRepository,
    private readonly outbox: OutboxWriter,
    private readonly identity: Pick<IdentityApi, 'findOrCreateResidentAccount'>,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.auditedAdd = this.buildAuditedAdd(audited)
    this.auditedProfile = this.buildAuditedProfile(audited)
  }

  async execute(staff: StaffContext, input: CreateResidentInput): Promise<CreateResidentResult> {
    requireRole(staff, CREATE_RESIDENT_ROLES)
    if (input.canPay && input.memberType !== 'tenant') throw new CanPayTenantOnlyError()
    const named = { ...input, fullName: personNameOf(input.fullName) }
    return this.uow.run(async () => {
      const added = await this.auditedAdd(staff, named)
      if (added.profileFilled) await this.auditedProfile(staff, named, added.accountId)
      return added
    })
  }

  private buildAuditedAdd(audited: Audited) {
    return audited(
      {
        action: 'residency.membership.add',
        object: (added: CreateResidentResult) => ({ type: 'membership', id: added.membershipId }),
      },
      async (staff: StaffContext, input: CreateResidentInput) => {
        const result = await this.add(staff, input)
        const changes: AuditChange[] = [
          { field: 'status', before: null, after: 'active' },
          { field: 'memberType', before: null, after: input.memberType },
          { field: 'canPay', before: null, after: input.canPay },
        ]
        return { result, changes }
      },
    )
  }

  private buildAuditedProfile(audited: Audited) {
    return audited(
      {
        action: 'residency.profile.update',
        object: (accountId: string) => ({ type: 'resident_profile', id: accountId }),
        masks: { email: 'email', note: 'personal' },
      },
      async (_staff: StaffContext, input: CreateResidentInput, accountId: string) => {
        const changes: AuditChange[] = []
        if (input.email !== null) changes.push({ field: 'email', before: null, after: input.email })
        if (input.note !== null) changes.push({ field: 'note', before: null, after: input.note })
        return { result: accountId, changes }
      },
    )
  }

  private async add(
    staff: StaffContext,
    input: CreateResidentInput,
  ): Promise<CreateResidentResult> {
    const { profiles, identity, clock } = this
    const { scope } = staff
    const unit = await this.unitFor(staff, input)
    const now = clock.now()
    const { accountId, created } = await identity.findOrCreateResidentAccount(
      input.phone,
      input.fullName,
    )
    const email = input.email?.trim().toLowerCase() || null
    const note = input.note?.trim() || null
    const profileFilled = await profiles.ensure(
      scope,
      { accountId, fullName: input.fullName, email, note },
      now,
    )
    const membership = await this.insert(staff, input, unit.id, accountId, now)
    await this.record(staff, input, unit, membership, now)
    return {
      accountId,
      membershipId: membership.id,
      accountCreated: created,
      profileFilled: profileFilled && (email !== null || note !== null),
    }
  }

  /**
   * The unit of the building. For an owner the row is held first, so the check below and the insert are not interleaved with
   * another one's, and a unit that has an owner is 409 `unit_has_owner`.
   */
  private async unitFor(staff: StaffContext, input: CreateResidentInput) {
    const { units, memberships } = this
    const { scope } = staff
    if (input.memberType === 'owner' && !(await units.lock(scope, input.unitId)))
      throw new NotFoundError()
    const unit = await units.find(scope, input.unitId)
    if (!unit) throw new NotFoundError()
    if (input.memberType === 'owner') {
      const owner = await memberships.findOwner(scope, unit.id)
      if (owner) throw new UnitHasOwnerError(owner.id)
    }
    return unit
  }

  private async insert(
    staff: StaffContext,
    input: CreateResidentInput,
    unitId: string,
    accountId: string,
    now: Date,
  ): Promise<MembershipRecord> {
    const { memberships, ids } = this
    const inserted = await memberships.insert(
      staff.scope,
      {
        id: ids.next(),
        accountId,
        unitId,
        memberType: input.memberType,
        canPay: input.canPay,
        addedByKind: 'staff',
        addedBy: staff.staffId,
      },
      now,
    )
    if (inserted) return inserted
    const existing = await memberships.findLive(staff.scope, unitId, accountId)
    throw new MemberExistsError(existing?.id ?? '', existing?.memberType)
  }

  /** The history row and the event: an owner added to an ownerless unit is `owner_changed`, any other member `added`. */
  private async record(
    staff: StaffContext,
    input: CreateResidentInput,
    unit: UnitRecord,
    membership: MembershipRecord,
    now: Date,
  ): Promise<void> {
    const isOwner = input.memberType === 'owner'
    await this.history.add(
      staff.scope,
      {
        id: this.ids.next(),
        unitId: unit.id,
        kind: isOwner ? 'owner_changed' : 'member_added',
        actor: { kind: 'staff', id: staff.staffId },
        details: isOwner
          ? { from: null, to: membership.accountId, source: 'manager' }
          : { accountId: membership.accountId, memberType: input.memberType },
      },
      now,
    )
    await this.outbox.add([
      isOwner
        ? {
            type: RESIDENCY_EVENTS.ownerChanged,
            aggregateId: unit.id,
            payload: {
              buildingId: staff.buildingId,
              unitId: unit.id,
              unitCode: unit.code,
              newOwnerAccountId: membership.accountId,
              previousOwnerAccountId: null,
              keepMembers: false,
            } satisfies OwnerChangedPayload,
            occurredAt: now,
          }
        : addedEvent(staff.buildingId, membership, now),
    ])
  }
}

const addedEvent = (buildingId: string, row: MembershipRecord, occurredAt: Date) => ({
  type: RESIDENCY_EVENTS.membershipChanged,
  aggregateId: row.unitId,
  payload: {
    buildingId,
    unitId: row.unitId,
    membershipId: row.id,
    accountId: row.accountId,
    change: 'added',
    memberType: row.memberType,
  } satisfies MembershipChangedPayload,
  occurredAt,
})
