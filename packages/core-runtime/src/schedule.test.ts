import { describe, expect, test } from 'bun:test'
import { type ClockSchedule, decide, lastSlot, validateSchedule, zonedTime } from './schedule'

const VN = 'Asia/Ho_Chi_Minh'
const local = (y: number, m: number, d: number, hh: number, mm: number, ss = 0, tz = VN) =>
  new Date(zonedTime(y, m, d, hh, mm, tz).getTime() + ss * 1000)

const daily = (at: string): ClockSchedule => ({ kind: 'daily', at })
const sunday: ClockSchedule = { kind: 'weekly', day: 'sun', at: '04:00' }
const monthly: ClockSchedule = { kind: 'monthly', day: 1, at: '04:30' }
const hourly: ClockSchedule = { kind: 'hourly', minute: 5 }

const run = (
  now: Date,
  schedule: ClockSchedule,
  graceHours: number,
  lastSuccess: Date | null = null,
  startedSlot: Date | null = null,
) =>
  decide({ now, schedule, timeZone: VN, graceMs: graceHours * 3600_000, lastSuccess, startedSlot })

describe('JB-14: the worked cases of DOC-38 §3.3', () => {
  test('invariant_check (daily 03:00, grace 12 h)', () => {
    expect(run(local(2026, 10, 19, 3, 1), daily('03:00'), 12)).toMatchObject({ run: true })
    expect(run(local(2026, 10, 19, 15, 0), daily('03:00'), 12)).toMatchObject({
      run: true,
      reason: 'catch_up',
    })
    expect(run(local(2026, 10, 19, 16, 30), daily('03:00'), 12)).toMatchObject({
      run: false,
      reason: 'beyond_grace',
    })
    expect(
      run(local(2026, 10, 19, 15, 0), daily('03:00'), 12, local(2026, 10, 19, 3, 0, 40)),
    ).toMatchObject({
      run: false,
      reason: 'already_succeeded',
    })
  })

  test('inbox_purge (Sunday 04:00, grace 24 h)', () => {
    expect(run(local(2026, 10, 19, 0, 30), sunday, 24)).toMatchObject({ run: true })
    expect(run(local(2026, 10, 19, 10, 0), sunday, 24)).toMatchObject({
      run: false,
      reason: 'beyond_grace',
    })
    expect(lastSlot(local(2026, 10, 19, 0, 30), sunday, VN)).toEqual(local(2026, 10, 18, 4, 0))
  })

  test('audit_purge (monthly, day 1 at 04:30, grace 168 h)', () => {
    expect(run(local(2026, 10, 19, 10, 0), monthly, 168)).toMatchObject({
      run: false,
      reason: 'beyond_grace',
    })
    expect(run(local(2026, 11, 1, 5, 0), monthly, 168)).toMatchObject({ run: true })
    const january = run(local(2027, 1, 1, 4, 0), monthly, 168)
    expect(january).toMatchObject({ run: false, reason: 'beyond_grace' })
    expect(january.slot).toEqual(local(2026, 12, 1, 4, 30))
  })

  test('storage_quota (hourly at :05, no grace): only the first 30 seconds count as on time', () => {
    expect(run(local(2026, 10, 19, 10, 3), hourly, 0)).toMatchObject({
      run: false,
      reason: 'beyond_grace',
    })
    expect(run(local(2026, 10, 19, 10, 5, 20), hourly, 0)).toMatchObject({
      run: true,
      reason: 'on_time',
    })
  })

  test('demo_reset (daily 04:00, grace 2 h) after a worker back at 06:30 is skipped', () => {
    expect(run(local(2026, 10, 19, 6, 30), daily('04:00'), 2)).toMatchObject({
      run: false,
      reason: 'beyond_grace',
    })
  })

  test('a slot this process already tried is not run again', () => {
    const slot = local(2026, 10, 19, 3, 0)
    expect(run(local(2026, 10, 19, 3, 0, 10), daily('03:00'), 12, null, slot)).toMatchObject({
      run: false,
      reason: 'already_tried',
    })
  })
})

describe('JB-14: the slot arithmetic', () => {
  test('a daily slot before and after the clock time', () => {
    expect(lastSlot(local(2026, 10, 19, 2, 59), daily('03:00'), VN)).toEqual(
      local(2026, 10, 18, 3, 0),
    )
    expect(lastSlot(local(2026, 10, 19, 3, 0), daily('03:00'), VN)).toEqual(
      local(2026, 10, 19, 3, 0),
    )
  })

  test('a weekly slot is always the Sunday, before and after 04:00', () => {
    expect(lastSlot(local(2026, 10, 18, 3, 59), sunday, VN)).toEqual(local(2026, 10, 11, 4, 0))
    expect(lastSlot(local(2026, 10, 18, 4, 0), sunday, VN)).toEqual(local(2026, 10, 18, 4, 0))
    expect(lastSlot(local(2026, 10, 24, 23, 59), sunday, VN)).toEqual(local(2026, 10, 18, 4, 0))
  })

  test('a monthly slot, and across a year end', () => {
    expect(lastSlot(local(2026, 10, 31, 12, 0), monthly, VN)).toEqual(local(2026, 10, 1, 4, 30))
    expect(lastSlot(local(2026, 1, 1, 4, 29), monthly, VN)).toEqual(local(2025, 12, 1, 4, 30))
  })

  test('an hourly slot', () => {
    expect(lastSlot(local(2026, 10, 19, 10, 4), hourly, VN)).toEqual(local(2026, 10, 19, 9, 5))
    expect(lastSlot(local(2026, 10, 19, 10, 5), hourly, VN)).toEqual(local(2026, 10, 19, 10, 5))
    expect(lastSlot(local(2026, 10, 19, 0, 4), hourly, VN)).toEqual(local(2026, 10, 18, 23, 5))
  })

  test('03:00 stays 03:00 local across both clock changes of America/New_York', () => {
    const ny = 'America/New_York'
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT. Midnight 07-Mar 03:00 EST = 08:00Z; 08-Mar 03:00 EDT = 07:00Z.
    expect(lastSlot(new Date('2026-03-08T12:00:00Z'), daily('03:00'), ny).toISOString()).toBe(
      '2026-03-08T07:00:00.000Z',
    )
    expect(lastSlot(new Date('2026-03-08T06:00:00Z'), daily('03:00'), ny).toISOString()).toBe(
      '2026-03-07T08:00:00.000Z',
    )
    // 2026-11-01: 02:00 EDT falls back to 01:00 EST. 31-Oct 03:00 EDT = 07:00Z; 01-Nov 03:00 EST = 08:00Z.
    expect(lastSlot(new Date('2026-11-01T12:00:00Z'), daily('03:00'), ny).toISOString()).toBe(
      '2026-11-01T08:00:00.000Z',
    )
    expect(lastSlot(new Date('2026-11-01T07:30:00Z'), daily('03:00'), ny).toISOString()).toBe(
      '2026-10-31T07:00:00.000Z',
    )
  })

  test('a schedule that cannot be computed is refused', () => {
    expect(() => validateSchedule({ kind: 'daily', at: '3:00' })).toThrow()
    expect(() => validateSchedule({ kind: 'monthly', day: 31, at: '04:00' })).toThrow()
    expect(() => validateSchedule({ kind: 'hourly', minute: 60 })).toThrow()
    expect(() => validateSchedule({ kind: 'every', seconds: 0 })).toThrow()
    expect(() => validateSchedule({ kind: 'weekly', day: 'sun', at: '04:00' })).not.toThrow()
  })
})
