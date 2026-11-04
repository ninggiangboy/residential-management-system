import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import type { BuildingId, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq } from 'drizzle-orm'
import { FeeBatchQueries } from '../src/application/queries/fee-batch-queries'
import type { FeeBatchListCursor } from '../src/domain/fee-batch-reader'
import { DrizzleFeeBatchRepository } from '../src/infrastructure/persistence/drizzle-fee-batch-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  importJob,
} from '../src/infrastructure/persistence/schema'

/**
 * The staff batch reads of P2-15 (E-89, E-91, E-93; DOC-66 §5, DR-324) on a clone of the migrated template: the Drizzle reader
 * behind `FeeBatchQueries`, a fake owner-name port and rows seeded as `rms_app` through the real guard triggers.
 */

const AT = new Date('2026-10-19T03:00:00Z')
const ids = new UuidV7Generator()
let db: TestDb
let database: Database
let queries: FeeBatchQueries

/** The owner name behind a unit id, read by the fake owner port (DOC-34 §6.1, DR-292). */
const owners = new Map<string, string>()

/** The creator of every seeded batch and the fake staff port's answer (E-89, E-91; DOC-66 §5, DOC-07 §11A). */
const CREATOR = ids.next()
const CREATOR_NAME = 'Lê Văn Quản'
const staff = new Map<string, string>([[CREATOR, CREATOR_NAME]])

const BUILDING_A = ids.next()
const BUILDING_B = ids.next()

const staffOf = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

/** The code of a refused call: the `DomainError` code, or `ok`. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    return error.code
  }
}

interface Unit {
  readonly unitId: string
  readonly code: string
}

function unit(code: string, owner: string): Unit {
  const unitId = ids.next()
  owners.set(unitId, owner)
  return { unitId, code }
}

interface BatchSeed {
  readonly id: string
  readonly code: string
  readonly name: { vi: string; en?: string }
  readonly feeMonth: string
  readonly status: 'draft' | 'published' | 'closed' | 'recalled'
  readonly replacesBatchId?: string
}

async function insertBatch(buildingId: string, seed: BatchSeed): Promise<string> {
  const published = seed.status !== 'draft'
  await database.executor.insert(feeBatch).values({
    id: seed.id,
    buildingId,
    code: seed.code,
    name: seed.name,
    feeMonth: seed.feeMonth,
    dueDate: '2026-10-15',
    status: seed.status,
    createdBy: CREATOR,
    replacesBatchId: seed.replacesBatchId ?? null,
    publishedAt: published ? AT : null,
    publishedBy: published ? ids.next() : null,
    recalledAt: seed.status === 'recalled' ? AT : null,
    recalledBy: seed.status === 'recalled' ? ids.next() : null,
    closedAt: seed.status === 'closed' ? AT : null,
    closedBy: seed.status === 'closed' ? ids.next() : null,
    version: 1,
  })
  return seed.id
}

interface ChargeSeed {
  readonly unit: Unit
  readonly amount: number
  readonly status: 'draft' | 'open' | 'paid' | 'void'
  readonly voidKind?: 'recall' | 'single'
  readonly lines?: ReadonlyArray<{ itemName: { vi: string; en?: string }; amount: number }>
}

async function insertCharge(
  buildingId: string,
  batchId: string,
  seed: ChargeSeed,
): Promise<string> {
  const chargeId = ids.next()
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId,
    batchId,
    unitId: seed.unit.unitId,
    unitCode: seed.unit.code,
    amount: seed.amount,
    status: 'draft',
    version: 1,
  })
  const lines = seed.lines ?? [
    { itemName: { vi: 'Phí quản lý', en: 'Management fee' }, amount: seed.amount },
  ]
  await database.executor.insert(chargeLine).values(
    lines.map((line, index) => ({
      id: ids.next(),
      buildingId,
      chargeId,
      position: index + 1,
      kind: 'fee' as const,
      itemName: line.itemName,
      quantity: '1',
      unitPrice: line.amount,
      amount: line.amount,
      note: null,
    })),
  )
  // The guard triggers only allow draft → open → paid | void (DOC-15 §11), so the target status is reached in order.
  if (seed.status !== 'draft') {
    await setChargeStatus(chargeId, { status: 'open' })
    if (seed.status === 'paid') await setChargeStatus(chargeId, { status: 'paid' })
    if (seed.status === 'void') {
      const voidKind = seed.voidKind ?? 'recall'
      await setChargeStatus(chargeId, {
        status: 'void',
        voidKind,
        voidReason: voidKind === 'single' ? 'Hủy khoản phí này' : null,
      })
    }
  }
  return chargeId
}

function setChargeStatus(
  chargeId: string,
  change: {
    status: string
    voidKind?: string
    voidReason?: string | null
  },
): Promise<unknown> {
  return database.executor
    .update(chargeTable)
    .set({
      status: change.status,
      voidKind: change.voidKind,
      voidReason: change.voidReason,
      voidedAt: change.status === 'void' ? AT : null,
      voidedBy: change.status === 'void' ? ids.next() : null,
    })
    .where(eq(chargeTable.id, chargeId))
}

/** A committed or still-validated fee import of a batch (the E-91 `source`). */
async function insertImport(
  buildingId: string,
  batchId: string,
  committedAt: Date | null,
): Promise<string> {
  const id = ids.next()
  await database.executor.insert(importJob).values({
    id,
    buildingId,
    kind: 'fee_batch',
    status: committedAt ? 'committed' : 'validated',
    fileKey: `fee/${id}.xlsx`,
    fileName: 'fees.xlsx',
    params: { batchId },
    result: {},
    createdBy: ids.next(),
    createdAt: committedAt ?? AT,
    expiresAt: new Date(AT.getTime() + 3_600_000),
    committedAt,
  })
  return id
}

