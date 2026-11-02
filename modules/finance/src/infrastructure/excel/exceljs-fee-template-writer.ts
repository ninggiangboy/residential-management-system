import type { Language } from '@rms/shared-types'
import ExcelJS from 'exceljs'
import type { TemplateWriter } from '../../application/ports'
import {
  FEE_COLUMNS,
  FEE_TEMPLATE_EXAMPLES,
  FEE_TEMPLATE_HEADERS,
  FEE_TEMPLATE_SHEET_NAMES,
  FEE_TEXT_COLUMNS,
} from '../../domain/fee-import/columns'

/** E-71 for `fee_batch`: the first sheet named `Phí` or `Fees`, row 1 the header, one example row per kind (DOC-18 §2.1). */
export class ExceljsFeeTemplateWriter implements TemplateWriter {
  async write(language: Language): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(FEE_TEMPLATE_SHEET_NAMES[language])
    const headers = FEE_TEMPLATE_HEADERS[language]
    sheet.columns = FEE_COLUMNS.map((column) => ({
      header: headers[column],
      key: column,
      width: Math.max(14, headers[column].length + 4),
      style: FEE_TEXT_COLUMNS.includes(column) ? { numFmt: '@' } : {},
    }))
    sheet.getRow(1).font = { bold: true }
    for (const example of FEE_TEMPLATE_EXAMPLES[language]) sheet.addRow(example)
    return new Uint8Array(await workbook.xlsx.writeBuffer())
  }
}
