import { expect, test } from 'bun:test'
import { themes } from '@rms/design-tokens/native'
import { PDF_MARGINS, PDF_PAGE, pdfColors } from './styles'

test('PDF_PAGE is A4 portrait (DOC-34 §5)', () => {
  expect(PDF_PAGE.width).toBe(595.28)
  expect(PDF_PAGE.height).toBe(841.89)
})

test('PDF_MARGINS follows DOC-34 §5', () => {
  expect(PDF_MARGINS).toEqual({ top: 36, right: 40, bottom: 48, left: 40 })
})

test('pdfColors come from the light theme (DOC-34 §5, DR-297)', () => {
  expect(pdfColors.danger).toBe(themes.light.danger)
  expect(typeof pdfColors.ink).toBe('string')
  expect(pdfColors.ink.length).toBeGreaterThan(0)
})
