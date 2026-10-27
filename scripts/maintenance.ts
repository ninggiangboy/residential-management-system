/**
 * `bun scripts/maintenance.ts on "<reason>"` and `... off` (DOC-70 §6.4): sets the one row of `platform.maintenance` as
 * `rms_migrator`, the only role that may write it (DOC-17 §3.4, DOC-19 §6). `ops/deploy/maintenance.sh` runs it in the `migrate`
 * container; every process polls the row (DOC-38 §3.7) and answers 503 `maintenance` while `active` is true.
 */
import { readFileSync } from 'node:fs'
import { Database } from '@core/db'

const [action, ...words] = process.argv.slice(2)
const reason = words.join(' ').trim()
if (action !== 'on' && action !== 'off') {
  process.stderr.write('usage: maintenance.ts on "<reason>" | off\n')
  process.exit(2)
}
if (action === 'on' && reason === '') {
  process.stderr.write('maintenance.ts on needs the reason residents will read\n')
  process.exit(2)
}

const file = process.env.MIGRATION_DATABASE_URL_FILE
const url = file ? readFileSync(file, 'utf8').trim() : process.env.MIGRATION_DATABASE_URL
if (!url) {
  process.stderr.write('MIGRATION_DATABASE_URL (or MIGRATION_DATABASE_URL_FILE) is required\n')
  process.exit(2)
}

const database = new Database({ url, poolMax: 1, prepare: false })
let code = 0
try {
  const active = action === 'on'
  await database.client.unsafe(
    `insert into platform.maintenance (id, active, reason, since)
     values (true, $1, $2, case when $1 then now() end)
     on conflict (id) do update set active = excluded.active, reason = excluded.reason, since = excluded.since`,
    [active, active ? reason : null],
  )
  process.stdout.write(`maintenance ${action}\n`)
} catch (error) {
  process.stderr.write(
    `maintenance ${action} failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  code = 1
} finally {
  await database.close()
}
process.exit(code)
