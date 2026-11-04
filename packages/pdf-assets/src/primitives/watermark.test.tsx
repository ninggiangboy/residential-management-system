import { expect, test } from 'bun:test'
import { Document, renderToBuffer, Text } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { PageFrame } from './page-frame'
import { Watermark } from './watermark'

registerFonts()

/** The five-byte `%PDF-` marker that opens a rendered PDF (DOC-34 §7.1). */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('Watermark renders a fixed diagonal text (DOC-34 §7.1)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <Watermark text="VOID" />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})

test('Watermark adds content to the document', async () => {
  const plain = await renderToBuffer(
    <Document>
      <PageFrame>
        <Text>Biên lai thu tiền</Text>
      </PageFrame>
    </Document>,
  )
  const marked = await renderToBuffer(
    <Document>
      <PageFrame>
        <Watermark text="VOID" />
        <Text>Biên lai thu tiền</Text>
      </PageFrame>
    </Document>,
  )
  expect(marked.byteLength).toBeGreaterThan(plain.byteLength)
})
