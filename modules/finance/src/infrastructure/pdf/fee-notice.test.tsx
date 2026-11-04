import { expect, setDefaultTimeout, test } from 'bun:test'
import { renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '@rms/pdf-assets'
import { extractPdfPages, extractPdfText } from '@rms/pdf-assets/testing'
import type { LocalDate } from '@rms/shared-types'
import type { FeeNoticeInput, PdfChargeLine } from '../../application/pdf-renderer'
import { FeeNoticeDocument } from './fee-notice'

registerFonts()
// Each text check starts `uv run` (pypdf), about 2 s; the 5 s default is too tight on a cold cache.
setDefaultTimeout(30_000)

/** The fee notice of DOC-34 §6.2 as `both`; each test overrides one field (PD-01 … PD-29, §16.1). */
const FIXTURE: FeeNoticeInput = {
  kind: 'fee_notice',
  language: 'both',
  draft: false,
  building: {
    name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
    company: {
      name: {
        vi: 'Công ty TNHH Quản lý Tòa nhà Sunrise',
        en: 'Sunrise Building Management Co., Ltd.',
      },
      address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
    },
    address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
    hotline: '1900 1234',
    email: 'bql@sunrise.vn',
    workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: 'Mon – Fri, 8:00 – 17:00' },
    logo: null,
  },
  gatewayActive: true,
  unit: { code: 'A-1508', ownerName: 'Trần Minh Anh' },
  batch: {
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10',
    dueDate: '2026-10-15' as LocalDate,
    issueDate: '2026-10-01' as LocalDate,
  },
  lines: [
    {
      position: 1,
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '85',
      unitPrice: 12000,
      amount: 1020000,
      kind: 'normal',
      note: null,
    },
    {
      position: 2,
      itemName: { vi: 'Nước sinh hoạt', en: 'Water' },
      quantity: '14',
      unitPrice: 12000,
      amount: 168000,
      kind: 'normal',
      note: null,
    },
    {
      position: 3,
      itemName: { vi: 'Điều chỉnh', en: 'Adjustment' },
      quantity: '1',
      unitPrice: 35175,
      amount: -35175,
      kind: 'adjustment',
      note: 'Trừ phí nước tính thừa T9',
    },
  ],
  total: 1152825,
}

async function render(input: FeeNoticeInput): Promise<Uint8Array> {
  return renderToBuffer(<FeeNoticeDocument input={input} />)
}

/** `count` numbered fee lines with unique names, so a document needs more than one page (PD-05, PD-06). */
function manyLines(count: number): PdfChargeLine[] {
  return Array.from({ length: count }, (_, at) => ({
    position: at + 1,
    itemName: { vi: `Khoản phí số ${String(at + 1).padStart(2, '0')}` },
    quantity: '1',
    unitPrice: 1000 + at,
    amount: 1000 + at,
    kind: 'normal' as const,
    note: null,
  }))
}

/** PD-01: the fee notice of §6.2 opens in `vi`, `en` and `both` (DOC-34 §5, §6.2, FR-36.1). */
test('PD-01 the §6.2 notice opens in vi, en and both (DOC-34 §5, §6.2)', async () => {
  const vi = await extractPdfText(await render({ ...FIXTURE, language: 'vi' }))
  expect(vi).toContain('THÔNG BÁO PHÍ THÁNG 10/2026')
  expect(vi).toContain('1.152.825')
  expect(vi).toContain('15/10/2026')
  const en = await extractPdfText(await render({ ...FIXTURE, language: 'en' }))
  expect(en).toContain('FEE NOTICE FOR OCTOBER 2026')
  expect(en).toContain('₫1,152,825')
  expect(en).toContain('Oct 15, 2026')
  const both = await extractPdfText(await render({ ...FIXTURE, language: 'both' }))
  expect(both).toContain('THÔNG BÁO PHÍ THÁNG 10/2026')
  expect(both).toContain('Fee notice for October 2026')
  expect(both).toContain('1.152.825')
  expect(both).toContain('15/10/2026')
})

/** PD-02: every Vietnamese tone mark round-trips and Be Vietnam Pro is embedded (DOC-34 §3, §16.1). */
test('PD-02 every Vietnamese tone mark round-trips in Be Vietnam Pro (DOC-34 §3)', async () => {
  const name = 'Nguyễn Thị Ánh Nguyệt, ỷ ỹ ự ữ'
  const bytes = await render({
    ...FIXTURE,
    lines: [
      {
        position: 1,
        itemName: { vi: name },
        quantity: '1',
        unitPrice: 1000,
        amount: 1000,
        kind: 'normal',
        note: null,
      },
    ],
  })
  expect(await extractPdfText(bytes)).toContain(name)
  expect(Buffer.from(bytes).toString('latin1')).toContain('BeVietnamPro')
})

