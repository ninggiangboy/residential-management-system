import ExcelJS from 'exceljs'

const HEADER = [
  'Mã căn hộ',
  'Tầng',
  'Số phòng ngủ',
  'Diện tích (m²)',
  'Tình trạng',
  'Họ tên chủ hộ',
  'SĐT chủ hộ',
]

/** An unit-and-owner workbook with the header of the template (E-71); each row is the seven cells. */
export async function workbook(
  rows: readonly (readonly (string | number)[])[],
  header: readonly string[] = HEADER,
) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Căn hộ')
  for (const row of [header, ...rows]) sheet.addRow([...row])
  return Buffer.from(await book.xlsx.writeBuffer())
}

export const xlsxFile = (name: string, buffer: Buffer) => ({
  name,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer,
})
