import { describe, expect, test } from 'bun:test'
import { type BootGuardDeps, reportBootGuard, runBootGuard } from './boot-guard'

const DEMO = 'b-demo'
const REAL = 'b-real'

const deps = (flagged: string[], membership: Record<string, string[]>): BootGuardDeps => ({
  identity: { listDemoAccountIds: async () => flagged },
  accountBuildings: {
    buildingIdsOfAccounts: async (ids: readonly string[]) => [
      ...new Set(ids.flatMap((id) => membership[id] ?? [])),
    ],
  },
  building: {
    isDemo: async (id: string) => id === DEMO,
    listBuildings: async () => [building(DEMO, true), building(REAL, false)],
    fakeGatewaysOutsideDemo: async () => [],
    gatewayKeyIds: async () => [],
  },
  piiKeyIds: async () => [],
  rings: { settings: ['k1'], pii: ['k1'] },
  standIns: [],
})

const building = (buildingId: string, isDemo: boolean) => ({
  buildingId,
  code: buildingId,
  name: { vi: buildingId },
  timeZone: 'Asia/Ho_Chi_Minh',
  isDemo,
  contact: { hotline: null, workingHours: null, email: null },
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

  test('the logger is called as a method: a logger that reads `this`, as pino does, works', () => {
    class ThisLogger {
      readonly seen: string[] = []
      error(_fields: unknown, message: string) {
        this.seen.push(`error ${message}`)
      }
      warn(_fields: unknown, message: string) {
        this.seen.push(`warn ${message}`)
      }
    }
    const strict = new ThisLogger()
    expect(reportBootGuard(failure, 'production', strict)).toBe(true)
    const lax = new ThisLogger()
    expect(reportBootGuard(failure, 'local', lax)).toBe(false)
    expect(strict.seen).toEqual(['error boot_guard_failed: m'])
    expect(lax.seen).toEqual(['warn boot_guard_failed: m'])
  })

  test('no failure starts, quietly, in every environment', () => {
    const { lines, log } = logger()
    expect(reportBootGuard([], 'production', log)).toBe(false)
    expect(lines).toEqual([])
  })
})

describe('runBootGuard, checks 2, 3, 5 and 6 (DOC-36 §10.1)', () => {
  const withBuilding = (override: Partial<BootGuardDeps['building']>): BootGuardDeps => {
    const base = deps([], {})
    return { ...base, building: { ...base.building, ...override } }
  }

  test('BD-28: a fake gateway on a building that is not a demo building fails check 2 and names the row', async () => {
    const failures = await runBootGuard(
      withBuilding({ fakeGatewaysOutsideDemo: async () => ['g1'] }),
    )
    expect(failures).toEqual([expect.objectContaining({ check: 2, ids: ['g1'] })])
  })

  test('check 3 counts the buildings that are not demo buildings, and the demo building is not one', async () => {
    expect(await runBootGuard(deps([], {}))).toEqual([])
    const failures = await runBootGuard(
      withBuilding({
        listBuildings: async () => [
          building(DEMO, true),
          building('r1', false),
          building('r2', false),
        ],
      }),
    )
    expect(failures).toEqual([expect.objectContaining({ check: 3, ids: ['r1', 'r2'] })])
  })

  test('check 5 names the ports bound to a stand-in', async () => {
    const failures = await runBootGuard({ ...deps([], {}), standIns: ['ActiveIntentProbe'] })
    expect(failures).toEqual([expect.objectContaining({ check: 5, ids: ['ActiveIntentProbe'] })])
  })

  test('BD-29: check 6 names the key that a sealed secret needs and the ring lacks', async () => {
    const failures = await runBootGuard({
      ...withBuilding({ gatewayKeyIds: async () => ['k1', 'k2'] }),
      piiKeyIds: async () => ['k3'],
      rings: { settings: ['k2'], pii: ['k3'] },
    })
    expect(failures).toEqual([expect.objectContaining({ check: 6, ids: ['settings:k1'] })])
  })

  test('check 6 skips a ring the process does not hold', async () => {
    const failures = await runBootGuard({
      ...deps([], {}),
      piiKeyIds: async () => ['k9'],
      rings: { settings: ['k1'], pii: null },
    })
    expect(failures).toEqual([])
  })
})

describe('reportBootGuard, by check', () => {
  const log = { error() {}, warn() {} }
  const failure = (check: number) => [{ check, message: 'm', ids: ['x'] }]

  test('check 3 only warns, in every environment', () => {
    for (const env of ['production', 'staging', 'local', 'test'])
      expect(reportBootGuard(failure(3), env, log)).toBe(false)
  })

  test('check 6 refuses in every environment', () => {
    for (const env of ['production', 'staging', 'local', 'test'])
      expect(reportBootGuard(failure(6), env, log)).toBe(true)
  })

  test.each([2, 5])('check %i refuses in production and staging and warns elsewhere', (check) => {
    expect(reportBootGuard(failure(check), 'production', log)).toBe(true)
    expect(reportBootGuard(failure(check), 'staging', log)).toBe(true)
    expect(reportBootGuard(failure(check), 'local', log)).toBe(false)
  })
})
