import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ForbiddenError, InvariantError, RateLimitedError } from '@core/kernel'
import type { DemoCounts, DemoResettable } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import { DemoResetRefusedError, DemoResetRunningError } from '../src/domain/errors'
import { BUILDING, createHarness, DEMO_BUILDING, demoPlanOf, type Harness } from './support'

const SETTING = sql`select current_setting('rms.demo_reset', true) as v`

let h: Harness
beforeAll(async () => {
  // A cache of 0 seconds: the job lists the buildings it has just been given.
  h = await createHarness({ settingsCacheSeconds: 0, demoPassword: 'demo-password-1' })
})
afterAll(async () => {
  await h.close()
})

/** A module that records what the reset asked of it, in order. */
function recorder(
  module: string,
  calls: string[],
  options: { failSeed?: boolean } = {},
): DemoResettable {
  return {
    module,
    async resetDemo(buildingId): Promise<DemoCounts> {
      calls.push(`reset:${module}:${buildingId}`)
      return { [`${module}.rows`]: 1 }
    },
    async seedDemo(buildingId): Promise<DemoCounts> {
      calls.push(`seed:${module}:${buildingId}`)
      if (options.failSeed) throw new Error(`${module} cannot seed`)
      return { [`${module}.rows`]: 2 }
    },
  }
}