const fixture = {
  a: {} as Record<string, string>,
  b: {} as Record<string, string>,
  units: {} as Record<string, Unit>,
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  queries = new FeeBatchQueries(
    new DrizzleFeeBatchRepository(database),
    {
      ownerNames: async (_buildingId, unitIds) =>
        new Map(unitIds.map((unitId) => [unitId, owners.get(unitId) ?? null])),
    },
    {
      names: async (staffIds) =>
        new Map(staffIds.map((staffId) => [staffId, staff.get(staffId) ?? null] as const)),
    },
  )

  fixture.units = {
    a1: unit('A-1001', 'Trần Minh Anh'),
    a2: unit('A-0901', 'Nguyễn Văn B'),
    a3: unit('A-0902', 'Lê Thị C'),
    a4: unit('A-0801', 'Phạm Văn D'),
    a5: unit('A-0701', 'Hoàng Thị E'),
    b1: unit('B-0101', 'Vũ Văn F'),
  }

  // Building A: four statuses across five fee months, so the keyset walk spans three pages at limit 2.
  const recalled = await insertBatch(BUILDING_A, {
    id: ids.next(),
    code: 'PH-2607-01',
    name: { vi: 'Phí tháng 7/2026', en: 'July 2026' },
    feeMonth: '2026-07-01',
    status: 'recalled',
  })
  const draft = await insertBatch(BUILDING_A, {
    id: ids.next(),
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026' },
    feeMonth: '2026-10-01',
    status: 'draft',
    replacesBatchId: recalled,
  })
  const published = await insertBatch(BUILDING_A, {
    id: ids.next(),
    code: 'PH-2609-01',
    name: { vi: 'Phí tháng 9/2026', en: 'September 2026' },
    feeMonth: '2026-09-01',
    status: 'published',
  })
  const closed = await insertBatch(BUILDING_A, {
    id: ids.next(),
    code: 'PH-2608-01',
    name: { vi: 'Phí tháng 8/2026', en: 'August 2026' },
    feeMonth: '2026-08-01',
    status: 'closed',
  })
  const emptyDraft = await insertBatch(BUILDING_A, {
    id: ids.next(),
    code: 'PH-2606-01',
    name: { vi: 'Phí tháng 6/2026' },
    feeMonth: '2026-06-01',
    status: 'draft',
  })
  fixture.a = { recalled, draft, published, closed, emptyDraft }

  await insertCharge(BUILDING_A, recalled, {
    unit: fixture.units.a5!,
    amount: 250_000,
    status: 'void',
    voidKind: 'recall',
  })
  await insertCharge(BUILDING_A, draft, {
    unit: fixture.units.a1!,
    amount: 150_000,
    status: 'draft',
  })
  await insertCharge(BUILDING_A, published, {
    unit: fixture.units.a2!,
    amount: 200_000,
    status: 'open',
  })
  await insertCharge(BUILDING_A, published, {
    unit: fixture.units.a3!,
    amount: 300_000,
    status: 'paid',
    lines: [
      { itemName: { vi: 'Phí quản lý', en: 'Management fee' }, amount: 200_000 },
      { itemName: { vi: 'Nước', en: 'Water' }, amount: 100_000 },
    ],
  })
  await insertCharge(BUILDING_A, closed, {
    unit: fixture.units.a4!,
    amount: 100_000,
    status: 'paid',
  })

  // A validated import created later must not shadow the committed one (both carry the batch id).
  await insertImport(BUILDING_A, published, new Date('2026-09-20T02:00:00Z'))
  await insertImport(BUILDING_A, published, null)
  await insertImport(BUILDING_A, closed, new Date('2026-08-02T02:00:00Z'))

  // Building B: the same reads must never see it from A.
  const b = await insertBatch(BUILDING_B, {
    id: ids.next(),
    code: 'PH-2610-09',
    name: { vi: 'Phí tòa B', en: 'Building B fees' },
    feeMonth: '2026-10-01',
    status: 'published',
  })
  fixture.b = { published: b }
  await insertCharge(BUILDING_B, b, { unit: fixture.units.b1!, amount: 500_000, status: 'open' })
})

