/**
 * `bun run test:integration` (DOC-88 §6, DR-67): runs the `test:integration` script of every workspace that defines one, at
 * most `LANES` workspaces at a time, and exits non-zero when any of them fails (the others still finish).
 *
 * Why not `bun run --filter … test:integration`: it starts every workspace at once, and each suite keeps a pool of
 * `rms_migrator` connections (fixtures that need DDL or the audit table; `TestDb.admin`). That role has `CONNECTION LIMIT 3`
 * (DOC-19 §3, `ops/postgres/0001-provision.sql`), so with six or seven suites running together a connection was refused
 * (`53300 too many connections for role "rms_migrator"`) in a different test on each run. Two lanes keep the sum of the
 * pools under the limit. `@mod/finance` is the longest suite (about 9 minutes), so the modules go first and it starts at
 * once beside one lane that runs all the others; the whole run takes about as long as finance alone.
 *
 * The output of a workspace is prefixed with its name, as `bun run --filter` does.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANES = 2
const SCRIPT = 'test:integration'

const root = resolve(import.meta.dir, '..')

type Workspace = { name: string; dir: string }

/** Modules first (they hold the long suite), then the apps; alphabetical inside each group. */
const workspaces: Workspace[] = ['modules', 'apps'].flatMap((group) =>
  readdirSync(resolve(root, group), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(root, group, d.name, 'package.json')))
    .map((d) => resolve(root, group, d.name))
    .flatMap((dir): Workspace[] => {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
        name: string
        scripts?: Record<string, string>
      }
      return pkg.scripts?.[SCRIPT] ? [{ name: pkg.name, dir }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
)

/** Copies a stream to stdout line by line, each line behind the prefix. */
async function pipePrefixed(stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of stream) {
    rest += decoder.decode(chunk, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) process.stdout.write(`${prefix}${line}\n`)
  }
  if (rest) process.stdout.write(`${prefix}${rest}\n`)
}

async function run({ name, dir }: Workspace): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
  const prefix = `${name} ${SCRIPT}: `
  const [, , code] = await Promise.all([
    pipePrefixed(proc.stdout, prefix),
    pipePrefixed(proc.stderr, prefix),
    proc.exited,
  ])
  return code
}

const queue = [...workspaces]
const failed: string[] = []
await Promise.all(
  Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if ((await run(next)) !== 0) failed.push(next.name)
    }
  }),
)

if (failed.length > 0) {
  console.error(`${SCRIPT} failed in: ${failed.sort().join(', ')}`)
  process.exit(1)
}
console.log(`${SCRIPT} passed in ${workspaces.length} workspaces`)
