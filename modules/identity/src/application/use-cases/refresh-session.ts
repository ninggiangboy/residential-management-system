import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import type { RevocationReason } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'
import type { ConsumedToken, SessionRepository } from '../../domain/session-repository'
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
  client: ConsumedToken['client']
}

export interface RefreshSessionDeps {
  sessions: SessionRepository
  staffAccounts: StaffAccountRepository
  events: SessionEvents
  tokens: TokenFactory
  signer: TokenSigner
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  logger: Log
  config: IdentityConfig
}

type Outcome = { denied: true } | { denied: false; result: RefreshResult }

/**
 * `POST /auth/refresh` (DOC-26 §3.5): rotate the presented token, accept it once more inside the grace window by minting a
 * sibling, and revoke the whole family when a token rotated long ago is used again. A reuse is committed first and answered 401
 * after, so the revocation is not rolled back with the exception (DOC-12 §8.1).
 */
export class RefreshSession {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: { refreshToken: string }): Promise<RefreshResult> {
    const outcome = await this.deps.uow.run(() => this.rotate(input.refreshToken))
    if (outcome.denied) throw new UnauthenticatedError()
    return outcome.result
  }

  private async rotate(presented: string): Promise<Outcome> {
    const { sessions, staffAccounts, events, tokens, signer, clock, ids, logger, config } =
      this.deps
    const now = clock.now()
    const hash = tokens.hashOpaque(presented)
    const nextId = ids.next()
    const log = (result: string, extra: object = {}) =>
      logger.info({ event: 'auth.refresh', outcome: result, ...extra }, 'auth.refresh')

    // 2. The first use of a live token: one row.
    let family = await sessions.consume(hash, nextId, now)
    let successorId = nextId
    if (!family) {
      // 3. Not the first use: classify with one SELECT.
      const fate = await sessions.classify(hash, now, config.refreshGraceSeconds)
      if (fate.fate === 'reuse') {
        await events.revoked([fate.family], 'token_reuse', now)
        logger.warn(
          { event: 'auth.refresh', outcome: 'reuse', sessionId: fate.family.id },
          'auth.refresh',
        )
        return { denied: true }
      }
      if (fate.fate !== 'grace') {
        log('expired')
        return { denied: true }
      }
      // 4. Grace: the first answer may have been lost, and the raw token cannot be returned again, so mint a sibling.
      family = fate.family
      successorId = ids.next()
    }

    // 5. A staff family needs an `active` account. A temporary lockout does not stop a refresh. Resident families join with P1-11.
    const staff = family.kind === 'staff' ? await staffAccounts.findById(family.accountId) : null
    if (!staff || staff.status !== 'active') {
      const reason: RevocationReason =
        staff?.status === 'locked' ? 'account_locked' : 'account_disabled'
      // The consume named a successor that will not exist; the deferred foreign key would refuse the commit.
      if (successorId === nextId) await sessions.dropSuccessor(hash)
      const revoked = await sessions.revokeFamily(family.familyId, reason, now)
      if (revoked) await events.revoked([revoked], reason, now)
      log('account_inactive', { sessionId: family.familyId })
      return { denied: true }
    }

    // 6. Issue the successor and sign with the role read now.
    const next = tokens.opaque()
    const refreshExpiresAt = slidingExpiry(
      now,
      config.refreshTtlDaysStaff,
      family.absoluteExpiresAt,
    )
    await sessions.insertToken(
      {
        id: successorId,
        familyId: family.familyId,
        tokenHash: next.hash,
        expiresAt: refreshExpiresAt,
      },
      now,
    )
    await sessions.touchFamily(family.familyId, now)
    const access = await signer.signAccess(staffClaims(staff, family.familyId))
    log(successorId === nextId ? 'ok' : 'grace', { sessionId: family.familyId })
    return {
      denied: false,
      result: {
        accessToken: access.token,
        expiresIn: access.expiresIn,
        refreshToken: next.token,
        refreshExpiresAt,
        client: family.client,
      },
    }
  }
}
