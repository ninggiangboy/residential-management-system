import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

/**
 * DOC-11 §10 row 6: `exceljs` reads and writes one xlsx under Bun, and streams 50,000 rows.
 * P1-13 owns the import tests; this file only keeps the compatibility check repeatable.
 */
const dir = mkdtempSync(join(tmpdir(), 'exceljs-'))

test('round-trips one workbook with Vietnamese text and a date', async () => {
  const file = join(dir, 'units.xlsx')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Căn hộ')
  sheet.addRow(['Mã căn', 'Chủ hộ', 'Ngày'])
  sheet.addRow(['A-1201', 'Nguyễn Văn A', new Date(Date.UTC(2026, 9, 9))])
  await workbook.xlsx.writeFile(file)

  const read = new ExcelJS.Workbook()
  await read.xlsx.readFile(file)
  const row = read.getWorksheet('Căn hộ')?.getRow(2)
  expect(row?.getCell(2).value).toBe('Nguyễn Văn A')
  expect(row?.getCell(3).value).toEqual(new Date(Date.UTC(2026, 9, 9)))
})

test('streams 50,000 rows out and back in', async () => {
  const file = join(dir, 'big.xlsx')
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file })
  const sheet = writer.addWorksheet('rows')
  for (let i = 1; i <= 50_000; i++) sheet.addRow([i, `Căn ${i}`]).commit()
  await sheet.commit()
  await writer.commit()

  let count = 0
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {})
  for await (const ws of reader) for await (const _row of ws) count++
  expect(count).toBe(50_000)
})

test('cleanup', () => rmSync(dir, { recursive: true, force: true }))
