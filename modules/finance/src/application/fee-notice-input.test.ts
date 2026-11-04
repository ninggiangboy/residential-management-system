import { describe, expect, test } from 'bun:test'
import { type LocalDate, money } from '@rms/shared-types'
import type { ChargeNoticeRow } from '../domain/charge-repository'
import {
  FEE_NOTICE_TEMPLATE_VERSION,
  type FeeNoticeContext,
  feeNoticeFileName,
  feeNoticeHash,
  feeNoticeKey,
  toFeeNoticeInput,
} from './fee-notice-input'
import type { NoticeBuilding } from './ports'

/**
 * The pure mapper of DOC-34 §8.1 (DR-292, DR-293): the hash is stable across key order and moves with the language,
 * the logo id, the owner, a line amount and the gateway switch; the key and the download name follow §8.1.
 */

const BUILDING: NoticeBuilding = {
  name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
  company: { name: { vi: 'Công ty Quản lý Sunrise' }, address: '12 Nguyễn Huệ, Quận 1' },
  address: '12 Nguyễn Huệ, Quận 1',
  hotline: '1900 1234',
  email: 'bql@sunrise.vn',
  workingHours: { vi: 'Thứ 2 – Thứ 6', en: 'Mon – Fri' },
  logoFile: '0192f3c4-9d02-7000-8000-00000000f0a1',
  gatewayActive: false,
}

const SOURCE: ChargeNoticeRow = {
  charge: {
    id: 'c1',
    unitId: 'u1',
    unitCode: 'A-1508',
    amount: money(984_825),
    status: 'open',
  },
  batch: {
    id: 'b1',
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01' as LocalDate,
    dueDate: '2026-11-10' as LocalDate,
    publishedAt: new Date('2026-10-01T03:00:00.000Z'),
    status: 'published',
  },
  lines: [
    {
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '85',
      unitPrice: 12000,
      amount: 1020000,
      note: null,
    },
    {
      position: 2,
      kind: 'adjustment',
      itemName: { vi: 'Điều chỉnh', en: 'Adjustment' },
      quantity: '1',
      unitPrice: 0,
      amount: -35175,
      note: 'Trừ phí nước tính thừa T9',
    },
  ],
}

const CONTEXT: FeeNoticeContext = {
  building: BUILDING,
  ownerName: 'Trần Minh Anh',
  issueDate: '2026-10-01' as LocalDate,
}

const LOGO = new Uint8Array([1, 2, 3])

/** The same value with every object's keys reversed: the hash must ignore key order (DOC-34 §8.1). */
function reversed<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => reversed(entry)) as unknown as T
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, entry]) => [key, reversed(entry)]),
    ) as T
  return value
}

describe('feeNoticeHash / feeNoticeKey / feeNoticeFileName (DOC-34 §8.1, DR-292, DR-293)', () => {
  const input = toFeeNoticeInput(SOURCE, CONTEXT, 'vi', LOGO)

  test('the template version is the §8.1 value', () => {
    expect(FEE_NOTICE_TEMPLATE_VERSION).toBe(1)
  })

  test('the hash is stable across key order and 16 hex characters long', () => {
    const hash = feeNoticeHash(input)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(feeNoticeHash(reversed(input))).toBe(hash)
  })

  test('the hash moves with the language, the logo id, the owner, a line amount and the gateway switch', () => {
    const hash = feeNoticeHash(input)
    expect(feeNoticeHash({ ...input, language: 'en' })).not.toBe(hash)
    expect(feeNoticeHash({ ...input, logoFile: 'another-id' })).not.toBe(hash)
    expect(
      feeNoticeHash({ ...input, unit: { ...input.unit, ownerName: 'Nguyễn Văn B' } }),
    ).not.toBe(hash)
    const lines = input.lines.map((line, index) =>
      index === 0 ? { ...line, amount: 1_020_001 } : line,
    )
    expect(feeNoticeHash({ ...input, lines })).not.toBe(hash)
    expect(feeNoticeHash({ ...input, gatewayActive: true })).not.toBe(hash)
  })

  test('the key and the download name have the §8.1 shapes', () => {
    expect(feeNoticeKey('0192f3c4', '0192f3c5', 'both', 'abcdef0123456789')).toBe(
      'batch/0192f3c4/unit/0192f3c5/both/abcdef0123456789.pdf',
    )
    expect(feeNoticeFileName('PH-2610-01', 'A-1508')).toBe('PH-2610-01-A-1508.pdf')
  })

  test('a draft batch is carried as `draft` and a published one is not', () => {
    expect(input.draft).toBe(false)
    const draft = toFeeNoticeInput(
      { ...SOURCE, batch: { ...SOURCE.batch, status: 'draft' } },
      CONTEXT,
      'vi',
      null,
    )
    expect(draft.draft).toBe(true)
    expect(draft.building.logo).toBeNull()
    expect(draft.logoFile).toBe(BUILDING.logoFile)
  })
})
