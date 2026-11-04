import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import ExcelJS from 'exceljs'
import { workbook, xlsxFile } from './xlsx'

/**
 * The finance harness (P2-16): the units a fee file needs, the fee workbook of E-71/E-72 and the create → import → commit →
 * publish walk through `W-Fee-Import` and `W-Fee-Batch`. The e2e seed builds SUNRISE-A with no units, so a spec creates its
 * own here — a fee row is refused for a unit that does not exist or has no owner (§4.3 of DOC-21).
 */

/** The header of the fee template (E-71), row 1 of `FEE_IMPORT_HEADERS.vi` of DOC-21 §2.1; a fee file has no personal data. */
export const FEE_HEADERS = [
  'Mã căn hộ',
  'Tháng phí',
  'Tên khoản',
  'Tên khoản (EN)',
  'Số lượng',
  'Đơn giá',
  'Thành tiền',
  'Loại',
  'Ghi chú',
] as const

const pad = (value: number) => String(value).padStart(2, '0')

/** `2026-11` from a date, the value of the fee-month field and the batch body. */
export const isoMonth = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`

/** `2026-11-20` from a date, the value of the due-date field. */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** `11/2026`, the form a fee row accepts and the template prints. */
export const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`

/**
 * The term of a new batch: the fee month of today and a due date comfortably ahead of the building day, so E-95's
 * `due_date_in_past` check never fires wherever the run happens.
 */
export function feeTerm(daysAhead = 20): { month: string; due: string } {
  const now = new Date()
  const due = new Date(now)
  due.setDate(due.getDate() + daysAhead)
  return { month: isoMonth(now), due: isoDay(due) }
}

/** A unit code of a run: `F1A2B3-1`. The row rule is 1–20 characters of `[A-Za-z0-9][A-Za-z0-9._/-]*` (DQ-64). */
export const unitCode = (tag: string, n: number) => `${tag}-${n}`

/** A login phone that is unique in a run: `09` and eight digits (the unit-owner import creates the owner's account). */
export const uniquePhone = () =>
  `09${String(10_000_000 + (Date.now() % 80_000_000) + Math.floor(Math.random() * 9_000)).slice(0, 8)}`

export interface UnitSeed {
  code: string
  ownerName: string
  ownerPhone?: string
  floor?: string | number
  bedrooms?: string | number
  area?: string | number
  /** `Đang ở`, `Trống` or `Cho thuê` (the residency import's vocabulary). */
  occupancy?: string
}

/**
 * Creates units with their owners through the unit-owner import (`W-Import`, `module: 'residency'`), the same way
 * `import.spec.ts` does: an owner is required for a fee row (§4.3). Leaves the page on the import result.
 */
export async function seedUnitsWithOwners(page: Page, units: readonly UnitSeed[]): Promise<void> {
  const rows = units.map((unit) => [
    unit.code,
    unit.floor ?? 5,
    unit.bedrooms ?? 2,
    unit.area ?? 68.5,
    unit.occupancy ?? 'Đang ở',
    unit.ownerName,
    unit.ownerPhone ?? uniquePhone(),
  ])
  await page.goto('/import')
  await page
    .locator('input[type=file]')
    .setInputFiles(xlsxFile('can-ho.xlsx', await workbook(rows)))
  await expect(page).toHaveURL(/importId=/)
  await expect(page.getByTestId('count-valid')).toHaveText(String(units.length))
  await page.getByRole('button', { name: /^Lưu \d+ dòng hợp lệ$/ }).click()
  await expect(page.getByRole('heading', { name: 'Đã lưu' })).toBeVisible()
}

export interface FeeRow {
  unitCode: string
  item: string
  itemEn?: string
  /** Default 1; a string is written as is (the reader takes `,` or `.` as the decimal mark). */
  quantity?: number | string
  unitPrice?: number
  amount?: number
  kind?: 'fee' | 'adjustment'
  note?: string
}

/** A fee-batch workbook with the header of E-71; `month` is `YYYY-MM` and is written as `MM/YYYY` in every row. */
export async function feeBatchWorkbook(rows: readonly FeeRow[], month: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Phí')
  sheet.addRow([...FEE_HEADERS])
  for (const row of rows) {
    sheet.addRow([
      row.unitCode,
      monthLabel(month),
      row.item,
      row.itemEn ?? null,
      row.quantity ?? null,
      row.unitPrice ?? null,
      row.amount ?? null,
      row.kind ?? null,
      row.note ?? null,
    ])
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}

export interface FeeBatchInput {
  name: string
  /** `YYYY-MM`. */
  month: string
  /** `YYYY-MM-DD`, on or after the building day. */
  due: string
  rows: readonly FeeRow[]
}

export interface BatchInfo {
  batchId: string
  code: string
  name: string
}

const batchIdOf = (url: string) => /\/fees\/([0-9a-f-]{36})/.exec(url)?.[1] ?? ''

/**
 * Creates the draft from `W-Fee-Import` (E-90), imports the workbook (E-72) and commits it (E-74). It drives the screen as
 * a person does — the settings, the file, "Kiểm tra", "Lưu nháp {n} dòng" — and leaves the page on the draft `W-Fee-Batch`.
 */
export async function createFeeBatch(page: Page, input: FeeBatchInput): Promise<BatchInfo> {
  await page.goto('/fees/import')
  // The fee month first: changing it rewrites a name still equal to the default.
  await page.getByTestId('fee-import-month').fill(input.month)
  await page.getByTestId('fee-import-due').fill(input.due)
  await page.getByTestId('fee-import-name').fill(input.name)
  await page
    .locator('input[type=file]')
    .setInputFiles(xlsxFile('dot-phi.xlsx', await feeBatchWorkbook(input.rows, input.month)))
  await expect(page.getByTestId('fee-import-check')).toBeEnabled()
  await page.getByTestId('fee-import-check').click()
  await expect(page.getByTestId('fee-import-preview')).toBeVisible()
  await page.getByTestId('save-batch').click()
  await expect(page.getByTestId('import-done')).toBeVisible()
  await page.getByTestId('result-open-batch').click()
  await expect(page).toHaveURL(/\/fees\/[0-9a-f-]{36}/)
  const code = (await page.getByTestId('batch-code').textContent())?.trim() ?? ''
  return { batchId: batchIdOf(page.url()), code, name: input.name }
}

/** `createFeeBatch`, then E-95 through the publish dialog; leaves the page on the published batch. */
export async function createPublishFeeBatch(page: Page, input: FeeBatchInput): Promise<BatchInfo> {
  const batch = await createFeeBatch(page, input)
  await page.getByTestId('publish').click()
  await page.getByTestId('publish-confirm').click()
  // The published header action is the settled signal: the toast may come and go.
  await expect(page.getByRole('link', { name: 'Xuất PDF hàng loạt' })).toBeVisible()
  return batch
}
