import { expect, test } from 'bun:test'
import {
  NOTICE_TITLE_PUSH_MAX,
  NOTIFICATION_TEMPLATES,
  type Params,
  TEMPLATE_KEYS,
} from '@rms/shared-types'
import { CATALOGS, type Messages } from '../catalog'
import { compareCatalogs } from '../icu'
import { renderNotification } from './render'

const notifyFamily = (messages: Messages): Record<string, string> =>
  Object.fromEntries(
    Object.entries(messages as Readonly<Record<string, string>>).filter(([key]) =>
      key.startsWith('notify.'),
    ),
  )

test('NT-01: the notify family is 21 keys x title and body, with the same arguments in vi and en', () => {
  const en = notifyFamily(CATALOGS.en)
  const vi = notifyFamily(CATALOGS.vi)
  expect(Object.keys(en)).toHaveLength(TEMPLATE_KEYS.length * 2)
  expect(compareCatalogs(en, vi, { base: 'en', other: 'vi' })).toEqual([])
})

const FIXTURE_PARAMS: Params = {
  batchCode: 'PH-2610-01',
  feeMonth: '2026-10',
  dueDate: '2026-11-20',
  ticketCode: 'YC-261019-004',
  status: 'in_progress',
  noticeTitle: { vi: 'Cắt nước ngày 21/10', en: 'Water shut-off on 21 October' },
}

/** The fixture values that are codes: they are the entry's own code, not personal data (DR-52), so the scan drops them. */
const CODE_FIXTURES = ['PH-2610-01', 'YC-261019-004']
const withoutCodes = (text: string) =>
  CODE_FIXTURES.reduce((out, code) => out.split(code).join(''), text)

test('NT-02: a pushed text holds no amount, name, phone or unit code (DR-52, FR-29.3)', () => {
  const pushed = TEMPLATE_KEYS.filter((key) => NOTIFICATION_TEMPLATES[key].push !== false)
  expect(pushed).toHaveLength(19)
  for (const language of ['vi', 'en'] as const) {
    for (const key of pushed) {
      const { title, body } = renderNotification(key, FIXTURE_PARAMS, language)
      const text = `${title}\n${body}`
      expect(text).not.toContain('Nguyễn Văn An')
      expect(text).not.toContain('A-1508')
      const scanned = withoutCodes(text)
      expect(scanned).not.toMatch(/\d{5,}/)
      expect(scanned).not.toMatch(/@/)
      expect(scanned).not.toMatch(/\+84|0\d{9}/)
    }
  }
})

test('the rendered example of DOC-31 §3.4', () => {
  const params: Params = { batchCode: 'PH-2610-01', feeMonth: '2026-10' }
  expect(renderNotification('fee.batch_published', params, 'vi')).toEqual({
    title: 'Phí tháng 10/2026 đã phát hành',
    body: 'Đợt phí PH-2610-01 đã có. Mở ứng dụng để xem chi tiết.',
  })
  expect(renderNotification('fee.batch_published', params, 'en')).toEqual({
    title: 'October 2026 fees published',
    body: 'Fee batch PH-2610-01 is ready. Open the app to see the details.',
  })
})

test('a notice title longer than 100 characters is cut with an ellipsis (DOC-31 §3.3)', () => {
  const prefix = 'Thông báo mới: '
  const { title } = renderNotification(
    'notice.published',
    { noticeTitle: { vi: 'a'.repeat(140) } },
    'vi',
  )
  expect(title.startsWith(prefix)).toBe(true)
  expect(title.endsWith('…')).toBe(true)
  expect(title.length).toBeLessThanOrEqual(prefix.length + NOTICE_TITLE_PUSH_MAX)
})

test('a notice title with no English falls back to Vietnamese (DOC-31 §3.3)', () => {
  const { title } = renderNotification(
    'notice.published',
    { noticeTitle: { vi: 'Cắt nước' } },
    'en',
  )
  expect(title).toBe('New notice: Cắt nước')
})
