import { describe, expect, test } from 'bun:test'
import type { JobContext } from '@core/runtime'
import { FakeClock } from '@core/testing'
import type { MetricsPort } from '@rms/shared-types'
import { DEFAULT_PUSH_CONFIG, type PushConfig } from '../../application/push-config'
import type { PushSender } from '../../application/push-sender'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'
import type { PushReceiptOutcome } from '../../domain/push-ticket'
import type { PushTicketRepository } from '../../domain/push-ticket-repository'
import { inboxPurgeJob } from './inbox-purge'
import { pushReceiptsJob } from './push-receipts'

const config: PushConfig = {
  ...DEFAULT_PUSH_CONFIG,
  receiptDelayMinutes: 15,
  ticketRetentionDays: 3,
  inboxRetentionDays: 180,
}
const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as JobContext['logger']

/** The `JobContext` the jobs read: a settable clock, no buildings, `withLock`/`snapshot` run the function directly. */
const context = (clock: FakeClock): JobContext => ({
  clock,
  signal: new AbortController().signal,
  logger: silent,
  manual: false,
  paused: () => false,
  buildings: async () => [],
  withLock: <T>(fn: () => Promise<T>) => fn(),
  snapshot: <T>(fn: () => Promise<T>) => fn(),
})

interface FakeTicket {
  readonly id: string
  readonly receiptId: string
  readonly deviceTokenId: string
  status: 'pending' | 'ok' | 'failed' | 'unknown'
  error: string | null
  readonly createdAt: number
  nextCheckAt: number
}

/** The rows `claimDue`/`settle`/`markUnknownOlderThan`/`purgeOlderThan` work on: OPM-S22, S23 and S24. */
function fakeTickets(now: () => Date) {
  const rows: FakeTicket[] = []
  const repo = {
    async claimDue(limit: number, leaseMinutes: number) {
      const at = now().getTime()
      const due = rows
        .filter((row) => row.status === 'pending' && row.nextCheckAt <= at)
        .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
        .slice(0, limit)
      for (const row of due) row.nextCheckAt = at + leaseMinutes * 60_000
      return due.map((row) => ({
        id: row.id,
        receiptId: row.receiptId,
        deviceTokenId: row.deviceTokenId,
      }))
    },
    async settle(id: string, outcome: PushReceiptOutcome) {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row || row.status !== 'pending') return false
      row.status = outcome.status
      row.error = outcome.error
      return true
    },
    async markUnknownOlderThan(hours: number) {
      const at = now().getTime()
      const old = rows.filter(
        (row) => row.status === 'pending' && row.createdAt < at - hours * 3_600_000,
      )
      for (const row of old) row.status = 'unknown'
      return old.length
    },
    async purgeOlderThan(days: number, batch: number) {
      const at = now().getTime()
      const doomed = rows
        .filter((row) => row.createdAt < at - days * 86_400_000)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, batch)
      for (const row of doomed) rows.splice(rows.indexOf(row), 1)
      return doomed.length
    },
  } as unknown as PushTicketRepository
  return { repo, rows }
}

/** The token deletes of the sender: `deleteByIds` removes and counts (DOC-31 §5.2). */
function fakeDevices(ids: readonly string[]) {
  const live = new Set(ids)
  const repo = {
    async deleteByIds(remove: readonly string[]) {
      let deleted = 0
      for (const id of remove) if (live.delete(id)) deleted += 1
      return deleted
    },
  } as unknown as DeviceTokenRepository
  return { repo, live }
}

type FakeReceipt = { status: 'ok' } | { status: 'error'; details: { error: string } }

/** The fake Expo endpoint: one request per call, `ok` unless the id is listed in `errors` or `absent` (DOC-31 §6.3). */
function fakeSender(options: { errors?: Record<string, string>; absent?: readonly string[] } = {}) {
  const calls: string[][] = []
  const sender = {
    async send() {
      return []
    },
    async getReceipts(ids: string[]) {
      calls.push(ids)
      const receipts: Record<string, FakeReceipt> = {}
      for (const id of ids) {
        if (options.absent?.includes(id)) continue
        const error = options.errors?.[id]
        receipts[id] = error ? { status: 'error', details: { error } } : { status: 'ok' }
      }
      return receipts
    },
  } as unknown as PushSender
  return { sender, calls }
}

/** A `MetricsPort` that records every count so a test can read it (NT-72). */
function recordingMetrics() {
  const counters: Array<{ name: string; labels: Record<string, string> }> = []
  const port = {
    inc(name: string, labels: Record<string, string> = {}) {
      counters.push({ name, labels })
    },
    add(name: string, _by: number, labels: Record<string, string> = {}) {
      counters.push({ name, labels })
    },
    observe() {},
  } as unknown as MetricsPort
  return { port, counters }
}

/** The entries `purgeOlderThan` deletes, oldest first, up to the batch (DOC-31 §4.5, OPM-S24). */
function fakeEntries(createdAt: readonly number[]) {
  const rows = [...createdAt]
  const batches: number[] = []
  const repo = {
    async purgeOlderThan(cutoff: Date, batch: number) {
      const doomed = rows
        .filter((at) => at < cutoff.getTime())
        .sort((a, b) => a - b)
        .slice(0, batch)
      batches.push(doomed.length)
      for (const at of doomed) rows.splice(rows.indexOf(at), 1)
      return doomed.length
    },
  } as unknown as InboxEntryRepository
  return { repo, rows, batches }
}

