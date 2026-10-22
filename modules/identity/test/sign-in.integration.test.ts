import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DomainError, LockedError, RateLimitedError } from '@core/kernel'
import { InvalidCredentialsError } from '../src/domain/errors'
import { createHarness, type Harness, PASSWORD } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const failure = async (promise: Promise<unknown>): Promise<DomainError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof DomainError) return error
    throw error
  }
  throw new Error('expected a failure')
}

describe('staff sign-in (DOC-26 §4.1)', () => {
  test('a right password opens one session and answers the profile and the tokens', async () => {
    const staff = await h.seedStaff({ role: 'manager', fullName: 'Lê Minh' })
    const result = await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.1' })
    expect(result.staff).toMatchObject({
      id: staff.id,
      fullName: 'Lê Minh',
      role: 'manager',
      buildingId: staff.buildingId,
    })
    expect(result.session.expiresIn).toBe(900)
    expect(result.session.refreshToken.length).toBeGreaterThan(30)
    const claims = await h.identity.verifier.verify(result.session.accessToken)
    expect(claims).toMatchObject({
      sub: staff.id,
      kind: 'staff',
      role: 'manager',
      bid: staff.buildingId,
    })
    const families = await h.db
      .sql`SELECT kind, building_id, client FROM identity.refresh_family WHERE account_id = ${staff.id}`
    expect(families).toHaveLength(1)
    expect(families[0]).toMatchObject({ kind: 'staff', client: 'app' })
    expect((await h.row(staff.id))?.last_login_at).not.toBeNull()
  })

  test('AU-01: 20 parallel wrong passwords leave 5 failures and a 15-minute lock, and none errors with 500', async () => {
    const staff = await h.seedStaff()
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        h.signIn(staff.email, 'wrong-password-1', { ip: '198.51.100.2' }),
      ),
    )
    const errors = results.map((r) => (r.status === 'rejected' ? r.reason : null))
    expect(errors.every((e) => e instanceof DomainError)).toBe(true)
    // The attempts that counted 1 to 4 see 401; the fifth locks the account and is the first to see 423.
    expect(errors.filter((e) => e instanceof InvalidCredentialsError)).toHaveLength(4)
    expect(errors.filter((e) => e instanceof LockedError)).toHaveLength(16)
    const row = await h.row(staff.id)
    expect(row?.failed_attempts).toBe(5)
    expect(new Date(row?.locked_until).getTime() - h.clock.now().getTime()).toBe(15 * 60_000)
  })

  test('AU-02: the right password during the lock is 423 with retryAfter, and Argon2 is not called', async () => {
    const staff = await h.seedStaff({
      failedAttempts: 5,
      lockedUntil: new Date(h.clock.now().getTime() + 600_000),
    })
    const before = h.hasher.verifies
    const error = await failure(h.signIn(staff.email, PASSWORD, { ip: '198.51.100.3' }))
    expect(error).toBeInstanceOf(LockedError)
    expect(error.retryAfterSeconds).toBe(600)
    expect(error.details).toEqual({ retryAfter: 600 })
    expect(h.hasher.verifies).toBe(before)
  })

  test('AU-03: the first wrong password after the lock ended counts 1 and clears the lock', async () => {
    const staff = await h.seedStaff({
      failedAttempts: 5,
      lockedUntil: new Date(h.clock.now().getTime() + 15 * 60_000),
    })
    h.clock.advance(15 * 60_000 + 1000)
    const error = await failure(h.signIn(staff.email, 'wrong-password-1', { ip: '198.51.100.4' }))
    expect(error).toBeInstanceOf(InvalidCredentialsError)
    const row = await h.row(staff.id)
    expect(row?.failed_attempts).toBe(1)
    expect(row?.locked_until).toBeNull()
  })

  test('AU-04: the 31st attempt of one IP in 15 minutes is 429 with Retry-After, whatever the email', async () => {
    const ip = '198.51.100.5'
    for (let attempt = 0; attempt < 30; attempt++) {
      const error = await failure(h.signIn(`nobody${attempt}@sunrise.example`, PASSWORD, { ip }))
      expect(error).toBeInstanceOf(InvalidCredentialsError)
    }
    const error = await failure(h.signIn('nobody31@sunrise.example', PASSWORD, { ip }))
    expect(error).toBeInstanceOf(RateLimitedError)
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  test('AU-09: a wrong password and an unknown email give the same answer, and each costs one Argon2 check', async () => {
    const staff = await h.seedStaff()
    const verifies = h.hasher.verifies
    const dummies = h.hasher.dummies
    const wrong = await failure(h.signIn(staff.email, 'wrong-password-1', { ip: '198.51.100.6' }))
    expect(h.hasher.verifies).toBe(verifies + 1)
    expect(h.hasher.dummies).toBe(dummies)
    const unknown = await failure(
      h.signIn('nobody@sunrise.example', 'wrong-password-1', { ip: '198.51.100.6' }),
    )
    expect(h.hasher.dummies).toBe(dummies + 1)
    expect(h.hasher.verifies).toBe(verifies + 1)
    for (const error of [wrong, unknown]) {
      expect(error).toBeInstanceOf(InvalidCredentialsError)
      expect([error.code, error.kind, error.message, error.details]).toEqual([
        wrong.code,
        wrong.kind,
        wrong.message,
        wrong.details,
      ])
    }
  })

  test('AU-10: an invited, a manually locked and a disabled account answer 401 with the right password, and no counter moves', async () => {
    for (const status of ['invited', 'locked', 'disabled'] as const) {
      const staff = await h.seedStaff({ status })
      const error = await failure(
        h.signIn(staff.email, staff.password ?? PASSWORD, { ip: '198.51.100.7' }),
      )
      expect(error, status).toBeInstanceOf(InvalidCredentialsError)
      const row = await h.row(staff.id)
      expect(row?.failed_attempts, status).toBe(0)
      expect(row?.locked_until, status).toBeNull()
    }
  })

  test('AU-11: a hash with older Argon2 parameters signs in and is stored again with the configured ones', async () => {
    const old = await Bun.password.hash(PASSWORD, {
      algorithm: 'argon2id',
      memoryCost: 4096,
      timeCost: 1,
    })
    expect(old).toContain('m=4096,t=1')
    const staff = await h.seedStaff({ passwordHash: old })
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.8' })
    const stored = String((await h.row(staff.id))?.password_hash)
    expect(stored).toContain('m=256,t=1')
    // …and the new hash still verifies.
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.8' })
  })

  test('the email is case-insensitive', async () => {
    const staff = await h.seedStaff({ email: 'Minh.Le@Sunrise.example' })
    await h.signIn('minh.le@SUNRISE.example', PASSWORD, { ip: '198.51.100.9' })
    expect(staff.id).toBeTruthy()
  })
})
