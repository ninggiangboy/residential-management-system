/** A calendar day `YYYY-MM-DD` in the building's zone; it carries no zone itself (DR-09, ADR-0013). */
export type LocalDate = string & { readonly __brand: 'LocalDate' }

/** `building.time_zone` default (DOC-14 §7). */
export const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** An open charge due within this many days is "due soon" (DOC-54 §6.2, DR-183). */
export const DUE_SOON_DAYS = 7

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLocalDate(value: unknown): value is LocalDate {
  const m = typeof value === 'string' ? LOCAL_DATE.exec(value) : null
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export function localDate(value: string): LocalDate {
  if (!isLocalDate(value)) throw new RangeError(`Not a calendar day: ${value}`)
  return value
}

/** The wall clock of an instant in a zone; `hour` is 0–23. */
export interface ZonedParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
}

const partFormatters = new Map<string, Intl.DateTimeFormat>()

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let format = partFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    partFormatters.set(timeZone, format)
  }
  const parts: Record<string, number> = {}
  for (const p of format.formatToParts(instant))
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The only way code asks "what day is it" (DOC-12 §9.4): the calendar day of `now` in the building zone. */
export function buildingToday(now: Date, timeZone: string): LocalDate {
  const p = zonedParts(now, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` as LocalDate
}

const dayNumber = (day: LocalDate) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** `to − from` in calendar days; never counts hours. */
export const daysBetween = (from: LocalDate, to: LocalDate): number =>
  dayNumber(to) - dayNumber(from)

/** `max(0, today − due)`: the due day is payable through its end (DOC-14 §7). */
export const daysPastDue = (today: LocalDate, due: LocalDate): number =>
  Math.max(0, daysBetween(due, today))
