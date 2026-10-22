import type { Clock, UnitOfWork } from '@core/kernel'
import { TokenInvalidError } from '../../domain/errors'
import { assertPasswordRule } from '../../domain/password-policy'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import type { SessionRepository } from '../../domain/session-repository'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { PasswordHasher, TokenFactory } from '../ports'
import type { SessionEvents } from '../session-events'

export interface SetPasswordDeps {
  staffAccounts: StaffAccountRepository
  passwordTokens: PasswordTokenRepository
  sessions: SessionRepository
  events: SessionEvents
  hasher: PasswordHasher
  factory: TokenFactory
  uow: UnitOfWork
  clock: Clock
}

/**
 * `POST /auth/staff/password` (DOC-26 §4.3): sets the password from an invite or a reset link. The rule is checked first, so a
 * weak password does not burn the link; the link is consumed by one atomic statement; and the status is part of the update, so a
 * person locked or disabled since the link was issued gets `token_invalid` and the link stays unconsumed (DR-150). An invite
 * activates the account; a reset clears the counters and revokes every session (`password_changed`, DR-129).
 */
export class SetPassword {
  constructor(private readonly deps: SetPasswordDeps) {}

  async execute(input: { token: string; password: string }): Promise<void> {
    const { staffAccounts, passwordTokens, sessions, events, hasher, factory, uow, clock } =
      this.deps
    const password = assertPasswordRule(input.password)
    await uow.run(async () => {
      const now = clock.now()
      const link = await passwordTokens.consumeLink(factory.hashOpaque(input.token), now)
      if (!link) throw new TokenInvalidError()
      const expected = link.kind === 'invite' ? 'invited' : 'active'
      const changed = await staffAccounts.setPassword(
        link.staffId,
        await hasher.hash(password),
        expected,
        now,
      )
      // Zero rows: the status moved since the link was issued. The throw rolls back the consume.
      if (!changed) throw new TokenInvalidError()
      if (link.kind === 'reset') {
        const revoked = await sessions.revokeAllOf('staff', link.staffId, 'password_changed', now)
        await events.revoked(revoked, 'password_changed', now)
      }
    })
  }
}
