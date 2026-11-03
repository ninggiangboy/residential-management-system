import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Envelope } from '@core/messaging'
import type { JobContext } from '@core/runtime'
import { adminUrl, cloneTemplate, type TestDb } from '@rms/test-support'
import postgres from 'postgres'
import { containerFor } from './support'

/**
 * The staff event stream over `app.handle` against a real PostgreSQL (DOC-52 §4 to §10, SE-01…SE-24): the frames, the targeting,
 * the replay, the limit, the fan-out between two `api` processes through `LISTEN`/`NOTIFY`, the close on a revoked session.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'Sunrise2026!'
const ORIGIN = 'http://localhost:5173'

let db: TestDb
let one: ReturnType<typeof containerFor>
let two: ReturnType<typeof containerFor>
let manager: string
let managerSid: string
let managerId: string
let technician: string

const call = (
  from: ReturnType<typeof containerFor>,
  path: string,
  init: RequestInit & { token?: string; json?: unknown } = {},
) => {
  const { token, json, headers, ...rest } = init
  return from.app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}

async function login(email: string): Promise<{ token: string; sid: string }> {
  const res = await call(one, '/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'web' },
  })
  expect(res.status).toBe(200)
  const { accessToken } = (await res.json()) as { accessToken: string }
  return { token: accessToken, sid: JSON.parse(atob(accessToken.split('.')[1] ?? '')).sid }
}

/** An open stream read in the background: the decoded frames so far and whether the server closed it. */
function reader(res: Response) {
  const frames: string[] = []
  let closed = false
  const stream = res.body?.getReader()
  const decoder = new TextDecoder()
  void (async () => {
    for (;;) {
      const { value, done } = (await stream?.read()) ?? { done: true, value: undefined }
      if (done) {
        closed = true
        return
      }
      frames.push(decoder.decode(value))
    }
  })()
  return {
    frames,
    isClosed: () => closed,
    cancel: () => stream?.cancel(),
    async waitFor(predicate: () => boolean, ms = 3000) {
      const until = Date.now() + ms
      while (!predicate() && Date.now() < until) await Bun.sleep(20)
      return predicate()
    },
  }
}
const dataOf = (frame: string) => JSON.parse(frame.split('data: ')[1] ?? '{}')

const handlerOf = (from: ReturnType<typeof containerFor>, name: string) => {
  const handler = from.container.realtime.handlers?.find((h) => h.name === name)
  if (!handler) throw new Error(`no handler ${name}`)
  return handler
}
const envelope = (
  type: string,
  payload: Record<string, unknown>,
  id: string = crypto.randomUUID(),
): Envelope => ({
  id,
  type,
  source: type.split('.')[0] ?? 'test',
  aggregateId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  payload,
  headers: {} as Envelope['headers'],
})
const moneyUnposted = (id?: string) =>
  envelope(
    'finance.money_unposted.v1',
    {
      buildingId: BUILDING,
      kind: 'gateway_event',
      rowId: crypto.randomUUID(),
      outcome: 'amount_short',
      amount: 2838000,
      receivedAt: new Date().toISOString(),
    },
    id,
  )
