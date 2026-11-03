import { describe, expect, test } from 'bun:test'
import type { IdGenerator, Log } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import type { StaffRole } from '@rms/shared-types'
import { assertMappings, RealtimePushHandler } from './application/handlers/realtime-push-handler'
import type {
  EventRow,
  HubStream,
  LiveEvent,
  RealtimeStore,
  ReplayRow,
  StreamHub,
  Timers,
} from './application/ports'
import { StaffEventStreams } from './application/staff-event-streams'
import { reaches } from './application/targeting'
import type { RealtimeMapping } from './contracts'

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Log
const B1 = '0192f3c4-0000-7000-8000-000000000001'
const B0 = '0192f3c4-0000-7000-8000-000000000000'

/** A UUIDv7 minted at `ms`: the first 48 bits are the time (DOC-52 §8.2). */
const v7 = (ms: number, n: number) => {
  const hex = ms.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-${String(n).padStart(12, '0')}`
}

class CounterIds implements IdGenerator {
  private n = 0
  constructor(private readonly clock: FakeClock) {}
  next() {
    return v7(this.clock.now().getTime(), ++this.n)
  }
}

/** A store in memory that mimics `ON CONFLICT (source_message_id) DO NOTHING` and tells the hub, as `pg_notify` does. */
class MemoryStore implements RealtimeStore {
  rows: Array<EventRow & { createdAt: Date }> = []
  published = 0
  constructor(
    private readonly clock: FakeClock,
    private readonly hub: MemoryHub,
  ) {}
  async publish(row: EventRow) {
    if (this.rows.some((r) => r.sourceMessageId === row.sourceMessageId)) return false
    const createdAt = this.clock.now()
    this.rows.push({ ...row, createdAt })
    this.published++
    this.hub.notify(row, createdAt)
    return true
  }
  async replay(
    scope: { buildingId: string; accountId: string; role: StaffRole },
    lastEventId: string,
    limit: number,
  ): Promise<ReplayRow[]> {
    const from = Number.parseInt(lastEventId.replace(/-/g, '').slice(0, 12), 16) - 5000
    return this.rows
      .filter(
        (r) =>
          r.buildingId === scope.buildingId &&
          r.createdAt.getTime() >= from &&
          (r.targetAccountId === scope.accountId || r.targetRoles?.includes(scope.role)),
      )
      .slice(0, limit)
      .map((r) => ({ id: r.id, type: r.type, data: r.data, createdAt: r.createdAt }))
  }
  async purgeOlderThan(cutoff: Date) {
    const before = this.rows.length
    this.rows = this.rows.filter((r) => r.createdAt >= cutoff)
    return before - this.rows.length
  }
}

class MemoryHub implements StreamHub {
  streams = new Set<HubStream>()
  async register(stream: HubStream) {
    this.streams.add(stream)
    return () => void this.streams.delete(stream)
  }
  closeLive(reason: string) {
    for (const s of [...this.streams]) s.close(reason)
  }
  notify(row: EventRow, createdAt: Date) {
    const target = {
      buildingId: row.buildingId,
      accountId: row.targetAccountId,
      roles: row.targetRoles,
    }
    const event: LiveEvent = {
      id: row.id,
      type: row.type,
      data: row.data,
      at: createdAt.toISOString(),
      ...(row.closeSessionId ? { closeSessionId: row.closeSessionId } : {}),
    }
    for (const s of [...this.streams]) if (reaches(target, s)) s.deliver(event)
  }
}

/** Timers the test fires by hand. */
class ManualTimers implements Timers {
  private pending: Array<{ at: number; fn: () => void; live: boolean }> = []
  private now = 0
  after(ms: number, fn: () => void) {
    const entry = { at: this.now + ms, fn, live: true }
    this.pending.push(entry)
    return () => {
      entry.live = false
    }
  }
  advance(ms: number) {
    this.now += ms
    for (const entry of [...this.pending])
      if (entry.live && entry.at <= this.now) {
        entry.live = false
        entry.fn()
      }
  }
}

function setup(max = 3) {
  const clock = new FakeClock(new Date('2026-11-03T08:00:00Z'))
  const hub = new MemoryHub()
  const store = new MemoryStore(clock, hub)
  const ids = new CounterIds(clock)
  const timers = new ManualTimers()
  const counts: Record<string, number> = {}
  const metrics = {
    inc: (name: string, labels?: Record<string, string>) => {
      const key = `${name}:${Object.values(labels ?? {}).join(',')}`
      counts[key] = (counts[key] ?? 0) + 1
    },
    add() {},
    observe() {},
  }
  const streams = new StaffEventStreams(
    store,
    hub,
    clock,
    ids,
    { maxStreamsPerAccount: max, heartbeatSeconds: 25 },
    metrics as never,
    timers,
  )
  return { clock, hub, store, ids, timers, streams, counts }
}

const open = (
  s: ReturnType<typeof setup>,
  who: { accountId: string; role: StaffRole; sessionId?: string; buildingId?: string },
  lastEventId?: string,
  ttlMs = 15 * 60_000,
) =>
  s.streams.execute({
    buildingId: who.buildingId ?? B1,
    accountId: who.accountId,
    role: who.role,
    sessionId: who.sessionId ?? `sess-${who.accountId}`,
    tokenExpiresAt: new Date(s.clock.now().getTime() + ttlMs),
    lastEventId,
  })

/** Reads a stream in the background and keeps the decoded frames. */
function collect(result: Awaited<ReturnType<typeof open>>) {
  if (result.rejected) throw new Error('rejected')
  const frames: string[] = []
  let closed = false
  const reader = result.stream.getReader()
  const decoder = new TextDecoder()
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        closed = true
        return
      }
      frames.push(decoder.decode(value))
    }
  })()
  return { frames, isClosed: () => closed, cancel: () => reader.cancel() }
}
const flush = () => Bun.sleep(0)
const dataOf = (frame: string) => JSON.parse(frame.split('data: ')[1] ?? '{}')

const moneyMapping: RealtimeMapping<{
  buildingId: string
  kind: 'gateway_event'
  rowId: string
  outcome: string
  amount: number
}> = {
  handler: 'realtime.sse_on_finance_money_unposted',
  eventType: 'finance.money_unposted.v1',
  build: (p) => ({
    buildingId: p.buildingId,
    target: { roles: ['manager', 'admin'] },
    event: { type: 'money_log.opened', data: { kind: p.kind, rowId: p.rowId, outcome: p.outcome } },
  }),
}
const envelope = (id: string, type: string, payload: Record<string, unknown>): Envelope => ({
  id,
  type,
  source: 'test',
  aggregateId: 'a',
  occurredAt: '2026-11-03T08:00:00.000Z',
  payload,
  headers: {} as Envelope['headers'],
})
const handlerFor = (
  s: ReturnType<typeof setup>,
  mapping: RealtimeMapping<never> = moneyMapping as never,
) =>
  new RealtimePushHandler(mapping, s.store, s.ids, silent, {
    inc: (name: string, labels?: Record<string, string>) => {
      const key = `${name}:${Object.values(labels ?? {}).join(',')}`
      s.counts[key] = (s.counts[key] ?? 0) + 1
    },
    add() {},
    observe() {},
  } as never)
const money = (id: string) =>
  envelope(id, 'finance.money_unposted.v1', {
    buildingId: B1,
    kind: 'gateway_event',
    rowId: 'row-1',
    outcome: 'amount_short',
    amount: 2838000,
  })

describe('SE-02: the first frame is ready', () => {
  test('ready carries a UUIDv7 cursor, the token sid and resumed false', async () => {
    const s = setup()
    const c = collect(await open(s, { accountId: 'm1', role: 'manager', sessionId: 'sid-1' }))
    await flush()
    expect(c.frames[0]).toStartWith('event: ready\n')
    const ready = dataOf(c.frames[0] ?? '')
    expect(ready).toMatchObject({ sessionId: 'sid-1', resumed: false })
    expect(ready.cursor).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    expect(s.counts['sse_stream_opens_total:fresh']).toBe(1)
  })
})

describe('SE-03: the heartbeat', () => {
  test('one comment after 25 s of silence and none before', async () => {
    const s = setup()
    const c = collect(await open(s, { accountId: 'm1', role: 'manager' }))
    await flush()
    s.timers.advance(24_000)
    await flush()
    expect(c.frames).toHaveLength(1)
    s.timers.advance(1_000)
    await flush()
    expect(c.frames[1]).toBe(': hb\n\n')
  })
})

describe('SE-04: the limit is per account and per process', () => {
  test('a fourth stream is refused until one closes; another process has its own count', async () => {
    const s = setup(3)
    const opened = [] as ReturnType<typeof collect>[]
    for (let i = 0; i < 3; i++)
      opened.push(collect(await open(s, { accountId: 'm1', role: 'manager' })))
    expect(await open(s, { accountId: 'm1', role: 'manager' })).toEqual({ rejected: 'limit' })
    expect(s.counts['sse_stream_opens_total:limited']).toBe(1)
    await opened[0]?.cancel()
    await flush()
    const again = await open(s, { accountId: 'm1', role: 'manager' })
    expect(again.rejected).toBeUndefined()
    expect(s.streams.openCount()).toBe(3)
    const other = setup(3)
    expect((await open(other, { accountId: 'm1', role: 'manager' })).rejected).toBeUndefined()
  })
})

describe('SE-05: who receives money_log.opened', () => {
  test('managers and admins of the building only, with no amount', async () => {
    const s = setup()
    const m = collect(await open(s, { accountId: 'm1', role: 'manager' }))
    const a = collect(await open(s, { accountId: 'a1', role: 'admin' }))
    const t = collect(await open(s, { accountId: 't1', role: 'technician' }))
    const g = collect(await open(s, { accountId: 'g1', role: 'guard' }))
    const other = collect(await open(s, { accountId: 'a0', role: 'admin', buildingId: B0 }))
    await flush()
    await handlerFor(s).handle(money('msg-1'))
    await flush()
    for (const c of [m, a]) {
      expect(c.frames).toHaveLength(2)
      const event = dataOf(c.frames[1] ?? '')
      expect(event.type).toBe('money_log.opened')
      expect(event.data).toEqual({ kind: 'gateway_event', rowId: 'row-1', outcome: 'amount_short' })
      expect(JSON.stringify(event)).not.toContain('amount"')
      expect(JSON.stringify(event)).not.toContain('2838000')
    }
    for (const c of [t, g, other]) expect(c.frames).toHaveLength(1)
  })
})

describe('SE-06: inbox.created reaches every stream of that staff member only', () => {
  test('two tabs of S, none for U', async () => {
    const s = setup()
    const s1 = collect(await open(s, { accountId: 'S', role: 'manager', sessionId: 'x1' }))
    const s2 = collect(await open(s, { accountId: 'S', role: 'manager', sessionId: 'x2' }))
    const u = collect(await open(s, { accountId: 'U', role: 'manager' }))
    await flush()
    const mapping: RealtimeMapping<{
      buildingId: string
      staffId: string
      entryId: string
      templateKey: string
    }> = {
      handler: 'realtime.sse_on_notification_staff_inbox_created',
      eventType: 'notification.staff_inbox_created.v1',
      build: (p) => ({
        buildingId: p.buildingId,
        target: { accountId: p.staffId },
        event: { type: 'inbox.created', data: { entryId: p.entryId, templateKey: p.templateKey } },
      }),
    }
    await handlerFor(s, mapping as never).handle(
      envelope('msg-2', 'notification.staff_inbox_created.v1', {
        buildingId: B1,
        staffId: 'S',
        entryId: 'e1',
        templateKey: 'finance.money_unposted',
      }),
    )
    await flush()
    expect(s1.frames).toHaveLength(2)
    expect(s2.frames).toHaveLength(2)
    expect(u.frames).toHaveLength(1)
  })
})

describe('SE-08: session.revoked closes the streams of that session only', () => {
  test('all three receive it, the two of s1 close, the s2 stream stays open', async () => {
    const s = setup()
    const a = collect(await open(s, { accountId: 'M', role: 'manager', sessionId: 's1' }))
    const b = collect(await open(s, { accountId: 'M', role: 'manager', sessionId: 's1' }))
    const c = collect(await open(s, { accountId: 'M', role: 'manager', sessionId: 's2' }))
    await flush()
    const mapping: RealtimeMapping<{
      accountId: string
      sessionId: string
      reason: string
      accountKind: string
      buildingId: string
    }> = {
      handler: 'realtime.close_stream_on_identity_session_revoked',
      eventType: 'identity.session_revoked.v1',
      build: (p) =>
        p.accountKind === 'staff'
          ? {
              buildingId: p.buildingId,
              target: { accountId: p.accountId },
              closeSessionId: p.sessionId,
              event: {
                type: 'session.revoked',
                data: { sessionId: p.sessionId, reason: p.reason },
              },
            }
          : null,
    }
    await handlerFor(s, mapping as never).handle(
      envelope('msg-3', 'identity.session_revoked.v1', {
        buildingId: B1,
        accountKind: 'staff',
        accountId: 'M',
        sessionId: 's1',
        reason: 'user_revoked',
      }),
    )
    await flush()
    for (const x of [a, b, c]) expect(x.frames).toHaveLength(2)
    expect(a.isClosed()).toBe(true)
    expect(b.isClosed()).toBe(true)
    expect(c.isClosed()).toBe(false)
  })

  test('SE-09: a resident revocation builds nothing, so no row and no notification', async () => {
    const s = setup()
    const mapping: RealtimeMapping<{ accountKind: string }> = {
      handler: 'realtime.close_stream_on_identity_session_revoked',
      eventType: 'identity.session_revoked.v1',
      build: () => null,
    }
    await handlerFor(s, mapping as never).handle(
      envelope('msg-4', 'identity.session_revoked.v1', { accountKind: 'resident' }),
    )
    expect(s.store.rows).toHaveLength(0)
  })
})

describe('SE-13: the handler twice writes once', () => {
  test('a relay retry inserts and notifies nothing the second time', async () => {
    const s = setup()
    const c = collect(await open(s, { accountId: 'm1', role: 'manager' }))
    await flush()
    const handler = handlerFor(s)
    await handler.handle(money('msg-5'))
    await handler.handle(money('msg-5'))
    await flush()
    expect(s.store.rows).toHaveLength(1)
    expect(s.store.published).toBe(1)
    expect(c.frames).toHaveLength(2)
    expect(s.counts['sse_events_published_total:money_log.opened']).toBe(1)
  })
})

describe('SE-10 to SE-12: replay', () => {
  test('SE-10: events written after e1 come back in order with resumed true', async () => {
    const s = setup()
    const first = collect(await open(s, { accountId: 'm1', role: 'manager' }))
    await flush()
    await handlerFor(s).handle(money('r1'))
    await flush()
    const e1 = dataOf(first.frames[1] ?? '').id as string
    await first.cancel()
    await flush()
    s.clock.advance(1000)
    for (const id of ['r2', 'r3', 'r4']) {
      s.clock.advance(10)
      await handlerFor(s).handle(money(id))
    }
    const second = collect(await open(s, { accountId: 'm1', role: 'manager' }, e1))
    await flush()
    expect(dataOf(second.frames[0] ?? '').resumed).toBe(true)
    const replayed = second.frames.slice(1).map((f) => dataOf(f).id as string)
    expect(replayed).toContain(e1)
    expect(replayed.length).toBe(4)
    expect(s.counts['sse_stream_opens_total:resumed']).toBe(1)
  })

  test('SE-11: another account and another building are not replayed', async () => {
    const s = setup()
    const mapping: RealtimeMapping<{ buildingId: string; staffId: string }> = {
      handler: 'realtime.sse_on_notification_staff_inbox_created',
      eventType: 'notification.staff_inbox_created.v1',
      build: (p) => ({
        buildingId: p.buildingId,
        target: { accountId: p.staffId },
        event: {
          type: 'inbox.created',
          data: { entryId: 'e', templateKey: 'finance.money_unposted' },
        },
      }),
    }
    await handlerFor(s, mapping as never).handle(
      envelope('o1', 'notification.staff_inbox_created.v1', {
        buildingId: B1,
        staffId: 'someone-else',
      }),
    )
    await handlerFor(s).handle(
      envelope('o2', 'finance.money_unposted.v1', {
        buildingId: B0,
        kind: 'gateway_event',
        rowId: 'r',
        outcome: 'x',
      }),
    )
    const lastEventId = v7(s.clock.now().getTime() - 60_000, 1)
    const c = collect(await open(s, { accountId: 'm1', role: 'manager' }, lastEventId))
    await flush()
    expect(dataOf(c.frames[0] ?? '').resumed).toBe(true)
    expect(c.frames).toHaveLength(1)
  })

  test('SE-12: 30 hours old, not a UUID, a UUIDv4, or 260 matching rows: resumed false, nothing replayed, never an error', async () => {
    const s = setup()
    for (let i = 0; i < 260; i++) {
      s.clock.advance(1)
      await handlerFor(s).handle(money(`bulk-${i}`))
    }
    const old = v7(s.clock.now().getTime() - 30 * 3_600_000, 1)
    const v4 = '0192f3c4-0000-4000-8000-000000000001'
    const recent = v7(s.clock.now().getTime() - 3_600_000, 2)
    for (const header of [old, 'abc', v4, recent]) {
      const c = collect(await open(s, { accountId: `m-${header}`, role: 'manager' }, header))
      await flush()
      expect(c.frames).toHaveLength(1)
      expect(dataOf(c.frames[0] ?? '').resumed).toBe(false)
    }
  })
})

describe('SE-15 and SE-16: lifetime', () => {
  test('SE-15: the stream closes when the access token expires', async () => {
    const s = setup()
    const c = collect(await open(s, { accountId: 'm1', role: 'manager' }, undefined, 60_000))
    await flush()
    s.timers.advance(59_000)
    await flush()
    expect(c.isClosed()).toBe(false)
    s.timers.advance(1_000)
    await flush()
    expect(c.isClosed()).toBe(true)
    expect(s.streams.openCount()).toBe(0)
  })

  test('SE-16: closeLive closes every stream', async () => {
    const s = setup()
    const a = collect(await open(s, { accountId: 'm1', role: 'manager' }))
    const b = collect(await open(s, { accountId: 'm2', role: 'admin' }))
    await flush()
    s.streams.closeLive()
    await flush()
    expect(a.isClosed() && b.isClosed()).toBe(true)
    expect(s.streams.openCount()).toBe(0)
  })
})

describe('SE-18 and install checks', () => {
  test('SE-18: a built event over 7,500 bytes throws before anything is written', async () => {
    const s = setup()
    const huge: RealtimeMapping<never> = {
      handler: 'realtime.huge',
      eventType: 'x.v1',
      build: () => ({
        buildingId: B1,
        target: { roles: ['manager'] },
        event: { type: 'inbox.created', data: { blob: 'x'.repeat(8000) } },
      }),
    }
    await expect(handlerFor(s, huge).handle(envelope('h1', 'x.v1', {}))).rejects.toThrow(
      'realtime_payload_too_large',
    )
    expect(s.store.rows).toHaveLength(0)
  })

  test('two mappings with one handler name fail the boot', () => {
    expect(() => assertMappings([moneyMapping as never, moneyMapping as never])).toThrow(
      'realtime.sse_on_finance_money_unposted',
    )
  })
})
