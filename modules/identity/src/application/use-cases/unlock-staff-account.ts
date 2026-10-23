import { type Clock, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { changeStaffAccount } from '../staff-change'

/** The Admin unlocks anyone; the Manager a Technician or a Guard (DR-133). Read by the route's `audience`. */
export const UNLOCK_STAFF_ACCOUNT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/accounts/{id}/unlock` (E-44, DOC-26 §4.4): one endpoint lifts the manual lock (`locked → active`) and the temporary
 * lockout of failed sign-ins (FR-13.6). Any other state is 409 `invalid_transition` (DR-147). Sessions were ended at the lock.
 */
export class UnlockStaffAccount {
  private readonly auditedUnlock: ReturnType<UnlockStaffAccount['buildAuditedUnlock']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedUnlock = this.buildAuditedUnlock(audited)
  }

  async execute(staff: StaffContext, staffId: string): Promise<StaffAccountView> {
    requireRole(staff, UNLOCK_STAFF_ACCOUNT_ROLES)
    return this.uow.run(() => this.auditedUnlock(staff, staffId))
  }

  private buildAuditedUnlock(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.unlock',
        object: (account: StaffAccountView) => ({ type: 'staff_account', id: account.id }),
      },
      async (staff: StaffContext, staffId: string) => {
        const now = this.clock.now()
        const { before, after } = await changeStaffAccount(
          this.staffAccounts,
          staff.scope,
          staffId,
          now,
          (account) => account.unlock(staff, now),
        )
        return {
          result: toStaffAccountView(after),
          changes:
            before.status === after.status
              ? []
              : [{ field: 'status', before: before.status, after: after.status }],
        }
      },
    )
  }
}
