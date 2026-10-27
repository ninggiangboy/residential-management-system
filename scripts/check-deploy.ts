/**
 * `bun run check:deploy` (stage `verify`, DOC-70 §6, §7, §14 as far as a laptop can show them): the files of a host are valid and
 * the scripts do what they say.
 *
 * - the compose files of staging and production (and production with its profiles) pass `docker compose config` on a stand-in
 *   for the host's `/opt/rms` and `/etc/rms/secrets`, so a missing secret or an unset variable is found here and not on the host
 * - the Caddyfile validates for one and for two upstreams, and is in the canonical form of `caddy fmt`
 * - every shell script under `ops/` passes shellcheck
 * - `bun test tools/ops-files`: `deploy.sh`, `smoke.sh`, the Caddyfile on a running Caddy, the PostgreSQL files on PostgreSQL 18,
 *   `postgres_exporter` (the backup path on SeaweedFS is `bun run test:backup-repo`: it installs pgBackRest and takes minutes)
 * Needs Docker; the images are pulled on first use. The tag of each image is read from the compose file that pins it.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const base = readFileSync(resolve(root, 'docker/compose.base.yml'), 'utf8')
const caddyImage = base.match(/image: (caddy:[\w.]+)/)?.[1]
if (!caddyImage) throw new Error('docker/compose.base.yml pins no Caddy image')
// koalaman/shellcheck-alpine has the same binary as the release; pinned here because no compose file runs it.
const SHELLCHECK_IMAGE = 'koalaman/shellcheck:v0.11.0'

let failed = false
function run(title: string, command: string[], options: { env?: Record<string, string> } = {}) {
  console.log(`\n-- ${title}`)
  const proc = Bun.spawnSync(command, {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...options.env },
  })
  const out = `${proc.stdout}${proc.stderr}`.trim()
  if (proc.exitCode !== 0) {
    failed = true
    console.error(out)
    console.error(`FAILED: ${title}`)
    return
  }
  console.log('ok')
}

/** A stand-in for the host's directories: the compose files with `/opt/rms/env` and `/etc/rms/secrets` moved into a temp folder. */
function standIn() {
  const dir = mkdtempSync(join(tmpdir(), 'rms-compose-'))
  mkdirSync(join(dir, 'env'), { recursive: true })
  mkdirSync(join(dir, 'secrets'), { recursive: true })
  mkdirSync(join(dir, 'docker'), { recursive: true })
  writeFileSync(join(dir, 'env/app.env'), '')
  for (const name of ['base', 'staging', 'production']) {
    const text = readFileSync(resolve(root, `docker/compose.${name}.yml`), 'utf8')
    for (const secret of text.matchAll(/\/etc\/rms\/secrets\/([a-z0-9-]+)/g))
      writeFileSync(join(dir, 'secrets', secret[1] as string), '')
    writeFileSync(
      join(dir, `docker/compose.${name}.yml`),
      text
        .replaceAll('/opt/rms/env', join(dir, 'env'))
        .replaceAll('/etc/rms/secrets', join(dir, 'secrets')),
    )
  }
  return dir
}

const host = standIn()
for (const [environment, profiles] of [
  ['staging', ''],
  ['production', 'api2,logs,deploy'],
  ['staging', 'deploy'],
] as const) {
  const envFile = join(host, `${environment}.env`)
  writeFileSync(
    envFile,
    [
      'COMPOSE_PROJECT_NAME=rms',
      `RMS_ENV=${environment}`,
      `COMPOSE_PROFILES=${profiles}`,
      'RMS_GHCR_OWNER=owner',
      'RMS_DOMAIN=example.invalid',
      `RMS_HOST_SUFFIX=${environment === 'staging' ? '-staging' : ''}`,
      'RMS_TAG=sha-1234567',
      'DEPLOY_UID=1000',
      '',
    ].join('\n'),
  )
  run(`compose config: ${environment}${profiles ? ` (profiles ${profiles})` : ''}`, [
    'docker',
    'compose',
    '--env-file',
    envFile,
    '-f',
    join(host, 'docker/compose.base.yml'),
    '-f',
    join(host, `docker/compose.${environment}.yml`),
    'config',
    '-q',
  ])
}

for (const upstreams of ['api-1:3000', 'api-1:3000 api-2:3000']) {
  run(`caddy validate (${upstreams})`, [
    'docker',
    'run',
    '--rm',
    '-e',
    `RMS_UPSTREAMS=${upstreams}`,
    '-v',
    `${resolve(root, 'ops/caddy')}:/etc/caddy:ro`,
    caddyImage,
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  ])
}
run('caddy fmt (canonical form)', [
  'docker',
  'run',
  '--rm',
  '-v',
  `${resolve(root, 'ops/caddy')}:/etc/caddy:ro`,
  caddyImage,
  'sh',
  '-c',
  'caddy fmt /etc/caddy/Caddyfile | diff -u /etc/caddy/Caddyfile - && echo canonical',
])

/**
 * An image that the local stack and a host both run has one tag: a pin changed in one file and not in the other would mean that
 * staging runs what nobody tested (DR-95, DOC-11 §7).
 */
function images(file: string): Map<string, string> {
  const compose = Bun.YAML.parse(readFileSync(resolve(root, file), 'utf8')) as {
    services: Record<string, { image?: string }>
  }
  const found = new Map<string, string>()
  for (const service of Object.values(compose.services)) {
    const image = service.image
    if (image && !image.includes('${')) {
      const colon = image.lastIndexOf(':')
      found.set(image.slice(0, colon), image.slice(colon + 1))
    }
  }
  return found
}
console.log('\n-- image tags agree between docker/compose.local.yml and compose.base.yml')
{
  const local = images('docker/compose.local.yml')
  const mismatches = [...images('docker/compose.base.yml')]
    .filter(([name, tag]) => local.has(name) && local.get(name) !== tag)
    .map(([name, tag]) => `${name}: base ${tag}, local ${local.get(name)}`)
  if (mismatches.length > 0) {
    failed = true
    console.error(`${mismatches.join('\n')}\nFAILED: image tags`)
  } else console.log('ok')
}

/** Every `.sh` under `ops/`. */
function scripts(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return scripts(path)
    return name.endsWith('.sh') ? [path.slice(root.length + 1)] : []
  })
}
const shellScripts = scripts(resolve(root, 'ops'))
const local =
  Bun.spawnSync(['shellcheck', '--version'], { stdout: 'pipe', stderr: 'pipe' }).exitCode === 0
run(
  `shellcheck (${shellScripts.length} scripts)`,
  local
    ? ['shellcheck', '-x', '-P', 'SCRIPTDIR', ...shellScripts]
    : [
        'docker',
        'run',
        '--rm',
        '-v',
        `${root}:/mnt:ro`,
        '-w',
        '/mnt',
        SHELLCHECK_IMAGE,
        '-x',
        '-P',
        'SCRIPTDIR',
        ...shellScripts,
      ],
)

console.log('\n-- bun test tools/ops-files')
const tests = Bun.spawnSync(
  [
    'bun',
    'test',
    ...readdirSync(resolve(root, 'tools/ops-files'))
      .filter((n) => n.endsWith('.test.ts') && !n.startsWith('backup-repo'))
      .map((n) => `tools/ops-files/${n}`),
  ],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
)
if (tests.exitCode !== 0) failed = true

process.exit(failed ? 1 : 0)
