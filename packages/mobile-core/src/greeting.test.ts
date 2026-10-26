import { expect, test } from 'bun:test'
import { greetingKey } from './greeting'

// Ho Chi Minh City is UTC+7: 01:00Z is 08:00 there.
const at = (utcHour: number, minute = 0) => new Date(Date.UTC(2026, 9, 9, utcHour, minute))

test('UIRA-40: 08:00, 12:30, 15:00 and 21:00 building time', () => {
  expect(greetingKey(at(1))).toBe('common.greeting.morning')
  expect(greetingKey(at(5, 30))).toBe('common.greeting.noon')
  expect(greetingKey(at(8))).toBe('common.greeting.afternoon')
  expect(greetingKey(at(14))).toBe('common.greeting.evening')
})

test('the edges: 05:00 is morning, 11:00 midday, 13:00 afternoon, 18:00 and 04:59 evening', () => {
  expect(greetingKey(at(22))).toBe('common.greeting.morning')
  expect(greetingKey(at(4))).toBe('common.greeting.noon')
  expect(greetingKey(at(6))).toBe('common.greeting.afternoon')
  expect(greetingKey(at(11))).toBe('common.greeting.evening')
  expect(greetingKey(at(21, 59))).toBe('common.greeting.evening')
})
