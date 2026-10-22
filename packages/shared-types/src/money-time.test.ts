import { describe, expect, test } from 'bun:test'
import { ERROR_CODES, RULE_CODES } from './errors'
import { lineAmount, money, moneyToJson } from './money'
import { buildingToday, daysPastDue, isLocalDate, localDate } from './time'

describe('Money (DR-11)', () => {
  // DOC-14 §6: the line-amount table
  test.each([
    [12_345n, 15_000, 185_175],
    [500n, 1, 1],
    [499n, 1, 0],
    [1n, 500, 1],
    [1n, 499, 0],
    [1_000n, 2_488_000, 2_488_000],
    [2_500n, 350_000, 875_000],
    [1_500n, 1, 2],
    [0n, 100_000, 0],
  ])('lineAmount(%p milli, %p đ) = %p đ', (qty, price, amount) => {
    expect(lineAmount(qty, money(price))).toBe(money(amount))
  })

  test('money refuses a fraction and JSON refuses an unsafe integer', () => {
    expect(() => money(0.5)).toThrow(RangeError)
    expect(moneyToJson(money(2_838_000))).toBe(2_838_000)
    expect(() => moneyToJson(money(2n ** 53n))).toThrow(RangeError)
  })
})

describe('time (DR-09, ADR-0013)', () => {
  const tz = 'Asia/Ho_Chi_Minh'
  // DOC-14 §7: building time 23:30, 00:30 and 06:59 around a charge due 2026-10-15
  test.each([
    ['2026-10-15T16:30:00Z', '2026-10-15', 0],
    ['2026-10-15T17:30:00Z', '2026-10-16', 1],
    ['2026-10-15T23:59:00Z', '2026-10-16', 1],
  ])('%s is %s in the building, %p day(s) past due', (instant, day, past) => {
    const today = buildingToday(new Date(instant), tz)
    expect(today).toBe(localDate(day))
    expect(daysPastDue(today, localDate('2026-10-15'))).toBe(past)
  })

  test('isLocalDate accepts real calendar days only', () => {
    expect(isLocalDate('2026-02-28')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-1-05')).toBe(false)
  })
})

test('UICP-06: a rule code never reuses the name of a top-level code (DR-220)', () => {
  const top = new Set<string>(ERROR_CODES)
  expect(RULE_CODES.filter((code) => top.has(code))).toEqual([])
  expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  expect(new Set(RULE_CODES).size).toBe(RULE_CODES.length)
})
