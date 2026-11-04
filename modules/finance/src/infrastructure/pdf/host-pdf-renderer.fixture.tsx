import { Document, Page, Text } from '@react-pdf/renderer'
import { PDF_FONT_FAMILY, type RenderTemplates } from '@rms/pdf-assets'

/**
 * The tiny templates module `host-pdf-renderer.test.ts` gives the render host (DOC-34 §2, §4.1, DR-291): one page per
 * kind, so the test exercises a real child process without the finance templates. `receipt` throws, which is the render
 * failure of DOC-34 §10 the adapter maps.
 */
const templates: RenderTemplates = {
  fee_notice: () => (
    <Document>
      <Page size="A4" style={{ padding: 40, fontFamily: PDF_FONT_FAMILY, fontSize: 10 }}>
        <Text>Xin chào, Hóa đơn tháng 11</Text>
      </Page>
    </Document>
  ),
  receipt: () => {
    throw new Error('render failed on purpose')
  },
}

export default templates
