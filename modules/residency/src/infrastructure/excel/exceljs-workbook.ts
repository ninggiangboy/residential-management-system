import { Readable } from 'node:stream'
import type { Language } from '@rms/shared-types'
import ExcelJS from 'exceljs'
import type { TemplateWriter, WorkbookRead, WorkbookReader } from '../../application/ports'
import {
  TEMPLATE_HEADERS,
  TEMPLATE_SHEET_NAMES,
  TEXT_COLUMNS,
  UNIT_OWNER_COLUMNS,
} from '../../domain/import/columns'
import type { Cell } from '../../domain/import/sheet'
import { MAX_ROWS } from '../../domain/import/types'

/** A cell value as `exceljs` hands it over, reduced to what the rules read (DOC-18 §1.1): text, a number, a `Date` or nothing. */
function cellOf(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value
  if (typeof value === 'boolean') return String(value)
  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  if ('result' in value) return cellOf(value.result as ExcelJS.CellValue)
  if ('text' in value) return String(value.text)
  return null
}

const READ_TIMEOUT_MS = 5000
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const WORKBOOK_ENTRY = Buffer.from('xl/workbook.xml')

/** DQ-01: a zip that holds `xl/workbook.xml`. The entry names of an archive are stored uncompressed, so no unzipping is needed. */
const looksLikeWorkbook = (bytes: Uint8Array) =>
  ZIP_MAGIC.every((byte, index) => bytes[index] === byte) &&
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(WORKBOOK_ENTRY)

const isBlank = (cell: Cell) => cell === null || (typeof cell === 'string' && cell.trim() === '')

/**
 * Reads the first sheet with the streaming reader, as DOC-18 §1.1 sets it up: `styles: 'cache'` makes a date cell a `Date` and not
 * a serial, and the reader stops at the 5,001st data row (DQ-05). Rows with no value are skipped and not counted.
 */
export class ExceljsWorkbookReader implements WorkbookReader {
  async read(bytes: Uint8Array): Promise<WorkbookRead> {
    if (!looksLikeWorkbook(bytes)) return { ok: false }
    // A truncated archive that passes the check above can leave the stream waiting for ever: give up inside the budget of NFR-12.
    const gaveUp = new Promise<WorkbookRead>((resolve) =>
      setTimeout(() => resolve({ ok: false }), READ_TIMEOUT_MS).unref(),
    )
    return Promise.race([this.parse(bytes), gaveUp])
  }

  private async parse(bytes: Uint8Array): Promise<WorkbookRead> {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(bytes)]), {
      sharedStrings: 'cache',
      styles: 'cache',
      worksheets: 'emit',
      entries: 'emit',
      hyperlinks: 'ignore',
    })
    let headers: (string | null)[] = []
    const rows: { row: number; cells: Cell[] }[] = []
    let tooMany = false
    try {
      for await (const sheet of reader) {
        for await (const row of sheet) {
          const cells: Cell[] = []
          row.eachCell({ includeEmpty: false }, (cell, column) => {
            cells[column - 1] = cellOf(cell.value)
          })
          if (row.number === 1) {
            headers = Array.from(cells, (cell) =>
              cell === null || cell === undefined ? null : String(cell),
            )
            continue
          }
          if (Array.from(cells).every((cell) => cell === undefined || isBlank(cell))) continue
          if (rows.length === MAX_ROWS) {
            tooMany = true
            break
          }
          rows.push({ row: row.number, cells: Array.from(cells, (cell) => cell ?? null) })
        }
        break
      }
    } catch {
      return { ok: false }
    }
    return { ok: true, sheet: { headers, rows }, tooMany }
  }
}

/** The template of E-71: the first sheet named after the language, one header row, Text format where Excel would drop a zero. */
export class ExceljsTemplateWriter implements TemplateWriter {
  async write(language: Language): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(TEMPLATE_SHEET_NAMES[language])
    const headers = TEMPLATE_HEADERS[language]
    sheet.columns = UNIT_OWNER_COLUMNS.map((column) => ({
      header: headers[column],
      key: column,
      width: Math.max(14, headers[column].length + 4),
      style: (TEXT_COLUMNS as readonly string[]).includes(column) ? { numFmt: '@' } : {},
    }))
    sheet.getRow(1).font = { bold: true }
    return new Uint8Array(await workbook.xlsx.writeBuffer())
  }
}
