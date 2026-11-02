import type { LocalDate } from '@rms/shared-types'
import { type ChargeLine, checkChargeLine } from '../charge-line'
import type { FeeColumn } from './columns'
import { foldKey } from './folding'
import type { Cell, FeeRawRow } from './sheet'
import type { FeeImportIssue } from './types'

/** A row after the row layer: the trimmed code, its matching key, the line when every rule held, and what the rules found. */
export interface ParsedFeeRow {
  readonly row: number
  /** Trimmed as typed, `null` when blank: what the issue and the preview show. */
  readonly unitCode: string | null
  /** `lower(code)` when the code is well formed: the key of the `db` layer (DOC-21 §4.3) and of the set rules. */
  readonly codeKey: string | null
  readonly line: ChargeLine | null
  readonly issues: readonly FeeImportIssue[]
}

const UNIT_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$/ // DQ-64, as DQ-10
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

const textOf = (cell: Cell | undefined): string | null => {
  if (cell === null || cell === undefined) return null
  const text = cell instanceof Date ? cell.toISOString() : String(cell).trim()
  return text === '' ? null : text
}

/** A number cell stays a number for the line rules; text is trimmed; a date in a number column reads as text and fails. */
const numberOrText = (cell: Cell | undefined): string | number | null =>
  typeof cell === 'number' ? cell : textOf(cell)

const monthOf = (year: number, month: number): LocalDate | null =>
  month >= 1 && month <= 12 && year >= 1900 && year <= 9999
    ? (`${year}-${String(month).padStart(2, '0')}-01` as LocalDate)
    : null

/**
 * DQ-65: `MM/YYYY` (the zero optional), `YYYY-MM`, a date cell or an Excel serial; the day is ignored. The first of the month, or
 * `null`. A date cell is read in UTC, the way `exceljs` builds it from the serial.
 */
export function parseFeeMonth(cell: Cell | undefined): LocalDate | null {
  if (cell instanceof Date)
    return Number.isNaN(cell.getTime())
      ? null
      : monthOf(cell.getUTCFullYear(), cell.getUTCMonth() + 1)
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell < 1) return null
    const day = new Date(EXCEL_EPOCH_MS + Math.floor(cell) * DAY_MS)
    return monthOf(day.getUTCFullYear(), day.getUTCMonth() + 1)
  }
  const text = textOf(cell)
  if (text === null) return null
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(text)
  if (slash) return monthOf(Number(slash[2]), Number(slash[1]))
  const iso = /^(\d{4})-(\d{2})$/.exec(text)
  return iso ? monthOf(Number(iso[1]), Number(iso[2])) : null
}

/** `2026-10-01` → `10/2026`, the form the texts of DQ-66 show. */
const monthText = (month: LocalDate): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`

/** DQ-68 compared by key (DOC-18 §2.1): `phí` and `điều chỉnh` in any case or composition; anything else reaches the rule as typed. */
function kindText(cell: Cell | undefined): string | null {
  const text = textOf(cell)
  if (text === null) return null
  const key = foldKey(text)
  if (key === 'fee' || key === 'phi') return 'fee'
  if (key === 'adjustment' || key === 'dieuchinh') return 'adjustment'
  return text
}

/** The row layer of DOC-18 §2.2 (DQ-64…DQ-74) on one row; every issue of the row is reported, not only the first. */
export function parseFeeRow(raw: FeeRawRow, batchFeeMonth: LocalDate): ParsedFeeRow {
  const { cells } = raw
  const unitCode = textOf(cells.unit_code)
  const codeKey = unitCode !== null && UNIT_CODE.test(unitCode) ? unitCode.toLowerCase() : null
  const issues: FeeImportIssue[] = []
  const add = (column: FeeColumn, code: string, params: Record<string, string | number> = {}) =>
    issues.push({ row: raw.row, unitCode, column, severity: 'error', code, params })

  if (codeKey === null) add('unit_code', 'unit_code_invalid')
  const month = parseFeeMonth(cells.fee_month)
  if (month === null) add('fee_month', 'fee_month_invalid')
  else if (month !== batchFeeMonth)
    add('fee_month', 'fee_month_mismatch', {
      expected: monthText(batchFeeMonth),
      got: monthText(month),
    })

  const checked = checkChargeLine({
    kind: kindText(cells.kind),
    itemName: textOf(cells.item_name) ?? '',
    itemNameEn: textOf(cells.item_name_en),
    quantity: numberOrText(cells.quantity),
    unitPrice: numberOrText(cells.unit_price),
    amount: numberOrText(cells.amount),
    note: textOf(cells.note),
  })
  if (!checked.ok)
    for (const issue of checked.issues) add(issue.column, issue.code, { ...issue.params })
  const line = checked.ok && issues.length === 0 ? checked.line : null
  return { row: raw.row, unitCode, codeKey, line, issues }
}
