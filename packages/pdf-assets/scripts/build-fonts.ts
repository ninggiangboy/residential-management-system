import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `bun run fonts:pdf` (DOC-34 §3, DR-56, DR-297) downloads the six static Be Vietnam Pro faces
 * of the Google Fonts release pinned to commit c13390277dfb1fcc7415d84ef7ef9cfc1e52f8c1
 * (recorded 2026-03-03, DOC-11 §5) and subsets each with the ranges of DOC-34 §3. The downloads
 * are cached in the OS temp directory keyed by the commit; a file is written only when its
 * bytes change, so a rerun is a no-op.
 */
const COMMIT = 'c13390277dfb1fcc7415d84ef7ef9cfc1e52f8c1'
const SOURCE_URL = `https://raw.githubusercontent.com/google/fonts/${COMMIT}/ofl/bevietnampro`
const FACES = ['Regular', 'Italic', 'Medium', 'SemiBold', 'Bold', 'BoldItalic'] as const

/**
 * Exactly the code points of DOC-34 §3. pyftsubset keeps the source's fixed `head` timestamp by
 * default (it does not run `--recalc-timestamp`), so dropping the `DSIG` table is all a
 * byte-stable output needs.
 */
const UNICODES = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+0100-017F',
  'U+01A0-01B0',
  'U+0300-0323',
  'U+1EA0-1EF9',
  'U+2010-2027',
  'U+2030',
  'U+2039-203A',
  'U+20AB',
  'U+2116',
  'U+2122',
  'U+2190-2193',
  'U+2212',
  'U+25CF',
].join(',')

const fontsDir = join(import.meta.dir, '..', 'fonts')
const cacheDir = join(tmpdir(), 'rms-pdf-assets', COMMIT)
const scratchDir = join(cacheDir, 'subset')
const uv = Bun.which('uv')
if (!uv) throw new Error('fonts:pdf needs uv (DR-237): https://docs.astral.sh/uv/')

mkdirSync(scratchDir, { recursive: true })
mkdirSync(fontsDir, { recursive: true })

async function download(name: string): Promise<string> {
  const path = join(cacheDir, name)
  if (existsSync(path)) return path
  const response = await fetch(`${SOURCE_URL}/${name}`)
  if (!response.ok) throw new Error(`fonts:pdf: ${name}: HTTP ${response.status}`)
  await Bun.write(path, await response.bytes())
  return path
}

async function writeIfChanged(path: string, bytes: Uint8Array): Promise<boolean> {
  const file = Bun.file(path)
  if (await file.exists()) {
    if (Buffer.from(await file.arrayBuffer()).equals(Buffer.from(bytes))) return false
  }
  await Bun.write(path, bytes)
  return true
}

function subset(source: string, output: string): void {
  const result = Bun.spawnSync(
    [
      uv!,
      'run',
      '--no-project',
      '--quiet',
      '--python',
      '>=3.11',
      '--with',
      'fonttools==4.67.0',
      'pyftsubset',
      source,
      `--unicodes=${UNICODES}`,
      '--layout-features=*',
      '--drop-tables+=DSIG',
      `--output-file=${output}`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) {
    throw new Error(`fonts:pdf: ${source}: ${result.stdout.toString()}${result.stderr.toString()}`)
  }
}

const written: string[] = []
for (const face of FACES) {
  const name = `BeVietnamPro-${face}`
  const source = await download(`${name}.ttf`)
  const scratch = join(scratchDir, `${name}.subset.ttf`)
  subset(source, scratch)
  const bytes = await Bun.file(scratch).bytes()
  const output = join(fontsDir, `${name}.subset.ttf`)
  if (await writeIfChanged(output, bytes)) {
    written.push(`${name}.subset.ttf`)
  }
}

const licence = await download('OFL.txt')
const licenceBytes = await Bun.file(licence).bytes()
if (await writeIfChanged(join(fontsDir, 'BeVietnamPro-OFL.txt'), licenceBytes)) {
  written.push('BeVietnamPro-OFL.txt')
}

console.log(written.length > 0 ? `wrote ${written.join(', ')}` : 'fonts/ is current')
