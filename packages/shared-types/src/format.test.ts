import { describe, expect, test } from 'bun:test'
import {
  daysLeft,
  formatArea,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPhone,
  formatTime,
  relativeTime,
} from './format'
import { localDate } from './time'

/**
 * UICP-07 (DOC-68 §7.2), the rows that need no catalog; the relative-time and day-count rows render words, so the
 * catalog package runs them. The table writes a plain space where the formatter puts a no-break space (DOC-68 §7.1).
 */
const nb = (s: string) => s.replace(/ (đ|m²|MB|GB)$/, ' $1')

const table: [string, () => [string, string], string, string][] = [
  [
    'formatMoney 2838000',
    () => [formatMoney(2838000, 'vi'), formatMoney(2838000, 'en')],
    '2.838.000 đ',
    '₫2,838,000',
  ],
  ['formatMoney 0', () => [formatMoney(0, 'vi'), formatMoney(0, 'en')], '0 đ', '₫0'],
  [
    'formatMoney 1000',
    () => [formatMoney(1000, 'vi'), formatMoney(1000, 'en')],
    '1.000 đ',
    '₫1,000',
  ],
  [
    'formatMoney -350000',
    () => [formatMoney(-350000, 'vi'), formatMoney(-350000, 'en')],
    '-350.000 đ',
    '-₫350,000',
  ],
  [
    'formatMoney 1234567890',
    () => [formatMoney(1234567890n, 'vi'), formatMoney(1234567890n, 'en')],
    '1.234.567.890 đ',
    '₫1,234,567,890',
  ],
  [
    'formatDate 2026-10-09',
    () => [formatDate('2026-10-09', 'vi'), formatDate('2026-10-09', 'en')],
    '09/10/2026',
    'Oct 9, 2026',
  ],
  [
    'formatDate 2026-01-05',
    () => [formatDate('2026-01-05', 'vi'), formatDate('2026-01-05', 'en')],
    '05/01/2026',
    'Jan 5, 2026',
  ],
  [
    'formatTime 08:30Z',
    () => [formatTime('2026-10-09T08:30:00Z'), formatTime('2026-10-09T08:30:00Z')],
    '15:30',
    '15:30',
  ],
  [
    'formatDateTime 08:30Z',
    () => [
      formatDateTime('2026-10-09T08:30:00Z', 'vi'),
      formatDateTime('2026-10-09T08:30:00Z', 'en'),
    ],
    '09/10/2026 15:30',
    'Oct 9, 2026 15:30',
  ],
  [
    'formatDate instant past local midnight',
    () => [
      formatDate(new Date('2026-10-09T17:30:00Z'), 'vi'),
      formatDate(new Date('2026-10-09T17:30:00Z'), 'en'),
    ],
    '10/10/2026',
    'Oct 10, 2026',
  ],
  [
    'formatPhone mobile',
    () => [formatPhone('+84912345678'), formatPhone('+84912345678')],
    '0912 345 678',
    '0912 345 678',
  ],
  [
    'formatPhone landline',
    () => [formatPhone('+842838123456'), formatPhone('+842838123456')],
    '0283 812 3456',
    '0283 812 3456',
  ],
  [
    'formatPhone not +84',
    () => [formatPhone('+14155550123'), formatPhone('+14155550123')],
    '+14155550123',
    '+14155550123',
  ],
  [
    'formatPercent 0.907',
    () => [formatPercent(0.907, 'vi'), formatPercent(0.907, 'en')],
    '90,7%',
    '90.7%',
  ],
  ['formatPercent 1', () => [formatPercent(1, 'vi'), formatPercent(1, 'en')], '100%', '100%'],
  ['formatArea 85.5', () => [formatArea(85.5, 'vi'), formatArea(85.5, 'en')], '85,5 m²', '85.5 m²'],
  ['formatArea 85', () => [formatArea(85, 'vi'), formatArea(85, 'en')], '85 m²', '85 m²'],
  [
    'formatBytes 2621440',
    () => [formatBytes(2621440, 'vi'), formatBytes(2621440, 'en')],
    '2,5 MB',
    '2.5 MB',
  ],
]

describe('UICP-07 formatter table', () => {
  test.each(table)('%s', (_name, run, vi, en) => {
    expect(run()).toEqual([nb(vi), nb(en)])
  })

  test('formatMoney never prints a decimal part and refuses a fraction', () => {
    expect(formatMoney(1_000_000, 'en')).not.toMatch(/[.]\d/)
    expect(() => formatMoney(10.5, 'vi')).toThrow(RangeError)
  })
})

describe('phrases the catalog renders', () => {
  const now = new Date('2026-10-09T03:00:00Z') // 10:00 in Asia/Ho_Chi_Minh
  const ago = (ms: number) => new Date(now.getTime() - ms)

  test('relativeTime picks the sentence and its argument', () => {
    expect(relativeTime(ago(30_000), now, 'vi')).toEqual({ key: 'common.time.just-now' })
    expect(relativeTime(ago(60_000), now, 'vi')).toEqual({
      key: 'common.time.minutes-ago',
      params: { count: 1 },
    })
    expect(relativeTime(ago(3 * 3_600_000), now, 'vi')).toEqual({
      key: 'common.time.hours-ago',
      params: { count: 3 },
    })
    expect(relativeTime('2026-10-08T08:30:00Z', now, 'vi')).toEqual({
      key: 'common.time.yesterday-at',
      params: { time: '15:30' },
    })
    expect(relativeTime(ago(3 * 86_400_000), now, 'en')).toEqual({ text: 'Oct 6, 2026' })
  })

  test('relativeTime counts building days, not 24-hour spans', () => {
    // 23:30 local yesterday is 10.5 hours before 10:00 today, yet it is "yesterday", not "10 hours ago"
    expect(relativeTime('2026-10-08T16:30:00Z', now, 'vi')).toEqual({
      key: 'common.time.yesterday-at',
      params: { time: '23:30' },
    })
  })

  test('daysLeft counts calendar days', () => {
    const today = localDate('2026-10-09')
    expect(daysLeft(localDate('2026-10-15'), today)).toEqual({
      key: 'common.time.days-left',
      params: { count: 6 },
    })
    expect(daysLeft(today, today)).toEqual({ key: 'common.today' })
    expect(daysLeft(localDate('2026-10-10'), today)).toEqual({
      key: 'common.time.days-left',
      params: { count: 1 },
    })
    expect(daysLeft(localDate('2026-10-06'), today)).toEqual({
      key: 'common.time.days-overdue',
      params: { count: 3 },
    })
  })
})
