import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderEnvExample } from '@core/config'
import { CONFIG_SLICES, ConfigError, type ConfigProblem, loadAppConfig } from './index'
import { CLOCK_JOB_GRACE_MINUTES } from './slices'
import { base64Key, hostEnv, localEnv } from './support'

const problemsOf = (
  env: Record<string, string | undefined>,
  io?: Parameters<typeof loadAppConfig>[1],
) => {
  try {
    loadAppConfig(env, io)
  } catch (error) {
    if (error instanceof ConfigError) return error.problems
    throw error
  }
  return []
}
const keys = (problems: readonly ConfigProblem[]) => problems.map((p) => p.key)
const ruleOf = (problems: readonly ConfigProblem[], key: string) =>
  problems.find((p) => p.key === key)?.rule

describe('the schema against DOC-41', () => {
  const doc = readFileSync(
    new URL('../../../../../docs/06-design/configuration-reference.md', import.meta.url),
    'utf8',
  )

  /** The keys of the tables of §4 to §14, with the defaults of their *Default* column. */
  function tableKeys() {
    const section = doc.slice(
      doc.indexOf('## 4. Process and runtime'),
      doc.indexOf('## 15. Web CMS and mobile apps'),
    )
    const rows: { keys: string[]; defaults: string | undefined }[] = []
    let defaultColumn = -1
    for (const line of section.split('\n')) {
      if (!line.startsWith('|')) continue
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      if (cells[0] === 'Key' || cells[0] === 'Key · ') {
        defaultColumn = cells.indexOf('Default')
        continue
      }
      if (/^-+$/.test(cells[0] ?? '') || cells[0] === '') continue
      const names = [...(cells[0] ?? '').matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(
        (m) => m[1] as string,
      )
      if (names.length === 0) continue
      rows.push({ keys: names, defaults: defaultColumn >= 0 ? cells[defaultColumn] : undefined })
      // The grace table has a second key and default per row (columns 3 and 4).
      const second = [...(cells[3] ?? '').matchAll(/`(JOB_[A-Z_]+_GRACE_MINUTES)`/g)].map(
        (m) => m[1] as string,
      )
      if (second.length > 0) rows.push({ keys: second, defaults: cells[4] })
    }
    return rows
  }

  const schemaKeys = () =>
    new Set(
      Object.values(CONFIG_SLICES).flatMap((slice) =>
        Object.keys((slice.schema as unknown as { shape: object }).shape),
      ),
    )

  test('CF-01 the keys of the schema and of the document are the same set', () => {
    const documented = new Set(tableKeys().flatMap((row) => row.keys))
    // `SMS_*` secrets are a pattern fixed in P1-22; `JOB_<NAME>_GRACE_MINUTES` is expanded by its own table.
    const inSchemaNotDoc = [...schemaKeys()].filter((key) => !documented.has(key))
    const inDocNotSchema = [...documented].filter((key) => !schemaKeys().has(key))
    expect({ inSchemaNotDoc, inDocNotSchema }).toEqual({ inSchemaNotDoc: [], inDocNotSchema: [] })
  })

  test('CF-02 each default of the document equals the default of the schema', () => {
    const defaults = loadAppConfig(localEnv()) as unknown as Record<string, Record<string, unknown>>
    const flat = Object.assign({}, ...Object.values(defaults)) as Record<string, unknown>
    const wrong: string[] = []
    // Only a literal default is compared: prose ("the SeaweedFS S3 gateway"), `none` and a reference to another key are not.
    const literal = /^[\w.:/@-]+(, [\w.:/@-]+)*$/
    for (const row of tableKeys()) {
      const cell = row.defaults?.replace(/`/g, '')
      if (cell === undefined || cell === 'none') continue
      if (cell !== 'empty' && (!literal.test(cell) || /^[A-Z][A-Z0-9_]+$/.test(cell))) continue
      const expected =
        cell === 'empty'
          ? ['']
          : cell.includes(', ')
            ? cell.split(', ')
            : Array(row.keys.length).fill(cell)
      if (expected.length !== row.keys.length) continue
      row.keys.forEach((key, i) => {
        const actual = flat[key]
        const text = Array.isArray(actual) ? actual.join(',') : String(actual)
        if (actual !== undefined && text !== expected[i])
          wrong.push(`${key}: ${text} ≠ ${expected[i]}`)
      })
    }
    expect(wrong).toEqual([])
  })

  test('CF-17 .env.example is the generated one and holds no secret value', () => {
    const path = new URL('../../../../../.env.example', import.meta.url).pathname
    const written = readFileSync(path, 'utf8')
    expect(written).toBe(
      renderEnvExample(CONFIG_SLICES, { command: 'bun run --cwd apps/api config:example' }),
    )
    for (const key of [
      'JWT_KEYS',
      'QR_KEYS',
      'OTP_HMAC_KEY',
      'DATABASE_URL',
      'S3_SECRET_ACCESS_KEY',
    ])
      expect(written).toMatch(new RegExp(`^(# )?${key}=$`, 'm'))
    for (const key of schemaKeys()) expect(written).toContain(`${key}=`)
  })

  test('CF-18 the thirteen clock jobs have a grace key and an hourly job has none', () => {
    expect(Object.keys(CLOCK_JOB_GRACE_MINUTES)).toHaveLength(13)
    const config = loadAppConfig(localEnv({ JOB_INVARIANT_CHECK_GRACE_MINUTES: '0' }))
    expect(config.jobs.JOB_INVARIANT_CHECK_GRACE_MINUTES).toBe(0)
    expect(config.jobs.JOB_DEMO_RESET_GRACE_MINUTES).toBe(120)
    expect(keys(problemsOf(localEnv({ JOB_ORPHAN_UPLOADS_GRACE_MINUTES: '5' })))).toEqual([
      'JOB_ORPHAN_UPLOADS_GRACE_MINUTES',
    ])
  })
})

describe('the boot rules of DOC-41 §17', () => {
  test('a complete local environment loads and each owner gets its slice', () => {
    const config = loadAppConfig(localEnv())
    expect(config.core.APP_ROLES).toEqual(['api', 'worker'])
    expect(config.core.PORT).toBe(3000)
    expect(config.db.DB_POOL_MAX).toBe(10)
    expect(config.files.S3_BUCKET).toBe('rms-local-files')
    expect(Object.keys(config.secrets.JWT_KEYS ?? {})).toEqual(['k1'])
  })

  test('CF-03 DATABASE_URL unset names that key and rule 1', () => {
    const problems = problemsOf(localEnv({ DATABASE_URL: undefined }))
    expect(keys(problems)).toEqual(['DATABASE_URL'])
    expect(ruleOf(problems, 'DATABASE_URL')).toBe(1)
  })

  test('CF-04 a malformed integer and a malformed boolean are each named once', () => {
    const problems = problemsOf(localEnv({ OUTBOX_BATCH_SIZE: 'fifty', OPENAPI_ENABLED: '1' }))
    expect(keys(problems).sort()).toEqual(['OPENAPI_ENABLED', 'OUTBOX_BATCH_SIZE'])
    expect(problems.every((p) => p.rule === 2)).toBe(true)
  })

  test('CF-05 a plain secret is refused in production and CF-06 accepted in local', () => {
    const { env, io } = hostEnv('production')
    const plain = { ...env, JWT_KEYS: localEnv().JWT_KEYS, JWT_KEYS_FILE: undefined }
    const problems = problemsOf(plain, io)
    expect(ruleOf(problems, 'JWT_KEYS')).toBe(3)
    expect(problemsOf(localEnv())).toEqual([])
  })

  test('a host profile that gives every secret as a file loads', () => {
    for (const profile of ['staging', 'production'] as const) {
      const { env, io } = hostEnv(profile)
      expect(problemsOf(env, io)).toEqual([])
    }
  })

  test('CF-07 an empty ring, a short key and a repeated kid are refused by rule 4', () => {
    const empty = problemsOf(localEnv({ QR_KEYS: '{}' }))
    const short = problemsOf(localEnv({ QR_KEYS: JSON.stringify({ v1: base64Key(16) }) }))
    const repeated = problemsOf(
      localEnv({ QR_KEYS: `{"v1":"${base64Key()}","v1":"${base64Key()}"}` }),
    )
    for (const problems of [empty, short, repeated]) {
      expect(keys(problems)).toEqual(['QR_KEYS'])
      expect(ruleOf(problems, 'QR_KEYS')).toBe(4)
    }
    expect(ruleOf(problemsOf(localEnv({ JWT_KEYS: '{"k1":"not a pem"}' })), 'JWT_KEYS')).toBe(4)
    expect(ruleOf(problemsOf(localEnv({ OTP_HMAC_KEY: base64Key(8) })), 'OTP_HMAC_KEY')).toBe(4)
  })

  test('CF-08 production refuses the console SMS driver, the allowlist mail driver and OpenAPI', () => {
    const cases: [Record<string, string>, string, number][] = [
      [{ SMS_DRIVER: 'console' }, 'SMS_DRIVER', 9],
      [{ MAIL_DRIVER: 'allowlist' }, 'MAIL_DRIVER', 9],
      [{ OPENAPI_ENABLED: 'true' }, 'OPENAPI_ENABLED', 10],
    ]
    for (const [override, key, rule] of cases) {
      const { env, io } = hostEnv('production', override)
      expect(ruleOf(problemsOf(env, io), key)).toBe(rule)
    }
  })

  test('CF-09 OUTBOX_CONCURRENCY above DB_POOL_MAX minus 4 is refused', () => {
    expect(
      ruleOf(
        problemsOf(localEnv({ OUTBOX_CONCURRENCY: '8', DB_POOL_MAX: '10' })),
        'OUTBOX_CONCURRENCY',
      ),
    ).toBe(6)
    expect(problemsOf(localEnv({ OUTBOX_CONCURRENCY: '6', DB_POOL_MAX: '10' }))).toEqual([])
  })

  test('CF-10 a resend after the lifetime and a refresh beyond its family are refused', () => {
    expect(
      ruleOf(
        problemsOf(localEnv({ OTP_RESEND_AFTER_SECONDS: '400', OTP_TTL_SECONDS: '300' })),
        'OTP_RESEND_AFTER_SECONDS',
      ),
    ).toBe(7)
    expect(
      ruleOf(problemsOf(localEnv({ REFRESH_TTL_DAYS_STAFF: '100' })), 'REFRESH_TTL_DAYS_STAFF'),
    ).toBe(7)
    expect(
      ruleOf(problemsOf(localEnv({ SSE_HEARTBEAT_SECONDS: '30' })), 'SSE_HEARTBEAT_SECONDS'),
    ).toBe(8)
  })

  test('CF-11 a typo of an owned prefix is refused, a foreign variable is not', () => {
    const problems = problemsOf(
      localEnv({ OUTBOX_BACHT_SIZE: '50', HOME: '/home/x', RMS_PG_PORT: '5432' }),
    )
    expect(keys(problems)).toEqual(['OUTBOX_BACHT_SIZE'])
    expect(ruleOf(problems, 'OUTBOX_BACHT_SIZE')).toBe(13)
  })

  test('CF-12 a wildcard origin and an origin with a path are refused', () => {
    expect(ruleOf(problemsOf(localEnv({ CORS_ORIGINS: '*' })), 'CORS_ORIGINS')).toBe(11)
    expect(
      ruleOf(
        problemsOf(localEnv({ CORS_ORIGINS: 'https://admin.example.vn/app' })),
        'CORS_ORIGINS',
      ),
    ).toBe(11)
    expect(
      problemsOf(localEnv({ CORS_ORIGINS: 'https://a.example.vn, http://localhost:5173' })),
    ).toEqual([])
  })

  test('CF-13 trusted proxy hops without trusted ranges are refused', () => {
    expect(ruleOf(problemsOf(localEnv({ TRUSTED_PROXY_HOPS: '1' })), 'TRUSTED_PROXY_HOPS')).toBe(12)
    expect(
      problemsOf(localEnv({ TRUSTED_PROXY_HOPS: '1', TRUSTED_PROXY_CIDRS: '172.16.0.0/12' })),
    ).toEqual([])
  })

  test('CF-14 the message names the key and the rule and never the value of a secret', () => {
    const secret = 'x'.repeat(40)
    const problems = problemsOf(
      localEnv({ OTP_HMAC_KEY: secret, DEMO_STAFF_PASSWORD: secret.slice(0, 5) }),
    )
    expect(keys(problems).sort()).toEqual(['DEMO_STAFF_PASSWORD', 'OTP_HMAC_KEY'])
    expect(JSON.stringify(problems)).not.toContain(secret)
    expect(JSON.stringify(problems)).not.toContain('xxxxx')
  })

  test('CF-15 the migrator URL in a host profile is refused, in local it is ignored by the slices', () => {
    const { env, io } = hostEnv('staging', {
      MIGRATION_DATABASE_URL_FILE: '/run/secrets/db-migrator-url',
    })
    expect(ruleOf(problemsOf(env, io), 'MIGRATION_DATABASE_URL')).toBe(5)
    expect(
      problemsOf(localEnv({ MIGRATION_DATABASE_URL: 'postgres://rms_migrator:x@localhost/rms' })),
    ).toEqual([])
  })

  test('a role that does not run the API does not need its keys', () => {
    const worker = localEnv({
      APP_ROLES: 'worker',
      JWT_KEYS: undefined,
      QR_KEYS: undefined,
      OTP_HMAC_KEY: undefined,
      PII_ENCRYPTION_KEYS: undefined,
    })
    expect(problemsOf(worker)).toEqual([])
    expect(keys(problemsOf({ ...worker, APP_ROLES: 'api' })).sort()).toEqual([
      'JWT_KEYS',
      'OTP_HMAC_KEY',
      'PII_ENCRYPTION_KEYS',
      'QR_KEYS',
    ])
  })

  test('a secret file that cannot be read is named, with its _FILE key', () => {
    const { env, io } = hostEnv('staging', { OTP_HMAC_KEY_FILE: '/run/secrets/missing' })
    const problems = problemsOf({ ...env, OTP_HMAC_KEY_FILE: '/run/secrets/missing' }, io)
    expect(keys(problems)).toContain('OTP_HMAC_KEY_FILE')
  })

  test('an empty variable counts as unset', () => {
    expect(problemsOf(localEnv({ DATABASE_URL: '' }))).toHaveLength(1)
    expect(loadAppConfig(localEnv({ PORT: '' })).core.PORT).toBe(3000)
  })

  test('APP_ROLES accepts either alone and refuses an unknown role', () => {
    expect(loadAppConfig(localEnv({ APP_ROLES: 'worker' })).core.APP_ROLES).toEqual(['worker'])
    expect(keys(problemsOf(localEnv({ APP_ROLES: 'api,relay' })))).toEqual(['APP_ROLES'])
  })
})
