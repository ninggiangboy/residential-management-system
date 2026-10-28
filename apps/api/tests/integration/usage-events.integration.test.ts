import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { Clock } from '@core/kernel'
import { createLogger } from '@core/telemetry'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * E-173 and E-174 over HTTP, the table, the rollup and its job against a real PostgreSQL (DOC-104 §13, UA-01…14, UA-16…20, UA-28,
 * UA-32, UA-33, UA-36). The clock is frozen at the instant the test starts, so `occurred_at` is checked to the second while the
 * tokens (signed by the same clock) stay valid.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const DEMO_BUILDING = '018f0000-0000-7000-8000-000000000002'
const PASSWORD = 'Sunrise2026!'
const SESSION = '0192f3c4-9d02-4000-8000-00000000a001'

/** Runs on the real time unless a test freezes it: the sign-in waits on the clock, so a frozen one must be released before it. */
class SettableClock implements Clock {
  private frozen: Date | null = null
  freeze(date: Date) {
    this.frozen = date
  }
  release() {
    this.frozen = null
  }
  now() {
    return this.frozen ? new Date(this.frozen) : new Date()
  }
}

let db: TestDb
let built: ReturnType<typeof containerFor>
let clock: SettableClock
let phoneCounter = 0
let unitCounter = 0

const call = (
  path: string,
  init: RequestInit & { token?: string; json?: unknown; unitId?: string; raw?: string } = {},
  on: Pick<typeof built, 'app'> = built,
) => {
  const { token, json, unitId, raw, headers, ...rest } = init
  const text = raw ?? (json === undefined ? undefined : JSON.stringify(json))
  return on.app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(text === undefined
          ? {}
          : {
              'content-type': 'application/json',
              'content-length': String(Buffer.byteLength(text)),
            }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(unitId ? { 'x-unit-id': unitId } : {}),
        ...headers,
      },
      body: text,
    }),
  )
}

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: { scope?: string } } }).error

const batch = (events: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  app: 'resident',
  appVersion: '1.0.3',
  platform: 'ios',
  sessionId: SESSION,
  events,
  ...over,
})

async function staffToken(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'web' },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

