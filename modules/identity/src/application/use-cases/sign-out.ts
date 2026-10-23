import type { Clock, UnitOfWork } from '@core/kernel'
import { RefreshFamily } from '../../domain/refresh-family'
import type { SessionRepository } from '../../domain/session-repository'
import type { TokenFactory } from '../ports'
import type { SessionEvents } from '../session-events'

/**
 * `POST /auth/logout` (DOC-26 §3.7): revokes the family of the presented refresh token with reason `sign_out`. It answers the
 * same whether or not the token is known, so a repeated logout is not an error.
 */
export class SignOut {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly tokens: TokenFactory,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { refreshToken: string }): Promise<void> {
    const { sessions, events, tokens, uow, clock } = this
    const hash = tokens.hashOpaque(input.refreshToken)
    await uow.run(async () => {
      const found = await sessions.findByToken(hash)
      if (!found) return
      const now = clock.now()
      const family = new RefreshFamily(found.family)
      const revocation = family.revoke('sign_out', now)
      if (revocation && (await sessions.revokeFamily(revocation, now)))
        await events.revoked([family.summary], 'sign_out', now)
    })
  }
}
