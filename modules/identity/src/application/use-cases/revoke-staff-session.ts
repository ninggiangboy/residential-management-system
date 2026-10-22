import type { Clock, UnitOfWork } from '@core/kernel'
import { NotFoundError, requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { SessionRepository } from '../../domain/session-repository'
import type { SessionEvents } from '../session-events'

export interface RevokeStaffSessionDeps {
  sessions: SessionRepository
  events: SessionEvents
  uow: UnitOfWork
  clock: Clock
}

/** Every staff role ends its own sessions (DOC-26 §7). The route reads this list for its `audience`. */
export const REVOKE_STAFF_SESSION_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

/**
 * `DELETE /staff/sessions/{id}` (DOC-26 §3.7): one conditional statement; zero rows is 404, so another account's session looks
 * missing (UC-26 E3). Revoking the current session is allowed and equals a logout.
 */
export class RevokeStaffSession {
  constructor(private readonly deps: RevokeStaffSessionDeps) {}

  async execute(staff: StaffContext, sessionId: string): Promise<void> {
    requireRole(staff, REVOKE_STAFF_SESSION_ROLES)
    const { sessions, events, uow, clock } = this.deps
    await uow.run(async () => {
      const now = clock.now()
      const revoked = await sessions.revokeOwned(
        'staff',
        staff.staffId,
        sessionId,
        'user_revoked',
        now,
      )
      if (!revoked) throw new NotFoundError()
      await events.revoked([revoked], 'user_revoked', now)
    })
  }
}
