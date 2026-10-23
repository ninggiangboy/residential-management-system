import { describe, expect, test } from 'bun:test'
import { ForbiddenError } from '@core/kernel'
import { InvalidStaffTransitionError, StaffSelfActionError, TokenInvalidError } from './errors'
import { StaffAccount, type StaffAccountRecord } from './staff-account'

const NOW = new Date('2026-10-23T08:00:00Z')
const LOCKOUT = { maxAttempts: 5, minutes: 15 }

const account = (over: Partial<StaffAccountRecord> = {}) =>
  new StaffAccount({
    id: 's1',
    buildingId: 'b1',
    email: 'a@example.com',
    fullName: 'A',
    role: 'admin',
    status: 'active',
    passwordHash: 'hash',
    failedAttempts: 0,
    lockedUntil: null,
    language: 'en',
    pushEnabled: true,
    avatarKey: null,
    lastLoginAt: null,
    createdAt: new Date('2026-08-03T02:00:00Z'),
    version: 3,
    ...over,
  })

describe('StaffAccount.recordFailure', () => {
  test('counts a wrong password and guards on the counters it read', () => {
    const outcome = account({ failedAttempts: 2 }).recordFailure(LOCKOUT, NOW)
    expect(outcome.failedAttempts).toBe(3)
    expect(outcome.lockedSeconds).toBe(0)
    expect(outcome.transition).toEqual({
      id: 's1',
      expect: { failedAttempts: 2, lockedUntil: null },
      set: { failedAttempts: 3, lockedUntil: null },
    })
  })

  test('the fifth wrong password locks for the lockout minutes', () => {
    const outcome = account({ failedAttempts: 4 }).recordFailure(LOCKOUT, NOW)
    expect(outcome.lockedSeconds).toBe(900)
    expect(outcome.transition?.set.lockedUntil).toEqual(new Date(NOW.getTime() + 15 * 60_000))
  })

  test('a lock still running counts nothing', () => {
    const until = new Date(NOW.getTime() + 60_000)
    const outcome = account({ failedAttempts: 5, lockedUntil: until }).recordFailure(LOCKOUT, NOW)
    expect(outcome.transition).toBeNull()
    expect(outcome.lockedSeconds).toBe(60)
    expect(outcome.failedAttempts).toBe(5)
  })

  test('an expired lock starts a new count at 1', () => {
    const until = new Date(NOW.getTime() - 1000)
    const outcome = account({ failedAttempts: 5, lockedUntil: until }).recordFailure(LOCKOUT, NOW)
    expect(outcome.failedAttempts).toBe(1)
    expect(outcome.transition?.set).toEqual({ failedAttempts: 1, lockedUntil: null })
    expect(outcome.transition?.expect).toEqual({ failedAttempts: 5, lockedUntil: until })
  })
})

describe('StaffAccount.signedIn', () => {
  test('clears the counters and stamps the login', () => {
    const t = account({ failedAttempts: 3 }).signedIn(NOW)
    expect(t.set).toEqual({ failedAttempts: 0, lockedUntil: null, lastLoginAt: NOW })
    expect(t.expect).toEqual({ status: 'active' })
  })

  test('a rehash replaces only the hash that was verified', () => {
    const t = account().signedIn(NOW, 'new')
    expect(t.set.passwordHash).toBe('new')
    expect(t.expect.passwordHash).toBe('hash')
  })
})

describe('StaffAccount.setPassword', () => {
  test('an invite activates an invited account and bumps the version', () => {
    const t = account({ status: 'invited', passwordHash: null }).setPassword('h', 'invite')
    expect(t.expect).toEqual({ status: 'invited', version: 3 })
    expect(t.set).toMatchObject({ passwordHash: 'h', status: 'active', version: 4 })
  })

  test('a reset needs an active account', () => {
    expect(() => account({ status: 'locked' }).setPassword('h', 'reset')).toThrow(TokenInvalidError)
    expect(() => account({ status: 'invited' }).setPassword('h', 'reset')).toThrow(
      TokenInvalidError,
    )
  })

  test('an invite for an account that is no longer invited is refused', () => {
    expect(() => account({ status: 'disabled' }).setPassword('h', 'invite')).toThrow(
      TokenInvalidError,
    )
  })
})

