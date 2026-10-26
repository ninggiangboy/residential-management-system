import { describe, expect, test } from 'bun:test'
import { secondsLeft } from './countdown'
import { initialLanguage } from './language'
import { randomId } from './random-id'
import { compareVersions, isBelowMinimum } from './version'

describe('initialLanguage (DOC-55 §11)', () => {
  test('the stored choice wins, then a device language that is vi or en, else vi', () => {
    expect(initialLanguage('en', 'vi')).toBe('en')
    expect(initialLanguage(null, 'en')).toBe('en')
    expect(initialLanguage(null, 'EN')).toBe('en')
    expect(initialLanguage(null, 'fr')).toBe('vi')
    expect(initialLanguage('xx', null)).toBe('vi')
  })
})

describe('versions (UIRA-07)', () => {
  test('numeric comparison, not text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1)
  })
  test('below the minimum, and no minimum is never below', () => {
    expect(isBelowMinimum('1.0.0', '1.2.0')).toBe(true)
    expect(isBelowMinimum('1.2.0', '1.2.0')).toBe(false)
    expect(isBelowMinimum('1.0.0', undefined)).toBe(false)
  })
})

test('randomId is a UUIDv4 and differs between calls', () => {
  const a = randomId()
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(randomId()).not.toBe(a)
})

describe('secondsLeft (UIRA-16)', () => {
  test('rounds up, reaches 0 and never goes negative', () => {
    expect(secondsLeft(45_000, 0)).toBe(45)
    expect(secondsLeft(45_000, 44_000)).toBe(1)
    expect(secondsLeft(45_000, 44_001)).toBe(1)
    expect(secondsLeft(45_000, 45_000)).toBe(0)
    expect(secondsLeft(45_000, 46_000)).toBe(0)
  })
})
