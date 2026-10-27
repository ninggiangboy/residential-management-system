/**
 * `bun run check:ops` (stage `verify`, DOC-40 §10 OB-04, OB-05, DOC-70 §10): the monitoring files under `ops/` are valid for the
 * versions that run them, and the alert rules pass their tests. Each tool runs from its own image, whose tag is read from
 * `docker/compose.local.yml` so that the pin has one home. Needs Docker; the images are pulled on first use.
 *
 * - `promtool check config`, `check rules` and `test rules` (Prometheus)
 * - `amtool check-config` (Alertmanager, with throw-away secret files)
 * - `loki -verify-config`
 * - `alloy validate` and `alloy fmt` (the file must be in canonical form)
 * - the Grafana dashboards are what `bun run ops:dashboards` writes
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const compose = readFileSync(resolve(root, 'docker/compose.local.yml'), 'utf8')

function image(repository: string): string {
  const match = compose.match(new RegExp(`image: (${repository.replace('/', '\\/')}:[\\w.-]+)`))
  if (!match?.[1]) throw new Error(`docker/compose.local.yml pins no image of ${repository}`)
  return match[1]
}

let failed = false
function run(title: string, args: string[], expectOutput?: (out: string) => boolean) {
  console.log(`\n-- ${title}`)
  const proc = Bun.spawnSync(['docker', 'run', '--rm', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = `${proc.stdout}${proc.stderr}`.trim()
  if (proc.exitCode !== 0 || (expectOutput && !expectOutput(out))) {
    failed = true
    console.error(out)
    console.error(`FAILED: ${title}`)
    return
  }
  console.log('ok')
}

const prometheus = image('prom/prometheus')
const alertmanager = image('prom/alertmanager')
const loki = image('grafana/loki')
const alloy = image('grafana/alloy')
const ops = (name: string) => `${resolve(root, 'ops', name)}`

const promtool = (title: string, ...args: string[]) =>
  run(title, ['-v', `${ops('prometheus')}:/p:ro`, '--entrypoint', 'promtool', prometheus, ...args])

promtool('promtool check config', 'check', 'config', '/p/prometheus.yml')
promtool(
  'promtool check rules',
  'check',
  'rules',
  '/p/rules/rms-alerts.yml',
  '/p/rules/rms-jobs.yml',
  '/p/rules/rms-host.yml',
)
promtool(
  'promtool test rules (OB-05)',
  'test',
  'rules',
  '/p/tests/rms-alerts.test.yml',
  '/p/tests/rms-host.test.yml',
)

// The secrets are files on the host (DOC-70 §9.1); the check reads them, so it gets empty ones.
const secrets = mkdtempSync(join(tmpdir(), 'rms-secrets-'))
for (const name of ['telegram-bot-token', 'alertmanager-smtp-password'])
  writeFileSync(join(secrets, name), 'x')
run('amtool check-config', [
  '-v',
  `${ops('alertmanager')}:/a:ro`,
  '-v',
  `${secrets}:/run/secrets:ro`,
  '--entrypoint',
  'amtool',
  alertmanager,
  'check-config',
  '/a/alertmanager.yml',
  '/a/alertmanager.local.yml',
])

run('loki -verify-config', [
  '-v',
  `${ops('loki')}:/etc/loki:ro`,
  loki,
  '-config.file=/etc/loki/config.yml',
  '-verify-config',
])

run('alloy validate', [
  '-e',
  'RMS_ENV=check',
  '-v',
  `${ops('alloy')}:/etc/alloy:ro`,
  alloy,
  'validate',
  '/etc/alloy/config.alloy',
])
const formatted = Bun.spawnSync(
  [
    'docker',
    'run',
    '--rm',
    '-v',
    `${ops('alloy')}:/etc/alloy:ro`,
    alloy,
    'fmt',
    '/etc/alloy/config.alloy',
  ],
  { stdout: 'pipe', stderr: 'pipe' },
)
if (String(formatted.stdout) !== readFileSync(resolve(root, 'ops/alloy/config.alloy'), 'utf8')) {
  failed = true
  console.error(
    '\nops/alloy/config.alloy is not in canonical form: run `alloy fmt -w` (docker run … grafana/alloy fmt -w)',
  )
}

const dashboards = Bun.spawnSync(['bun', 'scripts/build-dashboards.ts', '--check'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (dashboards.exitCode !== 0) failed = true

process.exit(failed ? 1 : 0)
