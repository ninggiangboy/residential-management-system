import { describe, expect, test } from 'bun:test'
import { daysLeft, localDate, relativeTime } from '@rms/shared-types'
import { createTranslator } from './translator'

const vi = createTranslator('vi')
const en = createTranslator('en')

describe('UICP-07: the rows of DOC-68 §7.2 that render words', () => {
  const now = new Date('2026-10-09T03:00:00Z') // 10:00 in the building zone
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const rows: [string, Date | string, string, string][] = [
    ['now − 30 s', ago(30_000), 'Vừa xong', 'Just now'],
    ['now − 2 min', ago(120_000), '2 phút trước', '2 minutes ago'],
    ['now − 1 min', ago(60_000), '1 phút trước', '1 minute ago'],
    ['now − 3 h', ago(3 * 3_600_000), '3 giờ trước', '3 hours ago'],
    ['yesterday 15:30', '2026-10-08T08:30:00Z', 'Hôm qua 15:30', 'Yesterday 15:30'],
    ['3 days ago', ago(3 * 86_400_000), '06/10/2026', 'Oct 6, 2026'],
  ]
  test.each(rows)('formatRelative %s', (_name, instant, viText, enText) => {
    expect(vi.phrase(relativeTime(instant, now, 'vi'))).toBe(viText)
    expect(en.phrase(relativeTime(instant, now, 'en'))).toBe(enText)
  })

  const today = localDate('2026-10-09')
  test.each([
    ['2026-10-15', 'Còn 6 ngày', '6 days left'],
    ['2026-10-09', 'Hôm nay', 'Today'],
    ['2026-10-10', 'Còn 1 ngày', '1 day left'],
    ['2026-10-06', 'Quá hạn 3 ngày', '3 days overdue'],
  ])('daysLeft due %s', (due, viText, enText) => {
    expect(vi.phrase(daysLeft(localDate(due), today))).toBe(viText)
    expect(en.phrase(daysLeft(localDate(due), today))).toBe(enText)
  })
})

describe('translator', () => {
  test('formats select and plain arguments', () => {
    expect(vi('common.unit.role-line', { memberType: 'tenant' })).toBe('Bạn là người thuê')
    expect(en('common.reference', { requestId: 'req_01' })).toBe('Reference: req_01')
    expect(en('error.account_locked', { minutes: 15 })).toBe(
      'Too many attempts. Try again in 15 minutes.',
    )
  })

  test('a key unknown at run time shows the key and is reported', () => {
    const missing: string[] = []
    const t = createTranslator('en', { onMissing: (key) => missing.push(key) })
    expect(t('web.nowhere' as never)).toBe('web.nowhere')
    expect(missing).toEqual(['web.nowhere'])
  })
})
