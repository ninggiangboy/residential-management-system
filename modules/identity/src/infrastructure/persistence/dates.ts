/**
 * The driver hands back a `timestamptz` of a raw `sql` statement as text (`2026-10-22 17:11:09.311334+00`), not as a `Date`: a
 * Drizzle column is mapped, a raw row is not. Comparing that text with a `Date` is false for every pair, so every instant read from
 * a raw statement goes through here. An offset without minutes (`+00`) is completed to `+00:00`, which `Date` reads.
 */
export function asDate(value: Date | string): Date {
  if (value instanceof Date) return value
  return new Date(value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
}

export const asDateOrNull = (value: Date | string | null): Date | null =>
  value === null ? null : asDate(value)
