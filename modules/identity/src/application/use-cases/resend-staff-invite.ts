import type { UnitOfWork } from '@core/kernel'
import { ConflictError, ForbiddenError, NotFoundError, requireRole } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { InviteIssuer } from '../invite-issuer'

/** The Admin resends any invite; the Manager only those of a Technician or a Guard (DR-133). */
export const RESEND_STAFF_INVITE_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

const MANAGER_MAY_TOUCH: readonly StaffRole[] = ['technician', 'guard']

/**
 * `POST /auth/staff/invite/resend` (DOC-26 §4.4): only for an `invited` account. The new link consumes the older one, and the
 * audit row `identity.staff.update` says the invite was resent (`details.invite`).
 */
export class ResendStaffInvite {
  private readonly auditedResend: ReturnType<ResendStaffInvite['buildAuditedResend']>

  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly inviteIssuer: InviteIssuer,
    private readonly uow: UnitOfWork,
    private readonly audited: Audited,
  ) {
    this.auditedResend = this.buildAuditedResend()
  }

  async execute(staff: StaffContext, staffId: string): Promise<void> {
    requireRole(staff, RESEND_STAFF_INVITE_ROLES)
    await this.uow.run(() => this.auditedResend(staff, staffId))
  }

  private buildAuditedResend() {
    return this.audited(
      {
        action: 'identity.staff.update',
        object: (id: string) => ({ type: 'staff_account', id }),
        details: () => ({ invite: 'resent' }),
      },
      async (staff: StaffContext, staffId: string) => {
        const { staffAccounts, inviteIssuer } = this
        const target = await staffAccounts.findById(staffId)
        // Another building's staff member looks missing (the scope of DOC-12 §7).
        if (!target || target.buildingId !== staff.buildingId) throw new NotFoundError()
        if (staff.role === 'manager' && !MANAGER_MAY_TOUCH.includes(target.role))
          throw new ForbiddenError()
        if (target.status !== 'invited')
          throw new ConflictError(
            'invalid_transition',
            'This can no longer be done in its current state',
            {
              details: { entity: 'staff_account', status: target.status, action: 'resend_invite' },
            },
          )
        await inviteIssuer.issue(target)
        return { result: target.id, changes: [] }
      },
    )
  }
}
