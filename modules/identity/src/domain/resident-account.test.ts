import { describe, expect, test } from 'bun:test'
import { ResidentAccount, type ResidentAccountRecord } from './resident-account'

const NOW = new Date('2026-10-23T08:00:00Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)

const account = (over: Partial<ResidentAccountRecord> = {}) =>
  new ResidentAccount({
    id: 'r1',
    phone: '+84901234567',
    displayName: 'Trần Thị Hoa',
    language: 'vi',
    pushEnabled: true,
    status: 'active',
    isDemo: false,
    lastAppOpenAt: null,
    version: 1,
    ...over,
  })

describe('ResidentAccount', () => {
  test('an account that asked for its deletion is still usable; a deleted one is not', () => {
    expect(account().canSignIn).toBe(true)
    expect(account({ status: 'deletion_requested' }).canSignIn).toBe(true)
    expect(account({ status: 'deleted' }).canSignIn).toBe(false)
  })

  test('the first open of the app stamps the account and guards on there being no stamp', () => {
    expect(account().appOpened(NOW)).toEqual({
      id: 'r1',
      expect: { lastAppOpenAt: null },
      set: { lastAppOpenAt: NOW },
    })
  })

  test('AU-54: the stamp is written at most once an hour', () => {
    const opened = account({ lastAppOpenAt: NOW })
    expect(opened.appOpened(at(30 * 60_000))).toBeNull()
    expect(opened.appOpened(at(59 * 60_000 + 59_000))).toBeNull()
    expect(opened.appOpened(at(60 * 60_000))).toEqual({
      id: 'r1',
      expect: { lastAppOpenAt: NOW },
      set: { lastAppOpenAt: at(60 * 60_000) },
    })
  })
})
