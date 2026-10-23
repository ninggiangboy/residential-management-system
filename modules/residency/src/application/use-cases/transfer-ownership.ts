import {
  type Clock,
  type IdGenerator,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import {
  type MembershipChangedPayload,
  type OwnerChangedPayload,
  RESIDENCY_EVENTS,
} from '../../contracts'
import { MemberExistsError } from '../../domain/errors'
import type { MembershipRecord } from '../../domain/membership'
import type { MembershipRepository } from '../../domain/membership-repository'
import { personNameOf } from '../../domain/person-name'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'
import { Unit } from '../../domain/unit'
import type { UnitHistoryRepository } from '../../domain/unit-history-repository'
import type { UnitRepository } from '../../domain/unit-repository'
import { unitBody } from '../unit-body'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const TRANSFER_OWNERSHIP_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface TransferOwnershipInput {
  phone: string
  fullName: string
  keepMembers: boolean
  /** 5…500 characters after trimming (DOC-35 §3.5); the audit wrapper refuses a short one before anything runs. */
  reason: string
  /** `If-Match`: the unit `version` the Manager saw; absent is 428. */
  version: number | undefined
}

export interface TransferOwnershipResult {
  unit: { unitId: string; code: string; version: number }
  owner: { membershipId: string; accountId: string }
  removedMembers: number
  accountCreated: boolean
  previousOwnerMembershipId: string | null
}

/**
 * `POST /staff/units/{id}/owner` (E-61, DOC-27 §7): the whole transfer in one transaction. The first statement bumps the unit's
 * `version`, which arbitrates two transfers and holds the unit until commit (DR-138); then the new owner's account and profile, the
 * removal of the old owner and, unless `keepMembers`, of every other member, the promotion of the new owner's own row or an
 * insert, the history row, the events and the audit row with the reason. Fees, receipts and tickets stay with the unit.
 */
export class TransferOwnership {
  private readonly auditedTransfer: ReturnType<TransferOwnership['buildAudited']>

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
    this.auditedTransfer = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    unitId: string,
    input: TransferOwnershipInput,
  ): Promise<TransferOwnershipResult> {
    requireRole(staff, TRANSFER_OWNERSHIP_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    const named = { ...input, fullName: personNameOf(input.fullName) }
    return this.uow.run(() => this.auditedTransfer(staff, unitId, named, input.version as number))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.owner.transfer',
        object: (result: TransferOwnershipResult) => ({ type: 'unit', id: result.unit.unitId }),
        reason: (_staff, _unitId, input: TransferOwnershipInput) => input.reason,
        details: (result: TransferOwnershipResult) => ({
          removedOthers: result.removedMembers,
        }),
      },
      async (
        staff: StaffContext,
        unitId: string,
        input: TransferOwnershipInput,
        version: number,
      ) => {
        const result = await this.transfer(staff, unitId, input, version)
        const changes: AuditChange[] = [
          {
            field: 'owner',
            before: result.previousOwnerMembershipId,
            after: result.owner.membershipId,
          },
        ]
        return { result, changes }
      },
    )
  }

  private async transfer(
    staff: StaffContext,
    unitId: string,
    input: TransferOwnershipInput,
    version: number,
  ): Promise<TransferOwnershipResult> {
    const { units, memberships, profiles, history, outbox, identity, clock, ids } = this
    const { scope } = staff
    const stored = await units.find(scope, unitId)
    if (!stored) throw new NotFoundError()
    const now = clock.now()
    // The arbiter: of two transfers with the same `If-Match` one bumps the version and the other, waiting on the row, finds it moved.
    const bumped = await units.apply(scope, Unit.bump(unitId, version), now)
    if (!bumped) {
      const current = await units.find(scope, unitId)
      throw new VersionConflictError(current ? unitBody(current) : undefined)
    }
    const { accountId, created } = await identity.findOrCreateResidentAccount(
      input.phone,
      input.fullName,
    )
    await profiles.ensure(
      scope,
      { accountId, fullName: input.fullName, email: null, note: null },
      now,
    )
    const previous = await memberships.findOwner(scope, unitId)
    if (previous?.accountId === accountId) throw new MemberExistsError(previous.id, 'owner')

    const removed = await memberships.removeForTransfer(
      scope,
      unitId,
      { accountId, keepMembers: input.keepMembers },
      now,
    )
    const promoted = await memberships.promoteToOwner(scope, unitId, accountId, now)
    const owner =
      promoted ??
      (await memberships.insert(
        scope,
        {
          id: ids.next(),
          accountId,
          unitId,
          memberType: 'owner',
          addedByKind: 'staff',
          addedBy: staff.staffId,
        },
        now,
      ))
    // `insert` answers `null` only for a live row of the pair, which the promotion would have found.
    if (!owner) throw new MemberExistsError('')

    await history.add(
      scope,
      {
        id: ids.next(),
        unitId,
        kind: 'owner_changed',
        actor: { kind: 'staff', id: staff.staffId },
        details: {
          from: previous?.accountId ?? null,
          to: accountId,
          keepMembers: input.keepMembers,
          removedMembers: removed.length,
        },
      },
      now,
    )
    await outbox.add([
      {
        type: RESIDENCY_EVENTS.ownerChanged,
        aggregateId: unitId,
        payload: {
          buildingId: staff.buildingId,
          unitId,
          unitCode: stored.code,
          newOwnerAccountId: accountId,
          previousOwnerAccountId: previous?.accountId ?? null,
          keepMembers: input.keepMembers,
        } satisfies OwnerChangedPayload,
        occurredAt: now,
      },
      ...removed.map((row) => removedEvent(staff.buildingId, row, now)),
    ])
    return {
      unit: { unitId, code: stored.code, version: bumped.version },
      owner: { membershipId: owner.id, accountId },
      removedMembers: removed.length,
      accountCreated: created,
      previousOwnerMembershipId: previous?.id ?? null,
    }
  }
}

const removedEvent = (buildingId: string, row: MembershipRecord, occurredAt: Date) => ({
  type: RESIDENCY_EVENTS.membershipChanged,
  aggregateId: row.unitId,
  payload: {
    buildingId,
    unitId: row.unitId,
    membershipId: row.id,
    accountId: row.accountId,
    change: 'removed',
    memberType: row.memberType,
  } satisfies MembershipChangedPayload,
  occurredAt,
})
