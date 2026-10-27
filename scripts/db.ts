/**
 * Database commands that are not the migration itself:
 *   bun run db:generate   drizzle-kit generates the next migration of every module of the catalog (DOC-14 §14.1)
 *   bun run db:reset      empties the application database and migrates it again: every object of the fourteen schemas and
 *                         every `drizzle_<module>` history goes, the roles and the database stay, then `seed:demo` (DOC-69 §11)
 * `reset` runs as `rms_migrator`, which owns everything; it refuses any profile but `local` and `test`.
 */
import { resolve } from 'node:path'
import { Database } from '@core/db'
import { MODULE_CATALOG } from '../apps/api/src/bootstrap/module-catalog'

const say = (line: string) => process.stdout.write(`${line}\n`)
const [command] = process.argv.slice(2)

async function generate() {
  for (const { name, dir } of MODULE_CATALOG) {
    say(`▶ generate ${name}`)
    const proc = Bun.spawn(['bunx', '--bun', 'drizzle-kit', 'generate'], {
      cwd: dir,
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((await proc.exited) !== 0) process.exit(1)
  }
  say(MODULE_CATALOG.length === 0 ? 'no modules in the catalog yet' : 'generated')
}

async function reset() {
  const profile = process.env.APP_ENV
  if (profile !== 'local' && profile !== 'test')
    throw new Error(`db:reset refuses APP_ENV=${profile ?? 'unset'}: only local and test`)
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required: run `bun run keys:generate`')
  const database = new Database({ url, poolMax: 1, prepare: false })
  try {
    const schemas = await database.client.unsafe(`
      select schema_name from information_schema.schemata
       where schema_name in ('platform','identity','building','residency','finance','tickets','access','vehicles',
                             'notices','notification','wiki','audit','reporting','realtime')
          or schema_name like 'drizzle\\_%'`)
    for (const { schema_name } of schemas)
      await database.client.unsafe(`drop schema if exists "${schema_name}" cascade`)
    say(`dropped ${schemas.length} schemas`)
  } finally {
    await database.close()
  }
  const migrate = Bun.spawn(['bun', resolve(import.meta.dir, 'migrate.ts')], {
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await migrate.exited) !== 0) process.exit(1)
  // The demo building comes back with the schemas (DOC-69 §11): `seed:demo` is safe to run on an empty database (P1-21).
  const seed = Bun.spawn(['bun', 'run', 'seed:demo'], {
    cwd: resolve(import.meta.dir, '..'),
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await seed.exited) !== 0) process.exit(1)
}

try {
  if (command === 'generate') await generate()
  else if (command === 'reset') await reset()
  else {
    process.stderr.write('usage: bun scripts/db.ts generate | reset\n')
    process.exit(64)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
process.exit(0)
