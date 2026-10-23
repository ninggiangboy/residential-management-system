import type { Clock, UnitOfWork } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import type { ResidentSession } from '@rms/shared-types'
import { RefreshFamily } from '../../domain/refresh-family'
import type { SessionRepository } from '../../domain/session-repository'
import type { SessionEvents } from '../session-events'

/**
 * `DELETE /me/sessions/{id}` (DOC-26 §3.7): the family decides it is the account's and live, one guarded statement ends it, and
 * zero rows is 404, so another account's session looks missing (UC-26 E3). Revoking the current session equals a logout. The
 * route is token-only: a resident reaches it without a unit, so no role list applies (the guard is `resident()`).
 */
export class RevokeResidentSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(resident: ResidentSession, sessionId: string): Promise<void> {
    const { sessions, events, uow, clock } = this
    await uow.run(async () => {
      const now = clock.now()
      const record = await sessions.findFamily(sessionId)
      const family = record ? new RefreshFamily(record) : null
      // Another account's session, an unknown one and one already revoked all look missing (UC-26 E3).
      if (!family?.ownedBy('resident', resident.accountId)) throw new NotFoundError()
      const revocation = family.revoke('user_revoked', now)
      if (!revocation || !(await sessions.revokeFamily(revocation, now))) throw new NotFoundError()
      await events.revoked([family.summary], 'user_revoked', now)
    })
  }
}