afterAll(async () => {
  await database.close()
  await db.drop()
})

describe('E-89 the batch list (DOC-66 §5)', () => {
  const managerA = () => staffOf('manager', BUILDING_A)

  test('filters, keyset over three pages with no duplicate, whole-building counts on the first page', async () => {
    const page1 = await queries.list(managerA(), { limit: 2 })
    expect(page1.items.map((item) => item.code)).toEqual(['PH-2610-01', 'PH-2609-01'])
    // The creator's name from `IdentityApi.getStaff`, not the id alone (E-89; DOC-66 §5, DOC-07 §11A).
    expect(page1.items[0]?.createdBy).toEqual({ id: CREATOR, name: CREATOR_NAME })
    expect(page1.next).not.toBeNull()
    expect(page1.counts).toEqual({ draft: 2, published: 1, closed: 1, recalled: 1 })
    expect(page1.totalCount).toBe(5)

    const page2 = await queries.list(managerA(), { limit: 2, after: page1.next! })
    expect(page2.items.map((item) => item.code)).toEqual(['PH-2608-01', 'PH-2607-01'])
    expect(page2.counts).toBeUndefined()
    expect(page2.next).not.toBeNull()

    const page3 = await queries.list(managerA(), { limit: 2, after: page2.next! })
    expect(page3.items.map((item) => item.code)).toEqual(['PH-2606-01'])
    expect(page3.next).toBeNull()

    const walk: string[] = []
    let after: FeeBatchListCursor | undefined
    for (;;) {
      const page = await queries.list(managerA(), { limit: 2, after })
      walk.push(...page.items.map((item) => item.code))
      if (!page.next) break
      after = page.next
    }
    expect(walk).toEqual(['PH-2610-01', 'PH-2609-01', 'PH-2608-01', 'PH-2607-01', 'PH-2606-01'])
    expect(new Set(walk).size).toBe(walk.length)

    const drafts = await queries.list(managerA(), { status: 'draft' })
    expect(drafts.items.map((item) => item.code)).toEqual(['PH-2610-01', 'PH-2606-01'])
    // The counts ignore the filters (DOC-66 §4, line 60).
    expect(drafts.counts).toEqual({ draft: 2, published: 1, closed: 1, recalled: 1 })

    const august = await queries.list(managerA(), { month: '2026-08' })
    expect(august.items.map((item) => item.code)).toEqual(['PH-2608-01'])

    const byName = await queries.list(managerA(), { q: 'september' })
    expect(byName.items.map((item) => item.code)).toEqual(['PH-2609-01'])
    const byCode = await queries.list(managerA(), { q: 'ph-2607' })
    expect(byCode.items.map((item) => item.code)).toEqual(['PH-2607-01'])
  })

  test('collectedRate, unitCount and void exclusion (DOC-22 §8.1)', async () => {
    const [september] = (await queries.list(managerA(), { month: '2026-09' })).items
    expect<unknown[]>([september?.unitCount, september?.total, september?.collected]).toEqual([
      2,
      500_000n,
      300_000n,
    ])
    expect(september?.collectedRate).toBeCloseTo(0.6, 10)

    const [july] = (await queries.list(managerA(), { month: '2026-07' })).items
    expect<unknown[]>([july?.unitCount, july?.total, july?.collected, july?.collectedRate]).toEqual(
      [1, 0n, 0n, null],
    )

    const [october] = (await queries.list(managerA(), { month: '2026-10' })).items
    expect<unknown[]>([october?.total, october?.collected, october?.collectedRate]).toEqual([
      150_000n,
      0n,
      0,
    ])

    const [june] = (await queries.list(managerA(), { month: '2026-06' })).items
    expect<unknown[]>([june?.unitCount, june?.collectedRate]).toEqual([0, null])
  })

  test('a foreign building is never listed and keeps its own counts', async () => {
    const mine = new Set((await queries.list(managerA(), {})).items.map((item) => item.code))
    expect(mine.has('PH-2610-09')).toBe(false)

    const theirs = await queries.list(staffOf('manager', BUILDING_B), {})
    expect(theirs.items.map((item) => item.code)).toEqual(['PH-2610-09'])
    expect(theirs.totalCount).toBe(1)
    expect(theirs.counts).toEqual({ draft: 0, published: 1, closed: 0, recalled: 0 })
  })
})

