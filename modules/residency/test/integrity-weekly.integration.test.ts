import { describe, expect, test } from 'bun:test'
import type { Database } from '@core/db'
import type { JobContext } from '@core/runtime'
import { FakeClock } from '@core/testing'
import { sql } from 'drizzle-orm'
import type { IntegrityReader } from '../src/domain/integrity-check'
import {
  type IntegrityBuildings,
  integrityWeeklyJob,
} from '../src/infrastructure/jobs/integrity-weekly'
import { DrizzleIntegrityReader } from '../src/infrastructure/persistence/drizzle-integrity-reader'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/**
 * `integrity_weekly` against a real PostgreSQL (DOC-38 §4.1, DR-321, DR-62, EXP-11 §3 K20/K21).
 * The rows of `residency` are read in one REPEATABLE READ READ ONLY transaction, and the
 * accounts are read after it through the harness stand-in. Each test makes its own harness, so a
 * dropped index or a changed account never leaks into another test. The `snapshot` of the minimal
 * `JobContext` is the one the job documents (DOC-38 §4, DR-62).
 */

const enabled = Boolean(process.env.RMS_POSTGRES_PASSWORD ?? process.env.TEST_ADMIN_DATABASE_URL)
const describeDb = enabled ? describe : describe.skip

interface LogLine {
  readonly level: 'info' | 'warn'
  readonly fields: Record<string, unknown>
}

/** A minimal `JobContext`: the snapshot is the documented one, and the logger keeps what it was told (DOC-38 §4, DR-62). */
function contextOn(database: Database): { context: JobContext; logs: LogLine[] } {
  const logs: LogLine[] = []
  const context = {
    clock: new FakeClock(new Date('2026-11-02T20:30:00Z')),
    signal: new AbortController().signal,
    logger: {
      info(fields: Record<string, unknown>) {
        logs.push({ level: 'info', fields })
      },
      warn(fields: Record<string, unknown>) {
        logs.push({ level: 'warn', fields })
      },
      error() {},
      debug() {},
    },
    manual: false,
    paused: () => false,
    buildings: async () => [],
    withLock: <T>(fn: () => Promise<T>) => fn(),
    snapshot: <T>(fn: () => Promise<T>) =>
      database.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
  } as unknown as JobContext
  return { context, logs }
}

/** Two real buildings: A carries the corruption under test, B is the control (RM-63). */
async function seedClean(h: Harness) {
  const unitA1 = await h.seedUnit(BUILDING)
  const unitA2 = await h.seedUnit(BUILDING)
  const unitB1 = await h.seedUnit(OTHER_BUILDING)
  const ownerA = await h.seedAccount('+84901000001', 'Chủ hộ A')
  const ownerA2 = await h.seedAccount('+84901000002', 'Chủ hộ A hai')
  const tenantA = await h.seedAccount('+84901000003', 'Thành viên A')
  const ownerB = await h.seedAccount('+84901000004', 'Chủ hộ B')
  const tenantB = await h.seedAccount('+84901000005', 'Thành viên B')
  await h.seedMembership({ unit: unitA1, accountId: ownerA, memberType: 'owner' })
  const tenantMember = await h.seedMembership({
    unit: unitA1,
    accountId: tenantA,
    memberType: 'tenant',
  })
  await h.seedMembership({ unit: unitA2, accountId: ownerA2, memberType: 'owner' })
  await h.seedMembership({ unit: unitB1, accountId: ownerB, memberType: 'owner' })
  await h.seedMembership({ unit: unitB1, accountId: tenantB, memberType: 'family' })
  return { unitA1, unitA2, tenantA, tenantMember }
}

/** Runs the job over `buildingIds` with the harness's reader and accounts, unless a stand-in is given (RM-69). */
async function runJob(
  h: Harness,
  buildingIds: readonly string[],
  reader: IntegrityReader = new DrizzleIntegrityReader(h.database),
) {
  const { context, logs } = contextOn(h.database)
  const job = integrityWeeklyJob(
    reader,
    { liveBuildingIds: async () => buildingIds },
    h.identity,
    720,
  )
  return { result: await job.run(context), logs }
}

const warns = (logs: readonly LogLine[]) => logs.filter((line) => line.level === 'warn')