/** A demo account signs in with the fixed code, which is the way to a real token without an SMS. */
async function resident(memberType: 'owner' | 'helper' = 'owner', buildingId = BUILDING) {
  phoneCounter++
  const phone = `+84903${String(phoneCounter).padStart(6, '0')}`
  const accountId = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${accountId}, ${phone}, ${`Resident ${phoneCounter}`}, true)`
  unitCounter++
  const unitId = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
    VALUES (${unitId}, ${buildingId}, ${`A-${3000 + unitCounter}`}, 15, 'occupied')`
  await db.sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, added_by_kind, added_by)
    VALUES (${crypto.randomUUID()}, ${buildingId}, ${accountId}, ${unitId}, ${memberType}, false, 'staff', ${crypto.randomUUID()})`
  const requested = await call('/auth/otp', { method: 'POST', json: { phone } })
  const { challengeId } = (await requested.json()) as { challengeId: string }
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  const { accessToken } = (await verified.json()) as { accessToken: string }
  return { accountId, unitId, token: accessToken }
}

const events = () =>
  db.sql<
    Array<{
      building_id: string
      audience: string
      app: string
      session_id: string
      event: string
      name: string
      duration_s: number | null
      occurred_at: Date
    }>
  >`SELECT * FROM analytics.usage_event ORDER BY occurred_at, event, name`

const clearEvents = async () => {
  await db.sql`DELETE FROM analytics.usage_event`
  await db.sql`DELETE FROM analytics.usage_daily`
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  for (const [id, code, isDemo] of [
    [BUILDING, 'SUNRISE-A', false],
    [DEMO_BUILDING, 'DEMO', true],
  ] as const) {
    await db.sql`
      INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
      VALUES (${id}, ${code}, '{"vi":"Chung cư","en":"Apartments"}', '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}',
              '12 Nguyễn Huệ', '1900 1234', ${isDemo})`
    await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
  }
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (gen_random_uuid(), ${BUILDING}, 'manager@sunrise.example', 'Lê Văn Quản', 'manager', 'active', ${hash}, 'en'),
           (gen_random_uuid(), ${BUILDING}, 'guard@sunrise.example', 'Hồ Bảo Vệ', 'guard', 'active', ${hash}, 'en'),
           (gen_random_uuid(), ${DEMO_BUILDING}, 'demo@demo.example', 'Demo Manager', 'manager', 'active', ${hash}, 'en')`
  clock = new SettableClock()
  built = containerFor(
    db.url,
    { clock },
    {
      OTP_PER_IP_PER_HOUR: '1000',
      STAFF_LOGIN_PER_IP: '1000',
      TRUSTED_PROXY_HOPS: '0',
      USAGE_EVENTS_PER_MINUTE_PER_IP: '600',
    },
    createLogger('silent'),
  )
})
afterEach(() => clock.release())
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('POST /me/usage-events (E-173)', () => {
  test('UA-01 a signed-in resident sends 3 valid events: 204, 3 rows under the building of the membership, at the receive time minus ageMs', async () => {
    await clearEvents()
    const now = new Date()
    now.setMilliseconds(987)
    const { token, unitId } = await resident()
    clock.freeze(now)
    const res = await call('/me/usage-events', {
      method: 'POST',
      token,
      unitId,
      json: batch([
        { event: 'app_open', name: 'Launch', ageMs: 61_200 },
        { event: 'screen_view', name: 'Main', ageMs: 4_200 },
        { event: 'tap', name: 'Account.language', ageMs: 900 },
      ]),
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('x-usage-enabled')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    const rows = await events()
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.building_id).toBe(BUILDING)
      expect(row.audience).toBe('resident')
      expect(row.session_id).toBe(SESSION)
    }
    const expected = (ageMs: number) =>
      new Date(Math.floor((now.getTime() - ageMs) / 1000) * 1000).toISOString()
    expect(rows.map((row) => row.occurred_at.toISOString()).sort()).toEqual(
      [expected(61_200), expected(4_200), expected(900)].sort(),
    )
  })

  test('UA-07 an age of one hour and a second is 400; an age of 4 seconds is stored 4 seconds before the receive time', async () => {
    await clearEvents()
    const now = new Date()
    now.setMilliseconds(500)
    const { token, unitId } = await resident()
    clock.freeze(now)
    const bad = await call('/me/usage-events', {
      method: 'POST',
      token,
      unitId,
      json: batch([{ event: 'screen_view', name: 'Main', ageMs: 3_600_001 }]),
    })
    expect(bad.status).toBe(400)
    expect((await errorOf(bad)).code).toBe('validation_failed')
    const ok = await call('/me/usage-events', {
      method: 'POST',
      token,
      unitId,
      json: batch([{ event: 'screen_view', name: 'Main', ageMs: 4_000 }]),
    })
    expect(ok.status).toBe(204)
    const [row] = await events()
    expect(row?.occurred_at.toISOString()).toBe(
      new Date(Math.floor((now.getTime() - 4_000) / 1000) * 1000).toISOString(),
    )
  })

  test('UA-03, UA-13, UA-14 names outside the lists are dropped (204) and the others are written', async () => {
    await clearEvents()
    const { token, unitId } = await resident()
    const res = await call('/me/usage-events', {
      method: 'POST',
      token,
      unitId,
      json: batch([
        { event: 'screen_view', name: 'Main', ageMs: 5 },
        { event: 'screen_view', name: 'Nowhere', ageMs: 5 },
        { event: 'screen_view', name: 'Login', ageMs: 5 },
        { event: 'screen_view', name: 'Unit-Pick', ageMs: 5 },
        { event: 'tap', name: 'Nowhere.save', ageMs: 5 },
        { event: 'tap', name: 'Account.unlisted', ageMs: 5 },
      ]),
    })
    expect(res.status).toBe(204)
    expect((await events()).map((row) => row.name)).toEqual(['Main'])
  })

  test('UA-05 an unknown key in the body or in an event is 400', async () => {
    const { token, unitId } = await resident()
    for (const body of [
      { ...batch([{ event: 'screen_view', name: 'Main', ageMs: 5 }]), extra: 1 },
      batch([{ event: 'screen_view', name: 'Main', ageMs: 5, extra: 1 }]),
      batch([{ event: 'screen_view', name: 'Main', ageMs: 5, accountId: crypto.randomUUID() }]),
    ]) {
      const res = await call('/me/usage-events', { method: 'POST', token, unitId, json: body })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('validation_failed')
    }
  })

  test('UA-06 51 events are 400; a body of 17 KB is a bare 413', async () => {
    const { token, unitId } = await resident()
    const many = Array.from({ length: 51 }, () => ({
      event: 'screen_view',
      name: 'Main',
      ageMs: 1,
    }))
    expect(
      (await call('/me/usage-events', { method: 'POST', token, unitId, json: batch(many) })).status,
    ).toBe(400)
    const big = batch([{ event: 'screen_view', name: 'Main'.padEnd(17 * 1024, 'x'), ageMs: 1 }])
    const res = await call('/me/usage-events', { method: 'POST', token, unitId, json: big })
    expect(res.status).toBe(413)
    expect((await errorOf(res)).code).toBe('payload_too_large')
  })

  test('UA-08 no token is 401; no X-Unit-Id is 400; the unit of another account is 403 membership_inactive; a staff token is 401', async () => {
    const { token, unitId } = await resident()
    const other = await resident()
    const json = batch([{ event: 'screen_view', name: 'Main', ageMs: 1 }])
    expect((await call('/me/usage-events', { method: 'POST', json, unitId })).status).toBe(401)
    const missing = await call('/me/usage-events', { method: 'POST', token, json })
    expect(missing.status).toBe(400)
    expect((await errorOf(missing)).code).toBe('validation_failed')
    const foreign = await call('/me/usage-events', {
      method: 'POST',
      token,
      unitId: other.unitId,
      json,
    })
    expect(foreign.status).toBe(403)
    expect((await errorOf(foreign)).code).toBe('membership_inactive')
    const manager = await staffToken('manager@sunrise.example')
    expect(
      (await call('/me/usage-events', { method: 'POST', token: manager, unitId, json })).status,
    ).toBe(401)
  })

  test('UA-28 every member type is allowed, a helper included', async () => {
    const helper = await resident('helper')
    const res = await call('/me/usage-events', {
      method: 'POST',
      token: helper.token,
      unitId: helper.unitId,
      json: batch([{ event: 'screen_view', name: 'Home-Helper', ageMs: 1 }]),
    })
    expect(res.status).toBe(204)
  })

  test('UA-09 a token of the demo building is 204 and writes no row', async () => {
    await clearEvents()
    const demo = await resident('owner', DEMO_BUILDING)
    const res = await call('/me/usage-events', {
      method: 'POST',
      token: demo.token,
      unitId: demo.unitId,
      json: batch([{ event: 'screen_view', name: 'Main', ageMs: 1 }]),
    })
    expect(res.status).toBe(204)
    expect(await events()).toHaveLength(0)
  })

  test('UA-32 a close with a duration is written; a close without one, a duration on a tap and 86,401 are 400; a mismatched lifecycle name is dropped', async () => {
    await clearEvents()
    const { token, unitId } = await resident()
    const send = (list: Array<Record<string, unknown>>) =>
      call('/me/usage-events', { method: 'POST', token, unitId, json: batch(list) })
    expect(
      (
        await send([
          { event: 'app_open', name: 'Launch', ageMs: 100 },
          { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 61 },
        ])
      ).status,
    ).toBe(204)
    const written = await events()
    expect(written.find((row) => row.event === 'app_open')?.duration_s).toBeNull()
    expect(written.find((row) => row.event === 'app_close')?.duration_s).toBe(61)
    for (const bad of [
      { event: 'app_close', name: 'Background', ageMs: 0 },
      { event: 'tap', name: 'Account.push', ageMs: 0, durationSec: 5 },
      { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 86_401 },
    ])
      expect((await send([bad])).status).toBe(400)
    await clearEvents()
    expect(
      (
        await send([
          { event: 'app_open', name: 'Background', ageMs: 0 },
          { event: 'app_close', name: 'Launch', ageMs: 0, durationSec: 5 },
        ])
      ).status,
    ).toBe(204)
    expect(await events()).toHaveLength(0)
  })
})

