import type { Clock, IdGenerator } from '@core/kernel'
import type { AccessClaims } from '../contracts'
import type { Client } from '../domain/refresh-family'
import type { SessionRepository } from '../domain/session-repository'
import type { StaffAccountRecord } from '../domain/staff-account'
import type { IdentityConfig } from './config'
import type { TokenFactory, TokenSigner } from './ports'
import type { SessionEvents } from './session-events'

const DAY_MS = 86_400_000

export interface IssuedSession {
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresAt: Date
}

/** The sliding limit of a refresh token, never beyond the family's absolute limit (DOC-26 §3.5 step 6). */
export const slidingExpiry = (now: Date, slidingDays: number, absoluteExpiresAt: Date): Date =>
  new Date(Math.min(now.getTime() + slidingDays * DAY_MS, absoluteExpiresAt.getTime()))

/** The claims of a staff access token, with the role read from the row now (DOC-26 §3.1). */
export const staffClaims = (staff: StaffAccountRecord, sessionId: string): AccessClaims => ({
  sub: staff.id,
  kind: 'staff',
  role: staff.role,
  bid: staff.buildingId,
  sid: sessionId,
})

/**
 * Opens a session: evicts the oldest families so that `maxFamilies - 1` stay, inserts the family and its first token, and
 * signs the access token (DOC-26 §3.6). Runs inside the caller's transaction.
 */
export class SessionIssuer {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly tokens: TokenFactory,
    private readonly signer: TokenSigner,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: IdentityConfig,
  ) {}

  async openStaffSession(
    staff: StaffAccountRecord,
    input: { client: Client; userAgent: string | null },
  ): Promise<IssuedSession> {
    const { sessions, events, tokens, signer, clock, ids, config } = this
    const now = clock.now()
    const evicted = await sessions.evictOldest('staff', staff.id, config.maxFamilies - 1, now)
    await events.revoked(evicted, 'cap_exceeded', now)

    const familyId = ids.next()
    const absoluteExpiresAt = new Date(now.getTime() + config.familyMaxDaysStaff * DAY_MS)
    await sessions.insertFamily(
      {
        id: familyId,
        kind: 'staff',
        accountId: staff.id,
        buildingId: staff.buildingId,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        client: input.client,
        absoluteExpiresAt,
      },
      now,
    )
    const refresh = tokens.opaque()
    const refreshExpiresAt = slidingExpiry(now, config.refreshTtlDaysStaff, absoluteExpiresAt)
    await sessions.insertToken(
      { id: ids.next(), familyId, tokenHash: refresh.hash, expiresAt: refreshExpiresAt },
      now,
    )
    const access = await signer.signAccess(staffClaims(staff, familyId))
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshExpiresAt,
    }
  }
}
