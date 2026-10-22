import type { Clock, IdGenerator, UnitOfWork } from '@core/kernel'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { MailCommands } from '../mail-commands'
import type { Delay, RateLimiter, TokenFactory } from '../ports'

const MINUTE_MS = 60_000
const HOUR_SECONDS = 3600

export interface RequestPasswordResetDeps {
  staffAccounts: StaffAccountRepository
  passwordTokens: PasswordTokenRepository
  limiter: RateLimiter
  factory: TokenFactory
  mail: MailCommands
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  config: IdentityConfig
  delay: Delay
}

/**
 * `POST /auth/staff/password-reset` (DOC-26 §4.3). It answers the same for a known and an unknown email and takes the same
 * time class for each: the two buckets are keyed by the input, not by whether the account exists, so a 429 reveals nothing, and
 * the answer waits for `RESET_MIN_RESPONSE_MS` so the path that writes and the path that does not look alike (DR-150, FI-16).
 * Only an `active` account gets a link; an invited, locked or disabled one gets nothing (FR-13.4).
 */
export class RequestPasswordReset {
  constructor(private readonly deps: RequestPasswordResetDeps) {}

  async execute(input: { email: string; ip: string }): Promise<void> {
    const { config, limiter, delay } = this.deps
    const began = performance.now()
    await limiter.take({
      key: `reset:email:${input.email.toLowerCase()}`,
      capacity: config.resetPerEmailPerHour,
      perSeconds: HOUR_SECONDS,
    })
    await limiter.take({
      key: `reset:ip:${input.ip}`,
      capacity: config.resetPerIpPerHour,
      perSeconds: HOUR_SECONDS,
    })
    await this.issueIfActive(input.email)
    const remaining = config.resetMinResponseMs - (performance.now() - began)
    if (remaining > 0) await delay(remaining)
  }

  private async issueIfActive(email: string): Promise<void> {
    const { staffAccounts, passwordTokens, factory, mail, uow, clock, ids, config } = this.deps
    const record = await staffAccounts.findByEmail(email)
    if (!record || !new StaffAccount(record).canSignIn) return
    await uow.run(async () => {
      const now = clock.now()
      const expiresAt = new Date(now.getTime() + config.resetTtlMinutes * MINUTE_MS)
      const link = factory.opaque()
      await passwordTokens.issueLink(
        {
          id: ids.next(),
          buildingId: record.buildingId,
          staffId: record.id,
          kind: 'reset',
          tokenHash: link.hash,
          expiresAt,
        },
        now,
      )
      await mail.request(record, 'password_reset', { secret: link.token, expiresAt })
    })
  }
}
