import { StyleSheet } from '@react-pdf/renderer'
import { themes } from '@rms/design-tokens/native'
import { PDF_FONT_FAMILY } from './fonts'

/**
 * The A4 portrait layout and style sheet of DOC-34 §5 (DR-55, DR-56, DR-297). Colours come only
 * from `@rms/design-tokens/native` (a Biome rule rejects a literal anywhere else), and the sheet
 * prints well in greyscale, so no meaning rests on colour.
 */
export const PDF_PAGE = { size: 'A4', width: 595.28, height: 841.89 } as const

/** Margins of DOC-34 §5: 40 pt left and right, 36 pt top, 48 pt bottom for the footer. */
export const PDF_MARGINS = { top: 36, right: 40, bottom: 48, left: 40 } as const

/** The light-theme colours DOC-34 §5 allows (DR-297). */
export const pdfColors = {
  ink: themes.light.ink,
  inkMuted: themes.light['ink-muted'],
  line: themes.light.line,
  danger: themes.light.danger,
} as const

export const pdfStyles = StyleSheet.create({
  // DOC-34 §5: the page box, base text 10 pt Regular at line height 1.4 (DR-55).
  page: {
    paddingTop: PDF_MARGINS.top,
    paddingRight: PDF_MARGINS.right,
    paddingBottom: PDF_MARGINS.bottom,
    paddingLeft: PDF_MARGINS.left,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    lineHeight: 1.4,
    color: pdfColors.ink,
  },
  // DOC-34 §5: the English line of `both` mode, 8.5 pt Italic in `inkMuted` (DR-71).
  secondary: {
    fontSize: 8.5,
    fontStyle: 'italic',
    color: pdfColors.inkMuted,
  },
  // DOC-34 §5: a label or table header, 8.5 pt Medium in `inkMuted`.
  label: {
    fontSize: 8.5,
    fontWeight: 500,
    color: pdfColors.inkMuted,
  },
  // DOC-34 §5: the title, 16 pt SemiBold.
  title: {
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  // DOC-34 §5: the English line of a bilingual title, 11 pt Regular.
  subtitle: {
    fontSize: 11,
    fontWeight: 400,
    lineHeight: 1.3,
  },
  // DOC-34 §5: amounts are right-aligned.
  amount: {
    textAlign: 'right',
  },
  // DOC-34 §5: the total, 12 pt SemiBold and right-aligned.
  total: {
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'right',
  },
  // DOC-34 §5: a 0.5 pt rule in `line`.
  rule: {
    borderBottomWidth: 0.5,
    borderBottomColor: pdfColors.line,
    marginVertical: 6,
  },
  // DOC-34 §5: the table header has a 1 pt rule below it.
  tableHeaderRule: {
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.line,
  },
  // DOC-34 §5: one table row; the component sets `wrap={false}` so a row never splits.
  row: {
    flexDirection: 'row',
  },
  // DOC-34 §5: the fixed footer of every page. The two texts sit directly in the `Page`, each
  // `fixed` and anchored from the top: react-pdf 4.9.0 loses a `render` text (the page count) that
  // sits inside a `View`, and one anchored with `bottom` inside a block, so there is no wrapper.
  footerLeft: {
    position: 'absolute',
    left: PDF_MARGINS.left,
    top: PDF_PAGE.height - 36,
    fontSize: 8.5,
    color: pdfColors.inkMuted,
  },
  footerRight: {
    position: 'absolute',
    right: PDF_MARGINS.right,
    top: PDF_PAGE.height - 36,
    fontSize: 8.5,
    color: pdfColors.inkMuted,
    textAlign: 'right',
  },
  // DOC-34 §5, §7.1: the layer the watermark sits in, fixed so it prints on every page.
  watermarkLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // DOC-34 §5, §7.1: the watermark text, 120 pt Bold in `danger` (size and opacity are props).
  watermarkText: {
    fontWeight: 700,
    color: pdfColors.danger,
    textAlign: 'center',
  },
})
