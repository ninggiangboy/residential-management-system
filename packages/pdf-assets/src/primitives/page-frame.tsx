import { Page, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import { PDF_PAGE, pdfStyles } from '../styles'

/**
 * The A4 page frame of DOC-34 §5 (DR-55): the standard margins and base text, and, when a footer
 * is given, the fixed footer slot that prints on every page.
 */
export function PageFrame(props: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Page size={PDF_PAGE.size} style={pdfStyles.page}>
      {props.children}
      {props.footer ? (
        <View fixed style={pdfStyles.footerSlot}>
          {props.footer}
        </View>
      ) : null}
    </Page>
  )
}
