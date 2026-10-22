/**
 * `bun run db:provision-ci` (DOC-71 §4.2): the CI twin of `docker/postgres/init/10-provision.sh`. Runs
 * `ops/postgres/0001-provision.sql` as `postgres` against the service container on `localhost:$RMS_PG_PORT`, with the
 * role passwords that `keys:generate` wrote to `.env.local`. psql runs from the same `postgres` image as the server, so the
 * runner needs no client of its own.
 *
 *   PGPASSWORD   the superuser password of the service container
 */
import { resolve } from 'node:path'
import { envFile, readEnvFile, root } from './lib/env'

const env = readEnvFile(envFile)
const need = (key: string) => {
  const value = env.get(key)
  if (!value) {
    console.error(`${key} missing in .env.local: run bun run keys:generate`)
    process.exit(2)
  }
  return value
}
if (!process.env.PGPASSWORD) {
  console.error('PGPASSWORD (the superuser password of the database) is not set')
  process.exit(2)
}

const proc = Bun.spawnSync(
  [
    'docker',
    'run',
    '--rm',
    '--network=host',
    '--env=PGPASSWORD',
    `--volume=${resolve(root, 'ops/postgres')}:/provision:ro`,
    'postgres:18.6',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '--host=localhost',
    `--port=${need('RMS_PG_PORT')}`,
    '--username=postgres',
    '--dbname=postgres',
    '-v',
    'db=rms',
    '-v',
    'app_conn_limit=80',
    '-v',
    `migrator_password=${need('RMS_MIGRATOR_PASSWORD')}`,
    '-v',
    `app_password=${need('RMS_APP_PASSWORD')}`,
    '-v',
    `readonly_password=${need('RMS_READONLY_PASSWORD')}`,
    '-f',
    '/provision/0001-provision.sql',
  ],
  { stdout: 'inherit', stderr: 'inherit' },
)
process.exit(proc.exitCode ?? 1)
