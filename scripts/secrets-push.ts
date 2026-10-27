/**
 * `bun run secrets:push staging [--dir <dir>] [--domain <domain>] [--file <name>=<path>]... [--dry-run]`: makes the secret files of a
 * host once and stores them in the GitHub environment, so the VPS needs nothing prepared by hand (DR-273, DOC-70 §9.1, DOC-71 §12).
 *
 * - the 15 application files come from `scripts/keys-generate.ts --out` (a file that exists is kept);
 * - the SSH host key of the VPS and the CI login key are made here too: the host key is installed by the bootstrap and pinned in
 *   `DEPLOY_KNOWN_HOSTS`, so the very first Tunnel login is already verified;
 * - `--file` adds what only the Owner has: `tunnel-token` (required), `ghcr-user` and `ghcr-read-token` (the pull login), and
 *   `smtp-password`, `expo-access-token`, `sms-*`, `telegram-bot-token`, `alertmanager-smtp-password` when they exist;
 * - the folder (default `~/.rms-secrets/<env>`) is the Owner's copy: it is outside the repository, and a sealed copy of it is what
 *   DOC-70 §9.3 asks the Owner to keep. Nothing is printed.
 * It sets `RMS_SECRETS_PACK` (one base64 tar.gz of the files), `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` and, on staging,
 * `STAGING_DEMO_PASSWORD` with `gh secret set --env <env>`; the Access service token and `DOMAIN` stay the Owner's to set.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const env = args[0]
if (env !== 'staging' && env !== 'production') {
  console.error(
    'usage: secrets-push.ts staging|production [--dir <dir>] [--domain <domain>] [--file <name>=<path>]... [--dry-run]',
  )
  process.exit(2)
}
const option = (name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const dryRun = args.includes('--dry-run')
const dir = resolve(option('--dir') ?? join(homedir(), '.rms-secrets', env))
const repoRoot = resolve(import.meta.dir, '..')
if (dir.startsWith(`${repoRoot}/`)) {
  console.error(`${dir} is inside the repository; keep the secret files outside it`)
  process.exit(2)
}

const run = (cmd: string[], opts: { stdin?: string } = {}) => {
  const proc = Bun.spawnSync(cmd, {
    stdin: opts.stdin === undefined ? 'ignore' : Buffer.from(opts.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0)
    throw new Error(`${cmd[0]} ${cmd[1] ?? ''} failed: ${proc.stderr.toString().trim()}`)
  return proc.stdout.toString()
}

mkdirSync(dir, { recursive: true, mode: 0o700 })

// 1. the application files, 15 of them (kept when they exist)
console.log(
  run([
    'bun',
    join(repoRoot, 'scripts/keys-generate.ts'),
    '--out',
    dir,
    '--env',
    env,
    '--db-host',
    'host.docker.internal',
  ]).trim(),
)

// 2. what only the Owner has
for (const spec of args.flatMap((arg, i) => (arg === '--file' ? [args[i + 1] ?? ''] : []))) {
  const [name, path] = spec.split('=')
  if (!name || !path || !/^[a-z0-9-]+$/.test(name))
    throw new Error(`--file wants <name>=<path>, got ${spec}`)
  writeFileSync(join(dir, name), readFileSync(path), { mode: 0o440 })
  console.log(`stored ${name}`)
}

// 3. the keys of the host and of CI, made once
const keygen = (name: string, comment: string) => {
  if (existsSync(join(dir, name))) return
  run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', join(dir, name)])
  console.log(`made ${name}`)
}
keygen('ssh-host-ed25519-key', `rms-${env}-host`)
keygen('deploy-ssh-key', `ci-deploy-${env}`)

if (!existsSync(join(dir, 'tunnel-token'))) {
  console.error(
    'tunnel-token is missing: create the Tunnel (DOC-70 §5.2) and add --file tunnel-token=<path to the token>',
  )
  process.exit(1)
}

// 4. the pack: every file but the CI login key and the public halves
const packed = readdirSync(dir).filter(
  (name) => !name.endsWith('.pub') && name !== 'deploy-ssh-key',
)
const tar = Bun.spawnSync(['tar', '-czf', '-', '-C', dir, ...packed], {
  stdout: 'pipe',
  stderr: 'pipe',
})
if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString().trim()}`)
const packB64 = Buffer.from(tar.stdout).toString('base64')
if (packB64.length > 45_000)
  throw new Error(`the pack is ${packB64.length} bytes; a GitHub secret holds 48 KB`)

const hostPub = readFileSync(join(dir, 'ssh-host-ed25519-key.pub'), 'utf8')
  .trim()
  .split(' ')
  .slice(0, 2)
  .join(' ')
const domain = option('--domain') ?? run(['gh', 'variable', 'get', 'DOMAIN', '--env', env]).trim()
const sfx = env === 'staging' ? '-staging' : ''

const secrets: [name: string, value: string][] = [
  ['RMS_SECRETS_PACK', packB64],
  ['DEPLOY_SSH_KEY', readFileSync(join(dir, 'deploy-ssh-key'), 'utf8')],
  ['DEPLOY_KNOWN_HOSTS', `ssh${sfx}.${domain} ${hostPub}\n`],
]
if (env === 'staging')
  secrets.push([
    'STAGING_DEMO_PASSWORD',
    readFileSync(join(dir, 'demo-staff-password'), 'utf8').trim(),
  ])

for (const [name, value] of secrets) {
  if (dryRun) console.log(`would set ${name} (${value.length} bytes) in environment ${env}`)
  else {
    run(['gh', 'secret', 'set', name, '--env', env], { stdin: value })
    console.log(`set ${name} in environment ${env}`)
  }
}
console.log(
  `the files are in ${basename(dir)} under ${resolve(dir, '..')}: keep a sealed copy off this machine (DOC-70 §9.3)`,
)
