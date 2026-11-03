import { describe, expect, test } from 'bun:test'
import { buildingToday, localDate } from '@rms/shared-types'
import { type AgingBucket, bucketOf, signedDaysPastDue } from './aging'

const DUE = localDate('2026-10-15')
const ZONE = 'Asia/Ho_Chi_Minh'

/** The bucket of an instant: its building day, then `today − due` (DOC-22 §8.1, DR-09). */
const bucketAt = (instant: string): AgingBucket =>
  bucketOf(signedDaysPastDue(buildingToday(new Date(instant), ZONE), DUE))

describe('LG-34: the aging buckets for a charge due 2026-10-15 (DOC-22 §8.3, §16.5)', () => {
  test.each([
    ['2026-10-15T05:00:00Z', 0, 'not_yet_due'],
    ['2026-10-16T05:00:00Z', 1, '1-30'],
    ['2026-11-14T05:00:00Z', 30, '1-30'],
    ['2026-11-15T05:00:00Z', 31, '31-60'],
    ['2026-12-14T05:00:00Z', 60, '31-60'],
    ['2026-12-15T05:00:00Z', 61, '61-90'],
    ['2027-01-13T05:00:00Z', 90, '61-90'],
    ['2027-01-14T05:00:00Z', 91, 'over_90'],
  ] as const)('%s is %p days past due in %s', (instant, days, bucket) => {
    const today = buildingToday(new Date(instant), ZONE)
    expect(signedDaysPastDue(today, DUE)).toBe(days)
    expect(bucketAt(instant)).toBe(bucket)
  })
})

describe('LG-35: the building day, not the UTC day (DOC-22 §8.3, FR-12.2)', () => {
  test.each([
    ['2026-10-14T05:00:00Z', -1, 'not_yet_due'],
    ['2026-10-14T17:00:00Z', 0, 'not_yet_due'],
    ['2026-10-15T16:30:00Z', 0, 'not_yet_due'],
    ['2026-10-15T17:30:00Z', 1, '1-30'],
    ['2026-10-15T23:59:00Z', 1, '1-30'],
  ] as const)('%s is %p days past due in %s', (instant, days, bucket) => {
    expect(bucketAt(instant)).toBe(bucket)
    expect(signedDaysPastDue(buildingToday(new Date(instant), ZONE), DUE)).toBe(days)
  })

  test('06:59 local on 10-16 is a day past due although the UTC date is still 10-15', () => {
    const instant = new Date('2026-10-15T23:59:00Z')
    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-15')
    expect(signedDaysPastDue(localDate('2026-10-15'), DUE)).toBe(0)
    expect(bucketAt(instant.toISOString())).toBe('1-30')
  })
})
