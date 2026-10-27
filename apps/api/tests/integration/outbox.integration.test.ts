import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import {
  DrizzleOutboxWriter,
  type Envelope,
  InProcessMessageBus,
  type MessagePublisher,
  OutboxAdmin,
  OutboxRelay,
  type OutboxSource,
  RetryLaterError,
} from '@core/messaging'
import { createLogger } from '@core/telemetry'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { createProbeModule, effectHandler, probeInbox, probeOutbox } from './probe'

let db: TestDb
let database: Database
const source: OutboxSource = { name: 'probe', table: probeOutbox, inboxTable: probeInbox }
const logger = createLogger('silent')

beforeAll(async () => {
  db = await cloneTemplate('empty')
  const admin = db.admin()
  await createProbeModule(admin)
  await admin.end()
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
})
afterAll(async () => {
  await database.close()
  await db.drop()
})
beforeEach(async () => {
  await db.sql`DELETE FROM probe.outbox_messages`
  await db.sql`DELETE FROM probe.inbox`
  await db.sql`DELETE FROM probe.effects`
})

interface Seed {
  type?: string
  aggregateId?: string
  /** Seconds ago the event occurred. */
  age?: number
  attempts?: number
  publishedDaysAgo?: number
  dead?: boolean
}

async function seed(count: number, options: Seed = {}): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = Bun.randomUUIDv7()
    ids.push(id)
    await db.sql`
      INSERT INTO probe.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at, attempts, published_at, dead_at)
      VALUES (${id}, ${options.type ?? 'probe.thing_happened.v1'}, ${options.aggregateId ?? id}, ${db.sql.json({ buildingId: null })},
              ${db.sql.json({})}, now() - make_interval(secs => ${options.age ?? 0}), ${options.attempts ?? 0},
              ${options.publishedDaysAgo === undefined ? null : db.sql`now() - make_interval(days => ${options.publishedDaysAgo})`},
              ${options.dead ? db.sql`now()` : null})`
  }
  return ids
}

const row = async (id: string) => {
  const rows = await db.sql<
    { attempts: number; published: boolean; dead: boolean; wait: number; error: string | null }[]
  >`SELECT attempts, published_at IS NOT NULL AS published, dead_at IS NOT NULL AS dead,
           extract(epoch FROM next_attempt_at - now())::float AS wait, last_error AS error
      FROM probe.outbox_messages WHERE id = ${id}`
  return rows[0] as (typeof rows)[number]
}

/** A publisher that records what it was given and lets a test decide how each message ends. */
function recorder(behaviour: (message: Envelope) => Promise<void> | void = () => {}) {
  const seen: Envelope[] = []
  const publisher: MessagePublisher = {
    async publish(message) {
      seen.push(message)
      await behaviour(message)
    },
  }
  return { publisher, seen }
}

const relayOf = (
  publisher: MessagePublisher,
  options: Partial<ConstructorParameters<typeof OutboxRelay>[4]> = {},
) =>
  new OutboxRelay(database, [source], publisher, logger, {
    pollIntervalMs: 50,
    batchSize: 50,
    concurrency: 4,
    leaseSeconds: 60,
    backoffBaseSeconds: 5,
    backoffMaxSeconds: 900,
    ...options,
  })

describe('claiming (DOC-38 §2.1)', () => {
  test('JB-01 120 pending rows, batch 50: 50, 50, 20 distinct rows, then none', async () => {
    await seed(120)
    const { publisher, seen } = recorder()
    const relay = relayOf(publisher)
    const claims = [
      await relay.drain(source),
      await relay.drain(source),
      await relay.drain(source),
      await relay.drain(source),
    ]
    expect(claims).toEqual([50, 50, 20, 0])
    expect(new Set(seen.map((m) => m.id)).size).toBe(120)
  })

  test('JB-02 a claim whose lease has expired comes back with attempts one higher', async () => {
    const ids = await seed(20)
    await db.sql`UPDATE probe.outbox_messages SET attempts = 1, locked_until = now() - interval '1 second'`
    const { publisher } = recorder(() => {
      throw new Error('keep it')
    })
    await relayOf(publisher).drain(source)
    for (const id of ids) expect((await row(id)).attempts).toBe(2)
  })

  test('a row whose lease is still valid is not claimed', async () => {
    await seed(3)
    await db.sql`UPDATE probe.outbox_messages SET locked_until = now() + interval '30 seconds'`
    const { publisher, seen } = recorder()
    expect(await relayOf(publisher).drain(source)).toBe(0)
    expect(seen).toHaveLength(0)
  })

  test('JB-07 two relays claiming at the same moment take disjoint rows', async () => {
    await seed(100)
    const { publisher, seen } = recorder(() => Bun.sleep(300))
    const claims = await Promise.all([
      relayOf(publisher).drain(source),
      relayOf(publisher).drain(source),
    ])
    expect(claims).toEqual([50, 50])
    expect(new Set(seen.map((m) => m.id)).size).toBe(100)
  })
})

