import { expect, test } from 'bun:test'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { CompanyHeader } from './company-header'
import { PageFrame } from './page-frame'

registerFonts()

/** The five-byte `%PDF-` marker that opens a rendered PDF (DOC-34 §6.2, §7.2). */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('CompanyHeader renders every line (DOC-34 §6.2, §7.2)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <CompanyHeader
          name="Công ty TNHH Quản lý Tòa nhà Sunrise"
          address="12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh"
          contactLine="Hotline 1900 1234 · bql@sunrise.vn"
          taxLine="MST 0312345678"
          buildingName="Chung cư Sunrise A"
        />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})

test('CompanyHeader renders with only a name', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <CompanyHeader name="Sunrise" />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})
