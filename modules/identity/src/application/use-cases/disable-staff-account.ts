import { type Clock, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { changeStaffAccount } from '../staff-change'
import { checkedReassignReason, type StaffSafeguards } from '../staff-safeguards'
import type { StaffSessions } from '../staff-sessions'

/** The Admin's alone (DOC-26 §4.4). Read by the route's `audience`. */
export const DISABLE_STAFF_ACCOUNT_ROLES = ['admin'] as const satisfies readonly StaffRole[]

export interface DisableStaffAccountInput {
  /** An active Technician or Guard who takes the open tickets, with a `reason` (DR-147). */
  reassignTo?: string
  reason?: string
}

interface Disabled {
  account: StaffAccountView
  reassignedTo: string | null
}

/**
 * `POST /staff/accounts/{id}/disable` (E-45, DOC-26 §4.4): `invited`, `active` or `locked` becomes `disabled`, the email stays
 * reserved, and every session ends (`account_disabled`). Refused for the last active Admin, for oneself, and for a person with
 * open tickets unless the Admin reassigns them.
 */
export class DisableStaffAccount {
  private readonly auditedDisable: ReturnType<DisableStaffAccount['buildAuditedDisable']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly safeguards: StaffSafeguards,
    private readonly staffSessions: StaffSessions,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedDisable = this.buildAuditedDisable(audited)
  }

  async execute(
    staff: StaffContext,
    staffId: string,
    input: DisableStaffAccountInput = {},
  ): Promise<StaffAccountView> {
    requireRole(staff, DISABLE_STAFF_ACCOUNT_ROLES)
    const reason = input.reassignTo === undefined ? undefined : checkedReassignReason(input.reason)
    return (await this.uow.run(() => this.auditedDisable(staff, staffId, { ...input, reason })))
      .account
  }

  private buildAuditedDisable(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.disable',
        object: (disabled: Disabled) => ({ type: 'staff_account', id: disabled.account.id }),
        reason: (_staff, _id, input: DisableStaffAccountInput) => input.reason,
        details: (disabled) =>
          disabled.reassignedTo ? { reassignedTo: disabled.reassignedTo } : undefined,
      },
      async (staff: StaffContext, staffId: string, input: DisableStaffAccountInput) => {
        const { staffAccounts, safeguards, staffSessions, clock } = this
        const now = clock.now()
        let reassignedTo: string | null = null
        const { before, after } = await changeStaffAccount(
          staffAccounts,
          staff.scope,
          staffId,
          now,
          (account) => account.disable(staff),
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
        await staffSessions.revokeAll(staffId, 'account_disabled', now)
        return {
          result: { account: toStaffAccountView(after), reassignedTo },
          changes: [{ field: 'status', before: before.status, after: 'disabled' }],
        }
      },
    )
  }
}
