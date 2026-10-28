import { readFileSync } from 'node:fs'
import type { Env } from '@core/config'
import type { z } from 'zod'
import { APP_ENVS, APP_ROLES, CONFIG_SLICES } from './slices'

/** One failed rule of DOC-41 §17: the key, the rule number and a message that never holds a value. */
export interface ConfigProblem {
  key: string
  rule: number
  message: string
}

/** `loadAppConfig` refuses the environment: `main.ts` writes one `config_invalid` line and exits 78 (DOC-41 §17). */
export class ConfigError extends Error {
  constructor(readonly problems: readonly ConfigProblem[]) {
    super(`Invalid configuration: ${[...new Set(problems.map((p) => p.key))].join(', ')}`)
    this.name = 'ConfigError'
  }
}

export const EXIT_CONFIG_INVALID = 78

type Slices = typeof CONFIG_SLICES
type Parsed = { [K in keyof Slices]: z.output<Slices[K]['schema']> }
type Files = Parsed['files']

export type Config = Omit<Parsed, 'files'> & {
  files: Files & { S3_BUCKET: string; S3_PUBLIC_ENDPOINT: string }
}

type AppEnv = (typeof APP_ENVS)[number]

/** Secrets are files in staging and production (DOC-41 §2 rule 4). */
const SECRET_KEYS = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'READONLY_DATABASE_URL',
  'JWT_KEYS',
  'QR_KEYS',
  'OTP_HMAC_KEY',
  'SETTINGS_ENCRYPTION_KEYS',
  'PII_ENCRYPTION_KEYS',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
  'EXPO_ACCESS_TOKEN',
  'DEMO_STAFF_PASSWORD',
] as const

/** Prefixes this document owns: an unknown key that starts with one is a typo, not a variable of another tool (rule 13). */
const OWNED_PREFIXES = [
  'OUTBOX_',
  'JOB_',
  'JOBS_',
  'FILES_',
  'OTP_',
  'STEPUP_',
  'RESET_',
  'REFRESH_',
  'FAMILY_',
  'ARGON2_',
  'INVITE_',
  'METRICS_',
  'WEBHOOK_',
  'INTENT_',
  'PUSH_',
  'NOTICE_',
  'SSE_',
  'QR_',
  'SMS_',
  'SMTP_',
  'MAIL_',
  'S3_',
  'CORS_',
  'TRUSTED_',
  'MAINTENANCE_',
  'READINESS_',
  'WORKER_',
  'IDEMPOTENCY_',
  'OPENAPI_',
  'SETTINGS_',
  'FEATURE_',
  'CLIENT_ERRORS_',
  'MEMBER_',
  'UPLOAD_',
  'PDF_',
  'EXPORT_',
  'STATEMENT_',
  'DEBT_',
  'GATEWAY_',
  'MIN_APP_',
  'STORE_URL_',
  'PII_',
  'JWT_',
  'ACCESS_TOKEN_',
  'MAX_FAMILIES_',
] as const

const knownKeys = (): Set<string> =>
  new Set(
    Object.values(CONFIG_SLICES).flatMap((slice) =>
      Object.keys((slice.schema as unknown as { shape: object }).shape),
    ),
  )

export interface ConfigIo {
  readFile(path: string): string
}

const fileIo: ConfigIo = { readFile: (path) => readFileSync(path, 'utf8') }

const isHostProfile = (env: AppEnv) => env === 'staging' || env === 'production'

/** The secrets after the `_FILE` form is read; a plain value in a host profile is refused (rule 3). */
function resolveSecrets(
  env: Env,
  profile: AppEnv | undefined,
  io: ConfigIo,
  problems: ConfigProblem[],
): Env {
  const resolved: Env = { ...env }
  for (const key of SECRET_KEYS) {
    const file = env[`${key}_FILE`]
    if (file) {
      try {
        resolved[key] = io.readFile(file).replace(/\r?\n$/, '')
      } catch {
        problems.push({ key: `${key}_FILE`, rule: 2, message: 'the secret file cannot be read' })
        delete resolved[key]
      }
    } else if (profile && isHostProfile(profile) && env[key]) {
      problems.push({
        key,
        rule: 3,
        message: `a secret must be given as ${key}_FILE in ${profile}`,
      })
      delete resolved[key]
    }
  }
  return resolved
}

