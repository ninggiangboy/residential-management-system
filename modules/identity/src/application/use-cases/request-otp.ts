import { isIP } from 'node:net'
import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import { RateLimitedError } from '@core/kernel'
import {
  PhoneInvalidError,
  PhoneNotRegisteredError,
  SmsUnavailableError,
} from '../../domain/errors'
import { OtpChallenge } from '../../domain/otp-challenge'
import type { OtpChallengeRepository } from '../../domain/otp-challenge-repository'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { IdentityConfig } from '../config'
import type { PhoneNumbers, RateLimiter, SmsProviderProbe, TokenFactory } from '../ports'
import type { SmsCommands } from '../sms-commands'

export interface RequestOtpInput {
  phone: string
  ip: string
}

export interface OtpRequested {
  challengeId: string
  /** Seconds before another code may be asked for. */
  resendAfter: number
  /** Seconds the code lives. */
  expiresIn: number
}

const HOUR_SECONDS = 3600
const DAY_MS = 86_400_000
const CODE_DIGITS = 6
const UNIQUE_VIOLATION = '23505'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === UNIQUE_VIOLATION ||
    (error as { cause?: { code?: string } }).cause?.code === UNIQUE_VIOLATION)

/**
 * `POST /auth/otp` (DOC-26 §5.1, DR-134). The order of the checks matters: a refused request spends as little as possible and
 * reveals no more than SDD §7.3 accepts. Every request spends a token of the IP bucket, whatever its outcome; the phone bucket
 * is spent only by a request that is going to issue a code. A demo account gets a real challenge with a hash no one knows and no
 * SMS, so its fixed code is the only way in (§5.3).
 */
export class RequestOtp {
  constructor(
    private readonly phones: PhoneNumbers,
    private readonly residents: ResidentAccountRepository,
    private readonly challenges: OtpChallengeRepository,
    private readonly limiter: RateLimiter,
    private readonly provider: SmsProviderProbe,
    private readonly factory: TokenFactory,
    private readonly sms: SmsCommands,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly config: IdentityConfig,
  ) {}

  async execute(input: RequestOtpInput): Promise<OtpRequested> {
    const {
      phones,
      residents,
      challenges,
      limiter,
      provider,
      factory,
      sms,
      uow,
      clock,
      ids,
      config,
    } = this
    const outcome = (result: string) =>
      this.logger.info(
        { event: 'auth.otp_requested', outcome: result, ip: input.ip },
        'auth.otp_requested',
      )
    const phone = phones.toE164(input.phone)
    if (!phone) throw new PhoneInvalidError()

    // 1. Every request spends one token of the IP bucket, so enumerating phones is throttled too. These tokens are taken outside
    // the transaction below: a refusal is never rolled back with the request.
    await limiter
      .take({
        key: `otp:ip:${input.ip}`,
        capacity: config.otpPerIpPerHour,
        perSeconds: HOUR_SECONDS,
      })
      .catch((error: unknown) => {
        outcome('ip_limited')
        throw error
      })

    // 2. No account that may sign in: no challenge and no SMS (FR-15.1). The enumeration trade-off is accepted (DR-37).
    const account = await residents.findSignInByPhone(phone)
    if (!account) {
      outcome('not_registered')
      throw new PhoneNotRegisteredError()
    }

    // 3. The resend gate spends nothing (FR-15.2).
    const now = clock.now()
    const open = await challenges.findOpen(phone)
    const wait = open ? new OtpChallenge(open).resendWait(now) : 0
    if (wait > 0) {
      outcome('resend_wait')
      throw new RateLimitedError('otp:resend', wait)
    }

    // 4. The phone bucket.
    await limiter
      .take({
        key: `otp:phone:${phone}`,
        capacity: config.otpPerPhonePerHour,
        perSeconds: HOUR_SECONDS,
      })
      .catch((error: unknown) => {
        outcome('phone_limited')
        throw error
      })

    // 5. The provider looks down (a real account only), and 6. the rolling 24-hour cap of the deployment.
    if (!account.isDemo && (await provider.isDown())) {
      outcome('sms_down')
      throw new SmsUnavailableError()
    }
    if ((await challenges.countSince(new Date(now.getTime() - DAY_MS))) >= config.otpDailyCap) {
      this.logger.warn({ event: 'otp_daily_cap_reached' }, 'otp_daily_cap_reached')
      outcome('daily_cap')
      throw new SmsUnavailableError()
    }

    // 7. Issue, in one transaction: the older challenge is spent, the new one inserted, the SMS command written with the code
    // encrypted. The demo account's code is never stored, so its hash is of a value that is drawn and forgotten.
    const challengeId = ids.next()
    const code = factory.digits(CODE_DIGITS)
    const expiresAt = new Date(now.getTime() + config.otpTtlSeconds * 1000)
    try {
      await uow.run(async () => {
        await challenges.issue(
          {
            id: challengeId,
            phone,
            codeHmac: factory.otpHmac(challengeId, code),
            expiresAt,
            resendAfter: new Date(now.getTime() + config.otpResendAfterSeconds * 1000),
            ip: isIP(input.ip.split('/')[0] ?? '') ? input.ip : null,
          },
          now,
        )
        if (!account.isDemo) await sms.request(account, 'otp', { secret: code, expiresAt })
      })
    } catch (error) {
      // Two requests for one phone at the same moment: the partial unique index lets one in; the other waits for a resend.
      if (!isUniqueViolation(error)) throw error
      outcome('resend_wait')
      throw new RateLimitedError('otp:resend', config.otpResendAfterSeconds)
    }
    outcome('issued')
    return {
      challengeId,
      resendAfter: config.otpResendAfterSeconds,
      expiresIn: config.otpTtlSeconds,
    }
  }
}
