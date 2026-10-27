import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * The metrics of DOC-40 §4 over HTTP against a real PostgreSQL (OB-02, OB-12, OB-14 in its local form): what the ops port serves
 * after the API did its work, the database gauges with rows to count, and the scrape of a process whose database is gone.
 */

const PASSWORD = 'Sunrise2026!'
const BUILDING = '018f0000-0000-7000-8000-000000000001'

let db: TestDb
let built: ReturnType<typeof containerFor>

const login = (password: string) =>
  built.app.handle(
    new Request('http://localhost/api/v1/auth/staff/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'manager@sunrise.example', password, client: 'app' }),
    }),
  )

const scrape = async (on: Pick<typeof built, 'ops'> = built) => {
  const res = await on.ops.handle(new Request('http://localhost/metrics'))
  expect(res.status).toBe(200)
  return (await res.text()).split('\n').filter((line) => line && !line.startsWith('#'))
}

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
    VALUES (gen_random_uuid(), ${BUILDING}, 'manager@sunrise.example', 'Lê Văn Quản', 'manager', 'active', ${hash}, 'en')`
  built = containerFor(db.url, {}, { TRUSTED_PROXY_HOPS: '0', STAFF_LOGIN_PER_IP: '1000' })
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('what the API counts', () => {
  test('sign-ins by outcome, answers by route template and error code, and no person in a label', async () => {
    expect((await login('wrong-password-1')).status).toBe(401)
    expect((await login('wrong-password-2')).status).toBe(401)
    expect((await login(PASSWORD)).status).toBe(200)
    // The request line (and so the observer) runs after the response is returned.
    await Bun.sleep(20)
    const lines = await scrape()
    expect(lines).toContain('auth_staff_login_total{outcome="invalid"} 2')
    expect(lines).toContain('auth_staff_login_total{outcome="ok"} 1')
    expect(lines).toContain('api_errors_total{code="invalid_credentials",status="401"} 2')
    expect(lines).toContain(
      'http_request_duration_seconds_count{method="POST",route="/api/v1/auth/staff/login",status="200"} 1',
    )
    // OB-02: the email of the sign-in is in no label.
    expect(lines.join('\n')).not.toContain('sunrise.example')
  })

  test('a 429 is counted by the scope the answer names', async () => {
    const tight = containerFor(db.url, {}, { TRUSTED_PROXY_HOPS: '0', STAFF_LOGIN_PER_IP: '1' })
    try {
      const attempt = () =>
        tight.app.handle(
          new Request('http://localhost/api/v1/auth/staff/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email: 'nobody@sunrise.example',
              password: 'x'.repeat(12),
              client: 'app',
            }),
          }),
        )
      await attempt()
      expect((await attempt()).status).toBe(429)
      await Bun.sleep(20)
      expect(await scrape(tight)).toContain('rate_limited_total{scope="staff_login"} 1')
      expect(await scrape(tight)).toContain('auth_staff_login_total{outcome="rate_limited"} 1')
    } finally {
      await tight.container.close()
    }
  })
})

describe('the gauges read from the database', () => {
  test('the outbox: the age of the oldest waiting message and the dead letters, per schema', async () => {
    const insert = (type: string, occurredAt: string, deadAt: string | null) => db.sql`
      INSERT INTO identity.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at, dead_at)
      VALUES (gen_random_uuid(), ${type}, 'a', '{}', '{}', ${occurredAt}::timestamptz, ${deadAt}::timestamptz)`
    await insert('identity.sms_requested.v1', new Date(Date.now() - 300_000).toISOString(), null)
    await insert(
      'identity.sms_requested.v1',
      new Date(Date.now() - 900_000).toISOString(),
      new Date().toISOString(),
    )
    // A fresh container, so no gauge is cached from an earlier scrape; `api` only, because a worker is ready when its relay runs.
    const fresh = containerFor(db.url, {}, { APP_ROLES: 'api' })
    try {
      const lines = await scrape(fresh)
      const age = lines.find((line) =>
        line.startsWith('outbox_oldest_unpublished_age_seconds{schema="identity"}'),
      )
      expect(Number(age?.split(' ')[1])).toBeGreaterThanOrEqual(299)
      expect(Number(age?.split(' ')[1])).toBeLessThan(330)
      expect(lines).toContain('outbox_dead_letters{schema="identity"} 1')
      expect(lines).toContain('outbox_oldest_unpublished_age_seconds{schema="building"} 0')
      expect(lines).toContain('readiness_ok 1')
      expect(lines).toContain('db_pool_waiting 0')
    } finally {
      await fresh.container.close()
    }
  })

  test('OB-12 / OB-14 (local): a database that is gone makes readiness 0 and the scrape still answers quickly', async () => {
    const lost = containerFor(
      'postgres://rms_app:x@127.0.0.1:1/rms',
      {},
      { METRICS_QUERY_TIMEOUT_MS: '800' },
    )
    try {
      const begin = performance.now()
      const lines = await scrape(lost)
      expect(performance.now() - begin).toBeLessThan(3000)
      expect(lines).toContain('readiness_ok 0')
      // The gauges that could not be read have no series, and each failure is counted.
      expect(lines.some((line) => line.startsWith('outbox_dead_letters{'))).toBe(false)
      expect(
        lines.some((line) =>
          line.startsWith('metrics_collection_errors_total{gauge="outbox_dead_letters"}'),
        ),
      ).toBe(true)
    } finally {
      await lost.container.close()
    }
  }, 15_000)
})
