import { expect, test } from 'bun:test'
import { Document, renderToBuffer, Text } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { PageFooter } from './page-footer'
import { PageFrame } from './page-frame'

registerFonts()

/** The five-byte `%PDF-` marker that opens a rendered PDF (DOC-34 §5). */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('PageFooter renders inside the PageFrame footer slot (DOC-34 §5)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame
        footer={
          <PageFooter
            code="PH-2610-01 · A-1508"
            pageText={(pageNumber, totalPages) => `Trang ${pageNumber}/${totalPages}`}
          />
        }
      >
        <Text>Thông báo phí</Text>
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})
