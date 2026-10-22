import type { Clock, UnitOfWork } from '@core/kernel'
import type { SessionRepository } from '../../domain/session-repository'
import type { TokenFactory } from '../ports'
import type { SessionEvents } from '../session-events'

export interface SignOutDeps {
  sessions: SessionRepository
  events: SessionEvents
  tokens: TokenFactory
  uow: UnitOfWork
  clock: Clock
}

/**
 * `POST /auth/logout` (DOC-26 §3.7): revokes the family of the presented refresh token with reason `sign_out`. It answers the
 * same whether or not the token is known, so a repeated logout is not an error.
 */
export class SignOut {
  constructor(private readonly deps: SignOutDeps) {}

  async execute(input: { refreshToken: string }): Promise<void> {
    const { sessions, events, tokens, uow, clock } = this.deps
    const hash = tokens.hashOpaque(input.refreshToken)
    await uow.run(async () => {
      const family = await sessions.familyOfToken(hash)
      if (!family) return
      const now = clock.now()
      const revoked = await sessions.revokeFamily(family.id, 'sign_out', now)
      if (revoked) await events.revoked([revoked], 'sign_out', now)
    })
  }
}