describeDb('integrity_weekly (DOC-38 §4.1, DR-321, EXP-11 §3 K20/K21)', () => {
  test('RM-63 clean data: no finding and no warning in either building', async () => {
    const h = await createHarness()
    try {
      await seedClean(h)
      const { result, logs } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({ findings: 0, buildings: 2, perKind: {} })
      expect(warns(logs)).toEqual([])
    } finally {
      await h.close()
    }
  })

  test('RM-64 K20: a second active owner is one membership_two_owners, in its building only', async () => {
    const h = await createHarness()
    try {
      const seeded = await seedClean(h)
      // The partial unique index is the guard (EXP-11 §3 K20); this own database drops it.
      await h.admin.unsafe('DROP INDEX residency.membership_one_owner_per_unit')
      const extra = await h.seedAccount('+84901000006', 'Chủ hộ A ba')
      await h.seedMembership({ unit: seeded.unitA1, accountId: extra, memberType: 'owner' })
      const { result, logs } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({ findings: 1, perKind: { membership_two_owners: 1 } })
      const found = warns(logs)
      expect(found).toHaveLength(1)
      expect(found[0]?.fields).toMatchObject({
        buildingId: BUILDING,
        kind: 'membership_two_owners',
        rows: 1,
        ids: [seeded.unitA1.id],
      })
      expect(found.map((line) => line.fields.buildingId)).toEqual([BUILDING])
    } finally {
      await h.close()
    }
  })

  test('RM-65 K21: an active membership of a deleted account is one member_of_removed_account', async () => {
    const h = await createHarness()
    try {
      const seeded = await seedClean(h)
      // EXP-11 §3 K21 says `removed`; identity only has `deleted` (DR-321). The phone takes the
      // `deleted:<uuid>` form the CHECK constraints force.
      await h.admin`
        UPDATE identity.resident_account
           SET status = 'deleted', deleted_at = now(), phone = 'deleted:' || id::text
         WHERE id = ${seeded.tenantA}::uuid`
      const { result, logs } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({
        findings: 1,
        perKind: { member_of_removed_account: 1 },
      })
      const found = warns(logs)
      expect(found).toHaveLength(1)
      expect(found[0]?.fields).toMatchObject({
        buildingId: BUILDING,
        kind: 'member_of_removed_account',
        rows: 1,
        ids: [seeded.tenantMember.id],
      })
      expect(found.map((line) => line.fields.buildingId)).toEqual([BUILDING])
    } finally {
      await h.close()
    }
  })

  test('RM-66 a membership whose account does not exist is one dangling_reference', async () => {
    const h = await createHarness()
    try {
      const seeded = await seedClean(h)
      const orphan = await h.seedMembership({
        unit: seeded.unitA2,
        accountId: crypto.randomUUID(),
        memberType: 'family',
      })
      const { result, logs } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({ findings: 1, perKind: { dangling_reference: 1 } })
      expect(warns(logs)[0]?.fields).toMatchObject({
        buildingId: BUILDING,
        kind: 'dangling_reference',
        rows: 1,
        ids: [orphan.id],
      })
    } finally {
      await h.close()
    }
  })

  test('RM-67 a deletion_requested account and a removed membership are not findings', async () => {
    const h = await createHarness()
    try {
      const seeded = await seedClean(h)
      const asking = await h.seedAccount('+84901000007', 'Người xin xoá')
      await h.admin`
        UPDATE identity.resident_account
           SET status = 'deletion_requested', deletion_requested_at = now()
         WHERE id = ${asking}::uuid`
      await h.seedMembership({ unit: seeded.unitA2, accountId: asking, memberType: 'family' })
      const gone = await h.seedAccount('+84901000008', 'Đã xoá')
      await h.admin`
        UPDATE identity.resident_account
           SET status = 'deleted', deleted_at = now(), phone = 'deleted:' || id::text
         WHERE id = ${gone}::uuid`
      await h.seedMembership({
        unit: seeded.unitA2,
        accountId: gone,
        memberType: 'family',
        status: 'removed',
      })
      const { result, logs } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({ findings: 0, perKind: {} })
      expect(warns(logs)).toEqual([])
    } finally {
      await h.close()
    }
  })

  test('RM-68 the job repairs nothing: the membership digest is equal before and after', async () => {
    const h = await createHarness()
    try {
      const seeded = await seedClean(h)
      await h.admin.unsafe('DROP INDEX residency.membership_one_owner_per_unit')
      const extra = await h.seedAccount('+84901000009', 'Chủ hộ A bốn')
      await h.seedMembership({ unit: seeded.unitA1, accountId: extra, memberType: 'owner' })
      const digest = async () => {
        const rows = (await h.database.executor.execute(sql`
          SELECT count(*)::int AS n, md5(string_agg(x.t, '|' ORDER BY x.t)) AS d
            FROM (SELECT id::text || ':' || account_id::text || ':' || unit_id::text || ':' || status
                       || ':' || member_type || ':' || credential_version::text AS t
                    FROM residency.membership) AS x`)) as unknown as Array<{ n: number; d: string }>
        return rows[0]
      }
      const before = await digest()
      const { result } = await runJob(h, [BUILDING, OTHER_BUILDING])
      expect(result.details).toMatchObject({ findings: 1 })
      expect(await digest()).toEqual(before)
    } finally {
      await h.close()
    }
  })

  test('RM-69 skips demo buildings: only the ids of IntegrityBuildings are read (DOC-40 §4)', async () => {
    const h = await createHarness()
    try {
      const read: string[] = []
      const reader: IntegrityReader = {
        async checkMemberships(buildingId) {
          read.push(buildingId)
          return []
        },
        async liveMembershipAccounts(buildingId) {
          read.push(buildingId)
          return []
        },
      }
      const buildings: IntegrityBuildings = { liveBuildingIds: async () => [BUILDING] }
      const { context } = contextOn(h.database)
      const job = integrityWeeklyJob(
        reader,
        buildings,
        { getResidentAccounts: async () => [] },
        720,
      )
      const result = await job.run(context)
      expect(result.details).toMatchObject({ buildings: 1 })
      expect([...new Set(read)]).toEqual([BUILDING])
    } finally {
      await h.close()
    }
  })

  test('RM-70 the definition is integrity_weekly, Monday 03:30, mode snapshot', () => {
    const job = integrityWeeklyJob(
      { checkMemberships: async () => [], liveMembershipAccounts: async () => [] },
      { liveBuildingIds: async () => [] },
      { getResidentAccounts: async () => [] },
      720,
    )
    expect(job.name).toBe('integrity_weekly')
    expect(job.schedule).toEqual({ kind: 'weekly', day: 'mon', at: '03:30' })
    expect(job.mode).toBe('snapshot')
  })
})
