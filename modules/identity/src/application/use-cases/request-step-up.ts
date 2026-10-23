import type { Clock, IdGenerator, UnitOfWork } from '@core/kernel'
import { NotFoundError, requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StepUpAction } from '../../contracts'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { MailCommands } from '../mail-commands'
import type { RateLimiter, TokenFactory } from '../ports'

const MINUTE_MS = 60_000
const HOUR_SECONDS = 3600
const CODE_DIGITS = 6

/** The three sensitive actions are the Admin's alone (DOC-26 §4.5). */
export const REQUEST_STEP_UP_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/step-up` (DOC-26 §4.5): one token of `stepup:staff:<id>` (5 per hour), then in one transaction the consume of the
 * live code of `(staff, action)`, the new code, and the mail command that carries it encrypted. The stored value is an HMAC bound
 * to the person and the action, so a code for `staff_email` does not open `gateway_config` (DR-132).
 */
export class RequestStepUp {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly passwordTokens: PasswordTokenRepository,
    /** The buckets of authenticated callers, in `platform.rate_bucket` (DOC-26 §6). */
    private readonly limiter: RateLimiter,
    private readonly factory: TokenFactory,
    private readonly mail: MailCommands,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: IdentityConfig,
  ) {}

  async execute(staff: StaffContext, action: StepUpAction): Promise<void> {
    requireRole(staff, REQUEST_STEP_UP_ROLES)
    const { staffAccounts, passwordTokens, limiter, factory, mail, uow, clock, ids, config } = this
    await limiter.take({
      key: `stepup:staff:${staff.staffId}`,
      capacity: config.stepUpRequestsPerHour,
      perSeconds: HOUR_SECONDS,
    })
    await uow.run(async () => {
      const record = await staffAccounts.findById(staff.staffId)
      if (!record) throw new NotFoundError()
      const now = clock.now()
      const expiresAt = new Date(now.getTime() + config.stepUpTtlMinutes * MINUTE_MS)
      const code = factory.digits(CODE_DIGITS)
      await passwordTokens.issueStepUp(
        {
          id: ids.next(),
          buildingId: record.buildingId,
          staffId: record.id,
          action,
          codeHmac: factory.stepUpHmac(record.id, action, code),
          expiresAt,
        },
        now,
      )
      await mail.request(record, 'step_up_code', { secret: code, params: { action }, expiresAt })
    })
  }
}
