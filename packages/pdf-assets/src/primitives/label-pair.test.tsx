import { expect, test } from 'bun:test'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { LabelPair } from './label-pair'
import { PageFrame } from './page-frame'

registerFonts()

/** The five-byte `%PDF-` marker that opens a rendered PDF (DOC-34 §5). */
function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

test('LabelPair renders a both-mode pair (DOC-34 §5)', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <LabelPair label="Căn hộ" labelSecondary="Unit" value="A-1508" width="50%" />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})

test('LabelPair renders without the secondary lines', async () => {
  const bytes = await renderToBuffer(
    <Document>
      <PageFrame>
        <LabelPair label="Căn hộ" value="A-1508" />
      </PageFrame>
    </Document>,
  )
  expect(header(bytes)).toBe('%PDF-')
})
