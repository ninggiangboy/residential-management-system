/**
 * `bun scripts/run-if-defined.ts <target> <task>`: runs `bun run <target>` when the root `package.json` defines it, and
 * otherwise prints a notice that the target is created by <task>. A CI step names a target of a later task this way, so
 * the workflow needs no edit when that task lands (the rule of `setup`, DR-233).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { annotate } from './lib/ci'

const [target, task] = process.argv.slice(2)
if (!target || !task) {
  console.error('usage: bun scripts/run-if-defined.ts <target> <task>')
  process.exit(2)
}
const root = resolve(import.meta.dir, '..')
const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
if (!(target in scripts)) {
  annotate('notice', target, `skipped: \`bun run ${target}\` is created by ${task}`)
  process.exit(0)
}
const proc = Bun.spawnSync(['bun', 'run', target], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(proc.exitCode ?? 1)
