/**
 * The clock of the clock jobs (DOC-38 §3.3): the last scheduled slot at or before "now" in the job's time zone, and the
 * decision whether a run is owed. Pure functions: the scheduler loop and the tests (JB-14, JB-19) call them with a fake clock.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type Schedule =
  | { kind: 'every'; seconds: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; at: string }
  | { kind: 'weekly'; day: Weekday; at: string }
  | { kind: 'monthly'; day: number; at: string }

export type ClockSchedule = Exclude<Schedule, { kind: 'every' }>

export const isClockSchedule = (schedule: Schedule): schedule is ClockSchedule =>
  schedule.kind !== 'every'

/** `HH:MM` → hour and minute. */
function parseTime(at: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at)
  if (!match) throw new Error(`invalid time of day "${at}", expected HH:MM`)
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** Throws when a schedule cannot be computed: the catalog test and `JobRuntime` call it for every job. */
export function validateSchedule(schedule: Schedule): void {
  switch (schedule.kind) {
    case 'every':
      if (!Number.isInteger(schedule.seconds) || schedule.seconds < 1)
        throw new Error('an `every` schedule needs whole seconds ≥ 1')
      return
    case 'hourly':
      if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59)
        throw new Error('an `hourly` minute is 0 to 59')
      return
    case 'daily':
      parseTime(schedule.at)
      return
    case 'weekly':
      parseTime(schedule.at)
      if (!WEEKDAYS.includes(schedule.day)) throw new Error(`unknown weekday "${schedule.day}"`)
      return
    case 'monthly':
      parseTime(schedule.at)
      if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 28)
        throw new Error('a `monthly` day is 1 to 28')
      return
  }
}

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let known = formatters.get(timeZone)
  if (!known) {
    known = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, known)
  }
  return known
}

function localParts(instant: Date, timeZone: string): LocalParts & { second: number } {
  const parts: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(instant)) parts[part.type] = part.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? ''),
  }
}

/** Local minus UTC, in ms, at this instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const l = localParts(instant, timeZone)
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant at which the wall clock of `timeZone` reads this date and time. Out-of-range fields normalize (day 0 is the
 * last day of the previous month), which is how "the day before" and "the previous month" are written below.
 */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  // The offset is that of the instant we are looking for, so ask twice: the first guess may sit on the other side of a change.
  const first = guess - offsetMs(new Date(guess), timeZone)
  return new Date(guess - offsetMs(new Date(first), timeZone))
}

/** The last slot at or before `now`, on the wall clock of `timeZone` (so 03:00 stays 03:00 across a clock change). */
export function lastSlot(now: Date, schedule: ClockSchedule, timeZone: string): Date {
  const l = localParts(now, timeZone)
  const slotOf = (dayOffset: number, hour: number, minute: number, month = l.month) =>
    zonedTime(l.year, month, l.day + dayOffset, hour, minute, timeZone)
  const notAfterNow = (slot: Date) => slot.getTime() <= now.getTime()

  switch (schedule.kind) {
    case 'hourly': {
      const slot = slotOf(0, l.hour, schedule.minute)
      return notAfterNow(slot) ? slot : slotOf(0, l.hour - 1, schedule.minute)
    }
    case 'daily': {
      const { hour, minute } = parseTime(schedule.at)
      const slot = slotOf(0, hour, minute)
      return notAfterNow(slot) ? slot : slotOf(-1, hour, minute)
    }
    case 'weekly': {
      const { hour, minute } = parseTime(schedule.at)
      const back = (l.weekday - WEEKDAYS.indexOf(schedule.day) + 7) % 7
      const slot = slotOf(-back, hour, minute)
      return notAfterNow(slot) ? slot : slotOf(-back - 7, hour, minute)
    }
    case 'monthly': {
      const { hour, minute } = parseTime(schedule.at)
      const slot = zonedTime(l.year, l.month, schedule.day, hour, minute, timeZone)
      return notAfterNow(slot)
        ? slot
        : zonedTime(l.year, l.month - 1, schedule.day, hour, minute, timeZone)
    }
  }
}

/** "On time" is two scheduler ticks (DOC-38 §3.3). */
export const ON_TIME_MS = 30_000

export type SlotDecision =
  | { run: true; slot: Date; reason: 'on_time' | 'catch_up' }
  | { run: false; slot: Date; reason: 'already_tried' | 'already_succeeded' | 'beyond_grace' }

/**
 * Whether the slot at or before `now` is owed a run: not if this process already tried it, not if a run succeeded since it,
 * not if it is older than the grace window (a slot missed while the worker was down is run once if the window allows).
 */
export function decide(input: {
  now: Date
  schedule: ClockSchedule
  timeZone: string
  graceMs: number
  lastSuccess: Date | null
  startedSlot: Date | null
}): SlotDecision {
  const slot = lastSlot(input.now, input.schedule, input.timeZone)
  const age = input.now.getTime() - slot.getTime()
  if (input.startedSlot && input.startedSlot.getTime() >= slot.getTime())
    return { run: false, slot, reason: 'already_tried' }
  if (input.lastSuccess && input.lastSuccess.getTime() >= slot.getTime())
    return { run: false, slot, reason: 'already_succeeded' }
  if (age > Math.max(input.graceMs, ON_TIME_MS)) return { run: false, slot, reason: 'beyond_grace' }
  return { run: true, slot, reason: age <= ON_TIME_MS ? 'on_time' : 'catch_up' }
}
