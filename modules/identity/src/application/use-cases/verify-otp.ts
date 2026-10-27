import type { Clock, Log, UnitOfWork } from '@core/kernel'
import { decide } from '@core/kernel'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { OtpInvalidError } from '../../domain/errors'
import { DEMO_FIXED_OTP, OtpChallenge } from '../../domain/otp-challenge'
import type { OtpChallengeRepository } from '../../domain/otp-challenge-repository'
import { ResidentAccount, type ResidentAccountRecord } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { IdentityConfig } from '../config'
import type { ActiveMembership, ActiveMemberships, TokenFactory } from '../ports'
import type { IssuedSession, SessionIssuer } from '../session-issuer'

export interface VerifyOtpInput {
  challengeId: string
  code: string
  userAgent: string | null
  ip: string
}

/** The answer of DOC-26 §3.4: the session, the account, and the active memberships (empty: no unit is linked yet, UC-14 E7). */
export interface ResidentSignIn {
  session: IssuedSession
  account: ResidentProfile
  memberships: ActiveMembership[]
}

/** The `account` object of the sign-in answer and of `GET /me` (DOC-26 §3.4). */
export interface ResidentProfile {
  id: string
  phone: string
  displayName: string | null
  language: ResidentAccountRecord['language']
  pushEnabled: boolean
}

export const toResidentProfile = (account: ResidentAccountRecord): ResidentProfile => ({
  id: account.id,
  phone: account.phone,
  displayName: account.displayName,
  language: account.language,
  pushEnabled: account.pushEnabled,
})

/** `expired`: the challenge is unknown, spent or past its time; the answer is the same as for a wrong code (FR-15.3), the metric is not. */
type Outcome =
  | { signedIn: true; value: ResidentSignIn }
  | { signedIn: false; attemptsLeft: number; expired?: true }
const EXPIRED = { signedIn: false, attemptsLeft: 0, expired: true } as const

/**
 * `POST /auth/otp/verify` (DOC-26 §5.2). One transaction: the right code is spent by one guarded statement and the session is
 * created with it, so a code is consumed only if the session exists and two taps on "verify" sign in once. A wrong code is
 * counted by the challenge and committed, and the answer 400 `otp_invalid` is thrown after the commit, so the count is not rolled
 * back with the exception (DOC-12 §8.1). Every wrong code is counted: a lost race loads the challenge again and decides on what
 * the winner left, so five guesses in parallel are five tries (DR-255 item 3).
 */
export class VerifyOtp {
  constructor(
    private readonly challenges: OtpChallengeRepository,
    private readonly residents: ResidentAccountRepository,
    private readonly memberships: ActiveMemberships,
    private readonly issuer: SessionIssuer,
    private readonly factory: TokenFactory,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: Log,
    private readonly config: IdentityConfig,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute(input: VerifyOtpInput): Promise<ResidentSignIn> {
    const outcome = await this.uow.run(() => this.verify(input))
    const log = (result: 'ok' | 'invalid' | 'expired' | 'exhausted') => {
      this.metrics.inc('auth_otp_verify_total', { outcome: result })
      this.logger.info(
        { event: 'auth.otp_verified', outcome: result, ip: input.ip },
        'auth.otp_verified',
      )
    }
    if (outcome.signedIn) {
      log('ok')
      return outcome.value
    }
    log(outcome.expired ? 'expired' : outcome.attemptsLeft === 0 ? 'exhausted' : 'invalid')
    throw new OtpInvalidError(outcome.attemptsLeft)
  }

  private async verify(input: VerifyOtpInput): Promise<Outcome> {
    const { challenges, residents, memberships, factory, clock, config } = this
    const outcome = await decide<Outcome>(async () => {
      const now = clock.now()
      const record = await challenges.findById(input.challengeId)
      // Unknown, expired and used challenges answer alike, with no tries left (FR-15.3).
      if (!record) return { done: true, value: EXPIRED }
      const challenge = new OtpChallenge(record)
      if (!challenge.isLive(now)) return { done: true, value: EXPIRED }

      const account = await residents.findSignInByPhone(record.phone)
      if (!account) return { done: true, value: EXPIRED }

      // The fixed code goes through its own statement, which checks the flag again; every other code, and every account that is
      // not flagged, goes through the ordinary one (DOC-26 §5.3).
      const demo = input.code === DEMO_FIXED_OTP && account.isDemo
      const spend = demo
        ? challenge.verifyDemo(now)
        : challenge.verify(factory.otpHmac(record.id, input.code), now)
      if (spend) {
        if (!(await (demo ? challenges.applyDemo(spend) : challenges.apply(spend))))
          return { done: false }
        return { done: true, value: await this.signIn(account, now, input.userAgent) }
      }

      const count = challenge.countFailure(now, config.otpMaxAttempts)
      if (!count) return { done: true, value: { signedIn: false, attemptsLeft: 0 } }
      if (!(await challenges.apply(count))) return { done: false }
      const left = Math.max(0, config.otpMaxAttempts - (count.set.attempts ?? 0))
      return { done: true, value: { signedIn: false, attemptsLeft: left } }
    })
    if (!outcome.signedIn) return outcome
    // Read after the session exists and in the same transaction, so a failure rolls the code back with it.
    const active = await memberships.listActive(outcome.value.account.id)
    return { signedIn: true, value: { ...outcome.value, memberships: active } }
  }

  private async signIn(
    record: ResidentAccountRecord,
    now: Date,
    userAgent: string | null,
  ): Promise<Outcome> {
    const { residents, issuer } = this
    const session = await issuer.openResidentSession(record, { userAgent })
    const opened = new ResidentAccount(record).appOpened(now)
    if (opened) await residents.apply(opened, now)
    return {
      signedIn: true,
      value: { session, account: toResidentProfile(record), memberships: [] },
    }
  }
}