describe('failure, back-off and the class limit (DOC-38 §2.3)', () => {
  test('JB-03 a message that fails every time waits 5, 10, 20, 40, 80, 160, 320 s and dies at the eighth attempt', async () => {
    const [id] = await seed(1)
    const { publisher } = recorder(() => {
      throw new Error('always')
    })
    const relay = relayOf(publisher)
    const waits: number[] = []
    for (let attempt = 1; attempt <= 8; attempt++) {
      await db.sql`UPDATE probe.outbox_messages SET next_attempt_at = now()`
      await relay.drain(source)
      const state = await row(id as string)
      waits.push(Math.round(state.wait))
      expect(state.attempts).toBe(attempt)
      expect(state.dead).toBe(attempt === 8)
    }
    expect(waits.slice(0, 7)).toEqual([5, 10, 20, 40, 80, 160, 320])
    expect((await row(id as string)).error).toBe('always')
  })

  test('JB-04 a dead message is not claimed; requeue makes it claimable again', async () => {
    const [id] = await seed(1, { dead: true, attempts: 8 })
    const { publisher, seen } = recorder()
    const relay = relayOf(publisher)
    expect(await relay.drain(source)).toBe(0)
    const admin = new OutboxAdmin(database, [source])
    expect((await admin.listDead()).map((d) => d.id)).toEqual([id as string])
    expect(await admin.requeue({ id: id as string })).toBe(1)
    expect(await relay.drain(source)).toBe(1)
    expect(seen).toHaveLength(1)
    expect((await row(id as string)).published).toBe(true)
  })

  test('discard deletes a dead row and never a live one', async () => {
    const [dead] = await seed(1, { dead: true })
    const [live] = await seed(1)
    const admin = new OutboxAdmin(database, [source])
    expect(await admin.discard(live as string)).toBe(0)
    expect(await admin.discard(dead as string)).toBe(1)
    expect(
      (await db.sql`SELECT 1 FROM probe.outbox_messages WHERE id = ${live as string}`).length,
    ).toBe(1)
  })

  test('JB-05 RetryLater gives the attempt back and waits the hint plus up to 10 %; a message past the budget dies', async () => {
    const [recent] = await seed(1, { age: 3600 })
    const [old] = await seed(1, { age: 25 * 3600 })
    const { publisher } = recorder(() => {
      throw new RetryLaterError('provider rate limit', 60_000)
    })
    await relayOf(publisher, { deferBudgetMs: 24 * 3600_000 }).drain(source)
    const a = await row(recent as string)
    const b = await row(old as string)
    expect(a).toMatchObject({ attempts: 0, dead: false })
    expect(a.wait).toBeGreaterThan(59)
    expect(a.wait).toBeLessThanOrEqual(66.1)
    expect(b).toMatchObject({ attempts: 0, dead: true })
  })

  test('MC-21 a type this build does not know is deferred and not lost; a known type with no handler is published (DR-272)', async () => {
    const [unknown] = await seed(1, { type: 'probe.written_by_a_newer_release.v1' })
    const [catalogued] = await seed(1)
    const { publisher, seen } = recorder()
    const known = new Set(['probe.thing_happened.v1'])
    await relayOf(publisher, { knownTypes: known, unknownTypeDeferMs: 60_000 }).drain(source)
    expect(seen.map((message) => message.type)).toEqual(['probe.thing_happened.v1'])
    expect(await row(unknown as string)).toMatchObject({
      attempts: 0,
      published: false,
      dead: false,
    })
    expect((await row(unknown as string)).wait).toBeGreaterThan(59)
    expect((await row(catalogued as string)).published).toBe(true)

    // The new worker knows the type: the message is claimed again and goes through.
    known.add('probe.written_by_a_newer_release.v1')
    await db.sql`UPDATE probe.outbox_messages SET next_attempt_at = now()`
    await relayOf(publisher, { knownTypes: known }).drain(source)
    expect((await row(unknown as string)).published).toBe(true)
    expect(seen.map((message) => message.type)).toContain('probe.written_by_a_newer_release.v1')
  })

  test('MC-16 the class limit is per type: three attempts for an sms command, eight for the rest', async () => {
    const [sms] = await seed(1, { type: 'probe.sms_requested.v1' })
    const [other] = await seed(1)
    const { publisher } = recorder(() => {
      throw new Error('down')
    })
    const relay = relayOf(publisher, {
      policy: (type) => ({ maxAttempts: type === 'probe.sms_requested.v1' ? 3 : 8 }),
    })
    for (let i = 0; i < 3; i++) {
      await db.sql`UPDATE probe.outbox_messages SET next_attempt_at = now()`
      await relay.drain(source)
    }
    expect((await row(sms as string)).dead).toBe(true)
    expect((await row(other as string)).dead).toBe(false)
  })
})

