import type { Clock, UnitOfWork } from '@core/kernel'
import { NotFoundError, requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { RefreshFamily } from '../../domain/refresh-family'
import type { SessionRepository } from '../../domain/session-repository'
import type { SessionEvents } from '../session-events'

/** Every staff role ends its own sessions (DOC-26 §7). The route reads this list for its `audience`. */
export const REVOKE_STAFF_SESSION_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

/**
 * `DELETE /staff/sessions/{id}` (DOC-26 §3.7): the family decides it is the account's and live, one guarded statement ends it, and zero rows is 404, so another account's session looks
 * missing (UC-26 E3). Revoking the current session is allowed and equals a logout.
 */
export class RevokeStaffSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(staff: StaffContext, sessionId: string): Promise<void> {
    requireRole(staff, REVOKE_STAFF_SESSION_ROLES)
    const { sessions, events, uow, clock } = this
    await uow.run(async () => {
      const now = clock.now()
      const record = await sessions.findFamily(sessionId)
      const family = record ? new RefreshFamily(record) : null
      // Another account's session, an unknown one and one already revoked all look missing (UC-26 E3).
      if (!family?.ownedBy('staff', staff.staffId)) throw new NotFoundError()
      const revocation = family.revoke('user_revoked', now)
      if (!revocation || !(await sessions.revokeFamily(revocation, now))) throw new NotFoundError()
      await events.revoked([family.summary], 'user_revoked', now)
    })
  }
}
