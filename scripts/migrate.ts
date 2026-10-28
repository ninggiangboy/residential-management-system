/**
 * `bun run db:migrate` (and `bun scripts/migrate.ts` in the image, DOC-70 §6.3): as `rms_migrator`, on one connection with
 * `prepare: false` (PgBouncer-compatible, DR-67):
 *   1. `0000-bootstrap.sql`: extensions, the fifteen schemas, the helpers and tables of `platform` (idempotent)
 *   2. the pending migrations of every module in catalog order, each with its history in `drizzle_<module>.__migrations`
 *   3. `0900-grants.sql`: the privileges of `rms_app` and `rms_readonly`, computed from nothing (idempotent, one transaction)
 * Never run by the application at boot (DR-08). Exit 0, or non-zero on the first failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Database, isPgError, migrateModule } from '@core/db'
import { MODULE_CATALOG } from '../apps/api/src/bootstrap/module-catalog'

const root = resolve(import.meta.dir, '..')
const say = (line: string) => process.stdout.write(`${line}\n`)
const warn = (line: string) => process.stderr.write(`${line}\n`)

/** The fifteen schemas of DOC-14 §2: fourteen modules and `platform` (`analytics` joined with DR-279). */
const SCHEMAS = [
  'platform',
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
  'analytics',
]

function migrationUrl(): string {
  const file = process.env.MIGRATION_DATABASE_URL_FILE
  const url = file ? readFileSync(file, 'utf8').trim() : process.env.MIGRATION_DATABASE_URL
  if (!url)
    throw new Error(
      'MIGRATION_DATABASE_URL (or MIGRATION_DATABASE_URL_FILE) is required: run `bun run keys:generate`',
    )
  return url
}

/** How many migrations a module's history holds; a module that never migrated has none. */
async function applied(database: Database, module: string): Promise<number> {
  try {
    const rows = await database.client.unsafe(
      `select count(*)::int as n from drizzle_${module}.__migrations`,
    )
    return (rows[0]?.n as number | undefined) ?? 0
  } catch (err) {
    if (isPgError(err, '42P01', '3F000')) return 0
    throw err
  }
}

const sqlFile = (name: string) => join(root, 'ops/postgres', name)

const database = new Database({ url: migrationUrl(), poolMax: 1, prepare: false })
let code = 0
try {
  await database.client.unsafe(readFileSync(sqlFile('0000-bootstrap.sql'), 'utf8'))
  say('bootstrap applied')

  let pending = 0
  for (const { name, migrations } of MODULE_CATALOG) {
    if (!existsSync(join(migrations, 'meta'))) {
      warn(`- ${name}: no migrations found, skipping (run \`bun run db:generate\` first)`)
      continue
    }
    const before = await applied(database, name)
    await migrateModule(database, name, migrations)
    const added = (await applied(database, name)) - before
    pending += added
    say(`✔ ${name} migrated (${added} applied)`)
  }

  await database.client.unsafe(readFileSync(sqlFile('0900-grants.sql'), 'utf8'))
  const present = await database.client.unsafe(
    `select count(*)::int as n from information_schema.schemata where schema_name in (${SCHEMAS.map((name) => `'${name}'`).join(', ')})`,
  )
  say(`migrated: ${pending} pending applied, ${(present[0]?.n as number | undefined) ?? 0} schemas`)
  say('grants applied')
} catch (error) {
  warn(`db:migrate failed: ${error instanceof Error ? error.message : String(error)}`)
  code = 1
} finally {
  await database.close()
}
process.exit(code)