describe('E-91 the batch view (DOC-66 §5)', () => {
  test('counts, total, replaces links and the latest committed import', async () => {
    const view = await queries.view(staffOf('manager', BUILDING_A), fixture.a.published!)
    expect(view.status).toBe('published')
    expect(view.version).toBe(1)
    // The creator's name from `IdentityApi.getStaff`, not the id alone (E-91; DOC-66 §5, DOC-07 §11A).
    expect(view.createdBy).toEqual({ id: CREATOR, name: CREATOR_NAME })
    expect(view.publishedAt).toBeInstanceOf(Date)
    expect(view.counts).toEqual({ charges: 2, lines: 3, open: 1, paid: 1, void: 0, missing: null })
    expect(Number(view.total)).toBe(500_000)
    expect(view.replaces).toBeNull()
    expect(view.replacedBy).toEqual([])
    expect(view.source?.importedAt).toEqual(new Date('2026-09-20T02:00:00Z'))
  })

  test('a draft views its replaces link; the recalled batch lists its replacement', async () => {
    const draft = await queries.view(staffOf('admin', BUILDING_A), fixture.a.draft!)
    expect(draft.replaces).toEqual({ id: fixture.a.recalled!, code: 'PH-2607-01' })
    expect(draft.counts).toEqual({ charges: 1, lines: 1, open: 0, paid: 0, void: 0, missing: null })
    expect(draft.source).toBeNull()

    const recalled = await queries.view(staffOf('manager', BUILDING_A), fixture.a.recalled!)
    expect(recalled.status).toBe('recalled')
    expect(recalled.replacedBy).toEqual([{ id: fixture.a.draft!, code: 'PH-2610-01' }])
    expect(recalled.counts).toEqual({
      charges: 1,
      lines: 1,
      open: 0,
      paid: 0,
      void: 1,
      missing: null,
    })
    expect(Number(recalled.total)).toBe(0)
  })

  test('an unknown id and a foreign batch are 404', async () => {
    expect(await codeOf(() => queries.view(staffOf('manager', BUILDING_A), ids.next()))).toBe(
      'not_found',
    )
    expect(
      await codeOf(() => queries.view(staffOf('manager', BUILDING_A), fixture.b.published!)),
    ).toBe('not_found')
  })
})

