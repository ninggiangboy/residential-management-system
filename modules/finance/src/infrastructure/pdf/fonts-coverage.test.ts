import { expect, setDefaultTimeout, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CATALOGS } from '@rms/i18n-catalog'
import { FONT_FILES } from '@rms/pdf-assets'

setDefaultTimeout(60_000)

/** Every string of the `pdf.*` catalog in both languages (DOC-34 §3, PD-30). */
function pdfCatalogText(): string {
  const parts: string[] = []
  for (const language of ['vi', 'en'] as const)
    for (const [key, text] of Object.entries(CATALOGS[language]))
      if (key.startsWith('pdf.')) parts.push(text)
  return parts.join('\n')
}

/**
 * A Vietnamese sample that holds every vowel with every tone, capital and small, built from base letters and the five tone marks
 * (so no precomposed letter is typed by hand), plus `đ Đ` and the currency sign (DOC-34 §3, PD-30). `●` (U+25CF) is left out on purpose: DOC-34 §3 keeps it in the subset ranges, but Be Vietnam Pro has no such glyph (DR-334).
 */
function vietnameseSample(): string {
  const bases = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y']
  const tones = ['̀', '́', '̃', '̉', '̣']
  const letters: string[] = ['đ', 'Đ', '₫', '×', '–', '—', '·', '−', '²', '³']
  for (const base of bases)
    for (const form of [base, base.toUpperCase()]) {
      letters.push(form.normalize('NFC'))
      for (const tone of tones) letters.push(`${form}${tone}`.normalize('NFC'))
    }
  return letters.join(' ')
}

/** The code points of `text` that the font's `cmap` lacks, read with fontTools through `uv` (the DS-05 route, DR-237). */
async function missingCodePoints(fontPath: string, text: string): Promise<string[]> {
  const uv = Bun.which('uv')
  if (!uv) throw new Error('PD-30 needs uv (DR-237): https://docs.astral.sh/uv/')
  const textPath = join(tmpdir(), `rms-pd30-${crypto.randomUUID()}.txt`)
  await Bun.write(textPath, text)
  const script = [
    'import sys',
    'from fontTools.ttLib import TTFont',
    'cmap = TTFont(sys.argv[1]).getBestCmap()',
    'text = open(sys.argv[2], encoding="utf-8").read()',
    'missing = sorted({ord(c) for c in text if not c.isspace() and ord(c) not in cmap})',
    'print(" ".join("U+%04X" % cp for cp in missing))',
  ].join('\n')
  const child = Bun.spawn(
    [
      uv,
      'run',
      '--no-project',
      '--quiet',
      '--python',
      '>=3.11',
      '--with',
      'fonttools==4.67.0',
      'python',
      '-I',
      '-c',
      script,
      fontPath,
      textPath,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`PD-30: exit ${code}: ${err}`)
  return out.trim() === '' ? [] : out.trim().split(' ')
}

test('PD-30 every code point of the pdf.* catalog and of a Vietnamese sample is in each subset file (DOC-34 §3)', async () => {
  const text = `${pdfCatalogText()}\n${vietnameseSample()}`
  for (const [face, path] of Object.entries(FONT_FILES))
    expect({ face, missing: await missingCodePoints(path, text) }).toEqual({ face, missing: [] })
})
