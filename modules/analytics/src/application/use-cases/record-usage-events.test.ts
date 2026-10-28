import { describe, expect, test } from 'bun:test'
import { RateLimitedError, ValidationError } from '@core/kernel'
import { recordingMetrics } from '@rms/test-support'
import type { NewUsageEvents, UsageEventRepository } from '../../domain/usage-event-repository'
import type { RateLimiter, RateRule } from '../ports'
import { UsageRateLimits } from '../usage-rate-limits'
import { RecordUsageEvents } from './record-usage-events'

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const SESSION = '0192f3c4-9d02-4000-8000-00000000a001'
const NOW = new Date('2026-10-28T09:12:30.987Z')

class Repository implements UsageEventRepository {
  batches: NewUsageEvents[] = []
  async insertBatch(_scope: unknown, batch: NewUsageEvents) {
    this.batches.push(batch)
    return batch.rows.length
  }
  async purgeBefore() {
    return 0
  }
}

class Limiter implements RateLimiter {
  taken: RateRule[] = []
  refuse: string | null = null
  async take(rule: RateRule) {
    this.taken.push(rule)
    if (rule.key.startsWith(this.refuse ?? '\0')) throw new RateLimitedError(rule.scope, 7)
  }
}

function build(over: { demo?: boolean; enabled?: boolean } = {}) {
  const repository = new Repository()
  const limiter = new Limiter()
  const metrics = recordingMetrics()
  let n = 0
  const useCase = new RecordUsageEvents(
    repository,
    new UsageRateLimits(limiter, { eventsPerMinutePerIp: 30, eventsPerHourPerSession: 120 }),
    { isDemo: async () => over.demo ?? false },
    { now: () => NOW },
    { next: () => `id-${++n}` },
    { enabled: over.enabled ?? true },
    metrics,
  )
  return { useCase, repository, limiter, metrics }
}

const batch = (events: Array<Record<string, unknown>>) => ({
  audience: 'resident' as const,
  buildingId: BUILDING,
  batch: {
    app: 'resident' as const,
    appVersion: '1.0.3',
    platform: 'ios' as const,
    sessionId: SESSION,
    events: events as never,
  },
})

describe('RecordUsageEvents', () => {
  test('UA-01 three valid events are written under the building and audience of the caller, at the receive time', async () => {
    const { useCase, repository, metrics } = build()
    const result = await useCase.execute(
      batch([
        { event: 'app_open', name: 'Launch', ageMs: 61_200 },
        { event: 'screen_view', name: 'Main', ageMs: 4_200 },
        { event: 'tap', name: 'Account.language', ageMs: 900 },
      ]),
    )
    expect(result).toEqual({ enabled: true })
    expect(repository.batches).toHaveLength(1)
    expect(repository.batches[0]).toMatchObject({
      receivedAt: NOW,
      app: 'resident',
      audience: 'resident',
      sessionId: SESSION,
    })
    expect(repository.batches[0]?.rows.map((row) => row.name)).toEqual([
      'Launch',
      'Main',
      'Account.language',
    ])
    expect(
      metrics.count('usage_events_total', {
        app: 'resident',
        audience: 'resident',
        event: 'screen_view',
        name: 'Main',
      }),
    ).toBe(1)
  })

  test('UA-03 a name outside the lists is dropped and counted; the batch still answers 204', async () => {
    const { useCase, repository, metrics } = build()
    await useCase.execute(
      batch([
        { event: 'screen_view', name: 'Main', ageMs: 1 },
        { event: 'screen_view', name: 'Nowhere', ageMs: 1 },
      ]),
    )
    expect(repository.batches[0]?.rows).toHaveLength(1)
    expect(metrics.count('usage_events_dropped_total', { reason: 'unknown_name' })).toBe(1)
  })

  test('a batch of only unknown names writes nothing', async () => {
    const { useCase, repository, metrics } = build()
    await useCase.execute(batch([{ event: 'screen_view', name: 'Nowhere', ageMs: 1 }]))
    expect(repository.batches).toEqual([])
    expect(metrics.count('usage_events_dropped_total', { reason: 'unknown_name' })).toBe(1)
  })

  test('UA-09 a demo building writes no row and counts the events as dropped', async () => {
    const { useCase, repository, metrics } = build({ demo: true })
    await useCase.execute(
      batch([
        { event: 'screen_view', name: 'Main', ageMs: 1 },
        { event: 'tap', name: 'Account.push', ageMs: 1 },
      ]),
    )
    expect(repository.batches).toEqual([])
    expect(metrics.count('usage_events_dropped_total', { reason: 'demo' })).toBe(2)
    expect(metrics.series().some((series) => series.startsWith('usage_events_total'))).toBe(false)
  })

  test('UA-10 while USAGE_ENABLED is off nothing is written and the answer tells the client to stop', async () => {
    const { useCase, repository, metrics } = build({ enabled: false })
    const result = await useCase.execute(batch([{ event: 'screen_view', name: 'Main', ageMs: 1 }]))
    expect(result).toEqual({ enabled: false })
    expect(repository.batches).toEqual([])
    expect(metrics.count('usage_events_dropped_total', { reason: 'disabled' })).toBe(1)
  })

  test('UA-32 an app_close without durationSec, and a tap with one, are refused before anything is spent or written', async () => {
    const { useCase, repository, limiter } = build()
    await expect(
      useCase.execute(batch([{ event: 'app_close', name: 'Background', ageMs: 0 }])),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      useCase.execute(batch([{ event: 'tap', name: 'Account.push', ageMs: 0, durationSec: 3 }])),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(repository.batches).toEqual([])
    expect(limiter.taken).toEqual([])
  })

  test('UA-11 the session bucket is keyed by the session id, never by an account, and a refusal writes nothing', async () => {
    const { useCase, repository, limiter } = build()
    await useCase.execute(batch([{ event: 'screen_view', name: 'Main', ageMs: 1 }]))
    expect(limiter.taken).toEqual([
      {
        key: `usage-events:session:${SESSION}`,
        scope: 'usage_events',
        capacity: 120,
        perSeconds: 3600,
      },
    ])
    limiter.refuse = 'usage-events:session:'
    await expect(
      useCase.execute(batch([{ event: 'screen_view', name: 'Main', ageMs: 1 }])),
    ).rejects.toBeInstanceOf(RateLimitedError)
    expect(repository.batches).toHaveLength(1)
  })

  test('UA-36 two closes of 61 s and 5 s are two observations; a dropped close adds none', async () => {
    const { useCase, metrics } = build()
    await useCase.execute(
      batch([
        { event: 'app_close', name: 'Background', ageMs: 100, durationSec: 61 },
        { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 5 },
      ]),
    )
    const labels = { app: 'resident', audience: 'resident' }
    expect(metrics.observations('usage_foreground_seconds', labels)).toEqual([61, 5])
    await useCase.execute(
      batch([{ event: 'app_close', name: 'Nowhere', ageMs: 0, durationSec: 900 }]),
    )
    expect(metrics.observations('usage_foreground_seconds', labels)).toEqual([61, 5])
  })
})

describe('UsageRateLimits', () => {
  test('UA-11 the IP bucket is 30 a minute and holds the address, not an account', async () => {
    const limiter = new Limiter()
    await new UsageRateLimits(limiter, {
      eventsPerMinutePerIp: 30,
      eventsPerHourPerSession: 120,
    }).takeIp('203.0.113.7')
    expect(limiter.taken).toEqual([
      { key: 'usage-events:ip:203.0.113.7', scope: 'usage_events', capacity: 30, perSeconds: 60 },
    ])
  })
})
