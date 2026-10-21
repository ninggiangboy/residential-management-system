/**
 * `bun run keys:generate`: creates `.env.local` for `APP_ENV=local` (DOC-69 §8). Idempotent: a key that exists is never
 * changed; a missing key is appended. A port set in the environment (`RMS_PG_PORT=5433 bun run keys:generate`) is written
 * the first time. The variables are written in the order the dotenv expansion needs: ports and passwords first, URLs after.
 */
import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { envFile, readEnvFile } from './lib/env'

/** A dotenv reference, expanded by Bun and by docker compose when the file is read. */
const ref = (name: string) => `\${${name}}`

const url = (role: string, password: string) =>
  `postgres://${role}:${ref(password)}@localhost:${ref('RMS_PG_PORT')}/rms`

const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')

const base64Key = (bytes: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64')

/** A key ring with one key (DOC-41 §6), on one line and single-quoted so dotenv leaves the JSON alone. */
const ring = (kid: string, key: string) => `'${JSON.stringify({ [kid]: key })}'`

/** An ES256 (P-256) private key in PEM; the `\n` escapes of JSON keep the ring on one line. */
const es256 = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()

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
  // The application keys (P1-04, DOC-41 §6): a ring is `{"<kid>": "<key>"}`, the newest kid signs and all verify.
  ['JWT_KEYS', () => ring('k1', es256())],
  ['QR_KEYS', () => ring('v1', base64Key(32))],
  ['OTP_HMAC_KEY', () => base64Key(32)],
  ['SETTINGS_ENCRYPTION_KEYS', () => ring('k1', base64Key(32))],
  ['PII_ENCRYPTION_KEYS', () => ring('k1', base64Key(32))],
]

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
