import { describe, expect, test } from 'bun:test'
import { OtpChallenge, type OtpChallengeRecord } from './otp-challenge'

const NOW = new Date('2026-10-23T08:00:00Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)

const challenge = (over: Partial<OtpChallengeRecord> = {}) =>
  new OtpChallenge({
    id: 'c1',
    phone: '+84901234567',
    codeHmac: 'h',
    expiresAt: at(300_000),
    resendAfter: at(45_000),
    attempts: 0,
    consumedAt: null,
    ...over,
  })

describe('OtpChallenge', () => {
  test('the right code spends the challenge once and guards on its being unspent', () => {
    expect(challenge().verify('h', NOW)).toEqual({
      id: 'c1',
      expect: { consumedAt: null },
      set: { consumedAt: NOW },
    })
  })

  test('a wrong code, a used challenge and an expired one have nothing to spend', () => {
    expect(challenge().verify('other', NOW)).toBeNull()
    expect(challenge({ consumedAt: at(-1) }).verify('h', NOW)).toBeNull()
    expect(challenge({ expiresAt: NOW }).verify('h', NOW)).toBeNull()
    expect(challenge({ expiresAt: at(1000) }).verify('h', at(1000))).toBeNull()
  })

  test('the fixed demo code spends a live challenge whatever the hash, and nothing else', () => {
    expect(challenge().verifyDemo(NOW)?.set).toEqual({ consumedAt: NOW })
    expect(challenge({ consumedAt: at(-1) }).verifyDemo(NOW)).toBeNull()
    expect(challenge({ expiresAt: at(-1) }).verifyDemo(NOW)).toBeNull()
  })

  test('a wrong code counts one try and guards on the count it read', () => {
    expect(challenge({ attempts: 2 }).countFailure(NOW, 5)).toEqual({
      id: 'c1',
      expect: { consumedAt: null, attempts: 2 },
      set: { attempts: 3, consumedAt: null },
    })
  })

  test('the last try spends the challenge, and a spent or expired one counts nothing', () => {
    expect(challenge({ attempts: 4 }).countFailure(NOW, 5)?.set).toEqual({
      attempts: 5,
      consumedAt: NOW,
    })
    expect(challenge({ consumedAt: at(-1) }).countFailure(NOW, 5)).toBeNull()
    expect(challenge({ expiresAt: at(-1) }).countFailure(NOW, 5)).toBeNull()
  })

  test('the tries left are 5 minus the count while the challenge is live, and 0 after', () => {
    expect(challenge().attemptsLeft(NOW, 5)).toBe(5)
    expect(challenge({ attempts: 3 }).attemptsLeft(NOW, 5)).toBe(2)
    expect(challenge({ attempts: 5, consumedAt: NOW }).attemptsLeft(NOW, 5)).toBe(0)
    expect(challenge({ expiresAt: at(-1) }).attemptsLeft(NOW, 5)).toBe(0)
  })

  test('another code may be asked for 45 seconds after the last; the wait counts up to the next whole second', () => {
    expect(challenge().resendWait(NOW)).toBe(45)
    expect(challenge().resendWait(at(30_000))).toBe(15)
    expect(challenge().resendWait(at(30_500))).toBe(15)
    expect(challenge().resendWait(at(45_000))).toBe(0)
    expect(challenge({ consumedAt: at(-1) }).resendWait(NOW)).toBe(0)
  })
})
