import { expect, test } from 'bun:test'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import type { MoneyColumn, MoneyRow } from './money-table'
import { MoneyTable } from './money-table'
import { PageFrame } from './page-frame'

registerFonts()

/** Two columns and three rows of DOC-34 §6.2, with a total (DOC-34 §5). */
const COLUMNS: readonly MoneyColumn[] = [
  { key: 'item', header: 'Khoản phí', headerSecondary: 'Item', width: '50%', align: 'left' },
  { key: 'amount', header: 'Thành tiền', headerSecondary: 'Amount', width: '50%', align: 'right' },
]

const ROWS: readonly MoneyRow[] = [
  {
    key: 'r1',
    cells: [{ text: 'Phí quản lý', secondary: 'Management fee' }, { text: '1.020.000 đ' }],
  },
  {
    key: 'r2',
    cells: [{ text: 'Nước sinh hoạt', secondary: 'Water' }, { text: '168.000 đ' }],
  },
  {
    key: 'r3',
    cells: [{ text: 'Điều chỉnh', secondary: 'Adjustment' }, { text: '−35.175 đ' }],
  },
]

function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('MoneyTable renders a 2-column table with three rows and a total (DOC-34 §5)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <MoneyTable
          columns={COLUMNS}
          rows={ROWS}
          total={{ label: 'Tổng cộng', labelSecondary: 'Total', amount: '1.152.825 đ' }}
        />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})

test('MoneyTable renders a header-only table with no rows', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <MoneyTable columns={COLUMNS} rows={[]} />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})
