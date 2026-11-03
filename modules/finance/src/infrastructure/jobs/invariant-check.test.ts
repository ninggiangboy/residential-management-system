import { describe, expect, test } from 'bun:test'
import type { JobContext } from '@core/runtime'
import { FakeClock } from '@core/testing'
import type { InvariantFinding, InvariantReader } from '../../domain/invariant-check'
import { invariantCheckJob } from './invariant-check'

const lines: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = []
const logger = {
  info: (fields: Record<string, unknown>, msg: string) =>
    lines.push({ level: 'info', fields, msg }),
  warn: (fields: Record<string, unknown>, msg: string) =>
    lines.push({ level: 'warn', fields, msg }),
  error() {},
  debug() {},
} as unknown as JobContext['logger']

const context = (signal = new AbortController().signal): JobContext => ({
  clock: new FakeClock(new Date('2026-11-03T20:00:00Z')),
  signal,
  logger,
  manual: false,
  paused: () => false,
  buildings: async () => [],
  withLock: <T>(fn: () => Promise<T>) => fn(),
  snapshot: <T>(fn: () => Promise<T>) => fn(),
})

const readerOf = (byBuilding: Record<string, readonly InvariantFinding[]>): InvariantReader => ({
  check: async (buildingId) => byBuilding[buildingId] ?? [],
})
const live = (...ids: string[]) => ({ liveBuildingIds: async () => ids })

describe('P2-11: invariant_check (DOC-22 §12, LG-56)', () => {
  test('is a daily 03:00 snapshot job named as the catalog says', () => {
    const job = invariantCheckJob(readerOf({}), live(), 720)
    expect([job.name, job.schedule, job.mode, job.graceMinutes]).toEqual([
      'invariant_check',
      { kind: 'daily', at: '03:00' },
      'snapshot',
      720,
    ])
  })

  test('a clean night: 0 violations, the job succeeds', async () => {
    lines.length = 0
    const result = await invariantCheckJob(readerOf({}), live('b1', 'b2'), 720).run(context())
    expect(result.details).toMatchObject({ queries: 19, violations: 0, buildings: 2 })
    expect(lines.map((line) => line.msg)).toEqual(['invariant_check.done'])
  })

  test('rows are summed over the buildings, logged per query, and nothing is repaired', async () => {
    lines.length = 0
    const reader = readerOf({
      b1: [{ tag: 'Q08', rows: 2, sampleIds: ['p1', 'p2'] }],
      b2: [
        { tag: 'Q08', rows: 1, sampleIds: ['p3'] },
        { tag: 'Q16', rows: 1, sampleIds: [null] },
      ],
    })
    const result = await invariantCheckJob(reader, live('b1', 'b2'), 720).run(context())
    expect(result.details).toMatchObject({ violations: 4, perQuery: { Q08: 3, Q16: 1 } })
    const warned = lines.filter((line) => line.msg === 'invariant_check.violation')
    expect(warned.map((line) => [line.fields.buildingId, line.fields.query])).toEqual([
      ['b1', 'Q08'],
      ['b2', 'Q08'],
      ['b2', 'Q16'],
    ])
  })

  test('a run that is aborted throws instead of reporting a smaller number', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      invariantCheckJob(readerOf({}), live('b1'), 720).run(context(controller.signal)),
    ).rejects.toThrow('stopped')
  })
})
