import { expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { Font } from '@react-pdf/renderer'
import { FONT_FILES, PDF_FONT_FAMILY, registerFonts } from './fonts'

/**
 * The six subset faces of DOC-34 §3 are produced by `bun run fonts:pdf`; this test runs after
 * generation. It asserts the files exist, then calls `registerFonts()` twice to prove it
 * registers once per process (its module guard).
 */
test('the six subset faces of DOC-34 §3 are present', () => {
  for (const path of Object.values(FONT_FILES)) {
    expect(existsSync(path)).toBe(true)
  }
})

test('registerFonts() registers the family once and the second call is a no-op', () => {
  const register = spyOn(Font, 'register')
  const hyphenate = spyOn(Font, 'registerHyphenationCallback')
  registerFonts()
  registerFonts()
  expect(register).toHaveBeenCalledTimes(1)
  expect(hyphenate).toHaveBeenCalledTimes(1)
  expect(register.mock.calls[0]?.[0]).toMatchObject({ family: PDF_FONT_FAMILY })
})
