import { type Clock, NotFoundError, RateLimitedError } from '@core/kernel'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { ResidentAccount } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { IdentityConfig } from '../config'
import type { RateLimiter } from '../ports'
import type { SmsCommands } from '../sms-commands'

const HOUR_SECONDS = 3600
const INVITATION_TTL_MS = 5 * 60_000

/**
 * `IdentityApi.queueMemberInvitation` (DOC-26 §2.2, DR-137): the SMS that tells a person they were added by an owner. One token of
 * the phone's own bucket `otp:phone:<e164>` is drawn in the caller's transaction, so an empty bucket is 429 and the add rolls
 * back with the account and the profile it created. The command expires in five minutes (a late invitation is useless). The
 * owner's cap of ten a day is `residency`'s. A demo account is sent nothing by the handler.
 */
export class QueueMemberInvitation {
  constructor(
    private readonly residents: ResidentAccountRepository,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsCommands,
    private readonly clock: Clock,
    private readonly config: Pick<IdentityConfig, 'otpPerPhonePerHour'>,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute(accountId: string, params: { unitCode: string }): Promise<void> {
    const record = await this.residents.findById(accountId)
    if (!record || !new ResidentAccount(record).canSignIn) throw new NotFoundError()
    await this.limiter
      .take({
        key: `otp:phone:${record.phone}`,
        capacity: this.config.otpPerPhonePerHour,
        perSeconds: HOUR_SECONDS,
      })
      .catch((error: unknown) => {
        if (error instanceof RateLimitedError)
          this.metrics.inc('member_invitations_total', { outcome: 'phone_bucket' })
        throw error
      })
    await this.sms.request(record, 'member_invitation', {
      params: { unitCode: params.unitCode },
      expiresAt: new Date(this.clock.now().getTime() + INVITATION_TTL_MS),
    })
    this.metrics.inc('member_invitations_total', { outcome: 'queued' })
  }
}