describe('POST /staff/usage-events (E-174)', () => {
  test('UA-08, UA-28 every staff role is allowed and the audience is staff; a resident token and no token are 401', async () => {
    await clearEvents()
    const json = batch([{ event: 'screen_view', name: 'S-Account', ageMs: 1 }], { app: 'staff' })
    for (const email of ['manager@sunrise.example', 'guard@sunrise.example']) {
      const token = await staffToken(email)
      expect((await call('/staff/usage-events', { method: 'POST', token, json })).status).toBe(204)
    }
    const rows = await events()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.audience)).toEqual(['staff', 'staff'])
    expect(rows.every((row) => row.building_id === BUILDING)).toBe(true)
    const { token } = await resident()
    expect((await call('/staff/usage-events', { method: 'POST', token, json })).status).toBe(401)
    expect((await call('/staff/usage-events', { method: 'POST', json })).status).toBe(401)
  })

  test('UA-09 the staff of the demo building write no row', async () => {
    await clearEvents()
    const token = await staffToken('demo@demo.example')
    const res = await call('/staff/usage-events', {
      method: 'POST',
      token,
      json: batch([{ event: 'screen_view', name: 'W-Units', ageMs: 1 }], {
        app: 'web',
        platform: 'web',
      }),
    })
    expect(res.status).toBe(204)
    expect(await events()).toHaveLength(0)
  })
})

