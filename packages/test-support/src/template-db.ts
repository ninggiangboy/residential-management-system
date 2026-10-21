import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postgres, { type Sql } from 'postgres'
import { adminUrl, appUrl, migratorUrl, withDatabase } from './urls'

/**
 * Each test file clones a migrated template database (`CREATE DATABASE … TEMPLATE …`), so files are isolated and a clone
 * costs about 100 ms instead of a full migration (DOC-88 §6, DR-77). The template is named after a hash of everything that
 * shapes it, so a stale one is never reused.
 */

export type TemplateKind = 'empty' | 'sample'

export interface TestDb {
  readonly name: string
  /** `rms_app`, the application's role. */
  readonly url: string
  /** `rms_app`, at most 10 connections. */
  readonly sql: Sql
  /** `rms_migrator`: for fixtures that need DDL or the audit table. */
  admin(): Sql
  /** N separate connections as `rms_app` (the race harness). */
  connect(max: number): Sql
  drop(): Promise<void>
}

const LOCK = 7_141_988 // advisory lock key of the template helper
export const TEMPLATE_PREFIX = 'rms_tpl_'
export const TEST_DB_PREFIX = 'rms_t_'
/** Bumped by the task that writes the sample-building seed; part of the template hash (DOC-88 §7). */
export const SAMPLE_SEED_VERSION = 0

const repoRoot = resolve(import.meta.dir, '../../..')

const connect = (url: string, max = 1) => postgres(url, { max, prepare: false, onnotice: () => {} })

/** Every file under `dir` whose path ends with `suffix`, in a stable order; none when the directory does not exist. */
function filesUnder(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (entry === 'node_modules') return []
      return statSync(path).isDirectory()
        ? filesUnder(path, suffix)
        : path.endsWith(suffix)
          ? [path]
          : []
    })
}

/** The first 8 hex characters of the SHA-256 of the provisioning script, the grants script, every migration and the seed version. */
export function templateHash(root = repoRoot): string {
  const hash = createHash('sha256')
  const files = [
    join(root, 'ops/postgres/0001-provision.sql'),
    join(root, 'ops/postgres/0900-grants.sql'),
    ...filesUnder(join(root, 'modules'), '.sql'),
  ].filter((file) => existsSync(file))
  for (const file of files) hash.update(file.slice(root.length)).update(readFileSync(file))
  hash.update(`seed:${SAMPLE_SEED_VERSION}`)
  return hash.digest('hex').slice(0, 8)
}

/** Runs the module migrations and the grants step on a freshly created template, as `rms_migrator` (DOC-88 §6.1 step 2). */
async function migrateTemplate(database: string): Promise<void> {
  const script = join(repoRoot, 'scripts/db.ts')
  // `db:migrate` exists from P1-06; until then a template has no schemas and an empty module catalog needs none.
  if (!existsSync(script)) return
  const proc = Bun.spawn(['bun', script, 'migrate'], {
    cwd: repoRoot,
    env: { ...process.env, MIGRATION_DATABASE_URL: withDatabase(migratorUrl(), database) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`db:migrate failed on ${database}:\n${out}\n${err}`)
}

/** Builds `rms_tpl_<kind>_<hash8>` once per hash, inside one advisory lock so parallel files and jobs build it once. */
export async function ensureTemplate(root: Sql, kind: TemplateKind): Promise<string> {
  const emptyName = `${TEMPLATE_PREFIX}empty_${templateHash()}`
  const name = kind === 'empty' ? emptyName : `${TEMPLATE_PREFIX}sample_${templateHash()}`
  await root`SELECT pg_advisory_lock(${LOCK})`
  try {
    const exists = async (database: string) =>
      (await root`SELECT 1 FROM pg_database WHERE datname = ${database}`).length > 0
    if (!(await exists(emptyName))) {
      await root.unsafe(`CREATE DATABASE ${emptyName} OWNER rms_migrator`)
      await migrateTemplate(emptyName)
      await root.unsafe(`ALTER DATABASE ${emptyName} IS_TEMPLATE true`)
    }
    if (kind === 'sample' && !(await exists(name))) {
      // The sample building is seeded by the builders of DOC-88 §7; until that task lands the sample equals the empty template.
      await root.unsafe(`CREATE DATABASE ${name} TEMPLATE ${emptyName} OWNER rms_migrator`)
      await root.unsafe(`ALTER DATABASE ${name} IS_TEMPLATE true`)
    }
  } finally {
    await root`SELECT pg_advisory_unlock(${LOCK})`
  }
  return name
}

/** A throw-away database cloned from the template; connect as `rms_app` and drop it in `afterAll`. */
export async function cloneTemplate(kind: TemplateKind = 'empty'): Promise<TestDb> {
  const root = connect(adminUrl())
  const template = await ensureTemplate(root, kind)
  const name = `${TEST_DB_PREFIX}${process.pid}_${randomBytes(4).toString('hex')}`
  for (let attempt = 1; ; attempt++) {
    try {
      await root`SELECT pg_advisory_lock(${LOCK})`
      await root.unsafe(`CREATE DATABASE ${name} TEMPLATE ${template} OWNER rms_migrator`)
      await root`SELECT pg_advisory_unlock(${LOCK})`
      break
    } catch (error) {
      await root`SELECT pg_advisory_unlock(${LOCK})`.catch(() => {})
      // 55006: the template is in use by another clone; wait and try again.
      if ((error as { code?: string }).code !== '55006' || attempt === 5) throw error
      await Bun.sleep(50)
    }
  }
  const url = withDatabase(appUrl(), name)
  const sql = connect(url, 10)
  return {
    name,
    url,
    sql,
    admin: () => connect(withDatabase(migratorUrl(), name), 2),
    connect: (max) => connect(url, max),
    async drop() {
      await sql.end({ timeout: 2 })
      if (process.env.TEST_KEEP_DB === 'true') {
        await root.end()
        return console.warn(`kept database ${name}`)
      }
      await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await root.end()
    },
  }
}

/** `bun run test:db-clean`: drops the databases of finished or crashed runs and the templates of an older hash. */
export async function cleanTestDatabases(): Promise<string[]> {
  const root = connect(adminUrl())
  try {
    const current = new Set([
      `${TEMPLATE_PREFIX}empty_${templateHash()}`,
      `${TEMPLATE_PREFIX}sample_${templateHash()}`,
    ])
    const rows = await root<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`} OR datname LIKE ${`${TEMPLATE_PREFIX}%`}`
    const dropped: string[] = []
    for (const { datname } of rows) {
      if (current.has(datname)) continue
      if (datname.startsWith(TEMPLATE_PREFIX))
        await root.unsafe(`ALTER DATABASE ${datname} IS_TEMPLATE false`)
      await root.unsafe(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`)
      dropped.push(datname)
    }
    return dropped
  } finally {
    await root.end()
  }
}
