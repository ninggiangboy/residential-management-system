import { type FeeColumn, feeColumnOfHeader, REQUIRED_COLUMNS } from './columns'

/** A cell as the reader hands it over: a number stays a number and a date cell is a `Date` (DOC-18 §1.1, DQ-65). */
export type Cell = string | number | Date | null

/** The first sheet as the reader saw it: row 1 as header texts, then the non-blank data rows. */
export interface Sheet {
  readonly headers: readonly (string | null)[]
  readonly rows: readonly { readonly row: number; readonly cells: readonly Cell[] }[]
}

export type FeeFileFailure =
  | 'import_file_type'
  | 'import_duplicate_column'
  | 'import_missing_column'
  | 'import_no_price'
  | 'import_empty'

export interface FeeRawRow {
  readonly row: number
  readonly cells: Partial<Record<FeeColumn, Cell>>
}

export type ReadFeeSheet =
  | { readonly ok: false; readonly code: FeeFileFailure; readonly params: Record<string, string> }
  | {
      readonly ok: true
      readonly unknownColumns: readonly string[]
      readonly rows: readonly FeeRawRow[]
    }

/** The file layer of the fee file: DQ-03, DQ-62, DQ-63, DQ-04 and DQ-06, in that order (DOC-18 §2.2). DQ-02 does not run. */
export function readFeeSheet(sheet: Sheet): ReadFeeSheet {
  const indexOf = new Map<FeeColumn, number>()
  const unknownColumns: string[] = []
  for (const [index, header] of sheet.headers.entries()) {
    const text = header?.trim()
    if (!text) continue
    const column = feeColumnOfHeader(text)
    if (column === null) {
      unknownColumns.push(text)
      continue
    }
    if (indexOf.has(column))
      return { ok: false, code: 'import_duplicate_column', params: { column } }
    indexOf.set(column, index)
  }
  const missing = REQUIRED_COLUMNS.filter((column) => !indexOf.has(column))
  if (missing.length > 0)
    return { ok: false, code: 'import_missing_column', params: { columns: missing.join(', ') } }
  if (!indexOf.has('unit_price') && !indexOf.has('amount'))
    return { ok: false, code: 'import_no_price', params: {} }
  if (sheet.rows.length === 0) return { ok: false, code: 'import_empty', params: {} }
  const rows = sheet.rows.map(({ row, cells }) => {
    const mapped: FeeRawRow['cells'] = {}
    for (const [column, index] of indexOf) mapped[column] = cells[index] ?? null
    return { row, cells: mapped }
  })
  return { ok: true, unknownColumns, rows }
}