describe('StaffAccount administration (DOC-26 §4.4)', () => {
  const admin = { staffId: 'admin-1', role: 'admin' } as const
  const manager = { staffId: 'manager-1', role: 'manager' } as const

  test('a Manager touches only a Technician or a Guard; an Admin anyone', () => {
    expect(() => account({ role: 'guard' }).lock(manager)).not.toThrow()
    expect(() => account({ role: 'technician' }).lock(manager)).not.toThrow()
    expect(() => account({ role: 'admin' }).lock(manager)).toThrow(ForbiddenError)
    expect(() => account({ role: 'manager' }).lock(manager)).toThrow(ForbiddenError)
    expect(() => account({ role: 'manager' }).lock(admin)).not.toThrow()
  })

  test('nobody changes their own account: the refusal names "self" before the role rule', () => {
    const self = account({ id: 'manager-1', role: 'manager' })
    for (const act of [
      () => self.lock(manager),
      () => self.disable(manager),
      () => self.edit(manager, { role: 'guard' }),
    ])
      expect(act).toThrow(StaffSelfActionError)
  })

  test('lock guards the status and the version it read, and moves the version', () => {
    const t = account({ role: 'guard' }).lock(admin)
    expect(t.expect).toEqual({ status: 'active', version: 3 })
    expect(t.set).toEqual({ status: 'locked', version: 4 })
    expect(() => account({ status: 'locked' }).lock(admin)).toThrow(InvalidStaffTransitionError)
    expect(() => account({ status: 'invited' }).lock(admin)).toThrow(InvalidStaffTransitionError)
  })

  test('unlock lifts a manual lock and a running lockout, nothing else', () => {
    expect(account({ status: 'locked' }).unlock(admin, NOW).set).toMatchObject({
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
    })
    const until = new Date(NOW.getTime() + 60_000)
    expect(account({ lockedUntil: until, failedAttempts: 5 }).unlock(admin, NOW).set.status).toBe(
      'active',
    )
    expect(() => account({ lockedUntil: new Date(NOW.getTime() - 1) }).unlock(admin, NOW)).toThrow(
      InvalidStaffTransitionError,
    )
    expect(() => account({ status: 'disabled' }).unlock(admin, NOW)).toThrow(
      InvalidStaffTransitionError,
    )
  })

  test('disable from invited, active and locked; enable returns invited without a password', () => {
    for (const status of ['invited', 'active', 'locked'] as const)
      expect(account({ status, passwordHash: 'h' }).disable(admin).set.status).toBe('disabled')
    expect(() => account({ status: 'disabled' }).disable(admin)).toThrow(
      InvalidStaffTransitionError,
    )
    expect(account({ status: 'disabled' }).enable(admin).set.status).toBe('active')
    expect(account({ status: 'disabled', passwordHash: null }).enable(admin).set.status).toBe(
      'invited',
    )
    expect(() => account({ status: 'active' }).enable(admin)).toThrow(InvalidStaffTransitionError)
  })

  test('edit: a Manager may change the name and language only; no change decides nothing', () => {
    const guard = (over: Partial<StaffAccountRecord> = {}) => account({ role: 'guard', ...over })
    expect(guard().edit(manager, { fullName: 'B' })?.set).toEqual({ fullName: 'B', version: 4 })
    expect(() => guard().edit(manager, { email: 'x@example.com' })).toThrow(ForbiddenError)
    expect(() => guard().edit(manager, { role: 'technician' })).toThrow(ForbiddenError)
    expect(guard({ fullName: 'A' }).edit(admin, { fullName: 'A', language: 'en' })).toBeNull()
    // The same address in another case is the same address (citext).
    expect(guard({ email: 'a@example.com' }).edit(admin, { email: 'A@Example.com' })).toBeNull()
    expect(guard().edit(admin, { role: 'technician' })?.set.role).toBe('technician')
  })

  test('only an active Admin counts for the last-Admin rule', () => {
    expect(account({ role: 'admin' }).isActiveAdmin).toBe(true)
    expect(account({ role: 'admin', status: 'locked' }).isActiveAdmin).toBe(false)
    expect(account({ role: 'manager' }).isActiveAdmin).toBe(false)
  })
})
