import { Text } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * The footer of DOC-34 §5 (DR-56): the document code on the left and the page text on the right,
 * on every page. Two `fixed` texts placed straight in the `Page` (see `pdfStyles.footerLeft`: a
 * `render` text inside a `View` is lost by react-pdf 4.9.0). Pass it as `PageFrame`'s `footer`;
 * this file imports no catalog.
 */
export function PageFooter(props: {
  code: string
  pageText: (pageNumber: number, totalPages: number) => string
}) {
  return (
    <>
      <Text fixed style={pdfStyles.footerLeft}>
        {props.code}
      </Text>
      <Text
        fixed
        style={pdfStyles.footerRight}
        render={({ pageNumber, totalPages }) => props.pageText(pageNumber, totalPages)}
      />
    </>
  )
}
