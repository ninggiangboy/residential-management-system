import { Readable } from 'node:stream'
import ExcelJS from 'exceljs'
import type { WorkbookRead, WorkbookReader } from '../../application/ports'
import type { Cell } from '../../domain/fee-import/sheet'
import { MAX_ROWS } from '../../domain/fee-import/types'

/** An `exceljs` value reduced to what the fee rules read (DOC-18 §1.1): text, a number, a `Date` or nothing. */
function toCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value
  if (typeof value === 'boolean') return String(value)
  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  if ('result' in value) return toCell(value.result as ExcelJS.CellValue)
  return 'text' in value ? String(value.text) : null
}

const GIVE_UP_MS = 5000
const ZIP = [0x50, 0x4b, 0x03, 0x04]

/** DQ-01: a zip holding `xl/workbook.xml`; entry names are stored uncompressed, so nothing is unzipped to tell. */
function isWorkbook(bytes: Uint8Array): boolean {
  if (!ZIP.every((byte, index) => bytes[index] === byte)) return false
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('xl/workbook.xml')
}

const empty = (cell: Cell | undefined) =>
  cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')

/**
 * The fee file's first sheet through the streaming reader set up as DOC-18 §1.1 says (`styles: 'cache'` turns a date cell into a
 * `Date`, which DQ-65 reads); it stops at the 5,001st data row (DQ-05) and skips rows with no value.
 */
export class ExceljsFeeWorkbookReader implements WorkbookReader {
  read(bytes: Uint8Array): Promise<WorkbookRead> {
    if (!isWorkbook(bytes)) return Promise.resolve({ ok: false })
    // A truncated archive can leave the stream waiting for ever: give up inside the budget of NFR-12.
    const timeout = new Promise<WorkbookRead>((resolve) => {
      setTimeout(() => resolve({ ok: false }), GIVE_UP_MS).unref()
    })
    return Promise.race([this.firstSheet(bytes), timeout])
  }

  private async firstSheet(bytes: Uint8Array): Promise<WorkbookRead> {
    const stream = Readable.from([Buffer.from(bytes)])
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
      sharedStrings: 'cache',
      styles: 'cache',
      worksheets: 'emit',
      entries: 'emit',
      hyperlinks: 'ignore',
    })
    const data: { row: number; cells: Cell[] }[] = []
    let headers: (string | null)[] = []
    let tooMany = false
    try {
      for await (const worksheet of workbook) {
        for await (const row of worksheet) {
          const values: Cell[] = []
          row.eachCell({ includeEmpty: false }, (cell, column) => {
            values[column - 1] = toCell(cell.value)
          })
          const cells = Array.from(values, (cell) => cell ?? null)
          if (row.number === 1) headers = cells.map((cell) => (cell === null ? null : String(cell)))
          else if (!cells.every(empty)) {
            tooMany = data.length === MAX_ROWS
            if (tooMany) break
            data.push({ row: row.number, cells })
          }
        }
        break
      }
    } catch {
      return { ok: false }
    }
    return { ok: true, sheet: { headers, rows: data }, tooMany }
  }
}
