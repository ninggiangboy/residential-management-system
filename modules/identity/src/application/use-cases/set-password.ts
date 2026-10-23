import type { Clock, UnitOfWork } from '@core/kernel'
import { decide } from '@core/kernel'
import { TokenInvalidError } from '../../domain/errors'
import { assertPasswordRule } from '../../domain/password-policy'
import { type LinkKind, PasswordToken } from '../../domain/password-token'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import type { SessionRepository } from '../../domain/session-repository'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { PasswordHasher, TokenFactory } from '../ports'
import type { SessionEvents } from '../session-events'

/**
 * `POST /auth/staff/password` (DOC-26 §4.3): sets the password from an invite or a reset link. The rule is checked first, so a
 * weak password does not burn the link; the link is spent by one guarded statement; and the aggregate checks the status and the update guards it, so a
 * person locked or disabled since the link was issued gets `token_invalid` and the link stays unconsumed (DR-150). An invite
 * activates the account; a reset clears the counters and revokes every session (`password_changed`, DR-129).
 */
export class SetPassword {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly passwordTokens: PasswordTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly hasher: PasswordHasher,
    private readonly factory: TokenFactory,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { token: string; password: string }): Promise<void> {
    const { staffAccounts, passwordTokens, sessions, events, hasher, factory, uow, clock } = this
    const password = assertPasswordRule(input.password)
    await uow.run(async () => {
      const now = clock.now()
      const found = await passwordTokens.findLink(factory.hashOpaque(input.token))
      const spend = found ? new PasswordToken(found).consumeLink(now) : null
      // An unknown, expired or used link, or one used in parallel, answers the same.
      if (!found || !spend || !(await passwordTokens.apply(spend))) throw new TokenInvalidError()
      const link = { staffId: found.staffId, kind: found.kind as LinkKind }
      const passwordHash = await hasher.hash(password)
      // The aggregate refuses a status that moved since the link was issued (DR-150); a version that moved is read again.
      await decide(async () => {
        const record = await staffAccounts.findById(link.staffId)
        if (!record) throw new TokenInvalidError()
        const transition = new StaffAccount(record).setPassword(passwordHash, link.kind)
        return (await staffAccounts.apply(transition, now))
          ? { done: true, value: undefined }
          : { done: false }
      })
      if (link.kind === 'reset') {
        const revoked = await sessions.revokeAllOf('staff', link.staffId, 'password_changed', now)
        await events.revoked(revoked, 'password_changed', now)
      }
    })
  }
}
