import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import { decide } from '@core/kernel'
import type { RevocationReason } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'
import { type Client, RefreshFamily } from '../../domain/refresh-family'
import type { SessionRepository } from '../../domain/session-repository'
import type { StaffAccountRecord } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { TokenFactory, TokenSigner } from '../ports'
import type { SessionEvents } from '../session-events'
import { slidingExpiry, staffClaims } from '../session-issuer'

export interface RefreshResult {
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresAt: Date
  client: Client
}

/** A presented token that may be answered: its family, the active account, and the id of the token that follows. */
interface Found {
  family: RefreshFamily
  staff: StaffAccountRecord
  successorId: string
}

type Outcome = { denied: true } | { denied: false; result: RefreshResult }

/**
 * `POST /auth/refresh` (DOC-26 §3.5): rotate the presented token, accept it once more inside the grace window by minting a
 * sibling, and revoke the whole family when a token rotated long ago is used again. A reuse is committed first and answered 401
 * after, so the revocation is not rolled back with the exception (DOC-12 §8.1).
 */
export class RefreshSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly events: SessionEvents,
    private readonly tokens: TokenFactory,
    private readonly signer: TokenSigner,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly config: IdentityConfig,
  ) {}

  async execute(input: { refreshToken: string }): Promise<RefreshResult> {
    const outcome = await this.uow.run(() => this.rotate(input.refreshToken))
    if (outcome.denied) throw new UnauthenticatedError()
    return outcome.result
  }

  private async rotate(presented: string): Promise<Outcome> {
    const { sessions, events, tokens, signer, clock, ids, logger, config } = this
    const now = clock.now()
    const hash = tokens.hashOpaque(presented)
    const nextId = ids.next()
    const log = (result: string, extra: object = {}) =>
      logger.info({ event: 'auth.refresh', outcome: result, ...extra }, 'auth.refresh')

    // 2 to 4. What the presented token is is the family's rule. Spending it is one guarded statement; the loser of two parallel
    // refreshes finds the token spent when it decides again, and takes the grace path.
    const found = await decide<Found | null>(async () => {
      const current = await sessions.findByToken(hash)
      if (!current) {
        log('expired')
        return { done: true, value: null }
      }
      const family = new RefreshFamily(current.family)
      const presentation = family.present(current.token, now, config.refreshGraceSeconds, nextId)
      if (presentation.kind === 'dead') {
        log('expired')
        return { done: true, value: null }
      }
      if (presentation.kind === 'reuse') {
        if (!(await sessions.revokeFamily(presentation.revocation, now))) return { done: false }
        await events.revoked([family.summary], 'token_reuse', now)
        logger.warn(
          { event: 'auth.refresh', outcome: 'reuse', sessionId: family.id },
          'auth.refresh',
        )
        return { done: true, value: null }
      }

      // 5. Checked before the token is spent, so a refused account leaves the token as it was.
      const staff = await this.activeStaff(family, now)
      if (!staff) {
        log('account_inactive', { sessionId: family.id })
        return { done: true, value: null }
      }

      if (presentation.kind === 'grace')
        // The first answer may have been lost, and the raw token cannot be returned again, so mint a sibling.
        return { done: true, value: { family, staff, successorId: ids.next() } }
      return (await sessions.rotateToken(presentation.transition))
        ? { done: true, value: { family, staff, successorId: nextId } }
        : { done: false }
    })
    if (!found) return { denied: true }
    const { family, staff, successorId } = found

    // 6. Issue the successor and sign with the role read now.
    const next = tokens.opaque()
    const refreshExpiresAt = slidingExpiry(
      now,
      config.refreshTtlDaysStaff,
      family.record.absoluteExpiresAt,
    )
    await sessions.insertToken(
      { id: successorId, familyId: family.id, tokenHash: next.hash, expiresAt: refreshExpiresAt },
      now,
    )
    await sessions.applyFamily(family.touched(now))
    const access = await signer.signAccess(staffClaims(staff, family.id))
    log(successorId === nextId ? 'ok' : 'grace', { sessionId: family.id })
    return {
      denied: false,
      result: {
        accessToken: access.token,
        expiresIn: access.expiresIn,
        refreshToken: next.token,
        refreshExpiresAt,
        client: family.record.client,
      },
    }
  }

  /**
   * A staff family needs an `active` account; a temporary lockout does not stop a refresh. Resident families join with P1-11.
   * An account that may not have a session ends the family and tells `realtime` and `notification`; `null` then.
   */
  private async activeStaff(family: RefreshFamily, now: Date): Promise<StaffAccountRecord | null> {
    const { sessions, staffAccounts, events } = this
    const staff =
      family.record.kind === 'staff' ? await staffAccounts.findById(family.record.accountId) : null
    if (staff?.status === 'active') return staff
    const reason: RevocationReason =
      staff?.status === 'locked' ? 'account_locked' : 'account_disabled'
    const revocation = family.revoke(reason, now)
    if (revocation && (await sessions.revokeFamily(revocation, now)))
      await events.revoked([family.summary], reason, now)
    return null
  }
}
