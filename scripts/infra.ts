/**
 * `bun run infra:up | infra:down | infra:reset` (DOC-69 §5, §6): the local PostgreSQL, object store and Mailpit of
 * `docker/compose.local.yml`. `reset` deletes the volumes, so the local database and files are lost (DOC-69 §11).
 */
import { existsSync } from 'node:fs'
import { composeFile, envFile, readEnvFile, root } from './lib/env'

const WAIT_SECONDS = 180

const [command] = process.argv.slice(2)
if (command !== 'up' && command !== 'down' && command !== 'reset') {
  console.error('usage: bun scripts/infra.ts up|down|reset')
  process.exit(64)
}

if (!existsSync(envFile)) {
  if (command === 'down') {
    console.log('nothing to stop: there is no .env.local')
    process.exit(0)
  }
  console.error('.env.local not found: run bun run keys:generate')
  process.exit(2)
}

const compose = (...args: string[]) => {
  const proc = Bun.spawnSync(
    ['docker', 'compose', '-f', composeFile, '--env-file', envFile, ...args],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  )
  return proc.exitCode
}

if (command === 'down' || command === 'reset') {
  const code = compose('down', ...(command === 'reset' ? ['--volumes'] : []))
  if (code !== 0) process.exit(code)
  if (command === 'down') process.exit(0)
}

const started = performance.now()
const code = compose('up', '-d', '--wait', '--wait-timeout', String(WAIT_SECONDS))
if (code !== 0) {
  console.error(
    `infra:up failed: see the docker compose output above (the services must be healthy within ${WAIT_SECONDS} s; docker compose -f docker/compose.local.yml ps shows which is not)`,
  )
  process.exit(code)
}

const env = readEnvFile(envFile)
const port = (key: string, fallback: string) => env.get(key) ?? fallback
const rows: [name: string, where: string][] = [
  ['postgres', `localhost:${port('RMS_PG_PORT', '5432')}`],
  [
    'objectstore',
    `localhost:${port('RMS_S3_PORT', '9000')}  (console ${port('RMS_S3_CONSOLE_PORT', '9001')})`,
  ],
  [
    'mailpit',
    `localhost:${port('RMS_MAIL_PORT', '1025')}  (web ${port('RMS_MAIL_UI_PORT', '8025')})`,
  ],
]
for (const [name, where] of rows) console.log(`${name.padEnd(13)} healthy   ${where}`)
console.log(`infra up in ${((performance.now() - started) / 1000).toFixed(0)} s`)
