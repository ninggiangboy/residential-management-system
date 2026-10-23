import { describe, expect, test } from 'bun:test'
import { TokenInvalidError } from './errors'
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
