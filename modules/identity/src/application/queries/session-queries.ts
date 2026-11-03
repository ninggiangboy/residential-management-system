import type { Clock } from '@core/kernel'
import { requireRole, ValidationError } from '@core/kernel'
import type { ResidentSession, StaffContext, StaffRole } from '@rms/shared-types'
import { deviceLabel } from '../../domain/device-label'
import type { AccountKind, Client } from '../../domain/refresh-family'
import type { SessionRepository } from '../../domain/session-repository'

/** One row of `GET /staff/sessions` (DOC-26 §3.7). */
export interface SessionDto {
  id: string
  client: Client
  device: string
  createdAt: string
  lastUsedAt: string
  current: boolean
}

/** The most ids one `liveSessionIds` call takes (DOC-09 §7.3). */
export const LIVE_SESSION_IDS_MAX = 500

/** Every staff role lists its own sessions (DOC-26 §7). */
export const LIST_STAFF_SESSIONS_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

/** The session lists of `GET /staff/sessions` and `GET /me/sessions`: the live families of an account, most recently used first, the current one marked. */
export class SessionQueries {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async listStaff(staff: StaffContext, currentSessionId: string): Promise<SessionDto[]> {
    requireRole(staff, LIST_STAFF_SESSIONS_ROLES)
    return this.list('staff', staff.staffId, currentSessionId)
  }

  /** The resident's own sessions; the route is token-only, so no role applies. */
  listResident(resident: ResidentSession): Promise<SessionDto[]> {
    return this.list('resident', resident.accountId, resident.sessionId)
  }

  /** `IdentityApi.liveSessionIds` (DOC-26 §3.7, DR-300): at most 500 ids; an unknown id is absent. */
  async liveSessionIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length > LIVE_SESSION_IDS_MAX) {
      throw new ValidationError([
        {
          path: 'sessionIds',
          code: 'maximum',
          message: `at most ${LIVE_SESSION_IDS_MAX} session ids`,
        },
      ])
    }
    return this.sessions.liveIds(ids, this.clock.now())
  }

  private async list(
    kind: AccountKind,
    accountId: string,
    currentSessionId: string,
  ): Promise<SessionDto[]> {
    const rows = await this.sessions.listLive(kind, accountId, this.clock.now())
    return rows.map((row) => ({
      id: row.id,
      client: row.client,
      device: deviceLabel(row.userAgent),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.id === currentSessionId,
    }))
  }
}