describe('the switch of the server and the buckets', () => {
  test('UA-10 with USAGE_ENABLED=false the answer is 204 with X-Usage-Enabled: false and no row', async () => {
    await clearEvents()
    const off = containerFor(db.url, {}, { USAGE_ENABLED: 'false', STAFF_LOGIN_PER_IP: '1000' })
    try {
      const login = await call(
        '/auth/staff/login',
        {
          method: 'POST',
          json: { email: 'manager@sunrise.example', password: PASSWORD, client: 'web' },
        },
        off,
      )
      const { accessToken } = (await login.json()) as { accessToken: string }
      const res = await call(
        '/staff/usage-events',
        {
          method: 'POST',
          token: accessToken,
          json: batch([{ event: 'screen_view', name: 'W-Units', ageMs: 1 }], {
            app: 'web',
            platform: 'web',
          }),
        },
        off,
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('x-usage-enabled')).toBe('false')
      expect(await events()).toHaveLength(0)
    } finally {
      await off.container.close()
    }
  })

  test('UA-11 the 4th request of one address in a minute is 429 rate_limited with Retry-After, scope usage_events; no bucket holds an account', async () => {
    const limited = containerFor(
      db.url,
      {},
      { USAGE_EVENTS_PER_MINUTE_PER_IP: '3', STAFF_LOGIN_PER_IP: '1000' },
    )
    try {
      const login = await call(
        '/auth/staff/login',
        {
          method: 'POST',
          json: { email: 'manager@sunrise.example', password: PASSWORD, client: 'web' },
        },
        limited,
      )
      const { accessToken } = (await login.json()) as { accessToken: string }
      const send = () =>
        call(
          '/staff/usage-events',
          {
            method: 'POST',
            token: accessToken,
            json: batch([{ event: 'screen_view', name: 'W-Units', ageMs: 1 }], {
              app: 'web',
              platform: 'web',
              sessionId: crypto.randomUUID(),
            }),
          },
          limited,
        )
      for (let i = 0; i < 3; i++) expect((await send()).status).toBe(204)
      const refused = await send()
      expect(refused.status).toBe(429)
      const error = await errorOf(refused)
      expect(error.code).toBe('rate_limited')
      expect(error.details?.scope).toBe('usage_events')
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
      const keys = await db.sql<
        { key: string }[]
      >`SELECT key FROM platform.rate_bucket WHERE key LIKE 'usage-events:%'`
      expect(keys.length).toBeGreaterThan(0)
      for (const { key } of keys)
        expect(key).toMatch(/^usage-events:(ip:.+|session:[0-9a-f-]{36})$/)
    } finally {
      await db.sql`DELETE FROM platform.rate_bucket WHERE key LIKE 'usage-events:ip:%'`
      await limited.container.close()
    }
  })

  test('UA-11 the 121st request of one session in an hour is 429', async () => {
    const token = await staffToken('manager@sunrise.example')
    const json = batch([{ event: 'screen_view', name: 'W-Units', ageMs: 1 }], {
      app: 'web',
      platform: 'web',
      sessionId: crypto.randomUUID(),
    })
    for (let i = 0; i < 120; i++)
      expect((await call('/staff/usage-events', { method: 'POST', token, json })).status).toBe(204)
    const refused = await call('/staff/usage-events', { method: 'POST', token, json })
    expect(refused.status).toBe(429)
    expect((await errorOf(refused)).details?.scope).toBe('usage_events')
  })

  test('UA-12 in maintenance mode the answer is 503 maintenance', async () => {
    const maintained = containerFor(db.url, {
      maintenanceStore: {
        read: async () => ({ active: true, reason: 'deploy', since: new Date() }),
      },
    })
    try {
      await maintained.container.maintenance.refresh()
      const res = await call(
        '/staff/usage-events',
        { method: 'POST', json: batch([{ event: 'screen_view', name: 'W-Units', ageMs: 1 }]) },
        maintained,
      )
      expect(res.status).toBe(503)
      expect((await errorOf(res)).code).toBe('maintenance')
    } finally {
      await maintained.container.close()
    }
  })
})

