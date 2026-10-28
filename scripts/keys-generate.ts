/**
 * `bun run keys:generate`: creates `.env.local` for `APP_ENV=local` (DOC-69 §8). Idempotent: a key that exists is never
 * changed; a missing key is appended. A port set in the environment (`RMS_PG_PORT=5433 bun run keys:generate`) is written
 * the first time. The variables are written in the order the dotenv expansion needs: ports and passwords first, URLs after.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { envFile, readEnvFile } from './lib/env'
import { base64Key, es256, ringJson, secret, secretFiles } from './lib/keys'

/** A dotenv reference, expanded by Bun and by docker compose when the file is read. */
const ref = (name: string) => `\${${name}}`

const url = (role: string, password: string) =>
  `postgres://${role}:${ref(password)}@localhost:${ref('RMS_PG_PORT')}/rms`

/** A key ring with one key (DOC-41 §6), single-quoted so dotenv leaves the JSON alone. */
const ring = (kid: string, key: string) => `'${ringJson(kid, key)}'`

const generated: [key: string, value: () => string][] = [
  ['APP_ENV', () => 'local'],
  ['RMS_PG_PORT', () => process.env.RMS_PG_PORT ?? '5432'],
  ['RMS_S3_PORT', () => process.env.RMS_S3_PORT ?? '9000'],
  ['RMS_S3_CONSOLE_PORT', () => process.env.RMS_S3_CONSOLE_PORT ?? '9001'],
  ['RMS_MAIL_PORT', () => process.env.RMS_MAIL_PORT ?? '1025'],
  ['RMS_MAIL_UI_PORT', () => process.env.RMS_MAIL_UI_PORT ?? '8025'],
  ['RMS_POSTGRES_PASSWORD', secret],
  ['RMS_MIGRATOR_PASSWORD', secret],
  ['RMS_APP_PASSWORD', secret],
  ['RMS_READONLY_PASSWORD', secret],
  // The URLs follow RMS_PG_PORT through dotenv expansion, so changing the port later needs no second run.
  ['DATABASE_URL', () => url('rms_app', 'RMS_APP_PASSWORD')],
  ['MIGRATION_DATABASE_URL', () => url('rms_migrator', 'RMS_MIGRATOR_PASSWORD')],
  ['READONLY_DATABASE_URL', () => url('rms_readonly', 'RMS_READONLY_PASSWORD')],
  ['S3_ENDPOINT', () => `http://localhost:${ref('RMS_S3_PORT')}`],
  ['S3_PUBLIC_ENDPOINT', () => `http://localhost:${ref('RMS_S3_PORT')}`],
  ['S3_BUCKET', () => 'rms-local-files'],
  ['S3_REGION', () => 'auto'],
  ['S3_FORCE_PATH_STYLE', () => 'true'],
  ['S3_ACCESS_KEY_ID', () => `rms${secret().slice(0, 16)}`],
  ['S3_SECRET_ACCESS_KEY', secret],
  ['DEMO_STAFF_PASSWORD', () => 'demo-password-1'],
  // DR-305: every API answer waits about this long on a laptop, as on a real network; 0 turns it off.
  ['DEV_LATENCY_MS', () => '400'],
  // The application keys (P1-04, DOC-41 §6): a ring is `{"<kid>": "<key>"}`, the newest kid signs and all verify.
  ['JWT_KEYS', () => ring('k1', es256())],
  ['QR_KEYS', () => ring('v1', base64Key(32))],
  ['OTP_HMAC_KEY', () => base64Key(32)],
  ['SETTINGS_ENCRYPTION_KEYS', () => ring('k1', base64Key(32))],
  ['PII_ENCRYPTION_KEYS', () => ring('k1', base64Key(32))],
]

function generateLocal() {
  const existed = existsSync(envFile)
  const have = readEnvFile(envFile)
  const missing = generated.filter(([key]) => !have.has(key))

  if (!existed)
    writeFileSync(
      envFile,
      '# Local secrets and ports. Made by `bun run keys:generate`; never committed.\n',
    )
  if (missing.length === 0) {
    console.log('kept .env.local')
  } else {
    appendFileSync(envFile, `${missing.map(([key, value]) => `${key}=${value()}`).join('\n')}\n`)
    console.log(
      existed
        ? `updated .env.local (${missing.length} keys added)`
        : `created .env.local (${missing.length} keys)`,
    )
  }
}

/**
 * `--out <dir> --env staging|production --db-host <host>`: one file per secret for a host (DOC-70 §9.1, DOC-41 §2 rule 4),
 * run on the host from the `rms-api` image so no key is made on a laptop or in CI. A file that exists is kept, so a second
 * run changes nothing (CF-16); a URL is built from the password file next to it.
 */
function generateOut(args: string[]) {
  const option = (name: string) => {
    const at = args.indexOf(name)
    return at === -1 ? undefined : args[at + 1]
  }
  const out = option('--out')
  const env = option('--env')
  const dbHost = option('--db-host')
  if (!out || (env !== 'staging' && env !== 'production') || !dbHost) {
    console.error(
      'usage: keys-generate.ts --out <dir> --env staging|production --db-host <host> [--db-port 5432] [--db-name rms]',
    )
    process.exit(2)
  }
  const dbPort = Number(option('--db-port') ?? 5432)
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    console.error(`--db-port ${option('--db-port')} is not a port`)
    process.exit(2)
  }
  mkdirSync(out, { recursive: true })

  const values = new Map<string, string>()
  const known = (name: string) => {
    const value = values.get(name)
    if (value === undefined) throw new Error(`${name} is used before it is made`)
    return value
  }
  let created = 0
  const files = secretFiles({ dbHost, dbPort, dbName: option('--db-name') ?? 'rms', env })
  for (const file of files) {
    const path = join(out, file.name)
    if (existsSync(path)) {
      values.set(file.name, readFileSync(path, 'utf8').replace(/\n$/, ''))
      continue
    }
    const value = file.make(known)
    values.set(file.name, value)
    // `wx` never overwrites; the mode is the one of DOC-70 §9.1 (group `rms` reads an application file).
    writeFileSync(path, value, { mode: file.mode === 'app' ? 0o440 : 0o400, flag: 'wx' })
    created++
  }
  console.log(created === 0 ? `kept ${files.length} files` : `created ${created} files`)
}

const args = process.argv.slice(2)
if (args.includes('--out')) generateOut(args)
else if (args.some((arg) => arg.startsWith('--'))) {
  console.error('unknown option; the local form takes none (see --out for a host)')
  process.exit(2)
} else generateLocal()
