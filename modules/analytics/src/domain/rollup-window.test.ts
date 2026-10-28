import { describe, expect, test } from 'bun:test'
import type { LocalDate } from '@rms/shared-types'
import { rollupWindow, shiftDay } from './rollup-window'

const day = (value: string) => value as LocalDate

describe('the rollup window (DOC-104 §7.1)', () => {
  test('the last 3 complete local days: today is not rolled up yet', () => {
    expect(rollupWindow(day('2026-10-28'))).toEqual({
      from: day('2026-10-25'),
      to: day('2026-10-28'),
    })
  })

  test('days are calendar days across a month, a year and a leap day', () => {
    expect(shiftDay(day('2026-11-01'), -1)).toBe(day('2026-10-31'))
    expect(shiftDay(day('2027-01-02'), -3)).toBe(day('2026-12-30'))
    expect(shiftDay(day('2028-03-01'), -1)).toBe(day('2028-02-29'))
    expect(shiftDay(day('2026-10-28'), -730)).toBe(day('2024-10-28'))
  })
})