describe('the tables (DOC-17 §9A)', () => {
  test('UA-02 no column of the schema names a person, a device or a network address', async () => {
    const columns = await db.sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'analytics' ORDER BY table_name, ordinal_position`
    const forbidden = /account|member|unit|role|device|token|(^|_)ip$|user_agent|phone|email|name_/
    expect(
      columns.filter(({ column_name }) => column_name !== 'name' && forbidden.test(column_name)),
    ).toEqual([])
    const byTable = (table: string) =>
      columns.filter((column) => column.table_name === table).map((column) => column.column_name)
    expect(byTable('usage_event')).toEqual([
      'id',
      'building_id',
      'occurred_at',
      'app',
      'platform',
      'app_version',
      'audience',
      'session_id',
      'event',
      'name',
      'duration_s',
    ])
    expect(byTable('usage_daily')).toEqual([
      'building_id',
      'day',
      'app',
      'platform',
      'audience',
      'event',
      'name',
      'events',
      'sessions',
      'seconds',
    ])
  })

  const insert = async (over: Record<string, unknown>) => {
    const row = {
      event: 'screen_view',
      name: 'Main',
      duration_s: null,
      app: 'resident',
      app_version: '1.0.3',
      ...over,
    }
    await db.sql`
      INSERT INTO analytics.usage_event (id, building_id, occurred_at, app, platform, app_version, audience, session_id, event, name, duration_s)
      VALUES (gen_random_uuid(), ${BUILDING}, now(), ${row.app as string}, 'ios', ${row.app_version as string}, 'resident', gen_random_uuid(),
              ${row.event as string}, ${row.name as string}, ${row.duration_s as number | null})`
  }

  test('UA-04 a name with a query string, a path or a trailing dot is refused by ck_usage_event_name', async () => {
    for (const name of ['Fees?unit=1', '/fees', 'Fees.', 'fees', 'Fees pay'])
      await expect(insert({ name })).rejects.toMatchObject({ code: '23514' })
    await insert({ name: 'Fees' })
  })

  test('UA-33 a close with no duration, a tap with a duration, 86,401 and a lifecycle name that does not fit are refused', async () => {
    const refused = [
      { event: 'app_close', name: 'Background', duration_s: null },
      { event: 'tap', name: 'Account.push', duration_s: 5 },
      { event: 'app_close', name: 'Background', duration_s: 86_401 },
      { event: 'app_open', name: 'Background' },
      { event: 'app_open', name: 'Fees' },
      { event: 'tap', name: 'Account' },
      { event: 'screen_view', name: 'Account.push' },
    ]
    for (const over of refused) await expect(insert(over)).rejects.toMatchObject({ code: '23514' })
    await insert({ event: 'app_close', name: 'Background', duration_s: 86_400 })
  })
})

describe('the rollup (DOC-104 §7.1)', () => {
  const ZONE = 'Asia/Ho_Chi_Minh'
  const NOON = new Date('2026-10-28T05:00:00Z') // 12:00 on 2026-10-28 in Ho Chi Minh City

  /** An event at a local wall-clock time of a local day. */
  const at = (day: string, time: string) => `${day} ${time}`

  async function seed(
    list: Array<{
      local: string
      session: string
      event: string
      name: string
      app?: string
      platform?: string
      audience?: string
      duration?: number
    }>,
  ) {
    for (const e of list)
      await db.sql`
        INSERT INTO analytics.usage_event (id, building_id, occurred_at, app, platform, app_version, audience, session_id, event, name, duration_s)
        VALUES (gen_random_uuid(), ${BUILDING}, (${e.local}::timestamp AT TIME ZONE ${ZONE}), ${e.app ?? 'resident'}, ${e.platform ?? 'ios'},
                '1.0.3', ${e.audience ?? 'resident'}, ${e.session}::uuid, ${e.event}, ${e.name}, ${e.duration ?? null})`
  }

  const S1 = '0192f3c4-9d02-4000-8000-00000000a001'
  const S2 = '0192f3c4-9d02-4000-8000-00000000a002'
  const S3 = '0192f3c4-9d02-4000-8000-00000000a003'
  const S4 = '0192f3c4-9d02-4000-8000-00000000a004'
  const S5 = '0192f3c4-9d02-4000-8000-00000000a005'

  const daily = () =>
    db.sql<
      Array<{
        day: string
        app: string
        platform: string
        audience: string
        event: string
        name: string
        events: number
        sessions: number
        seconds: string
      }>
    >`SELECT day::text AS day, app, platform, audience, event, name, events, sessions, seconds::text AS seconds
        FROM analytics.usage_daily ORDER BY day, app, platform, audience, event, name`

  const rollUp = () => built.container.analytics.useCases.rollUpUsage.execute(BUILDING)

  test('UA-16 seven events of five sessions fall in five groups; the event at 23:30 local is in the earlier day', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await seed([
      { local: at('2026-10-26', '23:30:00'), session: S1, event: 'screen_view', name: 'Main' },
      { local: at('2026-10-27', '00:30:00'), session: S1, event: 'screen_view', name: 'Main' },
      { local: at('2026-10-27', '09:00:00'), session: S2, event: 'screen_view', name: 'Main' },
      { local: at('2026-10-27', '10:00:00'), session: S3, event: 'screen_view', name: 'Main' },
      {
        local: at('2026-10-27', '10:05:00'),
        session: S4,
        event: 'screen_view',
        name: 'Main',
        platform: 'android',
      },
      {
        local: at('2026-10-27', '11:00:00'),
        session: S5,
        event: 'screen_view',
        name: 'Main',
        app: 'staff',
        audience: 'staff',
        platform: 'web',
      },
      { local: at('2026-10-27', '12:10:00'), session: S2, event: 'tap', name: 'Account.language' },
    ])
    const result = await rollUp()
    expect(result.rolled).toBe(5)
    const rows = await daily()
    expect(rows).toHaveLength(5)
    expect(rows.reduce((sum, row) => sum + row.events, 0)).toBe(7)
    expect(rows.filter((row) => row.day === '2026-10-26')).toEqual([
      expect.objectContaining({ name: 'Main', events: 1, sessions: 1 }),
    ])
    expect(
      rows.find((row) => row.day === '2026-10-27' && row.platform === 'ios' && row.name === 'Main'),
    ).toMatchObject({ events: 3, sessions: 3 })
  })

  test('UA-17 running it again leaves the same rows', async () => {
    const before = await daily()
    await rollUp()
    expect(await daily()).toEqual(before)
  })

  test('UA-34 seconds are the sum of the durations of the app_close rows (120 + 50) and 0 for the other events, also after a second run', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await seed([
      { local: at('2026-10-27', '09:00:00'), session: S1, event: 'app_open', name: 'Launch' },
      {
        local: at('2026-10-27', '09:02:00'),
        session: S1,
        event: 'app_close',
        name: 'Background',
        duration: 120,
      },
      { local: at('2026-10-27', '10:00:00'), session: S1, event: 'app_open', name: 'Resume' },
      {
        local: at('2026-10-27', '10:00:50'),
        session: S1,
        event: 'app_close',
        name: 'Background',
        duration: 50,
      },
      { local: at('2026-10-27', '10:01:00'), session: S1, event: 'screen_view', name: 'Main' },
    ])
    await rollUp()
    await rollUp()
    const rows = await daily()
    expect(rows.find((row) => row.event === 'app_close')).toMatchObject({
      events: 2,
      seconds: '170',
    })
    expect(
      rows.filter((row) => row.event !== 'app_close').every((row) => row.seconds === '0'),
    ).toBe(true)
  })

  test('UA-18 with an empty usage_daily the purge deletes nothing, however old the raw rows are', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await seed([
      { local: at('2026-07-01', '09:00:00'), session: S1, event: 'screen_view', name: 'Main' },
    ])
    const result = await rollUp()
    expect(result).toEqual({ rolled: 0, purgedRaw: 0, purgedDaily: 0 })
    expect(await events()).toHaveLength(1)
  })

  test('UA-18 with a rolled day only the raw rows older than 90 days and before the end of that day go', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await seed([
      { local: at('2026-07-01', '09:00:00'), session: S1, event: 'screen_view', name: 'Main' },
      { local: at('2026-10-20', '09:00:00'), session: S1, event: 'screen_view', name: 'Main' },
      { local: at('2026-10-27', '09:00:00'), session: S1, event: 'screen_view', name: 'Main' },
    ])
    // 2026-10-27 is rolled (the window is 10-25 to 10-27); the row of 07-01 is older than the 90 days and goes; the others stay.
    expect(await rollUp()).toEqual({ rolled: 1, purgedRaw: 1, purgedDaily: 0 })
    expect((await events()).map((row) => row.occurred_at.toISOString().slice(0, 10))).toEqual([
      '2026-10-20',
      '2026-10-27',
    ])
    // Rows younger than the retention stay even when a later day is rolled up.
    expect(await rollUp()).toEqual({ rolled: 1, purgedRaw: 0, purgedDaily: 0 })
  })

  test('UA-19 the rollup rows older than 730 days go and the newer stay', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await db.sql`
      INSERT INTO analytics.usage_daily (building_id, day, app, platform, audience, event, name, events, sessions, seconds)
      VALUES (${BUILDING}, '2024-10-01', 'resident', 'ios', 'resident', 'screen_view', 'Main', 3, 2, 0),
             (${BUILDING}, '2024-10-29', 'resident', 'ios', 'resident', 'screen_view', 'Main', 4, 2, 0)`
    const result = await rollUp()
    expect(result.purgedDaily).toBe(1)
    expect((await daily()).map((row) => row.day)).toEqual(['2024-10-29'])
  })

  test('UA-20 while another process holds the lock of the job a run is skipped, and after it the rows are as for one run', async () => {
    await clearEvents()
    clock.freeze(NOON)
    await seed([
      { local: at('2026-10-27', '09:00:00'), session: S1, event: 'screen_view', name: 'Main' },
    ])
    const holder = db.connect(1)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('job:usage_rollup'))`
      await held
    })
    await Bun.sleep(100)
    const jobs = built.container.runtime.jobs
    expect((await jobs.runNow('usage_rollup')).status).toBe('skipped_locked')
    expect(await daily()).toHaveLength(0)
    release()
    await holding
    expect((await jobs.runNow('usage_rollup')).status).toBe('succeeded')
    expect(await daily()).toHaveLength(1)
    await holder.end()
    const [run] = await db.sql<{ details: Record<string, number> }[]>`
      SELECT details FROM building.job_run WHERE name = 'usage_rollup' AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`
    expect(run?.details).toMatchObject({ rolled: 1, purgedRaw: 0, purgedDaily: 0 })
  })
})
