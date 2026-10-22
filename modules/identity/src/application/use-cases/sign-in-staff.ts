import type { Clock, Log, UnitOfWork } from '@core/kernel'
import { LockedError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import { InvalidCredentialsError } from '../../domain/errors'
import { normalizePassword } from '../../domain/password-policy'
import type { Client } from '../../domain/session-repository'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
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

export interface SignInStaffDeps {
  staffAccounts: StaffAccountRepository
  hasher: PasswordHasher
  limiter: RateLimiter
  building: Pick<BuildingApi, 'getSettings'>
  issuer: SessionIssuer
  uow: UnitOfWork
  clock: Clock
  logger: Log
  config: IdentityConfig
}

const FIFTEEN_MINUTES = 900

/**
 * Staff sign-in by email and password (DOC-26 §4.1, DR-128): the IP bucket, one answer for every credential failure, a dummy
 * Argon2 verify so an unknown email costs the same, the lockout as one statement, and a session on success. A sign-in writes no
 * audit row (FR-37 covers mutations); it writes the log line `auth.staff_login` with the outcome, never the email or password.
 */
export class SignInStaff {
  constructor(private readonly deps: SignInStaffDeps) {}

  async execute(input: StaffSignInInput): Promise<StaffSignInResult> {
    const { staffAccounts, hasher, limiter, building, issuer, uow, clock, logger, config } =
      this.deps
    const outcome = (result: string, staffId?: string) =>
      logger.info(
        { event: 'auth.staff_login', outcome: result, staffId, ip: input.ip },
        'auth.staff_login',
      )

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

    // 5 and 6. A wrong password is counted by one statement, so 20 parallel attempts leave 5 failures.
    if (!(await hasher.verify(password, record.passwordHash))) {
      const { lockout } = await building.getSettings(record.buildingId)
      const counted = await staffAccounts.recordFailureByEmail(record.email, lockout, now)
      if (counted === null || (counted.lockedUntil !== null && counted.lockedUntil > now)) {
        const fresh = await staffAccounts.findById(record.id)
        const seconds = fresh ? new StaffAccount(fresh).lockedSeconds(now) : 0
        outcome('locked', record.id)
        throw new LockedError(Math.max(seconds, 1))
      }
      outcome('invalid', record.id)
      throw new InvalidCredentialsError()
    }

    // 7. The right password: clear the counters (rehash when the parameters changed) and open the session, in one transaction.
    const rehashed = hasher.needsRehash(record.passwordHash)
      ? await hasher.hash(password)
      : undefined
    const session = await uow.run(async () => {
      await staffAccounts.markSignedIn(record.id, now, rehashed)
      return issuer.openStaffSession(record, { client: input.client, userAgent: input.userAgent })
    })
    outcome('ok', record.id)
    return { session, staff: toStaffProfile(record) }
  }
}
