import { type Clock, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { changeStaffAccount } from '../staff-change'

/** The Admin's alone (DOC-26 §4.4). Read by the route's `audience`. */
export const ENABLE_STAFF_ACCOUNT_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/accounts/{id}/enable` (E-46, DOC-26 §4.4): `disabled → active`, or `invited` when the person never set a password
 * (the table's `ck_staff_account_password`); then the Admin resends the invite. Any other state is 409 `invalid_transition`.
 */
export class EnableStaffAccount {
  private readonly auditedEnable: ReturnType<EnableStaffAccount['buildAuditedEnable']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedEnable = this.buildAuditedEnable(audited)
  }

  async execute(staff: StaffContext, staffId: string): Promise<StaffAccountView> {
    requireRole(staff, ENABLE_STAFF_ACCOUNT_ROLES)
    return this.uow.run(() => this.auditedEnable(staff, staffId))
  }

  private buildAuditedEnable(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.enable',
        object: (account: StaffAccountView) => ({ type: 'staff_account', id: account.id }),
      },
      async (staff: StaffContext, staffId: string) => {
        const { after } = await changeStaffAccount(
          this.staffAccounts,
          staff.scope,
          staffId,
          this.clock.now(),
          (account) => account.enable(staff),
        )
        return {
          result: toStaffAccountView(after),
          changes: [{ field: 'status', before: 'disabled', after: after.status }],
        }
      },
    )
  }
}
