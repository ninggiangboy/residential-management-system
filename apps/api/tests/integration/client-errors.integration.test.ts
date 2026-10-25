import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createLogger } from '@core/telemetry'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * `POST /client-errors` (E-04, DOC-42 §10) over HTTP against a real PostgreSQL: the body rules, the line it writes, the masking of
 * a phone, the account named by a valid token, and the two buckets (ER-43, ER-44). Nothing is stored: the proof is the log line.
 */

const PASSWORD = 'Sunrise2026!'
const BUILDING = '018f0000-0000-7000-8000-000000000001'

let db: TestDb
let built: ReturnType<typeof containerFor>
const lines: Array<Record<string, unknown>> = []

/** `app.handle` has no socket, so every caller is one address: the per-address limit is proved on a container of its own. */
const post = (
  body: unknown,
  init: { token?: string; raw?: string; on?: Pick<typeof built, 'app'> } = {},
) =>
  (init.on ?? built).app.handle(
    new Request('http://localhost/api/v1/client-errors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The server sets it from the body; `new Request` does not.
        'content-length': String(Buffer.byteLength(init.raw ?? JSON.stringify(body))),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.raw ?? JSON.stringify(body),
    }),
  )

const report = (over: Record<string, unknown> = {}) => ({
  app: 'web',
  appVersion: '1.0.3',
  platform: 'web',
  kind: 'render',
  screen: 'Units',
  errorName: 'TypeError',
  message: "Cannot read properties of undefined (reading 'amount')",
  ...over,
})

const clientErrorLines = () => lines.filter((line) => line.event === 'client_error')

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư","en":"Apartments"}',
            '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (gen_random_uuid(), ${BUILDING}, 'manager@sunrise.example', 'Lê Văn Quản', 'manager', 'active', ${hash}, 'en'),
           (gen_random_uuid(), ${BUILDING}, 'tech@sunrise.example', 'Trần Kỹ Thuật', 'technician', 'active', ${hash}, 'en')`
  const logger = createLogger('warn', {
    destination: {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as Record<string, unknown>)
      },
    },
  })
  built = containerFor(
    db.url,
    {},
    {
      TRUSTED_PROXY_HOPS: '0',
      CLIENT_ERRORS_PER_MINUTE_PER_IP: '1000',
      STAFF_LOGIN_PER_IP: '1000',
    },
    logger,
  )
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('POST /client-errors', () => {
  test('a report answers 204 with no-store and writes one client_error line with the fields', async () => {
    lines.length = 0
    const res = await post(
      report({
        stack: 'TypeError: x\n    at FeeRow',
        requestId: '0192f3c4-9d02-7000-8000-00000000f001',
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('')
    const [line] = clientErrorLines()
    expect(clientErrorLines()).toHaveLength(1)
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'client_error',
      app: 'web',
      appVersion: '1.0.3',
      platform: 'web',
      kind: 'render',
      screen: 'Units',
      errorName: 'TypeError',
      clientRequestId: '0192f3c4-9d02-7000-8000-00000000f001',
      accountKind: null,
      accountId: null,
    })
  })

  test('ER-43 an unknown key, a stack over 4 KB and a bad enum are 400; a body over 8 KB is a bare 413', async () => {
    expect((await post(report({ extra: 1 }))).status).toBe(400)
    expect((await post(report({ stack: 'x'.repeat(4097) }))).status).toBe(400)
    // 2,000 three-byte characters: within the character limit and over the byte limit.
    expect((await post(report({ stack: '€'.repeat(2000) }))).status).toBe(400)
    expect((await post(report({ kind: 'boom' }))).status).toBe(400)
    expect((await post(report({ app: 'admin' }))).status).toBe(400)
    expect((await post(report({ appVersion: 'latest' }))).status).toBe(400)
    expect((await post(report({ message: '' }))).status).toBe(400)
    const big = await post(report({ stack: 'x'.repeat(4096), requestId: 'r'.repeat(64) }), {
      raw: JSON.stringify({ ...report(), pad: 'x'.repeat(9000) }),
    })
    expect(big.status).toBe(413)
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe('payload_too_large')
    expect((await post(report({ stack: 'x'.repeat(4096), message: 'm'.repeat(500) }))).status).toBe(
      204,
    )
  })

  test('ER-43 a phone in the message and the stack is masked in the line', async () => {
    lines.length = 0
    const res = await post(
      report({
        message: 'No account for +84901234567 or 0901 234 567',
        stack: 'Error at call(+84 901 234 567)',
      }),
    )
    expect(res.status).toBe(204)
    const [line] = clientErrorLines()
    const text = JSON.stringify(line)
    expect(text).not.toContain('901234567')
    expect(text).not.toContain('901 234 567')
    expect(line?.message).toBe('No account for +84•••••567 or •••••567')
  })

  test('a valid token names the account; an invalid or foreign one is ignored, never a 401', async () => {
    const signedIn = await built.app.handle(
      new Request('http://localhost/api/v1/auth/staff/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'manager@sunrise.example',
          password: PASSWORD,
          client: 'app',
        }),
      }),
    )
    const { accessToken } = (await signedIn.json()) as { accessToken: string }
    lines.length = 0
    expect((await post(report(), { token: accessToken })).status).toBe(204)
    expect(clientErrorLines()[0]?.accountKind).toBe('staff')
    expect(typeof clientErrorLines()[0]?.accountId).toBe('string')
    lines.length = 0
    expect((await post(report(), { token: 'not-a-token' })).status).toBe(204)
    expect(clientErrorLines()[0]?.accountId).toBeNull()
  })

  test('ER-44 the 11th report of one address in a minute is 429 with Retry-After', async () => {
    const own = await cloneTemplate('empty')
    const limited = containerFor(own.url, {}, { TRUSTED_PROXY_HOPS: '0' })
    try {
      for (let i = 0; i < 10; i++) expect((await post(report(), { on: limited })).status).toBe(204)
      const refused = await post(report(), { on: limited })
      expect(refused.status).toBe(429)
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
      const body = (await refused.json()) as {
        error: { code: string; details?: { scope?: string } }
      }
      expect(body.error.code).toBe('rate_limited')
      expect(body.error.details?.scope).toBe('client_errors')
    } finally {
      await limited.container.close()
      await own.drop()
    }
  })

  test('an account is held to 30 an hour whatever the address', async () => {
    const signedIn = await built.app.handle(
      new Request('http://localhost/api/v1/auth/staff/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'tech@sunrise.example',
          password: PASSWORD,
          client: 'app',
        }),
      }),
    )
    const { accessToken } = (await signedIn.json()) as { accessToken: string }
    const statuses: number[] = []
    for (let i = 0; i < 31; i++)
      statuses.push((await post(report(), { token: accessToken })).status)
    expect(statuses.filter((status) => status === 204)).toHaveLength(30)
    expect(statuses[30]).toBe(429)
  })
})