const open = (
  from: ReturnType<typeof containerFor>,
  token: string,
  headers: Record<string, string> = {},
) => call(from, '/staff/events', { token, headers: { accept: 'text/event-stream', ...headers } })

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư","en":"Apartments"}', '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}',
            '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  managerId = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (${managerId}, ${BUILDING}, 'manager@sunrise.example', 'Lê Minh', 'manager', 'active', ${hash}, 'vi'),
           (gen_random_uuid(), ${BUILDING}, 'tech@sunrise.example', 'Võ Kỹ Thuật', 'technician', 'active', ${hash}, 'vi')`
  const env = { OTP_PER_IP_PER_HOUR: '1000', TRUSTED_PROXY_HOPS: '0', CORS_ORIGINS: ORIGIN }
  one = containerFor(db.url, {}, env)
  two = containerFor(db.url, {}, env)
  const m = await login('manager@sunrise.example')
  manager = m.token
  managerSid = m.sid
  technician = (await login('tech@sunrise.example')).token
})
afterAll(async () => {
  await one.container.close()
  await two.container.close()
  await db.drop()
})

describe('opening a stream (DOC-52 §4, §5)', () => {
  test('SE-01: no token is 401 and a resident token is 401', async () => {
    expect((await call(one, '/staff/events')).status).toBe(401)
    const phone = '+84905000001'
    await db.sql`INSERT INTO identity.resident_account (id, phone, display_name, is_demo) VALUES (gen_random_uuid(), ${phone}, 'R', true)`
    const requested = await call(one, '/auth/otp', { method: 'POST', json: { phone } })
    const { challengeId } = (await requested.json()) as { challengeId: string }
    const verified = await call(one, '/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: '123456' },
    })
    const { accessToken } = (await verified.json()) as { accessToken: string }
    expect((await open(one, accessToken)).status).toBe(401)
  })

  test('SE-02: the first frame is ready with a UUIDv7 cursor, the sid and resumed false', async () => {
    const res = await open(one, manager)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toStartWith('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const stream = reader(res)
    expect(await stream.waitFor(() => stream.frames.length > 0)).toBe(true)
    expect(stream.frames[0]).toStartWith('event: ready\n')
    const ready = dataOf(stream.frames[0] ?? '')
    expect(ready).toMatchObject({ sessionId: managerSid, resumed: false })
    expect(ready.cursor).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    await stream.cancel()
  })

  test('SE-04: a fourth stream of one account on one process is 429 with Retry-After 30; another process allows it', async () => {
    const opened = [] as Array<ReturnType<typeof reader>>
    for (let i = 0; i < 3; i++) opened.push(reader(await open(one, manager)))
    const fourth = await open(one, manager)
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('retry-after')).toBe('30')
    expect(
      ((await fourth.json()) as { error: { details: { scope: string } } }).error.details.scope,
    ).toBe('sse_streams')
    const elsewhere = await open(two, manager)
    expect(elsewhere.status).toBe(200)
    await reader(elsewhere).cancel()
    await opened[0]?.cancel()
    await Bun.sleep(100)
    const again = await open(one, manager)
    expect(again.status).toBe(200)
    await reader(again).cancel()
    for (const s of opened) await s.cancel()
  })

  test('SE-20: the preflight allows Authorization and Last-Event-ID', async () => {
    const res = await one.app.handle(
      new Request('http://localhost/api/v1/staff/events', {
        method: 'OPTIONS',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization, last-event-id',
        },
      }),
    )
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    expect(allowed).toContain('authorization')
    expect(allowed).toContain('last-event-id')
  })
})

describe('events (DOC-52 §6, §7, §9)', () => {
  test('SE-05 and SE-14: a money_log.opened written by process one reaches the Manager on process two, not the Technician', async () => {
    const onTwo = reader(await open(two, manager))
    const tech = reader(await open(two, technician))
    await onTwo.waitFor(() => onTwo.frames.length > 0)
    await handlerOf(one, 'realtime.sse_on_finance_money_unposted').handle(moneyUnposted())
    expect(await onTwo.waitFor(() => onTwo.frames.length > 1)).toBe(true)
    const event = dataOf(onTwo.frames[1] ?? '')
    expect(event.type).toBe('money_log.opened')
    expect(Object.keys(event.data).sort()).toEqual(['kind', 'outcome', 'rowId'])
    expect(onTwo.frames[1]).not.toContain('2838000')
    await Bun.sleep(150)
    expect(tech.frames).toHaveLength(1)
    await onTwo.cancel()
    await tech.cancel()
  })

  test('SE-13: the handler twice writes one row and one notification', async () => {
    const live = reader(await open(one, manager))
    await live.waitFor(() => live.frames.length > 0)
    const message = moneyUnposted()
    const handler = handlerOf(one, 'realtime.sse_on_finance_money_unposted')
    const before = Number((await db.sql`SELECT count(*)::int AS n FROM realtime.events`)[0]?.n)
    await handler.handle(message)
    await handler.handle(message)
    expect(Number((await db.sql`SELECT count(*)::int AS n FROM realtime.events`)[0]?.n)).toBe(
      before + 1,
    )
    await live.waitFor(() => live.frames.length > 1)
    await Bun.sleep(150)
    expect(live.frames).toHaveLength(2)
    await live.cancel()
  })

  test('SE-06: inbox.created reaches the streams of that staff member', async () => {
    const live = reader(await open(one, manager))
    await live.waitFor(() => live.frames.length > 0)
    await handlerOf(one, 'realtime.sse_on_notification_staff_inbox_created').handle(
      envelope('notification.staff_inbox_created.v1', {
        buildingId: BUILDING,
        staffId: managerId,
        entryId: crypto.randomUUID(),
        templateKey: 'finance.money_unposted',
      }),
    )
    expect(await live.waitFor(() => live.frames.length > 1)).toBe(true)
    expect(dataOf(live.frames[1] ?? '').type).toBe('inbox.created')
    await live.cancel()
  })

  test("SE-10 and SE-11: a reconnect with Last-Event-ID replays what was missed, only the stream's own events", async () => {
    const first = reader(await open(one, manager))
    await first.waitFor(() => first.frames.length > 0)
    await handlerOf(one, 'realtime.sse_on_finance_money_unposted').handle(moneyUnposted())
    await first.waitFor(() => first.frames.length > 1)
    const lastId = dataOf(first.frames.at(-1) ?? '').id as string
    await first.cancel()
    await Bun.sleep(1100)
    for (let i = 0; i < 3; i++)
      await handlerOf(one, 'realtime.sse_on_finance_money_unposted').handle(moneyUnposted())
    // an event for another account is in the buffer too and must not be replayed
    const foreignEntry = crypto.randomUUID()
    await handlerOf(one, 'realtime.sse_on_notification_staff_inbox_created').handle(
      envelope('notification.staff_inbox_created.v1', {
        buildingId: BUILDING,
        staffId: crypto.randomUUID(),
        entryId: foreignEntry,
        templateKey: 'finance.money_unposted',
      }),
    )
    const second = reader(await open(one, manager, { 'last-event-id': lastId }))
    await second.waitFor(() => second.frames.length >= 4)
    expect(dataOf(second.frames[0] ?? '').resumed).toBe(true)
    const events = second.frames.slice(1).map((f) => dataOf(f))
    expect(events.filter((e) => e.type === 'money_log.opened').length).toBeGreaterThanOrEqual(3)
    // the entry written for another account is never replayed (SE-11)
    expect(second.frames.join('')).not.toContain(foreignEntry)
    await second.cancel()
  })

  test('SE-12: a header that is not a UUIDv7 gives resumed false and never an error', async () => {
    for (const header of ['abc', '0192f3c4-0000-4000-8000-000000000001']) {
      const res = await open(one, manager, { 'last-event-id': header })
      expect(res.status).toBe(200)
      const s = reader(res)
      await s.waitFor(() => s.frames.length > 0)
      expect(dataOf(s.frames[0] ?? '').resumed).toBe(false)
      expect(s.frames).toHaveLength(1)
      await s.cancel()
    }
  })

  test('SE-08 and SE-09: a revoked session gets session.revoked and closes; a resident revocation writes nothing', async () => {
    const mine = await login('manager@sunrise.example')
    const live = reader(await open(one, mine.token))
    await live.waitFor(() => live.frames.length > 0)
    const other = reader(await open(one, manager))
    await other.waitFor(() => other.frames.length > 0)
    const handler = handlerOf(one, 'realtime.close_stream_on_identity_session_revoked')
    const before = Number((await db.sql`SELECT count(*)::int AS n FROM realtime.events`)[0]?.n)
    await handler.handle(
      envelope('identity.session_revoked.v1', {
        buildingId: null,
        accountKind: 'resident',
        accountId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        reason: 'sign_out',
      }),
    )
    expect(Number((await db.sql`SELECT count(*)::int AS n FROM realtime.events`)[0]?.n)).toBe(
      before,
    )
    await handler.handle(
      envelope('identity.session_revoked.v1', {
        buildingId: BUILDING,
        accountKind: 'staff',
        accountId: managerId,
        sessionId: mine.sid,
        reason: 'user_revoked',
      }),
    )
    expect(await live.waitFor(() => live.isClosed())).toBe(true)
    expect(dataOf(live.frames.at(-1) ?? '')).toMatchObject({ type: 'session.revoked' })
    await other.waitFor(() => other.frames.length > 1)
    expect(other.isClosed()).toBe(false)
    await other.cancel()
  })

  test('SE-17: a lost LISTEN connection closes the local streams so the tabs replay', async () => {
    const live = reader(await open(two, manager))
    await live.waitFor(() => live.frames.length > 0)
    const superuser = postgres(adminUrl(), { max: 1 })
    try {
      await superuser`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${db.name} AND query ILIKE 'listen%' AND pid <> pg_backend_pid()`
    } finally {
      await superuser.end()
    }
    expect(await live.waitFor(() => live.isClosed(), 8000)).toBe(true)
  })

  test('SE-16: closeLive closes every stream before the server stops', async () => {
    const a = reader(await open(one, manager))
    const b = reader(await open(one, technician))
    await a.waitFor(() => a.frames.length > 0)
    one.container.realtime.streams.closeLive()
    expect(await a.waitFor(() => a.isClosed())).toBe(true)
    expect(await b.waitFor(() => b.isClosed())).toBe(true)
  })
})

describe('buffer and metrics', () => {
  const ctx = (from: ReturnType<typeof containerFor>): JobContext => ({
    clock: from.container.clock,
    signal: new AbortController().signal,
    logger: from.container.logger,
    manual: false,
    paused: () => false,
    buildings: async () => [],
    withLock: (fn) => fn(),
    snapshot: (fn) => fn(),
  })

  test('SE-21: realtime_purge deletes the 25-hour row and keeps the 1-hour row', async () => {
    await db.sql`UPDATE realtime.events SET created_at = now() - interval '25 hours' WHERE id = (SELECT id FROM realtime.events ORDER BY created_at LIMIT 1)`
    const job = one.container.realtime.jobs?.find((j) => j.name === 'realtime_purge')
    const result = await job?.run(ctx(one))
    expect(result?.details).toEqual({ deleted: 1 })
    expect((await job?.run(ctx(one)))?.details).toEqual({ deleted: 0 })
  })

  test('SE-24: the scrape counts open streams and the opens by outcome', async () => {
    const scrape = async () =>
      await (await two.ops.handle(new Request('http://localhost/metrics'))).text()
    const open0 = Number(/sse_streams_open\s+(\d+)/.exec(await scrape())?.[1])
    const live = reader(await open(two, manager))
    await live.waitFor(() => live.frames.length > 0)
    const text = await scrape()
    expect(Number(/sse_streams_open\s+(\d+)/.exec(text)?.[1])).toBe(open0 + 1)
    expect(text).toContain('sse_stream_opens_total{outcome="fresh"}')
    await live.cancel()
    await Bun.sleep(100)
    expect(Number(/sse_streams_open\s+(\d+)/.exec(await scrape())?.[1])).toBe(open0)
  })
})
