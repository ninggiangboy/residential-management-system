import { expect, setDefaultTimeout, test } from 'bun:test'
import { renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '@rms/pdf-assets'
import { extractPdfPages, extractPdfText, extractPdfTextItems } from '@rms/pdf-assets/testing'
import type { LocalDate } from '@rms/shared-types'
import type { ReceiptInput } from '../../application/pdf-renderer'
import { ReceiptDocument } from './receipt'

registerFonts()
// Each text check starts `uv run` (pypdf), about 2 s; the 5 s default is too tight on a cold cache.
setDefaultTimeout(30_000)

/** The receipt of DOC-15 §7.3 as `both`; each test overrides one field (PD-10 … PD-13, PD-29, §16.1). */
const FIXTURE: ReceiptInput = {
  kind: 'receipt',
  language: 'both',
  number: 'BL-2610-0153',
  issuedAt: '2026-10-09T02:12:42Z',
  paidAt: '2026-10-09T02:12:41Z',
  payer: { name: 'Trần Minh Anh', memberType: 'owner' },
  unit: { code: 'A-1508' },
  batch: {
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
  },
  items: [
    {
      position: 1,
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: 2488000,
      amount: 2488000,
      kind: 'normal',
      note: null,
    },
    {
      position: 2,
      itemName: { vi: 'Nước', en: 'Water' },
      quantity: '12.345',
      unitPrice: 15000,
      amount: 185175,
      kind: 'normal',
      note: null,
    },
    {
      position: 3,
      itemName: { vi: 'Điều chỉnh', en: 'Adjustment' },
      quantity: '1',
      unitPrice: 0,
      amount: -35175,
      kind: 'adjustment',
      note: 'Trừ phí nước tính thừa tháng 9',
    },
  ],
  amount: 2638000,
  method: 'online',
  reference: 'FT2628273914',
  building: { name: { vi: 'Chung cư Sunrise', en: 'Sunrise Residences' } },
  company: {
    name: { vi: 'Công ty Quản lý Vận hành An Phú', en: 'An Phu Property Management Co.' },
    address: '12 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh',
    hotline: '028 3775 1234',
  },
  logo: null,
  void: null,
}

const render = (input: ReceiptInput): Promise<Uint8Array> =>
  renderToBuffer(<ReceiptDocument input={input} />)

/** pypdf breaks a wrapped line with a newline; flatten whitespace so a full sentence matches (DOC-34 §7.1). */
const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** The title and the tax statement of DOC-34 §7.1 stay bilingual in every mode (DR-17, DR-295). */
const TITLE = 'BIÊN LAI THU TIỀN / PAYMENT RECEIPT'
const STATEMENT =
  'Biên lai này xác nhận khoản đã thu, không phải hóa đơn giá trị gia tăng. / This receipt confirms a payment received. It is not a VAT invoice.'

/** PD-10: the receipt of DOC-15 §7.3 in `vi` (DOC-34 §7.1, §7.2, FR-36.2). */
test('PD-10 the receipt of DOC-15 §7.3 prints in vi (DOC-34 §7.1)', async () => {
  const text = flat(await extractPdfText(await render({ ...FIXTURE, language: 'vi' })))
  expect(text).toContain(TITLE)
  expect(text).toContain(STATEMENT)
  expect(text).toContain('BL-2610-0153')
  expect(text).toContain('2.638.000')
  expect(text).toContain('Hai triệu sáu trăm ba mươi tám nghìn đồng')
})

/** PD-11: the same receipt in `en`; the title and statement stay bilingual (DOC-34 §7.1, §7.3, FR-36.1). */
test('PD-11 the same receipt in en keeps the bilingual title and statement (DOC-34 §7.1)', async () => {
  const pages = await extractPdfPages(await render({ ...FIXTURE, language: 'en' }))
  const text = flat(pages.join('\n'))
  expect(text).toContain(TITLE)
  expect(text).toContain(STATEMENT)
  expect(text).toContain('₫2,638,000')
  // pypdf splits kerned pairs ("T wo"), so the words are compared without spaces.
  expect(text.replace(/\s+/g, '')).toContain(
    'Two million six hundred thirty-eight thousand dong'.replace(/\s+/g, ''),
  )
})

/** PD-12: the void copy stamps VOID on every page and keeps the number (DOC-34 §7.1, FR-36.3). */
test('PD-12 the void copy stamps VOID and keeps the number (DOC-34 §7.1)', async () => {
  // DOC-34 §7.2: one receipt covers one charge (DR-17), so a receipt is always one page; there is no 2-page case.
  const pages = await extractPdfPages(
    await render({ ...FIXTURE, void: { voidedOn: '2026-10-12' as LocalDate, reason: null } }),
  )
  expect(pages.length).toBe(1)
  for (const page of pages) expect(page).toContain('VOID')
  const text = flat(pages.join('\n'))
  expect(text).toContain('ĐÃ HỦY ngày 12/10/2026')
  expect(text).toContain('BL-2610-0153')
  expect(text).not.toContain('BL-2610-0154')
})

/** PD-13: the same input renders byte-identical (DOC-34 §7.1, PD-29). */
test('PD-13 the same input renders byte-identical (DOC-34 §7.1)', async () => {
  // The real PD-13 also renders again from the same snapshot after the company name and logo change and expects
  // byte-identical PDFs (FR-36.2); that half belongs to the cache slice that builds the snapshot, so here the same
  // input is rendered twice (DOC-34 §7.1, DR-17).
  const first = await render(FIXTURE)
  const second = await render(FIXTURE)
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
})

/** The footer of DOC-34 §5 sits in the 48 pt bottom margin on every page (like page-footer.test.tsx). */
test('the receipt footer sits in the bottom margin (DOC-34 §5)', async () => {
  const items = await extractPdfTextItems(await render({ ...FIXTURE, language: 'vi' }))
  const footer = items.find((item) => item.page === 1 && item.text.includes('Trang 1/1'))
  expect(footer).toBeDefined()
  // The footer sits in the 48 pt bottom margin: below the content (y > 794), above the edge (y < 842).
  expect(footer?.y).toBeGreaterThan(794)
  expect(footer?.y).toBeLessThan(842)
})