/** PD-03: an item name without `en` prints the `vi` name once in `en` and `both` (DOC-34 §5). */
test('PD-03 an item name without en prints the vi name once (DOC-34 §5)', async () => {
  const lines: PdfChargeLine[] = [
    {
      position: 1,
      itemName: { vi: 'Phí quản lý' },
      quantity: '1',
      unitPrice: 1000,
      amount: 1000,
      kind: 'normal',
      note: null,
    },
  ]
  expect(await extractPdfText(await render({ ...FIXTURE, language: 'en', lines }))).toContain(
    'Phí quản lý',
  )
  const both = await extractPdfText(await render({ ...FIXTURE, language: 'both', lines }))
  expect(both.split('Phí quản lý')).toHaveLength(2)
})

/** PD-04: an adjustment prints its note as the basis and a U+2212 amount (DOC-34 §6.1, DR-19). */
test('PD-04 an adjustment prints its note and a U+2212 amount (DOC-34 §6.1)', async () => {
  const text = await extractPdfText(await render({ ...FIXTURE, language: 'vi' }))
  expect(text).toContain('Trừ phí nước tính thừa T9')
  expect(text).toContain('−35.175')
})

/** PD-05: 60 lines span two or more pages, no row splits, the footer is on the last page (DOC-34 §5). */
test('PD-05 sixty lines span pages with no row split (DOC-34 §5)', async () => {
  const lines = manyLines(60)
  const pages = await extractPdfPages(await render({ ...FIXTURE, lines }))
  expect(pages.length).toBeGreaterThanOrEqual(2)
  for (const line of lines) {
    const onPages = pages.filter((page) => page.includes(line.itemName.vi)).length
    expect(onPages).toBe(1)
  }
  const last = pages[pages.length - 1] ?? ''
  expect(last).toContain('Tổng cộng')
  expect(last).toContain(`Trang ${pages.length}/${pages.length}`)
  expect(last).toContain(`Page ${pages.length} of ${pages.length}`)
})

/** PD-06: a draft batch prints the draft mark on every page (DOC-34 §6.1, DR-292). */
test('PD-06 a draft batch prints the draft mark on every page (DOC-34 §6.1)', async () => {
  const pages = await extractPdfPages(
    await render({ ...FIXTURE, draft: true, lines: manyLines(40) }),
  )
  expect(pages.length).toBeGreaterThanOrEqual(2)
  for (const page of pages) {
    expect(page).toContain('BẢN NHÁP')
    expect(page).toContain('DRAFT')
  }
})

/** PD-07: the how-to-pay block follows the gateway state and the working hours (DOC-34 §6.1). */
test('PD-07 the how-to-pay block follows the gateway and working hours (DOC-34 §6.1)', async () => {
  const active = await extractPdfText(await render({ ...FIXTURE, gatewayActive: true }))
  expect(active).toContain('Thanh toán trên App cư dân bằng mã QR')
  expect(active).toContain('Nộp tại văn phòng Ban quản lý')
  const none = await extractPdfText(
    await render({
      ...FIXTURE,
      gatewayActive: false,
      building: { ...FIXTURE.building, workingHours: null },
    }),
  )
  expect(none).not.toContain('Hướng dẫn nộp phí')
  expect(none).not.toContain('How to pay')
})

/** PD-08: a unit without an active owner prints an em dash (DOC-34 §6.1). */
test('PD-08 a unit without an active owner prints an em dash (DOC-34 §6.1)', async () => {
  const text = await extractPdfText(
    await render({ ...FIXTURE, unit: { code: 'A-1508', ownerName: null } }),
  )
  expect(text).toContain('Chủ hộ')
  expect(text).toContain('—')
})

/** PD-14: a decimal quantity uses the language decimal separator (DOC-34 §7.2, §16.1). */
test('PD-14 a decimal quantity uses the language decimal separator (DOC-34 §7.2)', async () => {
  const lines: PdfChargeLine[] = [
    {
      position: 1,
      itemName: { vi: 'Nước' },
      quantity: '12.345',
      unitPrice: 15000,
      amount: 185175,
      kind: 'normal',
      note: null,
    },
  ]
  const vi = await extractPdfText(await render({ ...FIXTURE, language: 'vi', lines }))
  expect(vi).toContain('12,345')
  const en = await extractPdfText(await render({ ...FIXTURE, language: 'en', lines }))
  expect(en).toContain('12.345')
})

/** PD-29: the same input renders byte-identical with no creation date (DOC-34 §5). */
test('PD-29 the same input renders byte-identical (DOC-34 §5)', async () => {
  const first = await render(FIXTURE)
  const second = await render(FIXTURE)
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
})