describe('NT-70: push_receipts claims 1,500 due tickets in two runs', () => {
  test('a run of 1,000 then one of 500, one request each, and DeviceNotRegistered deletes the token', async () => {
    const clock = new FakeClock(new Date('2026-11-03T00:00:00.000Z'))
    const { repo, rows } = fakeTickets(() => clock.now())
    const at = clock.now().getTime()
    for (let i = 0; i < 1500; i++)
      rows.push({
        id: `t${i}`,
        receiptId: `r${i}`,
        deviceTokenId: `d${i}`,
        status: 'pending',
        error: null,
        createdAt: at - 20 * 60_000,
        nextCheckAt: at - 60_000,
      })
    const { repo: devices, live } = fakeDevices(rows.map((row) => row.deviceTokenId))
    const { sender, calls } = fakeSender({ errors: { r0: 'DeviceNotRegistered' } })
    const job = pushReceiptsJob(repo, devices, sender, config)

    await job.run(context(clock))
    await job.run(context(clock))

    expect(calls.map((ids) => ids.length)).toEqual([1000, 500])
    expect(rows.filter((row) => row.status === 'ok')).toHaveLength(1499)
    expect(rows.filter((row) => row.status === 'failed')).toHaveLength(1)
    expect(live.has('d0')).toBe(false)
    expect(live.size).toBe(1499)
  })
})

describe('NT-71: an absent receipt ages out', () => {
  test('a ticket stays pending at 20 min and becomes unknown after 24 h', async () => {
    const clock = new FakeClock(new Date('2026-11-03T00:00:00.000Z'))
    const { repo, rows } = fakeTickets(() => clock.now())
    const at = clock.now().getTime()
    rows.push({
      id: 't1',
      receiptId: 'r1',
      deviceTokenId: 'd1',
      status: 'pending',
      error: null,
      createdAt: at - 20 * 60_000,
      nextCheckAt: at - 60_000,
    })
    const { repo: devices } = fakeDevices(['d1'])
    const { sender } = fakeSender({ absent: ['r1'] })
    const job = pushReceiptsJob(repo, devices, sender, config)

    await job.run(context(clock))
    expect(rows[0]?.status).toBe('pending')

    clock.advance(25 * 3_600_000)
    const second = await job.run(context(clock))
    expect(rows[0]?.status).toBe('unknown')
    expect(second.details).toMatchObject({ unknown: 1 })
  })
})

describe('NT-72: an InvalidCredentials receipt', () => {
  test('fails the ticket, counts the delivery failure and the provider auth failure', async () => {
    const clock = new FakeClock(new Date('2026-11-03T00:00:00.000Z'))
    const { repo, rows } = fakeTickets(() => clock.now())
    const at = clock.now().getTime()
    rows.push({
      id: 't1',
      receiptId: 'r1',
      deviceTokenId: 'd1',
      status: 'pending',
      error: null,
      createdAt: at - 20 * 60_000,
      nextCheckAt: at - 60_000,
    })
    const { repo: devices } = fakeDevices(['d1'])
    const { sender } = fakeSender({ errors: { r1: 'InvalidCredentials' } })
    const { port, counters } = recordingMetrics()
    const job = pushReceiptsJob(repo, devices, sender, config, port)

    const result = await job.run(context(clock))

    expect(rows[0]).toMatchObject({ status: 'failed', error: 'InvalidCredentials' })
    expect(counters).toContainEqual({ name: 'push_receipts_total', labels: { outcome: 'failed' } })
    expect(counters).toContainEqual({
      name: 'delivery_failed_total',
      labels: { channel: 'push', reason: 'invalid_credentials' },
    })
    expect(counters).toContainEqual({
      name: 'provider_auth_failed_total',
      labels: { provider: 'push' },
    })
    expect(result.did).toBe(1)
  })
})

describe('NT-73: push tickets older than the retention are purged', () => {
  test('a 4-day ticket goes, a 1-day one stays, and a second run purges nothing', async () => {
    const clock = new FakeClock(new Date('2026-11-03T00:00:00.000Z'))
    const { repo, rows } = fakeTickets(() => clock.now())
    const at = clock.now().getTime()
    rows.push({
      id: 'old',
      receiptId: 'r-old',
      deviceTokenId: 'd-old',
      status: 'ok',
      error: null,
      createdAt: at - 4 * 86_400_000,
      nextCheckAt: 0,
    })
    rows.push({
      id: 'new',
      receiptId: 'r-new',
      deviceTokenId: 'd-new',
      status: 'ok',
      error: null,
      createdAt: at - 1 * 86_400_000,
      nextCheckAt: 0,
    })
    const { repo: devices } = fakeDevices([])
    const { sender } = fakeSender()
    const job = pushReceiptsJob(repo, devices, sender, config)

    const first = await job.run(context(clock))
    expect(rows.map((row) => row.id)).toEqual(['new'])
    expect(first.details).toMatchObject({ purged: 1 })

    const second = await job.run(context(clock))
    expect(rows.map((row) => row.id)).toEqual(['new'])
    expect(second.did).toBe(0)
  })
})

describe('NT-80: inbox_purge deletes old entries in batches', () => {
  test('2,500 old entries purge in 1,000/1,000/500; a second run deletes 0', async () => {
    const clock = new FakeClock(new Date('2026-11-03T00:00:00.000Z'))
    const at = clock.now().getTime()
    const createdAt = Array.from({ length: 2500 }, (_, i) => at - (181 + (i % 40)) * 86_400_000)
    const { repo, rows, batches } = fakeEntries(createdAt)
    const job = inboxPurgeJob(repo, config, 24 * 60)

    const first = await job.run(context(clock))
    expect(batches).toEqual([1000, 1000, 500])
    expect(rows).toHaveLength(0)
    expect(first.did).toBe(2500)

    const second = await job.run(context(clock))
    expect(second.did).toBe(0)
    expect(rows).toHaveLength(0)
  })
})
