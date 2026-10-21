import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { InProcessMessageBus, OutboxRelay } from '@core/messaging'
import { createLogger } from '@core/telemetry'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { createProbeModule, effectHandler, probeInbox, probeOutbox } from './probe'

let db: TestDb
const source = { name: 'probe', table: probeOutbox, inboxTable: probeInbox }

beforeAll(async () => {
  db = await cloneTemplate('empty')
  const admin = db.admin()
  await createProbeModule(admin)
  await admin.end()
})
afterAll(async () => {
  await db.drop()
})

async function seed(count: number, aggregates: number) {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = Bun.randomUUIDv7()
    ids.push(id)
    await db.sql`
      INSERT INTO probe.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at)
      VALUES (${id}, 'probe.thing_happened.v1', ${`agg-${i % aggregates}`}, ${db.sql.json({ buildingId: null })}, ${db.sql.json({})}, now())`
  }
  return ids
}

async function untilPublished(count: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const rows =
      (await db.sql`SELECT count(*)::int AS n FROM probe.outbox_messages WHERE published_at IS NOT NULL`) as unknown as {
        n: number
      }[]
    if ((rows[0]?.n ?? 0) >= count) return
    await Bun.sleep(100)
  }
  throw new Error(`only some of the ${count} messages were published in ${timeoutMs} ms`)
}

describe('JB-15: kill the relay in the middle of a batch', () => {
  test('nothing is lost and no effect happens twice', async () => {
    const ids = await seed(5, 5)
    const child = Bun.spawn(['bun', 'tests/integration/relay-worker.ts'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: db.url } as Record<string, string>,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    // The first handler of every claimed message has written its effect; the second is asleep: the batch is half done.
    const until = Date.now() + 15_000
    let firstEffects = 0
    while (Date.now() < until && firstEffects < 4) {
      firstEffects =
        (
          (await db.sql`SELECT count(*)::int AS n FROM probe.effects WHERE handler = 'a'`) as {
            n: number
          }[]
        )[0]?.n ?? 0
      await Bun.sleep(50)
    }
    expect(firstEffects).toBeGreaterThanOrEqual(4)
    const pending =
      (await db.sql`SELECT count(*)::int AS n FROM probe.outbox_messages WHERE published_at IS NULL`) as unknown as {
        n: number
      }[]
    expect(pending[0]?.n).toBe(5)
    child.kill('SIGKILL')
    await child.exited

    // A second worker takes over once the leases (2 s) have expired.
    const database = new Database({ url: db.url, poolMax: 10, prepare: false })
    const bus = new InProcessMessageBus(createLogger('silent'))
    for (const name of ['a', 'b', 'c'])
      bus.subscribe(effectHandler(database, name, { relay: 'survivor' }))
    const relay = new OutboxRelay(database, [source], bus, createLogger('silent'), {
      pollIntervalMs: 50,
      batchSize: 50,
      concurrency: 4,
      leaseSeconds: 2,
    })
    relay.start()
    try {
      await untilPublished(5, 15_000)
    } finally {
      await relay.stop()
      await database.close()
    }

    const effects = await db.sql<{ message_id: string; handler: string; n: number }[]>`
      SELECT message_id, handler, count(*)::int AS n FROM probe.effects GROUP BY message_id, handler`
    for (const id of ids)
      for (const handler of ['a', 'b', 'c']) {
        const found = effects.find((e) => e.message_id === id && e.handler === handler)
        expect({ id, handler, n: found?.n }).toEqual({ id, handler, n: 1 })
      }
    const attempts = await db.sql<
      { attempts: number }[]
    >`SELECT attempts FROM probe.outbox_messages`
    expect(attempts.every((a) => a.attempts === 2)).toBe(true)
  }, 45_000)
})

describe('JB-16: two workers on one database', () => {
  test('claims are disjoint, every message is published once and no effect happens twice', async () => {
    await db.sql`DELETE FROM probe.outbox_messages`
    await db.sql`DELETE FROM probe.inbox`
    await db.sql`DELETE FROM probe.effects`
    const total = 1500
    const ids = await seed(total, 60)
    const workers = ['one', 'two'].map((label) => {
      const database = new Database({ url: db.url, poolMax: 10, prepare: false })
      const bus = new InProcessMessageBus(createLogger('silent'))
      bus.subscribe(effectHandler(database, 'h', { relay: label }))
      const relay = new OutboxRelay(database, [source], bus, createLogger('silent'), {
        pollIntervalMs: 20,
        batchSize: 50,
        concurrency: 6,
        leaseSeconds: 60,
      })
      return { label, database, relay }
    })
    for (const { relay } of workers) relay.start()
    try {
      await untilPublished(total, 60_000)
    } finally {
      for (const { relay, database } of workers) {
        await relay.stop()
        await database.close()
      }
    }
    const perMessage = await db.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM probe.effects GROUP BY message_id`
    expect(perMessage).toHaveLength(total)
    expect(perMessage.every((row) => row.n === 1)).toBe(true)
    const attempts = await db.sql<
      { max: number }[]
    >`SELECT max(attempts)::int AS max FROM probe.outbox_messages`
    expect(attempts[0]?.max).toBe(1)
    const byRelay = await db.sql<
      { relay: string; n: number }[]
    >`SELECT relay, count(*)::int AS n FROM probe.effects GROUP BY relay`
    expect(byRelay.map((r) => r.relay).sort()).toEqual(['one', 'two'])
    expect(ids).toHaveLength(total)
  }, 90_000)
})
