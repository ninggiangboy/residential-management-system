import { describe, expect, test } from 'bun:test'
import { Readable } from 'node:stream'
import ExcelJS from 'exceljs'
import { columnOfHeader, TEMPLATE_HEADERS } from '../../domain/import/columns'
import { parseBirthDate } from '../../domain/import/row-rules'
import { ExceljsTemplateWriter, ExceljsWorkbookReader } from './exceljs-workbook'

const reader = new ExceljsWorkbookReader()

async function bytesOf(fill: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  fill(workbook.addWorksheet('Căn hộ'))
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

describe('IM-01 a file that is not a workbook', () => {
  test('a CSV, a zip with the wrong content and nothing at all are not read', async () => {
    expect(await reader.read(new TextEncoder().encode('Mã căn hộ,Tầng\nA-1,3\n'))).toEqual({
      ok: false,
    })
    expect(await reader.read(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toEqual({ ok: false })
    expect(await reader.read(new Uint8Array())).toEqual({ ok: false })
  })
})

describe('reading the first sheet', () => {
  test('headers, numbers kept as numbers, Excel row numbers, blank rows skipped', async () => {
    const read = await reader.read(
      await bytesOf((sheet) => {
        sheet.addRow(['Mã căn hộ', 'Tầng', 'CCCD chủ hộ'])
        sheet.addRow(['A-1', 12, 79085012345])
        sheet.addRow([])
        sheet.addRow([null, '  ', null])
        sheet.addRow(['A-2', '13', '079085012345'])
      }),
    )
    expect(read).toEqual({
      ok: true,
      tooMany: false,
      sheet: {
        headers: ['Mã căn hộ', 'Tầng', 'CCCD chủ hộ'],
        rows: [
          { row: 2, cells: ['A-1', 12, 79085012345] },
          { row: 5, cells: ['A-2', '13', '079085012345'] },
        ],
      },
    })
  })

  test('IM-18 a date cell is a Date with styles cached, and both give 1985-04-03', async () => {
    const read = await reader.read(
      await bytesOf((sheet) => {
        sheet.addRow(['Mã căn hộ', 'Ngày sinh'])
        sheet.addRow(['A-1', new Date(Date.UTC(1985, 3, 3))])
      }),
    )
    if (!read.ok) throw new Error('unreadable')
    const cell = read.sheet.rows[0]?.cells[1]
    expect(cell).toBeInstanceOf(Date)
    expect(parseBirthDate(cell, '2026-10-19')).toBe('1985-04-03')
    // Without the cache the same cell is the serial 31140, which the date rule accepts as well.
    const bytes = await bytesOf((sheet) => {
      sheet.addRow(['Mã căn hộ', 'Ngày sinh'])
      sheet.addRow(['A-1', new Date(Date.UTC(1985, 3, 3))])
    })
    const plain = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(bytes)]), {
      sharedStrings: 'cache',
      worksheets: 'emit',
      entries: 'emit',
    })
    let serial: unknown
    for await (const sheet of plain)
      for await (const row of sheet) if (row.number === 2) serial = row.getCell(2).value
    expect(serial).toBe(31140)
    expect(parseBirthDate(serial as number, '2026-10-19')).toBe('1985-04-03')
  })

  test('IM-05 5,000 data rows are read, the 5,001st stops the reader', async () => {
    const make = (rows: number) =>
      bytesOf((sheet) => {
        sheet.addRow(['Mã căn hộ'])
        for (let i = 1; i <= rows; i++) sheet.addRow([`A-${i}`])
      })
    const exact = await reader.read(await make(5000))
    expect(exact).toMatchObject({ ok: true, tooMany: false })
    if (exact.ok) expect(exact.sheet.rows).toHaveLength(5000)
    expect(await reader.read(await make(5001))).toMatchObject({ ok: true, tooMany: true })
  })

  test('a workbook with only a header has no rows', async () => {
    const read = await reader.read(await bytesOf((sheet) => sheet.addRow(['Mã căn hộ'])))
    expect(read).toMatchObject({ ok: true, sheet: { rows: [] } })
  })
})

describe('the template of E-71', () => {
  test.each(['vi', 'en'] as const)(
    '%s: the sheet, the header row and the Text columns',
    async (language) => {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(
        (await new ExceljsTemplateWriter().write(language)).buffer as ArrayBuffer,
      )
      const sheet = workbook.worksheets[0]
      expect(sheet?.name).toBe(language === 'vi' ? 'Căn hộ' : 'Units')
      expect(sheet?.rowCount).toBe(1)
      const headers = Object.values(TEMPLATE_HEADERS[language])
      expect(sheet?.getRow(1).values).toEqual([undefined, ...headers])
      // The reader of the same file finds every column (the header matching round trip).
      expect(headers.map((header) => columnOfHeader(header))).not.toContain(null)
      expect(sheet?.getColumn(7).numFmt).toBe('@')
      expect(sheet?.getColumn(2).numFmt).toBeUndefined()
    },
  )
})
