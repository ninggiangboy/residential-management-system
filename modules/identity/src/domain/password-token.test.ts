import { describe, expect, test } from 'bun:test'
import { PasswordToken, type PasswordTokenRecord } from './password-token'

const NOW = new Date('2026-10-23T08:00:00Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)

const token = (over: Partial<PasswordTokenRecord> = {}) =>
  new PasswordToken({
    id: 'p1',
    staffId: 's1',
    kind: 'step_up',
    action: 'gateway_config',
    tokenHash: 'h',
    attempts: 0,
    expiresAt: at(600_000),
    consumedAt: null,
    ...over,
  })

describe('PasswordToken links', () => {
  test('a live link is spent once and guards on being unspent', () => {
    expect(token({ kind: 'reset' }).consumeLink(NOW)).toEqual({
      id: 'p1',
      expect: { consumedAt: null },
      set: { consumedAt: NOW },
    })
  })

  test('a used or expired link has nothing to spend', () => {
    expect(token({ consumedAt: at(-1) }).consumeLink(NOW)).toBeNull()
    expect(token({ expiresAt: NOW }).consumeLink(NOW)).toBeNull()
  })
})

describe('PasswordToken step-up codes', () => {
  test('the right code spends the challenge', () => {
    expect(token().verifyStepUp('h', NOW, 5)?.set).toEqual({ consumedAt: NOW })
  })

  test('a wrong code, a spent challenge and one out of tries are refused', () => {
    expect(token().verifyStepUp('x', NOW, 5)).toBeNull()
    expect(token({ consumedAt: at(-1) }).verifyStepUp('h', NOW, 5)).toBeNull()
    expect(token({ attempts: 5 }).verifyStepUp('h', NOW, 5)).toBeNull()
  })

  test('a wrong try is counted and guards on the count it read', () => {
    expect(token({ attempts: 2 }).countFailure(NOW, 5)).toEqual({
      id: 'p1',
      expect: { consumedAt: null, attempts: 2 },
      set: { attempts: 3, consumedAt: null },
    })
  })

  test('the last allowed try spends the challenge', () => {
    expect(token({ attempts: 4 }).countFailure(NOW, 5)?.set).toEqual({
      attempts: 5,
      consumedAt: NOW,
    })
  })

  test('nothing is counted on a spent or expired challenge, and no tries are left on it', () => {
    expect(token({ consumedAt: at(-1) }).countFailure(NOW, 5)).toBeNull()
    expect(token({ expiresAt: NOW }).attemptsLeft(NOW, 5)).toBe(0)
    expect(token({ attempts: 2 }).attemptsLeft(NOW, 5)).toBe(3)
  })
})
