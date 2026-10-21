import { generateKeyPairSync } from 'node:crypto'
import type { Env } from '@core/config'

/** Helpers of the configuration tests only; nothing imports this file in production. */

export const base64Key = (bytes = 32) => Buffer.alloc(bytes, 7).toString('base64')

const es256Pem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()

/** A complete `local` environment: every key a boot of `api` + `worker` needs and nothing else. */
export function localEnv(overrides: Env = {}): Env {
  return {
    APP_ENV: 'local',
    DATABASE_URL: 'postgres://rms_app:secret@localhost:5432/rms',
    JWT_KEYS: JSON.stringify({ k1: es256Pem() }),
    QR_KEYS: JSON.stringify({ v1: base64Key() }),
    OTP_HMAC_KEY: base64Key(),
    SETTINGS_ENCRYPTION_KEYS: JSON.stringify({ k1: base64Key() }),
    PII_ENCRYPTION_KEYS: JSON.stringify({ k1: base64Key() }),
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    ...overrides,
  }
}

/** The secrets of `localEnv` as files, for a host profile: `{ env, io }` where `io` serves the files from memory. */
export function hostEnv(profile: 'staging' | 'production', overrides: Env = {}) {
  const local = localEnv()
  const files = new Map<string, string>()
  const env: Env = {
    APP_ENV: profile,
    CORS_ORIGINS: 'https://admin.example.vn',
    ADMIN_BASE_URL: 'https://admin.example.vn',
    APP_DOWNLOAD_URL: 'https://apps.example.vn',
    S3_ENDPOINT: 'https://acct.r2.example.invalid',
    OPENAPI_ENABLED: profile === 'production' ? 'false' : 'true',
    SMS_DRIVER: profile === 'production' ? 'provider' : 'allowlist',
    MAIL_DRIVER: profile === 'production' ? 'smtp' : 'allowlist',
    ...(profile === 'production'
      ? {
          SMS_BRAND: 'RMS',
          SMTP_HOST: 'smtp.example.invalid',
          SMTP_USER: 'rms',
          MAIL_FROM: 'rms@example.invalid',
          STORE_URL_RESIDENT_IOS: 'https://apps.example.vn/ri',
          STORE_URL_RESIDENT_ANDROID: 'https://apps.example.vn/ra',
          STORE_URL_STAFF_IOS: 'https://apps.example.vn/si',
          STORE_URL_STAFF_ANDROID: 'https://apps.example.vn/sa',
        }
      : {}),
    ...overrides,
  }
  for (const key of [
    'DATABASE_URL',
    'JWT_KEYS',
    'QR_KEYS',
    'OTP_HMAC_KEY',
    'SETTINGS_ENCRYPTION_KEYS',
    'PII_ENCRYPTION_KEYS',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'SMTP_PASSWORD',
    'EXPO_ACCESS_TOKEN',
  ] as const) {
    const value = overrides[key] ?? (local[key] as string | undefined) ?? 'host-secret-value'
    files.set(`/run/secrets/${key}`, `${value}\n`)
    env[`${key}_FILE`] = `/run/secrets/${key}`
  }
  const io = {
    readFile(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
  }
  return { env, io }
}
