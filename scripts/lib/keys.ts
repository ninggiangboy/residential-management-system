/**
 * The generators of `bun run keys:generate` (DOC-69 §8, DOC-70 §9.1). The file has no import beyond `node:crypto`, because the
 * `rms-api` image runs it on the staging host (`--out`) and carries nothing else of `scripts/`.
 */
import { generateKeyPairSync } from 'node:crypto'

/** 24 random bytes in hex: a password that is safe inside a URL and a psql variable. */
export const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')

export const base64Key = (bytes: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64')

/** A key ring with one key (DOC-41 §6), on one line. */
export const ringJson = (kid: string, key: string) => JSON.stringify({ [kid]: key })

/** An ES256 (P-256) private key in PEM; the `\n` escapes of JSON keep the ring on one line. */
export const es256 = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()

/** The files of `--out`, in the order they are made: a name, how to make it and who may read it (DOC-70 §9.1). */
type SecretFile = {
  name: string
  /** `app` is mounted into a container (0440, group `rms`); `host` is read by the operator only (0400). */
  mode: 'app' | 'host'
  make: (known: (name: string) => string) => string
}

type OutOptions = { dbHost: string; dbPort: number; dbName: string; env: 'staging' | 'production' }

const url = (role: string, passwordFile: string, options: OutOptions): SecretFile['make'] => {
  return (known) =>
    `postgres://${role}:${known(passwordFile)}@${options.dbHost}:${options.dbPort}/${options.dbName}`
}

/** The 15 files that `keys:generate --out` writes; the `seaweedfs-*`, tunnel and provider files are made elsewhere. */
export function secretFiles(options: OutOptions): SecretFile[] {
  return [
    { name: 'db-app-password', mode: 'host', make: secret },
    { name: 'db-migrator-password', mode: 'host', make: secret },
    { name: 'db-readonly-password', mode: 'host', make: secret },
    { name: 'db-app-url', mode: 'app', make: url('rms_app', 'db-app-password', options) },
    // Only `migrate` mounts it, and it runs as the uid of `deploy` (DOC-70 §6.3).
    {
      name: 'db-migrator-url',
      mode: 'host',
      make: url('rms_migrator', 'db-migrator-password', options),
    },
    {
      name: 'db-readonly-url',
      mode: 'app',
      make: url('rms_readonly', 'db-readonly-password', options),
    },
    { name: 'jwt-keys', mode: 'app', make: () => ringJson('k1', es256()) },
    { name: 'qr-keys', mode: 'app', make: () => ringJson('v1', base64Key(32)) },
    { name: 'otp-hmac-key', mode: 'app', make: () => base64Key(32) },
    { name: 'settings-encryption-keys', mode: 'app', make: () => ringJson('k1', base64Key(32)) },
    { name: 'pii-encryption-keys', mode: 'app', make: () => ringJson('k1', base64Key(32)) },
    { name: 's3-access-key-id', mode: 'app', make: () => `rms${secret().slice(0, 16)}` },
    { name: 's3-secret-access-key', mode: 'app', make: secret },
    { name: 'demo-staff-password', mode: 'app', make: secret },
    { name: 'grafana-admin-password', mode: 'app', make: secret },
  ]
}
