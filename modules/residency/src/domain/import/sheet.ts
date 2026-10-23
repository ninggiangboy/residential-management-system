import { columnOfHeader, type UnitOwnerColumn } from './columns'

/** A cell as the reader hands it over: a number stays a number, because DQ-22 depends on it (DOC-18 §1.1). */
export type Cell = string | number | Date | null

/** The first sheet of the file as the reader saw it: row 1 as header texts, then the non-blank data rows. */
export interface Sheet {
  /** Texts of row 1 by column index; `null` for an empty header cell. */
  headers: readonly (string | null)[]
  rows: readonly { row: number; cells: readonly Cell[] }[]
}

export type FileFailureCode =
  | 'import_file_type'
  | 'import_no_header'
  | 'import_duplicate_column'
  | 'import_empty'

export type RawRow = { row: number; cells: Partial<Record<UnitOwnerColumn, Cell>> }

export type ReadSheet =
  | { ok: false; code: FileFailureCode; params: Record<string, string> }
  | {
      ok: true
      /** Header texts that matched no alias, in file order (DQ-06). */
      unknownColumns: string[]
      rows: RawRow[]
    }

/** DQ-02, DQ-03, DQ-04 and DQ-06: which column is which, and whether the file can be read at all. */
export function readSheet(sheet: Sheet): ReadSheet {
  const indexOf = new Map<UnitOwnerColumn, number>()
  const unknownColumns: string[] = []
  for (const [index, header] of sheet.headers.entries()) {
    const text = header?.trim()
    if (!text) continue
    const column = columnOfHeader(text)
    if (column === null) {
      unknownColumns.push(text)
      continue
    }
    if (indexOf.has(column))
      return { ok: false, code: 'import_duplicate_column', params: { column } }
    indexOf.set(column, index)
  }
  if (!indexOf.has('unit_code')) return { ok: false, code: 'import_no_header', params: {} }
  if (sheet.rows.length === 0) return { ok: false, code: 'import_empty', params: {} }
  const rows = sheet.rows.map(({ row, cells }) => {
    const mapped: RawRow['cells'] = {}
    for (const [column, index] of indexOf) mapped[column] = cells[index] ?? null
    return { row, cells: mapped }
  })
  return { ok: true, unknownColumns, rows }
}