describe('E-93 the batch charges (DOC-66 §5)', () => {
  const managerA = () => staffOf('manager', BUILDING_A)

  test('keyset by unit code over two pages, owner names and lines on demand', async () => {
    const page1 = await queries.chargesPage(managerA(), fixture.a.published!, { limit: 1 })
    expect(page1.items.map((item) => item.unitCode)).toEqual(['A-0901'])
    expect(page1.items[0]?.ownerName).toBe('Nguyễn Văn B')
    expect(page1.next).not.toBeNull()

    const page2 = await queries.chargesPage(managerA(), fixture.a.published!, {
      limit: 1,
      after: page1.next!,
    })
    expect(page2.items.map((item) => item.unitCode)).toEqual(['A-0902'])
    expect(page2.next).toBeNull()
    expect(page2.items[0]?.ownerName).toBe('Lê Thị C')
    expect(page2.items[0]?.lineCount).toBe(2)
    expect(page2.items[0]?.lines).toBeUndefined()

    const withLines = await queries.chargesPage(managerA(), fixture.a.published!, {
      includeLines: true,
    })
    const paid = withLines.items.find((item) => item.unitCode === 'A-0902')
    expect(paid?.lineCount).toBe(2)
    expect(paid?.lines?.map((line) => [line.position, line.amount])).toEqual([
      [1, 200_000],
      [2, 100_000],
    ])
  })

  test('status, voidKind and q filters', async () => {
    const paid = await queries.chargesPage(managerA(), fixture.a.published!, { status: 'paid' })
    expect(paid.items.map((item) => item.unitCode)).toEqual(['A-0902'])

    const search = await queries.chargesPage(managerA(), fixture.a.published!, { q: '0901' })
    expect(search.items.map((item) => item.unitCode)).toEqual(['A-0901'])

    const recalled = await queries.chargesPage(managerA(), fixture.a.recalled!, {
      voidKind: 'recall',
    })
    expect(recalled.items.map((item) => [item.unitCode, item.voidKind, item.status])).toEqual([
      ['A-0701', 'recall', 'void'],
    ])
  })

  test('view=missing is an empty page, and an unknown or foreign batch is 404', async () => {
    const missing = await queries.chargesPage(managerA(), fixture.a.draft!, { view: 'missing' })
    expect(missing).toEqual({ items: [], next: null })

    expect(await codeOf(() => queries.chargesPage(managerA(), ids.next(), {}))).toBe('not_found')
    expect(await codeOf(() => queries.chargesPage(managerA(), fixture.b.published!, {}))).toBe(
      'not_found',
    )
  })
})

describe('the role gate (EP:181-185, DOC-21 §3)', () => {
  test('a Technician or a Guard is 403 on every read', async () => {
    const guard = staffOf('guard', BUILDING_A)
    expect(await codeOf(() => queries.list(guard, {}))).toBe('forbidden')
    expect(await codeOf(() => queries.view(guard, fixture.a.draft!))).toBe('forbidden')
    expect(await codeOf(() => queries.chargesPage(guard, fixture.a.draft!, {}))).toBe('forbidden')

    const technician = staffOf('technician', BUILDING_A)
    expect(await codeOf(() => queries.list(technician, {}))).toBe('forbidden')
  })
})
