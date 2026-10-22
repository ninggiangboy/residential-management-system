import type { Language } from './language'
import {
  DEFAULT_TIME_ZONE,
  daysBetween,
  isLocalDate,
  type LocalDate,
  localDate,
  zonedParts,
} from './time'

/**
 * The display formats of DR-71 and DR-223 (DOC-68 §7). Pure and dependency-free so that the API, the web and both
 * apps print the same text; no component calls `Intl` for money or builds a date by hand. Test UICP-07 is the table.
 */

const NBSP = ' '
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const pad = (n: number) => String(n).padStart(2, '0')

const group = (digits: string, separator: string) => digits.replace(/\B(?=(\d{3})+$)/g, separator)

/** `2.838.000 đ` / `₫2,838,000`; a negative amount has a leading `-`. Integer đồng only. */
export function formatMoney(amount: bigint | number, lang: Language): string {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount))
    throw new RangeError(`Money must be an integer, got ${amount}`)
  const value = BigInt(amount)
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString()
  return lang === 'vi' ? `${sign}${group(digits, '.')}${NBSP}đ` : `${sign}₫${group(digits, ',')}`
}

type Day = { year: number; month: number; day: number }

/** A building day is taken as is; an instant is moved into the building zone first. */
function toDay(value: LocalDate | Date | string, timeZone: string): Day {
  if (typeof value === 'string' && isLocalDate(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    return { year, month, day }
  }
  return zonedParts(toInstant(value), timeZone)
}

function toInstant(value: Date | string): Date {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Not an instant: ${String(value)}`)
  return instant
}

/** `09/10/2026` / `Oct 9, 2026`. */
export function formatDate(
  value: LocalDate | Date | string,
  lang: Language,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const d = toDay(value, timeZone)
  return lang === 'vi'
    ? `${pad(d.day)}/${pad(d.month)}/${d.year}`
    : `${MONTHS_EN[d.month - 1]} ${d.day}, ${d.year}`
}

/** `15:30`, 24-hour, in the building zone, in both languages. */
export function formatTime(instant: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const p = zonedParts(toInstant(instant), timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

export const formatDateTime = (
  instant: Date | string,
  lang: Language,
  timeZone = DEFAULT_TIME_ZONE,
): string => `${formatDate(toInstant(instant), lang, timeZone)} ${formatTime(instant, timeZone)}`

/** `+84912345678` → `0912 345 678` (DR-205); another country code stays in international form. Display only. */
export function formatPhone(e164: string): string {
  const national = /^\+84(\d{9,10})$/.exec(e164)
  if (!national) return e164
  const digits = `0${national[1]}`
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
}

/** Up to one decimal, a trailing zero dropped, the decimal sign of the language. */
function oneDecimal(value: number, lang: Language): string {
  const text = String(Math.round(value * 10) / 10)
  return lang === 'vi' ? text.replace('.', ',') : text
}

/** `90,7%` / `90.7%`. */
export const formatPercent = (ratio: number, lang: Language): string =>
  `${oneDecimal(ratio * 100, lang)}%`

/** `85,5 m²` / `85.5 m²`. */
export const formatArea = (m2: number, lang: Language): string => `${oneDecimal(m2, lang)}${NBSP}m²`

const MIB = 1_048_576
const GIB = 1_073_741_824

/** Mebibytes and gibibytes written "MB" and "GB" (DOC-37 §2), always one decimal. */
export function formatBytes(bytes: number, lang: Language): string {
  const [value, unit] = bytes >= GIB ? [bytes / GIB, 'GB'] : [bytes / MIB, 'MB']
  const text = value.toFixed(1)
  return `${lang === 'vi' ? text.replace('.', ',') : text}${NBSP}${unit}`
}

/**
 * A sentence the catalog renders (`@rms/i18n-catalog` holds the words; this package holds none), or a finished text.
 * `relativeTime` and `daysLeft` return one; `t.phrase()` of the catalog turns it into text.
 */
export type Phrase =
  | { readonly key: 'common.time.just-now' | 'common.today'; readonly params?: undefined }
  | {
      readonly key:
        | 'common.time.minutes-ago'
        | 'common.time.hours-ago'
        | 'common.time.days-left'
        | 'common.time.days-overdue'
      readonly params: { readonly count: number }
    }
  | { readonly key: 'common.time.yesterday-at'; readonly params: { readonly time: string } }
  | { readonly text: string }

/** "Last seen", "sent" and inbox rows only, never a deadline (DR-223). */
export function relativeTime(
  instant: Date | string,
  now: Date,
  lang: Language,
  timeZone = DEFAULT_TIME_ZONE,
): Phrase {
  const at = toInstant(instant)
  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000)
  if (seconds < 60) return { key: 'common.time.just-now' }
  if (seconds < 3600)
    return { key: 'common.time.minutes-ago', params: { count: Math.floor(seconds / 60) } }
  const days = daysBetween(dayOf(at, timeZone), dayOf(now, timeZone))
  if (days === 0)
    return { key: 'common.time.hours-ago', params: { count: Math.floor(seconds / 3600) } }
  if (days === 1)
    return { key: 'common.time.yesterday-at', params: { time: formatTime(at, timeZone) } }
  return { text: formatDate(at, lang, timeZone) }
}

const dayOf = (instant: Date, timeZone: string): LocalDate => {
  const p = zonedParts(instant, timeZone)
  return localDate(`${p.year}-${pad(p.month)}-${pad(p.day)}`)
}

/** A deadline in calendar days of the building zone (ADR-0013): today, N days left, or N days overdue. */
export function daysLeft(due: LocalDate, today: LocalDate): Phrase {
  const left = daysBetween(today, due)
  if (left === 0) return { key: 'common.today' }
  return left > 0
    ? { key: 'common.time.days-left', params: { count: left } }
    : { key: 'common.time.days-overdue', params: { count: -left } }
}