function rolesOf(raw: string | undefined): readonly string[] {
  const roles = (raw ?? 'api,worker').split(',').map((role) => role.trim())
  return roles.every((role) => (APP_ROLES as readonly string[]).includes(role))
    ? roles
    : ['api', 'worker']
}

/** Rule 1 for keys whose requirement depends on the profile, the role or another key (the *Profiles* column of DOC-41). */
function requiredKeys(env: Env, profile: AppEnv | undefined): string[] {
  const roles = rolesOf(env.APP_ROLES)
  const api = roles.includes('api')
  const worker = roles.includes('worker')
  const host = profile !== undefined && isHostProfile(profile)
  const required = [
    'SETTINGS_ENCRYPTION_KEYS',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]
  if (api) required.push('JWT_KEYS', 'QR_KEYS', 'OTP_HMAC_KEY', 'PII_ENCRYPTION_KEYS')
  if (api && host) required.push('CORS_ORIGINS', 'ADMIN_BASE_URL', 'APP_DOWNLOAD_URL')
  if (api && profile === 'production')
    required.push(
      'STORE_URL_RESIDENT_IOS',
      'STORE_URL_RESIDENT_ANDROID',
      'STORE_URL_STAFF_IOS',
      'STORE_URL_STAFF_ANDROID',
    )
  if (worker && host) required.push('SMTP_PASSWORD', 'EXPO_ACCESS_TOKEN')
  if (worker && profile === 'production') required.push('SMS_BRAND')
  if (worker && env.MAIL_DRIVER === 'smtp') required.push('SMTP_HOST', 'SMTP_USER', 'MAIL_FROM')
  return required
}

type Fail = (key: string, rule: number, message: string) => void

function limitRules(config: Parsed, fail: Fail) {
  const { identity } = config
  if (config.jobs.OUTBOX_CONCURRENCY > config.db.DB_POOL_MAX - 4)
    fail('OUTBOX_CONCURRENCY', 6, 'must not exceed DB_POOL_MAX minus 4')
  if (identity.OTP_RESEND_AFTER_SECONDS >= identity.OTP_TTL_SECONDS)
    fail('OTP_RESEND_AFTER_SECONDS', 7, 'must be less than OTP_TTL_SECONDS')
  if (identity.REFRESH_TTL_DAYS_STAFF > identity.FAMILY_MAX_DAYS_STAFF)
    fail('REFRESH_TTL_DAYS_STAFF', 7, 'must not exceed FAMILY_MAX_DAYS_STAFF')
  if (identity.REFRESH_TTL_DAYS_RESIDENT > identity.FAMILY_MAX_DAYS_RESIDENT)
    fail('REFRESH_TTL_DAYS_RESIDENT', 7, 'must not exceed FAMILY_MAX_DAYS_RESIDENT')
  if (config.later.SSE_HEARTBEAT_SECONDS >= 30)
    fail('SSE_HEARTBEAT_SECONDS', 8, 'must stay below 30')
}

function productionRules(config: Parsed, fail: Fail) {
  if (config.drivers.SMS_DRIVER !== 'provider')
    fail('SMS_DRIVER', 9, 'must be provider in production')
  if (config.drivers.MAIL_DRIVER !== 'smtp') fail('MAIL_DRIVER', 9, 'must be smtp in production')
  if (config.http.OPENAPI_ENABLED) fail('OPENAPI_ENABLED', 10, 'must be false in production')
}

/** An origin is `scheme://host[:port]` with no path and no wildcard. */
const isOrigin = (origin: string) => {
  try {
    return origin !== '*' && new URL(origin).origin === origin
  } catch {
    return false
  }
}

/** Rule 15: the simulated latency of DR-305 is a laptop tool; a host never waits on purpose. */
function hostRules(config: Parsed, fail: Fail) {
  if (config.http.DEV_LATENCY_MS > 0) fail('DEV_LATENCY_MS', 15, 'must be 0 outside local and test')
}

function networkRules(config: Parsed, fail: Fail) {
  if (!config.http.CORS_ORIGINS.every(isOrigin))
    fail('CORS_ORIGINS', 11, 'must hold origins without a path and no wildcard')
  if (config.core.TRUSTED_PROXY_HOPS > 0 && config.core.TRUSTED_PROXY_CIDRS.length === 0)
    fail('TRUSTED_PROXY_HOPS', 12, 'must be 0 when TRUSTED_PROXY_CIDRS is empty')
}

