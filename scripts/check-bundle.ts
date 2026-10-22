/**
 * `bun run check:bundle` (DOC-53 §8, DR-179): builds the web CMS with a Vite manifest and checks the gzip size of its
 * JavaScript against the planned budgets. Fails when a budget is exceeded.
 *
 *   shell      the entry chunk and everything it imports statically: what every page loads
 *   /login     the shell plus the chunks of `src/routes/login.tsx`       ≤ 170 KB
 *   landing    the shell plus the chunks of `src/routes/index.tsx`       ≤ 300 KB
 *   any other chunk                                                       ≤ 120 KB
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { annotate, markdownTable, writeSummary } from './lib/ci'

const KB = 1024
const budget = { login: 170 * KB, landing: 300 * KB, chunk: 120 * KB }

type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[] }
const web = resolve(import.meta.dir, '../apps/cms-web')
const out = mkdtempSync(join(tmpdir(), 'rms-bundle-'))

try {
  const build = Bun.spawnSync(
    ['bun', 'x', 'vite', 'build', '--manifest', '--outDir', out, '--emptyOutDir'],
    {
      cwd: web,
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

  const manifest = JSON.parse(readFileSync(join(out, '.vite/manifest.json'), 'utf8')) as Record<
    string,
    Chunk
  >
  const gz = new Map<string, number>()
  const size = (file: string) => {
    if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(out, file))).length)
    return gz.get(file) ?? 0
  }
  /** The chunk files of `keys` and of their static imports. */
  const closure = (keys: string[]) => {
    const seen = new Set<string>()
    const visit = (key: string) => {
      if (seen.has(key) || !manifest[key]) return
      seen.add(key)
      for (const next of manifest[key].imports ?? []) visit(next)
    }
    for (const key of keys) visit(key)
    return new Set([...seen].map((key) => manifest[key]?.file ?? ''))
  }
  const total = (files: Set<string>) => [...files].reduce((sum, file) => sum + size(file), 0)
  const routeKeys = (route: string) =>
    Object.keys(manifest).filter((key) => key.startsWith(`src/routes/${route}.tsx`))

  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry)
  const shell = closure(entries)
  const rows: (string | number)[][] = []
  let over = false
  const check = (what: string, bytes: number, limit: number) => {
    const ok = bytes <= limit
    if (!ok) {
      over = true
      annotate(
        'error',
        'check:bundle',
        `${what}: ${(bytes / KB).toFixed(1)} KB gzip is over ${limit / KB} KB`,
      )
    }
    rows.push([what, (bytes / KB).toFixed(1), limit / KB, ok ? 'ok' : '**over**'])
  }

  for (const [route, label, limit] of [
    ['login', '/login first load', budget.login],
    ['index', 'shell + landing route', budget.landing],
  ] as const) {
    const keys = routeKeys(route)
    if (keys.length === 0) {
      rows.push([label, '-', limit / KB, `no src/routes/${route}.tsx yet`])
      continue
    }
    check(label, total(new Set([...shell, ...closure(keys)])), limit)
  }
  for (const chunk of Object.values(manifest)) {
    if (!chunk.file.endsWith('.js') || shell.has(chunk.file)) continue
    check(`chunk ${chunk.src ?? chunk.file}`, size(chunk.file), budget.chunk)
  }
  rows.unshift(['shell (every page)', (total(shell) / KB).toFixed(1), '-', 'reported'])

  const table = markdownTable(['What', 'KB gzip', 'Budget KB', 'State'], rows)
  console.log(`\n${table}`)
  writeSummary(`### Web bundle budgets (DOC-53 §8)\n\n${table}\n`)
  process.exitCode = over ? 1 : 0
} finally {
  rmSync(out, { recursive: true, force: true })
}
