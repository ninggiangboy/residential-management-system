/**
 * `bun run check:arch`: the three dependency-cruiser configurations of DOC-12 §6.
 * dependency-cruiser runs from `tools/depcruise`, which carries the TypeScript 6 compiler it needs
 * (DOC-11 §10 row 2); the product itself stays on TypeScript 7.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const toolDir = resolve(root, 'tools/depcruise')
const depcruise = resolve(toolDir, 'node_modules/.bin/depcruise')

if (!existsSync(depcruise)) {
  const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: toolDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (install.exitCode !== 0) process.exit(install.exitCode)
}

let failed = false
for (const scope of ['apps', 'modules', 'packages']) {
  const run = Bun.spawnSync([depcruise, scope, '--config', `.dependency-cruiser.${scope}.cjs`], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (run.exitCode !== 0) failed = true
}
process.exit(failed ? 1 : 0)
