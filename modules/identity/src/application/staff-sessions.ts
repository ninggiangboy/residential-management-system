import type { RevocationReason } from '../contracts'
import type { SessionRepository } from '../domain/session-repository'
import type { SessionEvents } from './session-events'

/**
 * Ends every session of a staff account and tells `realtime` and `notification`, one event per family (DOC-26 §3.8): a lock, a
 * disable and a role change all end here. Runs in the transaction of the change, so the events exist only if it commits.
 */
export class StaffSessions {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
  ) {}

  async revokeAll(staffId: string, reason: RevocationReason, now: Date): Promise<number> {
    const revoked = await this.sessions.revokeAllOf('staff', staffId, reason, now)
    await this.events.revoked(revoked, reason, now)
    return revoked.length
  }
}
