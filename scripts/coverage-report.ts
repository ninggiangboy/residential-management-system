/**
 * `bun run test:coverage` (DOC-88 §10, DR-77): runs the unit tests of every workspace with an lcov reporter, then prints
 * line and function coverage per workspace against the targets of DOC-88 §10. A figure below its target is a `::warning`
 * and **never** fails the run; the exit code is that of the tests. `bunfig.toml` sets no `coverageThreshold` on purpose.
 *
 * Bun 1.4.3 writes no branch counters (`BRF`/`BRH`) into lcov, so the branch targets are shown as "n/a"; a file that no
 * test imports is not in the report (Bun only instruments loaded files).
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { annotate, markdownTable, writeSummary } from './lib/ci'

const root = resolve(import.meta.dir, '..')
const outDir = resolve(root, 'coverage')

/** DOC-88 §10. A module not listed takes `modules/*`; a workspace with no row has no target. */
const targets: Record<string, number> = {
  'modules/finance': 90,
  'modules/identity': 90,
  'modules/access': 80,
  'modules/tickets': 80,
  'modules/notices': 80,
  'modules/residency': 80,
  'modules/*': 70,
  'apps/cms-web': 60,
  'packages/mobile-core': 70,
  'packages/client-core': 70,
  'packages/core-db': 50,
}
const targetOf = (ws: string) =>
  targets[ws] ?? (ws.startsWith('modules/') ? targets['modules/*'] : undefined)

const workspaces = ['apps', 'modules', 'packages'].flatMap((group) =>
  readdirSync(resolve(root, group), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(root, group, d.name, 'package.json')))
    .map((d) => `${group}/${d.name}`),
)

rmSync(outDir, { recursive: true, force: true })
let failed = false
for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(resolve(root, ws, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  if (!pkg.scripts?.test) continue
  const dir = resolve(outDir, ws.replace('/', '__'))
  const proc = Bun.spawnSync(
    ['bun', 'run', 'test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${dir}`],
    { cwd: resolve(root, ws), stdout: 'inherit', stderr: 'inherit' },
  )
  if (proc.exitCode !== 0) failed = true
}

const rows: (string | number)[][] = []
for (const ws of workspaces) {
  const lcov = resolve(outDir, ws.replace('/', '__'), 'lcov.info')
  if (!existsSync(lcov)) continue
  const sum = { LF: 0, LH: 0, FNF: 0, FNH: 0 }
  for (const line of readFileSync(lcov, 'utf8').split('\n')) {
    const [key, value] = line.split(':')
    if (key && key in sum) sum[key as keyof typeof sum] += Number(value)
  }
  if (sum.LF === 0) continue
  const lines = Math.round((sum.LH / sum.LF) * 1000) / 10
  const functions = sum.FNF ? `${Math.round((sum.FNH / sum.FNF) * 1000) / 10}%` : 'n/a'
  const target = targetOf(ws)
  const below = target !== undefined && lines < target
  if (below)
    annotate('warning', 'coverage', `${ws}: line coverage ${lines}% is below its target ${target}%`)
  rows.push([
    ws,
    `${lines}%`,
    functions,
    target === undefined ? '-' : `${target}%`,
    below ? 'below (warning)' : 'ok',
  ])
}

const table = markdownTable(['Workspace', 'Lines', 'Functions', 'Line target', 'State'], rows)
console.log(`\n${table}\nBranch coverage: n/a (Bun 1.4.3 writes no branch counters).`)
writeSummary(
  `### Coverage (warning only, DR-77)\n\n${table}\n\nBranch coverage: n/a (Bun 1.4.3 writes no branch counters).\n`,
)
process.exit(failed ? 1 : 0)
