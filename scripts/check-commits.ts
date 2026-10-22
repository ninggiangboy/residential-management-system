/**
 * `bun run check:commits` (DOC-71 §11.2, DR-166): the pull-request title, which a squash merge turns into the commit, and
 * the subject of every commit of the branch follow Conventional Commits with a module as the scope.
 *
 *   PR_TITLE   the pull-request title (set by the workflow; absent locally)
 *   BASE_REF   the commit the branch starts from (default: the merge base with origin/dev)
 *
 * `--message-file <path>` checks only the subject of that message: the `commit-msg` hook (`.husky/commit-msg`, DR-246).
 */
import { readFileSync } from 'node:fs'
import { annotate } from './lib/ci'

const types = 'feat|fix|perf|refactor|docs|test|chore|ci|build|revert'
const scopes = [
  'identity',
  'building',
  'residency',
  'finance',
  'tickets',
  'access',
  'vehicles',
  'notices',
  'notification',
  'wiki',
  'audit',
  'reporting',
  'realtime',
  'api',
  'web',
  'resident-app',
  'staff-app',
  'core',
  'shared',
  'ops',
  'docs',
  'deps',
].join('|')
const pattern = new RegExp(`^(${types})(\\((${scopes})\\))?!?: .{1,100}$`)

const usage = () => {
  console.log(`expected: <${types}>(<module>)?!?: <summary of 1 to 100 characters>`)
  console.log(`modules: ${scopes.replaceAll('|', ', ')}`)
}

const flag = process.argv.indexOf('--message-file')
if (flag !== -1) {
  // The subject is the first line that is neither empty nor a comment; a merge commit is not checked (`--no-merges` below).
  const subject =
    readFileSync(process.argv[flag + 1] ?? '', 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('#')) ?? ''
  if (subject.startsWith('Merge ') || pattern.test(subject)) process.exit(0)
  console.error(`commit message does not match DOC-71 §11.2: "${subject}"`)
  usage()
  process.exit(1)
}

const git = (...args: string[]) => {
  const proc = Bun.spawnSync(['git', ...args], { stderr: 'inherit' })
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
  return proc.stdout.toString().trim()
}

const base = process.env.BASE_REF || git('merge-base', 'HEAD', 'origin/dev')
const subjects = git('log', '--no-merges', '--format=%h %s', `${base}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .map((line) => ({
    what: `commit ${line.slice(0, line.indexOf(' '))}`,
    text: line.slice(line.indexOf(' ') + 1),
  }))
if (process.env.PR_TITLE !== undefined)
  subjects.unshift({ what: 'pull-request title', text: process.env.PR_TITLE })

const bad = subjects.filter((s) => !pattern.test(s.text))
for (const s of bad)
  annotate('error', 'check:commits', `${s.what} does not match DOC-71 §11.2: "${s.text}"`)
console.log(`${subjects.length - bad.length}/${subjects.length} subjects follow DOC-71 §11.2`)
if (bad.length > 0) usage()
process.exit(bad.length > 0 ? 1 : 0)
