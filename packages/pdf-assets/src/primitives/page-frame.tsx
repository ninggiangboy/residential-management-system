import { Page } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import { PDF_PAGE, pdfStyles } from '../styles'

/**
 * The A4 page frame of DOC-34 §5 (DR-55): the standard margins and base text. The footer (see
 * `PageFooter`) is placed straight in the page, because its page count is a `render` text that
 * react-pdf 4.9.0 loses inside a wrapping `View`.
 */
export function PageFrame(props: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Page size={PDF_PAGE.size} style={pdfStyles.page}>
      {props.children}
      {props.footer}
    </Page>
  )
}
