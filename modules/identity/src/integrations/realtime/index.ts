import type { RealtimeMapping } from '@mod/realtime/contracts'
import { IDENTITY_EVENTS, type SessionRevokedPayload } from '../../contracts'

/**
 * A revoked staff session closes the open tabs of that session at once (FR-45, DOC-52 §6.6). A resident has no stream, so a
 * resident's revocation builds nothing (SE-09); a revocation without a building cannot be a staff one.
 */
export const identityRealtime: RealtimeMapping<SessionRevokedPayload>[] = [
  {
    handler: 'realtime.close_stream_on_identity_session_revoked',
    eventType: IDENTITY_EVENTS.sessionRevoked,
    build: (p) =>
      p.accountKind !== 'staff' || p.buildingId === null
        ? null
        : {
            buildingId: p.buildingId,
            target: { accountId: p.accountId },
            closeSessionId: p.sessionId,
            event: { type: 'session.revoked', data: { sessionId: p.sessionId, reason: p.reason } },
          },
  },
]
