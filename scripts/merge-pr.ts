/**
 * `bun run pr:merge <number>` (DOC-71 §11.1, DR-241): the merge of a pull request into `dev`. GitHub Free has no branch
 * protection for a private repository, so this script is what makes `gate` the required check: it squash-merges only
 * when the pull request is open, not a draft, targets `dev`, contains the tip of `dev` (the "up to date" rule), and the
 * check `gate` of its head commit is `success`. `--match-head-commit` makes GitHub refuse the merge if a commit was
 * pushed after the check was read; the repository deletes the merged branch (`delete_branch_on_merge`). Needs `gh` signed in.
 */
type Pr = {
  number: number
  title: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRefOid: string
}

const trunk = 'dev'
const number = process.argv[2]
if (!number || !/^\d+$/.test(number)) {
  console.error('usage: bun run pr:merge <pull-request number>')
  process.exit(2)
}

const gh = (...args: string[]) => {
  const proc = Bun.spawnSync(['gh', ...args], { stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    console.error(`gh ${args.join(' ')} failed: ${proc.stderr.toString().trim()}`)
    process.exit(1)
  }
  return proc.stdout.toString().trim()
}
const refuse = (why: string) => {
  console.error(`not merged: ${why}`)
  process.exit(1)
}

const pr = JSON.parse(
  gh(
    'pr',
    'view',
    number,
    '--json',
    'number,title,state,isDraft,baseRefName,headRefName,headRefOid',
  ),
) as Pr
if (pr.state !== 'OPEN') refuse(`#${pr.number} is ${pr.state.toLowerCase()}`)
if (pr.isDraft) refuse(`#${pr.number} is a draft: gh pr ready ${pr.number}`)
if (pr.baseRefName !== trunk) refuse(`#${pr.number} targets ${pr.baseRefName}, not ${trunk}`)

const behind = Number(
  gh('api', `repos/{owner}/{repo}/compare/${trunk}...${pr.headRefOid}`, '--jq', '.behind_by'),
)
if (behind > 0)
  refuse(
    `${pr.headRefName} is ${behind} commit(s) behind ${trunk}: gh pr update-branch ${pr.number}, wait for CI, run again`,
  )

const gate = gh(
  'api',
  `repos/{owner}/{repo}/commits/${pr.headRefOid}/check-runs?check_name=gate&filter=latest`,
  '--jq',
  '[.check_runs[] | {status, conclusion}] | first // {}',
)
const { status, conclusion } = JSON.parse(gate || '{}') as { status?: string; conclusion?: string }
if (!status) refuse(`no gate check on ${pr.headRefOid.slice(0, 7)} yet`)
if (status !== 'completed') refuse(`gate is ${status} on ${pr.headRefOid.slice(0, 7)}: wait for it`)
if (conclusion !== 'success') refuse(`gate is ${conclusion} on ${pr.headRefOid.slice(0, 7)}`)

console.log(
  `gate is green on ${pr.headRefOid.slice(0, 7)} and ${pr.headRefName} is up to date with ${trunk}`,
)
gh(
  'pr',
  'merge',
  number,
  '--squash',
  '--match-head-commit',
  pr.headRefOid,
  '--subject',
  `${pr.title} (#${pr.number})`,
)
console.log(`merged #${pr.number} into ${trunk}: ${pr.title}`)
