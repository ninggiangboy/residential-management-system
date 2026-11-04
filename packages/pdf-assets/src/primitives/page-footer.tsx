import { Text, View } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * The footer content of DOC-34 §5 (DR-56): the document code on the left and the page text on the
 * right. `PageFrame` owns the fixed footer slot, so this returns the inner row only and the
 * caller passes it as `PageFrame`'s `footer`; this file never adds a slot and imports no catalog.
 */
export function PageFooter(props: {
  code: string
  pageText: (pageNumber: number, totalPages: number) => string
}) {
  return (
    <View style={[pdfStyles.row, { flexGrow: 1, justifyContent: 'space-between' }]}>
      <Text style={pdfStyles.footerText}>{props.code}</Text>
      <Text
        style={pdfStyles.footerText}
        render={({ pageNumber, totalPages }) => props.pageText(pageNumber, totalPages)}
      />
    </View>
  )
}
