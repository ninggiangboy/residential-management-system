import { expect, test } from 'bun:test'
import { Document, renderToBuffer, Text } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { PageFrame } from './page-frame'

registerFonts()

/** The five-byte `%PDF-` marker that opens a rendered PDF (DOC-34 §5). */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('PageFrame renders an A4 page as a PDF (DOC-34 §5)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <Text>Xin chào</Text>
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})

test('PageFrame renders the fixed footer slot', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame footer={<Text>Cố định</Text>}>
        <Text>Xin chào</Text>
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})
