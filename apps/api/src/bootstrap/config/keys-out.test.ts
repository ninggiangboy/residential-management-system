import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { loadAppConfig } from './load'
import { hostEnv } from './support'

/** CF-16 on the host form: `keys:generate --out` makes the files of DOC-70 §9.1 and a second run changes nothing. */

const script = resolve(import.meta.dir, '../../../../../scripts/keys-generate.ts')
const args = (out: string) => [
  'bun',
  script,
  '--out',
  out,
  '--env',
  'staging',
  '--db-host',
  'host.docker.internal',
]

const run = (command: string[]) => {
  const proc = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  return {
    code: proc.exitCode,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  }
}

const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8')

describe('keys:generate --out (CF-16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rms-keys-'))
  const first = run(args(dir))

  test('writes the 15 files, with the modes of DOC-70 §9.1', () => {
    expect(first).toEqual({ code: 0, out: 'created 15 files', err: '' })
    expect(readdirSync(dir)).toHaveLength(15)
    const modes = (name: string) => statSync(join(dir, name)).mode & 0o777
    expect(modes('db-migrator-url')).toBe(0o400)
    expect(modes('db-app-password')).toBe(0o400)
    expect(modes('db-app-url')).toBe(0o440)
    expect(modes('jwt-keys')).toBe(0o440)
  })

  test('a URL carries the password of the file beside it', () => {
    for (const [role, name] of [
      ['rms_app', 'app'],
      ['rms_migrator', 'migrator'],
      ['rms_readonly', 'readonly'],
    ] as const)
      expect(read(dir, `db-${name}-url`)).toBe(
        `postgres://${role}:${read(dir, `db-${name}-password`)}@host.docker.internal:5432/rms`,
      )
  })

  test('the files satisfy the staging configuration (DOC-41 §6, §17)', () => {
    const { env } = hostEnv('staging')
    const mapped: Record<string, string> = {
      DATABASE_URL: 'db-app-url',
      JWT_KEYS: 'jwt-keys',
      QR_KEYS: 'qr-keys',
      OTP_HMAC_KEY: 'otp-hmac-key',
      SETTINGS_ENCRYPTION_KEYS: 'settings-encryption-keys',
      PII_ENCRYPTION_KEYS: 'pii-encryption-keys',
      S3_ACCESS_KEY_ID: 's3-access-key-id',
      S3_SECRET_ACCESS_KEY: 's3-secret-access-key',
      DEMO_STAFF_PASSWORD: 'demo-staff-password',
    }
    for (const [key, file] of Object.entries(mapped)) env[`${key}_FILE`] = join(dir, file)
    // The provider secrets (`SMTP_PASSWORD`, `EXPO_ACCESS_TOKEN`) are not made here; the test stands in for them.
    const io = {
      readFile: (path: string) => (path.startsWith(dir) ? read(dir, basename(path)) : 'provider'),
    }
    const config = loadAppConfig(env, io)
    expect(config.secrets.DEMO_STAFF_PASSWORD?.length).toBeGreaterThanOrEqual(12)
  })

  test('a second run keeps every file', () => {
    const before = readdirSync(dir).map((name) => [name, read(dir, name)])
    expect(run(args(dir))).toEqual({ code: 0, out: 'kept 15 files', err: '' })
    expect(readdirSync(dir).map((name) => [name, read(dir, name)])).toEqual(before)
  })

  test('a missing file is made again and the others stay', () => {
    const jwt = read(dir, 'jwt-keys')
    const otp = read(dir, 'otp-hmac-key')
    Bun.spawnSync(['rm', join(dir, 'otp-hmac-key')])
    expect(run(args(dir)).out).toBe('created 1 files')
    expect(read(dir, 'jwt-keys')).toBe(jwt)
    expect(read(dir, 'otp-hmac-key')).not.toBe(otp)
  })

  test('refuses a call without the host or the environment', () => {
    expect(run(['bun', script, '--out', dir, '--env', 'staging']).code).toBe(2)
    expect(run(['bun', script, '--out', dir, '--db-host', 'x', '--env', 'local']).code).toBe(2)
    expect(run(['bun', script, '--surprise']).code).toBe(2)
  })
})
