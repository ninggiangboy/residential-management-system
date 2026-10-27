/**
 * `bun run setup` (DOC-69 §4): an empty clone to a running local stack, stopping at the first failure.
 * Steps 5 and 6 came with later tasks (`db:migrate` P1-06, `seed:demo` P1-21): while a target does not exist the step is reported
 * as skipped, so this file needed no edit when the task landed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const scripts = (
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

const run = (cmd: string[]) => {
  const proc = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (proc.exitCode !== 0) {
    console.error(`setup stopped: \`${cmd.join(' ')}\` exited with code ${proc.exitCode}`)
    process.exit(proc.exitCode)
  }
}

const steps: { n: number; label: string; target: string; cmd: string[]; task?: string }[] = [
  { n: 1, label: 'tools', target: 'check:tools', cmd: ['bun', 'run', 'check:tools'] },
  {
    n: 2,
    label: 'install',
    target: 'install',
    cmd: ['bun', 'install', '--frozen-lockfile'],
  },
  { n: 3, label: 'keys', target: 'keys:generate', cmd: ['bun', 'run', 'keys:generate'] },
  { n: 4, label: 'infrastructure', target: 'infra:up', cmd: ['bun', 'run', 'infra:up'] },
  {
    n: 5,
    label: 'database',
    target: 'db:migrate',
    cmd: ['bun', 'run', 'db:migrate'],
    task: 'P1-06',
  },
  {
    n: 6,
    label: 'demo data',
    target: 'seed:demo',
    cmd: ['bun', 'run', 'seed:demo'],
    task: 'P1-21',
  },
]

for (const step of steps) {
  console.log(`\n[${step.n}/6] ${step.label}`)
  if (step.target !== 'install' && !(step.target in scripts)) {
    console.log(`skipped: \`bun run ${step.target}\` does not exist before ${step.task}`)
    continue
  }
  run(step.cmd)
}
console.log('\nsetup done')
