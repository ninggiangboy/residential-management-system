import type { DocumentProps } from '@react-pdf/renderer'
import { Document, Page, Text } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { PDF_FONT_FAMILY } from '../fonts'

/**
 * Fixture kinds for the render-host pool tests (DOC-34 §4.1, §10, DR-291). They live in this
 * package, and application code never imports react.
 *
 * The dates are pinned: react-pdf 4.9.0 defaults `creationDate` to `new Date()`, so without a
 * fixed instant the same input renders to different bytes. DOC-34 §5 fixes `creator`/`producer` to
 * `RMS`; PD-29 asks for a byte-identical result.
 */
const FIXED_INSTANT = new Date('2026-01-01T00:00:00.000Z')

const METADATA = {
  title: 'HD-2611-0001',
  author: 'RMS',
  creator: 'RMS',
  producer: 'RMS',
  creationDate: FIXED_INSTANT,
  modificationDate: FIXED_INSTANT,
}

function sheet(paragraphs: string[]): ReactElement<DocumentProps> {
  const pages = paragraphs.map((paragraph, at) => ({ id: `page-${at + 1}`, paragraph }))
  return (
    <Document {...METADATA}>
      {pages.map(({ id, paragraph }) => (
        <Page key={id} size="A4" style={{ padding: 40, fontFamily: PDF_FONT_FAMILY, fontSize: 10 }}>
          <Text>{paragraph}</Text>
        </Page>
      ))}
    </Document>
  )
}

function busyWait(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    // The pool kills the host, so a blocking loop is the slow case under test.
  }
}

const templates: Record<string, (input: unknown) => ReactElement<DocumentProps>> = {
  hello: () => sheet(['Xin chào, Hóa đơn tháng 11']),
  two: () => sheet(['Xin chào, Hóa đơn tháng 11', 'Trang thứ hai']),
  slow: (input) => {
    busyWait(typeof input === 'number' ? input : 1_500)
    return sheet(['Xin chào, Hóa đơn tháng 11'])
  },
  crash: () => process.exit(1),
}

export default templates