/** Rules 6 to 12 and 15 on the parsed values (DOC-41 §17). */
function crossRules(config: Parsed, profile: AppEnv): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const fail: Fail = (key, rule, message) => problems.push({ key, rule, message })
  limitRules(config, fail)
  if (profile === 'production') productionRules(config, fail)
  if (isHostProfile(profile)) hostRules(config, fail)
  networkRules(config, fail)
  return problems
}

function unknownKeys(env: Env): ConfigProblem[] {
  const known = knownKeys()
  const secretFiles = new Set(SECRET_KEYS.map((key) => `${key}_FILE`))
  return Object.keys(env)
    .filter((name) => OWNED_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .filter((name) => !known.has(name) && !secretFiles.has(name))
    .map((name) => ({
      key: name,
      rule: 13,
      message: 'this key is not in the configuration reference',
    }))
}

/** The first problem of each key of one slice, with the rule it breaks (1 = missing, 4 = a ring, 2 = anything else). */
function parseProblems(issues: readonly z.core.$ZodIssue[], env: Env): ConfigProblem[] {
  const seen = new Set<string>()
  const problems: ConfigProblem[] = []
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    const rule =
      (issue as { params?: { rule?: number } }).params?.rule ?? (env[key] === undefined ? 1 : 2)
    problems.push({ key, rule, message: rule === 1 ? 'a value is required' : issue.message })
  }
  return problems
}

function parseSlices(env: Env, problems: ConfigProblem[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {}
  for (const [name, slice] of Object.entries(CONFIG_SLICES)) {
    const result = slice.schema.safeParse(env)
    if (result.success) parsed[name] = result.data
    else problems.push(...parseProblems(result.error.issues, env))
  }
  return parsed
}

/** The environment a host profile gives `api` and `worker` must not hold the migrator's URL (rule 5). */
function refuseMigratorUrl(env: Env, profile: AppEnv | undefined, problems: ConfigProblem[]) {
  if (!profile || !isHostProfile(profile)) return
  if (env.MIGRATION_DATABASE_URL || env.MIGRATION_DATABASE_URL_FILE)
    problems.push({
      key: 'MIGRATION_DATABASE_URL',
      rule: 5,
      message: 'must not be present in the environment of api or worker',
    })
}

function finalize(config: Parsed): Config {
  return {
    ...config,
    files: {
      ...config.files,
      S3_PUBLIC_ENDPOINT: config.files.S3_PUBLIC_ENDPOINT ?? (config.files.S3_ENDPOINT as string),
      S3_BUCKET: config.files.S3_BUCKET ?? `rms-${config.core.APP_ENV}-files`,
    },
  }
}

/**
 * Parses `process.env` once with the slices of DOC-41, applies the boot rules of §17 and hands each owner its typed slice.
 * Throws `ConfigError` listing every failing key and rule; never a value (DOC-41 §17, CF-14).
 */
export function loadAppConfig(env: Env = process.env, io: ConfigIo = fileIo): Config {
  const problems: ConfigProblem[] = []
  // An empty variable (`${VAR:-}` in compose) counts as unset.
  const given: Env = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
  const profile = (APP_ENVS as readonly string[]).includes(given.APP_ENV ?? '')
    ? (given.APP_ENV as AppEnv)
    : undefined

  refuseMigratorUrl(given, profile, problems)
  const resolved = resolveSecrets(given, profile, io, problems)
  if (profile && isHostProfile(profile)) {
    delete resolved.MIGRATION_DATABASE_URL
    delete resolved.MIGRATION_DATABASE_URL_FILE
  }
  problems.push(...unknownKeys(given))

  const parsed = parseSlices(resolved, problems)
  const listed = new Set(problems.map((p) => p.key))
  for (const key of requiredKeys(resolved, profile))
    if (resolved[key] === undefined && !listed.has(key))
      problems.push({ key, rule: 1, message: 'a value is required in this profile or role' })

  if (problems.length === 0) problems.push(...crossRules(parsed as Parsed, profile as AppEnv))
  if (problems.length > 0) throw new ConfigError(problems)
  return finalize(parsed as Parsed)
}
