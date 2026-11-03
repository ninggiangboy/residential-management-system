import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fonts } from './model'

/**
 * DS-05 (DOC-54 §4.1): the shipped files cover Vietnamese. fontTools reads the `cmap` (the CI helper DOC-54 names),
 * through `uv`; without `uv` the test is skipped locally and fails in CI.
 */
const root = join(import.meta.dir, '..')
const webFonts = join(root, '../../apps/cms-web/public/fonts')
const files = [
  ...fonts.map((f) => join(root, 'fonts', `${f.file}.ttf`)),
  ...fonts.map((f) => join(webFonts, `${f.file}.woff2`)),
]
const uv = Bun.which('uv')
if (!uv && process.env.CI) throw new Error('DS-05 needs uv in CI (DOC-69 §2)')

test('every font face of tokens.json ships as ttf (apps) and woff2 (web), with its licence', () => {
  expect(readdirSync(join(root, 'fonts')).sort()).toEqual(
    [...fonts.map((f) => `${f.file}.ttf`), 'BigShoulders-OFL.txt', 'Geologica-OFL.txt'].sort(),
  )
  expect(readdirSync(webFonts).sort()).toEqual(
    [...fonts.map((f) => `${f.file}.woff2`), 'BigShoulders-OFL.txt', 'Geologica-OFL.txt'].sort(),
  )
})

test.skipIf(!uv)(
  'DS-05: all 147 Vietnamese letters, đ, Đ and ₫ in every shipped file',
  () => {
    const proc = Bun.spawnSync(
      [
        uv!,
        'run',
        '--no-project',
        '--quiet',
        // fonttools 4.67 needs Python 3.11 or later; without this uv may pick an older interpreter on the machine.
        '--python',
        '>=3.11',
        '--with',
        'fonttools==4.67.0',
        '--with',
        'brotli==1.2.0',
        'python',
        '-I',
        join(root, 'scripts/check_glyphs.py'),
        ...files,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const report = proc.stdout.toString() + proc.stderr.toString()
    // biome-ignore lint/suspicious/noMisplacedAssertion: inside test.skipIf(), which Biome does not know as a test
    expect({ exit: proc.exitCode, report }).toEqual({
      exit: 0,
      report: files.map((f) => `${f}: ok\n`).join(''),
    })
  },
  60_000,
)
