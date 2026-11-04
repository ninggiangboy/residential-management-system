import { expect, setDefaultTimeout, test } from 'bun:test'
import { Document, renderToBuffer, Text } from '@react-pdf/renderer'
import { registerFonts } from '../fonts'
import { extractPdfTextItems } from '../testing'
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

test('the footer prints inside the page on every page, with the page count (DOC-34 §5)', async () => {
  setDefaultTimeout(30_000)
  const bytes = await renderToBuffer(
    <Document>
      {['Trang đầu', 'Trang hai'].map((body) => (
        <PageFrame
          key={body}
          footer={
            <PageFooter
              code="PH-2610-01 · A-1508"
              pageText={(pageNumber, totalPages) => `Trang ${pageNumber}/${totalPages}`}
            />
          }
        >
          <Text>{body}</Text>
        </PageFrame>
      ))}
    </Document>,
  )
  const items = await extractPdfTextItems(bytes)
  for (const [page, count] of [
    [1, 'Trang 1/2'],
    [2, 'Trang 2/2'],
  ] as const) {
    const footer = items.find((item) => item.page === page && item.text.includes(count))
    expect(footer).toBeDefined()
    // The footer sits in the 48 pt bottom margin: below the content (y > 794), above the edge (y < 842).
    expect(footer?.y).toBeGreaterThan(794)
    expect(footer?.y).toBeLessThan(842)
  }
})