const count = async (table: string, where = 'true') =>
  Number((await h.db.sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n)
const auditCount = () => count('audit.audit_log')

/** Puts the demo building in its seeded state and empties the recorders. */
async function freshDemo() {
  h.demoModules.length = 0
  await h.building.demo.ensureBuilding.execute(demoPlanOf(DEMO_BUILDING).building)
  await h.building.demo.reset.run(DEMO_BUILDING)
}

describe('demo reset (DOC-36 §10)', () => {
  test('BD-37 assertDemo refuses a real building and an unknown id, and accepts the demo building', async () => {
    await expect(h.building.api.assertDemo(BUILDING)).rejects.toBeInstanceOf(DemoResetRefusedError)
    await expect(h.building.api.assertDemo(crypto.randomUUID())).rejects.toBeInstanceOf(
      DemoResetRefusedError,
    )
    await h.building.api.assertDemo(DEMO_BUILDING)
  })

  test('BD-37 the answer to a refusal is a 404 not_found that does not say which case it was', async () => {
    const error = await h.building.api.assertDemo(BUILDING).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'not_found', kind: 'not_found' })
  })

  test('BD-37 assertDemo reads the row, never the cache: a flag cleared a moment ago refuses at once', async () => {
    const cached = await createHarness({ settingsCacheSeconds: 3600 })
    try {
      expect(await cached.building.api.isDemo(DEMO_BUILDING)).toBe(true)
      await cached.admin.unsafe(
        `UPDATE building.building SET is_demo = false WHERE id = '${DEMO_BUILDING}'`,
      )
      expect(await cached.building.api.isDemo(DEMO_BUILDING)).toBe(true)
      await expect(cached.building.api.assertDemo(DEMO_BUILDING)).rejects.toBeInstanceOf(
        DemoResetRefusedError,
      )
    } finally {
      await cached.close()
    }
  })

  test('BD-37 the reset and the seed of building itself refuse a real building and change nothing', async () => {
    const before = await count('building.building_setting')
    const { resettable } = h.building.demo
    await expect(resettable.resetDemo(BUILDING)).rejects.toBeInstanceOf(DemoResetRefusedError)
    await expect(resettable.resetDemo(crypto.randomUUID())).rejects.toBeInstanceOf(
      DemoResetRefusedError,
    )
    await expect(
      resettable.seedDemo(BUILDING, {
        today: '2026-10-20' as never,
        plan: demoPlanOf(BUILDING),
        password: 'x',
      }),
    ).rejects.toBeInstanceOf(DemoResetRefusedError)
    expect(await count('building.building_setting')).toBe(before)
    await expect(h.building.demo.reset.run(BUILDING)).rejects.toBeInstanceOf(DemoResetRefusedError)
  })

  test('the building row is created once, and a row of that id that is not a demo building is never flagged', async () => {
    const plan = demoPlanOf(DEMO_BUILDING)
    expect(await h.building.demo.ensureBuilding.execute(plan.building)).toBe(false)
    const fresh = demoPlanOf(crypto.randomUUID()).building
    expect(await h.building.demo.ensureBuilding.execute({ ...fresh, code: 'DEMO-B' })).toBe(true)
    expect(await h.building.demo.ensureBuilding.execute({ ...fresh, code: 'DEMO-B' })).toBe(false)
    await expect(
      h.building.demo.ensureBuilding.execute({ ...plan.building, id: BUILDING }),
    ).rejects.toBeInstanceOf(DemoResetRefusedError)
    expect(await count('building.building', `id = '${BUILDING}' AND NOT is_demo`)).toBe(1)
  })

  test('BD-38 a reset puts the seed back with the same ids and keeps the terms and the audit log', async () => {
    await freshDemo()
    const termsBefore = await h.db
      .sql`SELECT id, kind, version FROM building.terms_version WHERE building_id = ${DEMO_BUILDING} ORDER BY kind`
    const gatewayBefore = await h.db
      .sql`SELECT id FROM building.gateway_config WHERE building_id = ${DEMO_BUILDING}`
    // What a demo session leaves behind: a changed setting, a stored acceptance, a file.
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{"defaultDueDays": 3}' WHERE building_id = '${DEMO_BUILDING}'`,
    )
    await h.admin.unsafe(
      `UPDATE building.building SET hotline = '000', logo_file = NULL WHERE id = '${DEMO_BUILDING}'`,
    )
    await h.admin.unsafe(
      `INSERT INTO building.terms_acceptance (building_id, account_id, version_id)
       SELECT building_id, gen_random_uuid(), id FROM building.terms_version WHERE building_id = '${DEMO_BUILDING}'`,
    )
    const ticket = await h.building.files.register(h.resident(crypto.randomUUID(), DEMO_BUILDING), {
      module: 'identity',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: 1000,
    })
    const audits = await auditCount()
    const versionBefore = Number(
      (await h.db.sql`SELECT version FROM building.building WHERE id = ${DEMO_BUILDING}`)[0]
        ?.version,
    )

    const result = await h.building.demo.reset.run(DEMO_BUILDING)

    expect(result.deleted).toMatchObject({
      'building.file_object': 1,
      'building.terms_acceptance': 2,
      'building.gateway_config': 1,
      'building.building_setting': 1,
    })
    expect(result.created).toMatchObject({
      'building.gateway_config': 1,
      'building.terms_version': 0,
    })
    expect(
      await h.db
        .sql`SELECT id, kind, version FROM building.terms_version WHERE building_id = ${DEMO_BUILDING} ORDER BY kind`,
    ).toEqual(termsBefore)
    expect(
      await h.db.sql`SELECT id FROM building.gateway_config WHERE building_id = ${DEMO_BUILDING}`,
    ).toEqual(gatewayBefore)
    expect(
      (
        await h.db
          .sql`SELECT data FROM building.building_setting WHERE building_id = ${DEMO_BUILDING}`
      )[0]?.data,
    ).toEqual({})
    expect(await count('building.terms_acceptance', `building_id = '${DEMO_BUILDING}'`)).toBe(0)
    const building = (
      await h.db.sql`SELECT hotline, version FROM building.building WHERE id = ${DEMO_BUILDING}`
    )[0]
    expect(building?.hotline).toBe('1900 0000')
    expect(Number(building?.version)).toBeGreaterThan(versionBefore)
    // The file is gone with one delete command (DR-122); the audit log is not touched (DR-60).
    expect((await h.fileRow(ticket.fileId))?.status).toBe('deleted')
    expect(
      (await h.commands('building.file_delete_requested.v1')).filter(
        (c) => c.payload.fileId === ticket.fileId,
      ),
    ).toHaveLength(1)
    expect(await auditCount()).toBe(audits)
  })

  test('the gateway of the seed is the fake driver and its blob opens with the ring', async () => {
    await freshDemo()
    const config = await h.building.api.getGatewayConfig(DEMO_BUILDING, 'payos')
    expect(config).toMatchObject({
      driver: 'fake',
      status: 'active',
      secrets: {},
      receivingAccount: { bankBin: '970436', accountNumber: '0000000000' },
    })
  })

  test('the modules are reset in reverse dependency order and seeded in forward order, with the lock setting open for the demo only', async () => {
    await freshDemo()
    const calls: string[] = []
    // Pushed in the wrong order on purpose.
    h.demoModules.push(recorder('residency', calls), recorder('identity', calls))
    const seen: string[] = []
    h.demoModules.push({
      module: 'finance',
      async resetDemo() {
        seen.push(String((await h.execute(SETTING))[0]?.v))
        return {}
      },
      async seedDemo() {
        return {}
      },
    })
    const result = await h.building.demo.reset.run(DEMO_BUILDING)
    expect(calls).toEqual([
      `reset:residency:${DEMO_BUILDING}`,
      `reset:identity:${DEMO_BUILDING}`,
      `seed:identity:${DEMO_BUILDING}`,
      `seed:residency:${DEMO_BUILDING}`,
    ])
    expect(seen).toEqual([DEMO_BUILDING])
    expect(result.deleted).toMatchObject({ 'residency.rows': 1, 'identity.rows': 1 })
    expect(result.created).toMatchObject({ 'residency.rows': 2, 'identity.rows': 2 })
    // The setting is local to the transaction.
    expect(String((await h.execute(SETTING))[0]?.v ?? '')).toBe('')
  })

  test('a module with no place in the order is a programming error and the reset does nothing', async () => {
    await freshDemo()
    h.demoModules.push(recorder('mystery', []))
    await expect(h.building.demo.reset.run(DEMO_BUILDING)).rejects.toBeInstanceOf(InvariantError)
    h.demoModules.length = 0
  })

  test('BD-39 a seed that fails rolls the whole reset back: the old demo is intact', async () => {
    await freshDemo()
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{"defaultDueDays": 3}' WHERE building_id = '${DEMO_BUILDING}'`,
    )
    const calls: string[] = []
    h.demoModules.push(recorder('identity', calls), recorder('finance', calls, { failSeed: true }))
    await expect(h.building.demo.reset.run(DEMO_BUILDING)).rejects.toThrow('finance cannot seed')
    expect(calls).toContain(`seed:finance:${DEMO_BUILDING}`)
    expect(
      (
        await h.db
          .sql`SELECT data FROM building.building_setting WHERE building_id = ${DEMO_BUILDING}`
      )[0]?.data,
    ).toEqual({ defaultDueDays: 3 })
    expect(await count('building.gateway_config', `building_id = '${DEMO_BUILDING}'`)).toBe(1)
    h.demoModules.length = 0
  })

  test('BD-41 a reset that finds the lock held answers demo_reset_running and changes nothing', async () => {
    await freshDemo()
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{"defaultDueDays": 3}' WHERE building_id = '${DEMO_BUILDING}'`,
    )
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked: () => void = () => {}
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holder = h.admin.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('job:demo_reset'))`
      locked()
      await held
    })
    await lockTaken
    try {
      const error = await h.building.demo.reset
        .run(DEMO_BUILDING)
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(DemoResetRunningError)
      expect(error).toMatchObject({ code: 'demo_reset_running' })
    } finally {
      release()
      await holder
    }
    expect(
      (
        await h.db
          .sql`SELECT data FROM building.building_setting WHERE building_id = ${DEMO_BUILDING}`
      )[0]?.data,
    ).toEqual({ defaultDueDays: 3 })
  })

  test('a reset with no DEMO_STAFF_PASSWORD fails before it deletes anything', async () => {
    const bare = await createHarness({ settingsCacheSeconds: 0 })
    try {
      await bare.building.demo.ensureBuilding.execute(demoPlanOf(DEMO_BUILDING).building)
      await bare.admin.unsafe(
        `UPDATE building.building_setting SET data = '{"defaultDueDays": 3}' WHERE building_id = '${DEMO_BUILDING}'`,
      )
      await expect(bare.building.demo.reset.run(DEMO_BUILDING)).rejects.toBeInstanceOf(
        InvariantError,
      )
      expect(
        (
          await bare.db
            .sql`SELECT data FROM building.building_setting WHERE building_id = ${DEMO_BUILDING}`
        )[0]?.data,
      ).toEqual({ defaultDueDays: 3 })
    } finally {
      await bare.close()
    }
  })

  test('a plan for another building is never used on this one', async () => {
    await freshDemo()
    const other = await h.db.sql`SELECT id FROM building.building WHERE code = 'DEMO-B'`
    expect(other).toHaveLength(1)
    await expect(h.building.demo.reset.run(String(other[0]?.id))).rejects.toBeInstanceOf(
      DemoResetRefusedError,
    )
  })

  test('the duration of a reset is observed in seconds (demo_reset_duration_seconds)', async () => {
    await freshDemo()
    const before = h.observed.length
    await h.building.demo.reset.run(DEMO_BUILDING)
    expect(h.observed.slice(before)).toEqual([
      { name: 'demo_reset_duration_seconds', seconds: expect.any(Number) },
    ])
  })
})

describe('POST /staff/demo/reset as a use case (E-56, DOC-36 §10.4)', () => {
  test('BD-42 the Admin of a real building gets a 404 before the limit and without a trace', async () => {
    const audits = await auditCount()
    const error = await h.building.useCases.resetDemo
      .execute(h.staff('admin', BUILDING))
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DemoResetRefusedError)
    expect(await auditCount()).toBe(audits)
    expect(await count('platform.rate_bucket', `key = 'demo-reset:building:${BUILDING}'`)).toBe(0)
  })

  test('only the Admin may call it', async () => {
    for (const role of ['manager', 'technician', 'guard'] as const)
      await expect(
        h.building.useCases.resetDemo.execute(h.staff(role, DEMO_BUILDING)),
      ).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('the Admin of the demo building resets it, one audit row records it, and a second press within a minute is limited', async () => {
    await freshDemo()
    await h.admin.unsafe(`DELETE FROM platform.rate_bucket WHERE key LIKE 'demo-reset:%'`)
    const audits = await auditCount()
    const admin = h.staff('admin', DEMO_BUILDING)
    const result = await h.building.useCases.resetDemo.execute(admin)
    expect(result).toMatchObject({
      durationMs: expect.any(Number),
      deleted: expect.any(Object),
      created: expect.any(Object),
    })
    expect(Object.keys(result)).toEqual(['durationMs', 'deleted', 'created'])
    const rows = await h.db
      .sql`SELECT object_id, details, actor_id FROM audit.audit_log WHERE action = 'building.demo.reset'`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ object_id: DEMO_BUILDING, actor_id: admin.staffId })
    expect(rows[0]?.details).toMatchObject({ durationMs: result.durationMs, units: 0 })
    expect(await auditCount()).toBe(audits + 1)
    await expect(h.building.useCases.resetDemo.execute(admin)).rejects.toBeInstanceOf(
      RateLimitedError,
    )
    expect(await auditCount()).toBe(audits + 1)
  })

  test('a reset that fails leaves no audit row', async () => {
    await freshDemo()
    await h.admin.unsafe(`DELETE FROM platform.rate_bucket WHERE key LIKE 'demo-reset:%'`)
    const audits = await auditCount()
    h.demoModules.push(recorder('finance', [], { failSeed: true }))
    await expect(
      h.building.useCases.resetDemo.execute(h.staff('admin', DEMO_BUILDING)),
    ).rejects.toThrow('finance cannot seed')
    expect(await auditCount()).toBe(audits)
    h.demoModules.length = 0
  })
})

describe('the nightly job demo_reset (DOC-36 §10.3)', () => {
  test('BD-43 resets the demo buildings and only them', async () => {
    await freshDemo()
    const calls: string[] = []
    h.demoModules.push(recorder('identity', calls))
    // A second demo building is refused by the plan check; take it out of the way for this test.
    await h.admin.unsafe(`UPDATE building.building SET is_demo = false WHERE code = 'DEMO-B'`)
    const result = await h.runJob('demo_reset')
    expect(result).toEqual({ did: 1, details: { buildings: 1 } })
    expect(calls).toEqual([`reset:identity:${DEMO_BUILDING}`, `seed:identity:${DEMO_BUILDING}`])
    expect(calls.join()).not.toContain(BUILDING)
  })

  test('is a daily 04:00 job in lock mode with the grace window of its key', () => {
    const job = h.building.jobs?.find((candidate) => candidate.name === 'demo_reset')
    expect(job).toMatchObject({
      schedule: { kind: 'daily', at: '04:00' },
      mode: 'lock',
      graceMinutes: 120,
    })
  })

  test('writes no audit row', async () => {
    await freshDemo()
    const audits = await auditCount()
    await h.runJob('demo_reset')
    expect(await auditCount()).toBe(audits)
  })
})
