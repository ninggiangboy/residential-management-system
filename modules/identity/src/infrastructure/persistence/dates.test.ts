import { expect, test } from 'bun:test'
import { asDate, asDateOrNull } from './dates'

test('a timestamptz as the driver prints it becomes the same instant', () => {
  expect(asDate('2026-10-22 17:11:09.311334+00').toISOString()).toBe('2026-10-22T17:11:09.311Z')
  expect(asDate('2026-10-22 17:11:09+07').toISOString()).toBe('2026-10-22T10:11:09.000Z')
  expect(asDate('2026-10-22 17:11:09+05:30').toISOString()).toBe('2026-10-22T11:41:09.000Z')
})

test('a Date and a null pass through', () => {
  const date = new Date('2026-10-22T00:00:00Z')
  expect(asDate(date)).toBe(date)
  expect(asDateOrNull(null)).toBeNull()
})
