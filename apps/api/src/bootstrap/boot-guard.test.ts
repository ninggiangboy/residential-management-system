import { describe, expect, test } from 'bun:test'
import { reportBootGuard, runBootGuard } from './boot-guard'

const DEMO = 'b-demo'
const REAL = 'b-real'

const deps = (flagged: string[], membership: Record<string, string[]>) => ({
  identity: { listDemoAccountIds: async () => flagged },
  accountBuildings: {
    buildingIdsOfAccounts: async (ids: readonly string[]) => [
      ...new Set(ids.flatMap((id) => membership[id] ?? [])),
    ],
  },
  building: { isDemo: async (id: string) => id === DEMO },
})

describe('runBootGuard, check 1 (DOC-36 §10.1, BD-30)', () => {
  test('a flagged account in the demo building passes', async () => {
    expect(await runBootGuard(deps(['a1'], { a1: [DEMO] }))).toEqual([])
  })

  test('a flagged account with a membership in a real building fails the check and names the building, not the account', async () => {
    expect(await runBootGuard(deps(['a1', 'a2'], { a1: [DEMO], a2: [DEMO, REAL] }))).toEqual([
      expect.objectContaining({ check: 1, ids: [REAL] }),
    ])
  })

  test('an account with no membership and no flagged account pass', async () => {
    expect(await runBootGuard(deps(['a1'], {}))).toEqual([])
    expect(await runBootGuard(deps([], {}))).toEqual([])
  })

  test('residency is asked in batches of 500 accounts', async () => {
    const asked: number[] = []
    const flagged = Array.from({ length: 1200 }, (_, i) => `a${i}`)
    await runBootGuard({
      ...deps(flagged, {}),
      accountBuildings: {
        buildingIdsOfAccounts: async (ids) => {
          asked.push(ids.length)
          return []
        },
      },
    })
    expect(asked).toEqual([500, 500, 200])
  })
})

describe('reportBootGuard', () => {
  const failure = [{ check: 1, message: 'm', ids: [REAL] }]
  const logger = () => {
    const lines: Array<{ level: string; fields: unknown }> = []
    return {
      lines,
      log: {
        error: (fields: unknown) => void lines.push({ level: 'error', fields }),
        warn: (fields: unknown) => void lines.push({ level: 'warn', fields }),
      },
    }
  }

  test.each(['production', 'staging'])('%s refuses to start and logs an error', (env) => {
    const { lines, log } = logger()
    expect(reportBootGuard(failure, env, log)).toBe(true)
    expect(lines).toEqual([
      { level: 'error', fields: { event: 'boot_guard_failed', check: 1, ids: [REAL] } },
    ])
  })

  test.each(['local', 'test'])('%s warns and starts', (env) => {
    const { lines, log } = logger()
    expect(reportBootGuard(failure, env, log)).toBe(false)
    expect(lines.map((line) => line.level)).toEqual(['warn'])
  })

  test('no failure starts, quietly, in every environment', () => {
    const { lines, log } = logger()
    expect(reportBootGuard([], 'production', log)).toBe(false)
    expect(lines).toEqual([])
  })
})
