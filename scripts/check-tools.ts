/**
 * `bun run check:tools`: the installed tools against `.tool-versions` and DOC-69 §2. Bun must match exactly; Node must be a
 * release Expo SDK 58 accepts (24.3 or later on the even lines, DOC-11 §1) and only warns when it differs from the pin;
 * Docker needs Compose v2 or later and a running engine.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const pins = new Map(
  readFileSync(resolve(root, '.tool-versions'), 'utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts): parts is [string, string] => parts.length === 2 && parts[1] !== undefined)
    .map(([tool, version]) => [tool, version] as const),
)

const run = (cmd: string[]) => {
  try {
    const proc = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
    return proc.exitCode === 0 ? proc.stdout.toString().trim() : undefined
  } catch {
    return undefined
  }
}

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const bunPin = pins.get('bun')
if (Bun.version !== bunPin) fail(`tool_version_mismatch: bun ${Bun.version}, expected ${bunPin}`)

const nodeVersion = run(['node', '--version'])?.replace(/^v/, '')
if (!nodeVersion) fail('tool_missing: node (needed for Expo, DOC-69 §3)')
const [major = 0, minor = 0] = (nodeVersion ?? '').split('.').map(Number)
const nodeOk = (major === 24 && minor >= 3) || (major >= 26 && major % 2 === 0)
if (!nodeOk)
  fail(
    `tool_version_mismatch: node ${nodeVersion}, expected ${pins.get('nodejs')} (Expo SDK 58 accepts 24.3+ and 26+)`,
  )
if (nodeVersion !== pins.get('nodejs')) {
  console.warn(
    `warn: node ${nodeVersion}, .tool-versions pins ${pins.get('nodejs')} (accepted by Expo SDK 58)`,
  )
}

const compose = run(['docker', 'compose', 'version', '--short'])
if (!compose)
  fail(
    'tool_missing: docker compose (Docker Engine 29.9 or Docker Desktop with Compose 5.6, DOC-69 §2)',
  )
if (Number((compose ?? '').replace(/^v/, '').split('.')[0]) < 2)
  fail(`tool_version_mismatch: docker compose ${compose}, expected 2 or later`)
if (!run(['docker', 'info', '--format', '{{.ServerVersion}}']))
  fail('docker_not_running: start Docker, then run again')

console.log('tools ok')
