/**
 * `bun run staging:push [sha]` (DOC-71 §11.1, DR-276): moves the branch `staging` forward to a commit of `dev` (the tip of `dev`
 * when no commit is named), which is what publishes the image and deploys staging. `staging` takes no pull request: it only
 * fast-forwards. The script refuses unless the commit is on `dev`, is ahead of `staging` (the branch is created when it does not
 * exist yet), and the check `gate` of the commit is `success`. It moves the branch through the API with the signed-in user's
 * token (a push made by `GITHUB_TOKEN` would not start `ci`), `force` is off, so GitHub refuses anything but a fast-forward.
 * No local checkout is needed. Needs `gh` signed in.
 */
const trunk = 'dev'
const branch = 'staging'
const named = process.argv[2] ?? trunk
if (process.argv.length > 3 || named.startsWith('-')) {
  console.error('usage: bun run staging:push [commit sha (default: the tip of dev)]')
  process.exit(2)
}

const run = (args: string[]) => {
  const proc = Bun.spawnSync(['gh', ...args], { stderr: 'pipe' })
  return {
    ok: proc.exitCode === 0,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  }
}
const gh = (...args: string[]) => {
  const result = run(args)
  if (!result.ok) {
    console.error(`gh ${args.join(' ')} failed: ${result.err}`)
    process.exit(1)
  }
  return result.out
}
const refuse = (why: string) => {
  console.error(`staging not moved: ${why}`)
  process.exit(1)
}

const sha = gh('api', `repos/{owner}/{repo}/commits/${named}`, '--jq', '.sha')
const short = sha.slice(0, 7)

// `compare/<base>...<head>` says where the head stands against the base: identical, ahead, behind or diverged.
const standing = (base: string) =>
  gh('api', `repos/{owner}/{repo}/compare/${base}...${sha}`, '--jq', '.status')

if (!['identical', 'behind'].includes(standing(trunk)))
  refuse(`${short} is not a commit of ${trunk}`)

const current = run(['api', `repos/{owner}/{repo}/git/ref/heads/${branch}`, '--jq', '.object.sha'])
if (current.ok) {
  const at = current.out.slice(0, 7)
  const state = standing(current.out)
  if (state === 'identical') refuse(`${branch} is already at ${short}`)
  if (state !== 'ahead')
    refuse(`${short} is not ahead of ${branch} (${at}): ${branch} only moves forward`)
}

const gate = gh(
  'api',
  `repos/{owner}/{repo}/commits/${sha}/check-runs?check_name=gate&filter=latest`,
  '--jq',
  '[.check_runs[] | {status, conclusion}] | first // {}',
)
const { status, conclusion } = JSON.parse(gate || '{}') as { status?: string; conclusion?: string }
if (!status) refuse(`no gate check on ${short} yet`)
if (status !== 'completed') refuse(`gate is ${status} on ${short}: wait for it`)
if (conclusion !== 'success') refuse(`gate is ${conclusion} on ${short}`)

if (current.ok) {
  gh(
    'api',
    '-X',
    'PATCH',
    `repos/{owner}/{repo}/git/refs/heads/${branch}`,
    '-f',
    `sha=${sha}`,
    '-F',
    'force=false',
  )
  console.log(`${branch} moved from ${current.out.slice(0, 7)} to ${short}: ci deploys it`)
} else {
  gh(
    'api',
    '-X',
    'POST',
    'repos/{owner}/{repo}/git/refs',
    '-f',
    `ref=refs/heads/${branch}`,
    '-f',
    `sha=${sha}`,
  )
  console.log(`${branch} created at ${short}: ci deploys it`)
}

export {}
