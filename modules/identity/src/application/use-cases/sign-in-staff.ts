import type { Clock, Log, UnitOfWork } from '@core/kernel'
import { LockedError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import { type CounterLabels, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { InvalidCredentialsError } from '../../domain/errors'
import { normalizePassword } from '../../domain/password-policy'
import type { Client } from '../../domain/refresh-family'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { FailureCounter } from '../failure-counter'
import type { PasswordHasher, RateLimiter } from '../ports'
import type { IssuedSession, SessionIssuer } from '../session-issuer'
import { type StaffProfile, toStaffProfile } from '../staff-dto'

export interface StaffSignInInput {
  email: string
  password: string
  client: Client
  ip: string
  userAgent: string | null
}

export interface StaffSignInResult {
  session: IssuedSession
  staff: StaffProfile
}

const FIFTEEN_MINUTES = 900

/**
 * Staff sign-in by email and password (DOC-26 §4.1, DR-128): the IP bucket, one answer for every credential failure, a dummy
 * Argon2 verify so an unknown email costs the same, the lockout counted by `StaffAccount.recordFailure`, and a session on success. A sign-in writes no
 * audit row (FR-37 covers mutations); it writes the log line `auth.staff_login` with the outcome, never the email or password.
 */
export class SignInStaff {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly failures: FailureCounter,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly building: Pick<BuildingApi, 'getSettings'>,
    private readonly issuer: SessionIssuer,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: Log,
    private readonly config: IdentityConfig,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute(input: StaffSignInInput): Promise<StaffSignInResult> {
    const {
      staffAccounts,
      failures,
      hasher,
      limiter,
      building,
      issuer,
      uow,
      clock,
      logger,
      config,
      metrics,
    } = this
    const outcome = (
      result: CounterLabels['auth_staff_login_total']['outcome'],
      staffId?: string,
    ) => {
      metrics.inc('auth_staff_login_total', { outcome: result })
      logger.info(
        { event: 'auth.staff_login', outcome: result, staffId, ip: input.ip },
        'auth.staff_login',
      )
    }

    // 1. Every attempt spends a token of the IP bucket, successful or not. It is not part of any transaction below.
    await limiter
      .take({
        key: `staff-login:ip:${input.ip}`,
        capacity: config.staffLoginPerIp,
        perSeconds: FIFTEEN_MINUTES,
      })
      .catch((error: unknown) => {
        outcome('rate_limited')
        throw error
      })

    const password = normalizePassword(input.password)
    const now = clock.now()
    const record = await staffAccounts.findByEmail(input.email)
    const account = record ? new StaffAccount(record) : null

    // 3. Unknown email, `invited`, manually `locked`, `disabled`: the same answer after the same kind of work.
    if (!record || !account?.canSignIn || record.passwordHash === null) {
      await hasher.dummyVerify(password)
      outcome('invalid', record?.id)
      throw new InvalidCredentialsError()
    }

    // 4. A temporary lock refuses even the right password, without checking it.
    const lockedFor = account.lockedSeconds(now)
    if (lockedFor > 0) {
      outcome('locked', record.id)
      throw new LockedError(lockedFor)
    }

    // 5 and 6. A wrong password is counted by the aggregate and one guarded statement, so 20 parallel attempts leave 5 failures.
    if (!(await hasher.verify(password, record.passwordHash))) {
      const { lockout } = await building.getSettings(record.buildingId)
      const counted = await failures.count(record.id, lockout, now)
      if (counted && counted.lockedSeconds > 0) {
        metrics.inc('auth_lockouts_total')
        outcome('locked', record.id)
        throw new LockedError(counted.lockedSeconds)
      }
      outcome('invalid', record.id)
      throw new InvalidCredentialsError()
    }

    // 7. The right password: clear the counters (rehash when the parameters changed) and open the session, in one transaction.
    const rehashed = hasher.needsRehash(record.passwordHash)
      ? await hasher.hash(password)
      : undefined
    const session = await uow.run(async () => {
      // Zero rows: the account was disabled or its password changed since it was read; the sign-in fails like any other.
      if (!(await staffAccounts.apply(account.signedIn(now, rehashed), now)))
        throw new InvalidCredentialsError()
      return issuer.openStaffSession(record, { client: input.client, userAgent: input.userAgent })
    })
    outcome('ok', record.id)
    return { session, staff: toStaffProfile(record) }
  }
}
