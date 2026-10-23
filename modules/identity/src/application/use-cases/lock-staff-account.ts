import { type Clock, ForbiddenError, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { changeStaffAccount } from '../staff-change'
import { checkedReassignReason, type StaffSafeguards } from '../staff-safeguards'
import type { StaffSessions } from '../staff-sessions'

/** The Admin locks anyone but themselves; the Manager a Technician or a Guard (DR-133). Read by the route's `audience`. */
export const LOCK_STAFF_ACCOUNT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface LockStaffAccountInput {
  /** Admin only: an active Technician or Guard who takes the open tickets, with a `reason` (DR-147). */
  reassignTo?: string
  reason?: string
}

interface Locked {
  account: StaffAccountView
  reassignedTo: string | null
}

/**
 * `POST /staff/accounts/{id}/lock` (E-43, DOC-26 §4.4): `active → locked`, every session ended (`account_locked`). Refused for the
 * last active Admin (409 `last_admin`, serialized by the row lock) and for a person with open tickets unless an Admin names
 * who takes them; that forced lock is audited as `identity.staff.force_lock` with its reason (FR-14.3).
 */
export class LockStaffAccount {
  private readonly auditedLock: ReturnType<LockStaffAccount['buildAuditedLock']>
  private readonly auditedForce: ReturnType<LockStaffAccount['buildAuditedLock']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly safeguards: StaffSafeguards,
    private readonly staffSessions: StaffSessions,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedLock = this.buildAuditedLock(audited, 'identity.staff.lock')
    this.auditedForce = this.buildAuditedLock(audited, 'identity.staff.force_lock')
  }

  async execute(
    staff: StaffContext,
    staffId: string,
    input: LockStaffAccountInput = {},
  ): Promise<StaffAccountView> {
    requireRole(staff, LOCK_STAFF_ACCOUNT_ROLES)
    if (input.reassignTo !== undefined && staff.role !== 'admin') throw new ForbiddenError()
    const forced = input.reassignTo !== undefined
    const reason = forced ? checkedReassignReason(input.reason) : undefined
    const run = forced ? this.auditedForce : this.auditedLock
    return (await this.uow.run(() => run(staff, staffId, { ...input, reason }))).account
  }

  private buildAuditedLock(audited: Audited, action: string) {
    return audited(
      {
        action,
        object: (locked: Locked) => ({ type: 'staff_account', id: locked.account.id }),
        reason: (_staff, _id, input: LockStaffAccountInput) => input.reason,
      },
      async (staff: StaffContext, staffId: string, input: LockStaffAccountInput) => {
        const { staffAccounts, safeguards, staffSessions, clock } = this
        const now = clock.now()
        let reassignedTo: string | null = null
        const { after } = await changeStaffAccount(
          staffAccounts,
          staff.scope,
          staffId,
          now,
          (account) => account.lock(staff),
          async (account) => {
            await safeguards.keepsAnAdmin(staff.scope, account)
            reassignedTo = await safeguards.clearTickets(
              staff.scope,
              staff,
              account,
              input.reassignTo ? { to: input.reassignTo, reason: input.reason ?? '' } : undefined,
            )
          },
        )
        await staffSessions.revokeAll(staffId, 'account_locked', now)
        return {
          result: { account: toStaffAccountView(after), reassignedTo },
          changes: [
            { field: 'status', before: 'active', after: 'locked' },
            ...(reassignedTo ? [{ field: 'reassignedTo', before: null, after: reassignedTo }] : []),
          ],
        }
      },
    )
  }
}
