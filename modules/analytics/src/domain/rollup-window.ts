import type { LocalDate } from '@rms/shared-types'

/** The days a run of `usage_rollup` recomputes: the last 3 complete local days, so a day missed by a failed run is made up (DOC-104 §7.1). */
export const ROLLUP_DAYS = 3

/** `day + by` calendar days; never counts hours (DOC-12 §9.4). */
export function shiftDay(day: LocalDate, by: number): LocalDate {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10) as LocalDate
}

/** `[today - 3, today)`: today is not complete, so it is not rolled up yet. */
export function rollupWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: shiftDay(today, -ROLLUP_DAYS), to: today }
}
