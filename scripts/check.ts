/**
 * `bun run check`: every check of the `verify` stage (DOC-71 §4.1, DOC-88 §11) in one command. Each check runs even after
 * one fails, so a pull request sees every broken rule at once; the exit code is 1 when any blocking check failed.
 * A check whose root target does not exist yet is reported as skipped with the task that creates it, so this file needs
 * no edit when that task lands (the rule of `setup`, DR-233).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { annotate, markdownTable, writeSummary } from './lib/ci'

const root = resolve(import.meta.dir, '..')
const scripts = (
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

type Check = { target: string; what: string; task?: string; warnOnly?: boolean }

const checks: Check[] = [
  { target: 'lint', what: 'Biome' },
  { target: 'typecheck', what: 'TypeScript' },
  { target: 'check:arch', what: 'dependency-cruiser, incl. the type-only @app/api import (DR-04)' },
  { target: 'check:arch:fixtures', what: 'negative fixtures of the cruiser rules (DR-230)' },
  { target: 'quality:unused', what: 'knip' },
  { target: 'quality:dup', what: 'jscpd' },
  { target: 'check:scope', what: 'building-scope lint (DR-12)', task: 'P1-07' },
  { target: 'check:audit', what: 'audit actions declared and catalogued (AD-06)', task: 'P1-08' },
  {
    target: 'check:layout',
    what: 'module layout: one use case per file, handlers, repositories in domain (DR-254)',
  },
  { target: 'check:i18n', what: 'catalog parity (NFR-13)', task: 'P1-09' },
  { target: 'check:authz-metadata', what: 'route audience metadata (AG-01)', task: 'P1-15' },
  { target: 'check:dependabot', what: 'Expo-managed modules ignored by Dependabot (DR-94)' },
  {
    target: 'check:ops',
    what: 'promtool rules and tests, amtool, Loki, Alloy, dashboards (OB-04, OB-05)',
  },
  {
    target: 'check:deploy',
    what: 'compose files, Caddyfile, shell scripts, deploy.sh and the host files on real PostgreSQL and Caddy (DOC-70)',
  },
  { target: 'check:test-ids', what: 'test IDs against the documents (DR-169)', warnOnly: true },
]

type Outcome = 'pass' | 'fail' | 'warn' | 'skipped'
const results: { check: Check; outcome: Outcome; seconds: number }[] = []

for (const check of checks) {
  if (!(check.target in scripts)) {
    console.log(`\n== ${check.target}: skipped, created by ${check.task ?? 'a later task'}`)
    results.push({ check, outcome: 'skipped', seconds: 0 })
    continue
  }
  console.log(`\n== ${check.target} (${check.what})`)
  const started = performance.now()
  const proc = Bun.spawnSync(['bun', 'run', check.target], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const seconds = Math.round((performance.now() - started) / 100) / 10
  if (proc.exitCode === 0) {
    results.push({ check, outcome: 'pass', seconds })
    continue
  }
  results.push({ check, outcome: check.warnOnly ? 'warn' : 'fail', seconds })
  annotate(check.warnOnly ? 'warning' : 'error', check.target, `failed: ${check.what}`)
}

const table = markdownTable(
  ['Check', 'Result', 'Seconds'],
  results.map(({ check, outcome, seconds }) => [
    `\`${check.target}\``,
    outcome === 'skipped' ? `skipped until ${check.task}` : outcome,
    seconds,
  ]),
)
console.log(`\n${table}`)
writeSummary(`### verify\n\n${table}\n`)

process.exit(results.some((r) => r.outcome === 'fail') ? 1 : 0)
