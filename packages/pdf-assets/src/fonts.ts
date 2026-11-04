import { join } from 'node:path'
import { Font } from '@react-pdf/renderer'

/**
 * The six Be Vietnam Pro faces of DOC-34 §3 (DR-56, DR-297): 400 normal and italic, 500, 600,
 * and 700 normal and italic. The files are produced by `bun run fonts:pdf` into this package's
 * `fonts/` directory.
 */
export const FONT_FILES = {
  regular: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-Regular.subset.ttf'),
  italic: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-Italic.subset.ttf'),
  medium: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-Medium.subset.ttf'),
  semiBold: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-SemiBold.subset.ttf'),
  bold: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-Bold.subset.ttf'),
  boldItalic: join(import.meta.dir, '..', 'fonts', 'BeVietnamPro-BoldItalic.subset.ttf'),
} as const

export const PDF_FONT_FAMILY = 'Be Vietnam Pro'

let registered = false

/**
 * Registers the family with `@react-pdf/renderer` once per process (DOC-34 §3, DR-56) and turns
 * hyphenation off: the default hyphenator splits Vietnamese syllables wrongly (DR-297). Call
 * before the first render.
 */
export function registerFonts(): void {
  if (registered) return
  registered = true
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: FONT_FILES.regular, fontWeight: 400 },
      { src: FONT_FILES.italic, fontWeight: 400, fontStyle: 'italic' },
      { src: FONT_FILES.medium, fontWeight: 500 },
      { src: FONT_FILES.semiBold, fontWeight: 600 },
      { src: FONT_FILES.bold, fontWeight: 700 },
      { src: FONT_FILES.boldItalic, fontWeight: 700, fontStyle: 'italic' },
    ],
  })
  Font.registerHyphenationCallback((word) => [word])
}
