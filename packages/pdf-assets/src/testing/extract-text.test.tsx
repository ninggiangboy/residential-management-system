import { describe, expect, test } from 'bun:test'
import { Document, Page, renderToBuffer, Text } from '@react-pdf/renderer'
import { PDF_FONT_FAMILY, registerFonts } from '../fonts'
import { extractPdfPages, extractPdfText } from './extract-text'

describe('extractPdfText', () => {
  test('reads Vietnamese text back page by page', async () => {
    registerFonts()
    const tones = 'Nguyễn Thị Ánh Nguyệt, ỷ ỹ ự ữ'
    const bytes = await renderToBuffer(
      <Document>
        <Page size="A4" style={{ fontFamily: PDF_FONT_FAMILY }}>
          <Text>{tones}</Text>
        </Page>
        <Page size="A4" style={{ fontFamily: PDF_FONT_FAMILY }}>
          <Text>Trang 2/2</Text>
        </Page>
      </Document>,
    )
    const pages = await extractPdfPages(bytes)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain(tones)
    expect(await extractPdfText(bytes)).toContain('Trang 2/2')
  })
})
