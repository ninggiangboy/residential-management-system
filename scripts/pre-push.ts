/**
 * The `pre-push` hook (`.husky/pre-push`, DR-246): Gitleaks over the commits being pushed that no remote branch has yet,
 * with the configuration of the CI job `security` (DOC-71 §5, DOC-69 §3). The binary comes from `.tool-versions`; without
 * it the scan is skipped with a warning, because CI runs it anyway.
 *
 * Git writes one line per pushed ref on stdin: `<local ref> <local sha> <remote ref> <remote sha>`.
 */
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const deleted = /^0+$/

const shas = (await Bun.stdin.text())
  .split('\n')
  .map((line) => line.split(' ')[1])
  .filter((sha): sha is string => sha !== undefined && !deleted.test(sha))
if (shas.length === 0) process.exit(0)

if (!Bun.which('gitleaks')) {
  console.warn(
    'pre-push: gitleaks not found, secret scan skipped (install 8.30.1 from .tool-versions)',
  )
  process.exit(0)
}

const proc = Bun.spawnSync(
  [
    'gitleaks',
    'git',
    root,
    '--config',
    resolve(root, '.gitleaks.toml'),
    '--redact',
    '--no-banner',
    `--log-opts=--no-merges ${shas.join(' ')} --not --remotes`,
  ],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
)
if (proc.exitCode !== 0)
  console.error(
    'pre-push: gitleaks found a secret (DOC-71 §5); remove it from the commits, then push again',
  )
process.exit(proc.exitCode ?? 1)