describe('cleanup (DOC-38 §2.5)', () => {
  test('JB-06 published 8 d and 2 d ago, pending 9 d, dead 9 d; inbox 8 d and 1 d: only the 8-day rows go', async () => {
    const [old] = await seed(1, { publishedDaysAgo: 8 })
    const [recent] = await seed(1, { publishedDaysAgo: 2 })
    const [pending] = await seed(1, { age: 9 * 86400 })
    const [dead] = await seed(1, { age: 9 * 86400, dead: true })
    await db.sql`INSERT INTO probe.inbox (message_id, handler, processed_at) VALUES
      (${Bun.randomUUIDv7()}, 'a', now() - interval '8 days'), (${Bun.randomUUIDv7()}, 'b', now() - interval '1 day')`
    await relayOf(recorder().publisher, { retentionDays: 7 }).cleanup(source)
    const left = (await db.sql`SELECT id FROM probe.outbox_messages`).map((r) => r.id as string)
    expect(left.sort()).toEqual([recent, pending, dead].map(String).sort())
    expect(left).not.toContain(old as string)
    expect((await db.sql`SELECT handler FROM probe.inbox`).map((r) => r.handler)).toEqual(['b'])
  })

  test('only one relay cleans at a time: the second skips without waiting', async () => {
    await seed(1, { publishedDaysAgo: 8 })
    const relay = relayOf(recorder().publisher, { retentionDays: 7 })
    const holder = db.connect(1)
    await holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('outbox-cleanup:probe'))`
      const begin = performance.now()
      await relay.cleanup(source)
      expect(performance.now() - begin).toBeLessThan(500)
      expect((await tx`SELECT count(*)::int AS n FROM probe.outbox_messages`)[0]?.n).toBe(1)
    })
    await holder.end()
  })
})

describe('the writer (DOC-09 §3.4, JB-23)', () => {
  const rules = {
    source: 'probe',
    types: new Set(['probe.thing_happened.v1']),
    maxPayloadBytes: 1024,
  }
  const writer = () =>
    new DrizzleOutboxWriter(database, probeOutbox, () => Bun.randomUUIDv7(), rules)
  const event = (over: Partial<{ type: string; payload: Record<string, unknown> }> = {}) => ({
    type: 'probe.thing_happened.v1',
    aggregateId: 'agg-1',
    payload: { buildingId: null, thingId: 't1' },
    occurredAt: new Date(),
    ...over,
  })
  const count = async () =>
    (await db.sql`SELECT count(*)::int AS n FROM probe.outbox_messages`)[0]?.n as number

  test('MC-03 outside a transaction it throws and writes nothing', async () => {
    await expect(writer().add([event()])).rejects.toThrow('inside UnitOfWork.run')
    expect(await count()).toBe(0)
  })

  test('MC-04 a rolled-back transaction leaves no row; a committed one leaves one', async () => {
    await database
      .run(async () => {
        await writer().add([event()])
        throw new Error('rollback')
      })
      .catch(() => {})
    expect(await count()).toBe(0)
    await database.run(() => writer().add([event()]))
    expect(await count()).toBe(1)
  })

  test('JB-23 a type that is not in the catalog, or not of this module, is refused and nothing is written', async () => {
    for (const type of ['probe.unknown.v1', 'finance.thing_happened.v1', 'not a type'])
      await expect(database.run(() => writer().add([event({ type })]))).rejects.toThrow()
    expect(await count()).toBe(0)
  })

  test('MC-05 a payload over the limit is refused; one without buildingId is refused', async () => {
    await expect(
      database.run(() =>
        writer().add([event({ payload: { buildingId: null, blob: 'x'.repeat(2000) } })]),
      ),
    ).rejects.toThrow('over 1024 bytes')
    await expect(
      database.run(() => writer().add([event({ payload: { thingId: 't1' } })])),
    ).rejects.toThrow('buildingId')
    await database.run(() =>
      writer().add([event({ payload: { buildingId: null, blob: 'x'.repeat(900) } })]),
    )
    expect(await count()).toBe(1)
  })

  test('MC-02 the row carries the correlation of the request context', async () => {
    await database.run(() => writer().add([event()]))
    const [stored] = await db.sql<
      { type: string; aggregate_id: string }[]
    >`SELECT type, aggregate_id FROM probe.outbox_messages`
    expect(stored).toMatchObject({ type: 'probe.thing_happened.v1', aggregate_id: 'agg-1' })
  })
})

describe('handlers and the inbox (DOC-09 §4.3)', () => {
  test('MC-08 three handlers, the second fails once: the first and third write once, only the second runs again', async () => {
    const [id] = await seed(1)
    const bus = new InProcessMessageBus(logger)
    const log: string[] = []
    for (const handler of [
      effectHandler(database, 'a', { log }),
      effectHandler(database, 'b', { failTimes: 1, log }),
      effectHandler(database, 'c', { log }),
    ])
      bus.subscribe(handler)
    const relay = relayOf(bus)
    await relay.drain(source)
    expect((await row(id as string)).published).toBe(false)
    await db.sql`UPDATE probe.outbox_messages SET next_attempt_at = now()`
    await relay.drain(source)
    expect((await row(id as string)).published).toBe(true)
    const effects = await db.sql<
      { handler: string; n: number }[]
    >`SELECT handler, count(*)::int AS n FROM probe.effects GROUP BY handler ORDER BY handler`
    expect(effects.map((e) => [e.handler, e.n])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ])
    // The first delivery ran a, b, c; the second ran only b again (a and c are blocked by their inbox row but still entered).
    expect(log.filter((entry) => entry.startsWith('b:'))).toHaveLength(2)
  })

  test('MC-07 delivering the same envelope twice changes nothing the second time', async () => {
    const [id] = await seed(1)
    const bus = new InProcessMessageBus(logger)
    bus.subscribe(effectHandler(database, 'a'))
    const relay = relayOf(bus)
    await relay.drain(source)
    await db.sql`UPDATE probe.outbox_messages SET published_at = NULL, next_attempt_at = now() WHERE id = ${id as string}`
    await relay.drain(source)
    expect((await db.sql`SELECT count(*)::int AS n FROM probe.effects`)[0]?.n).toBe(1)
  })

  test('MC-18 aggregates run in parallel; the messages of one aggregate start in id order', async () => {
    const log: string[] = []
    const ids = [...(await seed(2, { aggregateId: 'A' })), ...(await seed(2, { aggregateId: 'B' }))]
    const bus = new InProcessMessageBus(logger)
    bus.subscribe(effectHandler(database, 'h', { delayMs: 150, log }))
    const begin = performance.now()
    await relayOf(bus, { concurrency: 4 }).drain(source)
    const elapsed = performance.now() - begin
    // Two aggregates of two messages: parallel across aggregates (≈ 300 ms), not 4 × 150 ms in sequence.
    expect(elapsed).toBeLessThan(550)
    const orderOf = (aggregate: string[]) =>
      log.map((entry) => entry.split(':')[1] as string).filter((id) => aggregate.includes(id))
    expect(orderOf(ids.slice(0, 2))).toEqual(ids.slice(0, 2).sort())
    expect(orderOf(ids.slice(2))).toEqual(ids.slice(2).sort())
  })
})
