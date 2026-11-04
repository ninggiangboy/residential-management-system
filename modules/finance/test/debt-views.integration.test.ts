import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { NotFoundError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import {
  type BuildingId,
  type BuildingScope,
  type LocalDate,
  localDate,
  money,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq, sql } from 'drizzle-orm'
import type { DebtUnitDirectory, DebtUnitProfile } from '../src/application/ports'
import { DebtQueries } from '../src/application/queries/debt-queries'
import { DrizzleDebtRepository } from '../src/infrastructure/persistence/drizzle-debt-repository'
import { DrizzleUnitPaymentsReader } from '../src/infrastructure/persistence/drizzle-unit-payments-reader'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'
import { debtUnitDirectory } from '../src/integrations/residency'
import { TEST_ZONE } from './support/ports'

/**
 * The P2-15 tests of the DOC-66 §5 debt views: the E-101 filters and summary and the E-102 unit view, on a clone of
 * the migrated template. The Drizzle `DebtQueries` is built directly with a fake `DebtUnitDirectory` (owner names) and a real
 * `DrizzleUnitPaymentsReader`, so the owner read is exercised without the container (the module wires the two adapters; this file
 * covers the reads). Charges are seeded as `draft` with lines and moved to `open` — the guard triggers require the lines first.
 */

/** The fixture instant: the building day (Asia/Ho_Chi_Minh) is 2026-10-19. */
const AT = new Date('2026-10-19T03:00:00Z')
/** A due date 4 days before the building day: 1–30 days past due, under the switch (DOC-66 §5). */
const DUE_SOON = localDate('2026-10-15')
/** A due date 79 days before the building day: past the 30-day switch. */
const DUE_LATE = localDate('2026-08-01')
/** A future due date: not yet due (FR-12.1). */
const DUE_NEXT = localDate('2026-11-15')
const AMOUNT = 100_000
const SOON_AMOUNT = 200_000
const LATE_AMOUNT = 300_000
const BATCH_NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }
const ITEM_NAME = { vi: 'Phí quản lý', en: 'Management fee' }
const OWNER = 'Trần Minh Anh'

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let queries: DebtQueries
const ids = new UuidV7Generator()
const clock = new FakeClock(AT)

/** The unit/owner read of E-101/E-102: a fake `DebtUnitDirectory` over this map, scoped to the building it is asked about. */
const profiles = new Map<string, DebtUnitProfile & { readonly buildingId: string }>()
const unitsPort = {
  units: async (buildingId: string, unitIds: readonly string[]) =>
    unitIds.flatMap((unitId) => {
      const profile = profiles.get(unitId)
      return profile && profile.buildingId === buildingId ? [profile] : []
    }),
}

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

function addProfile(
  unitId: string,
  buildingId: string,
  code: string,
  ownerName: string | null,
): void {
  profiles.set(unitId, {
    unitId,
    buildingId,
    code,
    floor: 15,
    areaM2: null,
    ownerName,
    ownerPhone: null,
  })
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
  admin = db.admin(4)
  queries = new DebtQueries(
    new DrizzleDebtRepository(database),
    { timeZone: async () => TEST_ZONE },
    clock,
    unitsPort,
    new DrizzleUnitPaymentsReader(database),
  )
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

/** A `fee_batch` at `status`; the published rows carry the columns their checks require. */
async function insertBatch(spec: {
  readonly building: string
  readonly code: string
  readonly feeMonth: string
  readonly dueDate: string
  readonly status?: 'draft' | 'published'
}): Promise<string> {
  const status = spec.status ?? 'published'
  const batchId = ids.next()
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: spec.building,
    code: spec.code,
    name: BATCH_NAME,
    feeMonth: spec.feeMonth,
    dueDate: spec.dueDate,
    status,
    createdBy: ids.next(),
    publishedAt: status === 'published' ? AT : null,
    publishedBy: status === 'published' ? ids.next() : null,
    version: status === 'published' ? 2 : 1,
  })
  return batchId
}

/** A charge as `draft` with one line, then moved to `open` (the trigger requires the line before the status change). */
async function insertCharge(spec: {
  readonly building: string
  readonly batchId: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
}): Promise<{ chargeId: string; version: number }> {
  const chargeId = ids.next()
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId: spec.building,
    batchId: spec.batchId,
    unitId: spec.unitId,
    unitCode: spec.unitCode,
    amount: spec.amount,
    status: 'draft',
    version: 1,
  })
  await database.executor.insert(chargeLine).values({
    id: ids.next(),
    buildingId: spec.building,
    chargeId,
    position: 1,
    kind: 'fee',
    itemName: ITEM_NAME,
    quantity: '1',
    unitPrice: spec.amount,
    amount: spec.amount,
  })
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(eq(chargeTable.id, chargeId))
  return { chargeId, version: 2 }
}

const BUILDING_A = ids.next()
const BUILDING_B = ids.next()
const UNIT_SOON = ids.next()
const UNIT_NEXT = ids.next()
const UNIT_LATE = ids.next()
const UNIT_EMPTY = ids.next()
const UNIT_FOREIGN = ids.next()

let chargeSoon: { chargeId: string; version: number }
let intentId: string

/** Seeds the two buildings, the four units of A and the foreign unit of B (the shared fixture of every test). */
async function seedFixture(): Promise<void> {
  const october = await insertBatch({
    building: BUILDING_A,
    code: 'PH-2610-01',
    feeMonth: '2026-10-01',
    dueDate: DUE_SOON,
  })
  const november = await insertBatch({
    building: BUILDING_A,
    code: 'PH-2611-01',
    feeMonth: '2026-11-01',
    dueDate: DUE_NEXT,
  })
  const august = await insertBatch({
    building: BUILDING_A,
    code: 'PH-2608-01',
    feeMonth: '2026-08-01',
    dueDate: DUE_LATE,
  })
  chargeSoon = await insertCharge({
    building: BUILDING_A,
    batchId: october,
    unitId: UNIT_SOON,
    unitCode: 'A-1508',
    amount: AMOUNT,
  })
  await insertCharge({
    building: BUILDING_A,
    batchId: november,
    unitId: UNIT_NEXT,
    unitCode: 'B-201',
    amount: SOON_AMOUNT,
  })
  await insertCharge({
    building: BUILDING_A,
    batchId: august,
    unitId: UNIT_LATE,
    unitCode: 'C-777',
    amount: LATE_AMOUNT,
  })
  const foreign = await insertBatch({
    building: BUILDING_B,
    code: 'PH-2610-01',
    feeMonth: '2026-10-01',
    dueDate: DUE_SOON,
  })
  await insertCharge({
    building: BUILDING_B,
    batchId: foreign,
    unitId: UNIT_FOREIGN,
    unitCode: 'A-1508',
    amount: AMOUNT,
  })

  addProfile(UNIT_SOON, BUILDING_A, 'A-1508', OWNER)
  addProfile(UNIT_NEXT, BUILDING_A, 'B-201', 'Lê Văn B')
  addProfile(UNIT_LATE, BUILDING_A, 'C-777', null)
  addProfile(UNIT_EMPTY, BUILDING_A, 'D-1', 'Phạm Thị C')
  addProfile(UNIT_FOREIGN, BUILDING_B, 'A-1508', 'Nguyễn Văn D')

  await seedActiveIntent()
  await seedPayments()
}

/** One `pending` intent item on `UNIT_SOON`'s charge, so E-102 shows an `activeIntent` (FR-05.6). */
async function seedActiveIntent(): Promise<void> {
  intentId = ids.next()
  await admin`
    INSERT INTO finance.payment_intent
      (id, building_id, unit_id, code, order_code, amount, status, gateway_config_id, provider, link_id,
       created_by, created_at, display_until, expires_at, version)
    VALUES (${intentId}::uuid, ${BUILDING_A}::uuid, ${UNIT_SOON}::uuid, 'TT-261000-0001', 1000001, ${AMOUNT},
            'pending', ${ids.next()}::uuid, 'payos', 'link-1', ${ids.next()}::uuid, ${AT}, ${new Date(AT.getTime() + 30 * 60_000)},
            ${new Date(AT.getTime() + 60 * 60_000)}, 1)`
  await admin`
    INSERT INTO finance.payment_intent_item (id, building_id, intent_id, charge_id, amount)
    VALUES (${ids.next()}::uuid, ${BUILDING_A}::uuid, ${intentId}::uuid, ${chargeSoon.chargeId}::uuid, ${AMOUNT})`
}

/** 22 cash payments on `UNIT_SOON`, a receipt on the newest and a `refunded` flag on the second (DOC-66 §5, DR-327). */
async function seedPayments(): Promise<void> {
  const received = (index: number) => new Date(AT.getTime() - index * 60_000)
  const paymentIds: string[] = []
  for (let index = 0; index < 22; index += 1)
    paymentIds.push(await insertCashPayment(received(index), 50_000 + index))
  await insertReceipt(paymentIds[0] as string, 50_000)
  await admin`
    INSERT INTO finance.gateway_event
      (id, building_id, provider, reference, amount, paid_at, source, payload, intent_id, unit_id, outcome, related_payment_id)
    VALUES (${ids.next()}::uuid, ${BUILDING_A}::uuid, 'payos', 'ref-refund-1', 50001, ${AT}, 'webhook', '{}'::jsonb,
            ${intentId}::uuid, ${UNIT_SOON}::uuid, 'refunded', ${paymentIds[1] as string}::uuid)`
}

async function insertCashPayment(receivedAt: Date, amount: number): Promise<string> {
  const id = ids.next()
  await admin`
    INSERT INTO finance.payment
      (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by, status)
    VALUES (${id}::uuid, ${BUILDING_A}::uuid, ${UNIT_SOON}::uuid, 'cash', ${amount}, ${receivedAt},
            ${OWNER}, ${ids.next()}::uuid, ${ids.next()}::uuid, 'posted')`
  return id
}

async function insertReceipt(paymentId: string, amount: number): Promise<void> {
  const allocationId = ids.next()
  await admin`
    INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount, status)
    VALUES (${allocationId}::uuid, ${BUILDING_A}::uuid, ${paymentId}::uuid, ${chargeSoon.chargeId}::uuid, ${amount}, 'live')`
  await admin`
    INSERT INTO finance.receipt
      (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot, status)
    VALUES (${ids.next()}::uuid, ${BUILDING_A}::uuid, 'BL-2610-0001', ${allocationId}::uuid, ${paymentId}::uuid,
            ${chargeSoon.chargeId}::uuid, ${UNIT_SOON}::uuid, ${amount}, '{}'::jsonb, 'issued')`
}

describe('the DOC-66 §5 debt views (P2-15)', () => {
  beforeAll(seedFixture)

  test('the `month` filter keeps the charges of that fee month (DOC-66 §5)', async () => {
    const page = await queries.list(scopeOf(BUILDING_A), {
      limit: 50,
      filter: { month: '2026-10' },
    })
    expect(page.rows.map((row) => row.unitId)).toEqual([UNIT_SOON])
    expect(page.rows[0]?.outstanding).toBe(money(AMOUNT))
  })

  test('the `q` filter matches a unit-code substring, case-insensitively (DOC-66 §5)', async () => {
    const page = await queries.list(scopeOf(BUILDING_A), { limit: 50, filter: { q: 'a-15' } })
    expect(page.rows.map((row) => row.unitCode)).toEqual(['A-1508'])
    expect(page.rows[0]?.ownerName).toBe(OWNER)
  })

  test('the `overdue30` switch keeps only units with a charge more than 30 days past due (DOC-66 §5)', async () => {
    const page = await queries.list(scopeOf(BUILDING_A), { limit: 50, filter: { overdue30: true } })
    expect(page.rows.map((row) => row.unitId)).toEqual([UNIT_LATE])
    expect(page.rows[0]?.overdue30).toBe(money(LATE_AMOUNT))
  })

  test('the summary and asOf are on the first page only, and follow the filter (DOC-66 §5)', async () => {
    const first = await queries.list(scopeOf(BUILDING_A), { limit: 2, summary: true })
    expect(first.asOf).toBe('2026-10-19' as LocalDate)
    expect(first.summary?.outstanding).toBe(money(AMOUNT + SOON_AMOUNT + LATE_AMOUNT))
    expect(first.summary?.units).toBe(3)
    expect(first.summary?.ownedUnits).toBeNull()
    expect(first.summary?.overdue30).toEqual({ amount: money(LATE_AMOUNT), units: 1 })
    expect(first.summary?.collected?.feeMonth).toBe('2026-11-01' as LocalDate)
    expect(first.next).not.toBeNull()

    const second = await queries.list(scopeOf(BUILDING_A), {
      limit: 2,
      summary: true,
      after: first.next ?? undefined,
    })
    expect(second.summary).toBeNull()
    expect(second.asOf).toBeNull()

    const plain = await queries.list(scopeOf(BUILDING_A), { limit: 2 })
    expect(plain.summary).toBeNull()
  })

  test('the collected tile follows the month filter (DOC-66 §5)', async () => {
    const page = await queries.list(scopeOf(BUILDING_A), {
      limit: 50,
      summary: true,
      filter: { month: '2026-10' },
    })
    expect(page.summary?.collected?.feeMonth).toBe('2026-10-01' as LocalDate)
    expect(page.summary?.outstanding).toBe(money(AMOUNT))
  })

  test('lastReminderAt is the latest debt_reminder of the unit (DOC-66 §5)', async () => {
    const before = await queries.list(scopeOf(BUILDING_A), { limit: 50, filter: { q: 'A-1508' } })
    expect(before.rows[0]?.lastReminderAt).toBeNull()

    await admin`
      INSERT INTO finance.debt_reminder (id, building_id, unit_id, reminder_day, sent_by, charge_count, amount, created_at)
      VALUES (${ids.next()}::uuid, ${BUILDING_A}::uuid, ${UNIT_SOON}::uuid, '2026-10-18', ${ids.next()}::uuid, 1, ${AMOUNT}, ${AT})`

    const after = await queries.list(scopeOf(BUILDING_A), { limit: 50, filter: { q: 'A-1508' } })
    expect(after.rows[0]?.lastReminderAt?.getTime()).toBe(AT.getTime())
  })

  test('the owner name comes through the port, the code from the charge snapshot (DOC-66 §5)', async () => {
    const page = await queries.list(scopeOf(BUILDING_A), { limit: 50, filter: { q: 'B-201' } })
    expect(page.rows[0]?.ownerName).toBe('Lê Văn B')
    expect(page.rows[0]?.unitCode).toBe('B-201')
  })

  test('unitView carries the unit, the owner, the tiles and an open charge with its active intent (DOC-66 §5)', async () => {
    const view = await queries.unitView(scopeOf(BUILDING_A), UNIT_SOON)
    expect(view.unit).toEqual({ id: UNIT_SOON, code: 'A-1508', floor: 15, areaM2: null })
    expect(view.owner).toEqual({ name: OWNER, phone: null })
    expect(view.summary).toEqual({
      outstanding: money(AMOUNT),
      openCharges: 1,
      nearestDue: DUE_SOON,
      overdueAmount: money(AMOUNT),
    })
    const [charge] = view.openCharges
    expect(charge?.chargeId).toBe(chargeSoon.chargeId)
    expect(charge?.batch).toEqual({
      code: 'PH-2610-01',
      name: BATCH_NAME,
      feeMonth: '2026-10-01' as LocalDate,
    })
    expect(charge?.daysPastDue).toBe(4)
    expect(charge?.version).toBe(2)
    expect(charge?.activeIntent?.since.getTime()).toBe(AT.getTime())
  })

  test('unitView of a unit with nothing open is not 404 and reads zero (DOC-66 §5)', async () => {
    const view = await queries.unitView(scopeOf(BUILDING_A), UNIT_EMPTY)
    expect(view.unit.code).toBe('D-1')
    expect(view.summary).toEqual({
      outstanding: money(0),
      openCharges: 0,
      nearestDue: null,
      overdueAmount: money(0),
    })
    expect(view.openCharges).toEqual([])
  })

  test('the payments page is keyset paged over more than 20 payments, newest first (DOC-66 §5, DR-324)', async () => {
    const first = await queries.unitView(scopeOf(BUILDING_A), UNIT_SOON)
    expect(first.payments).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const received = first.payments.map((payment) => payment.receivedAt.getTime())
    expect(received).toEqual([...received].sort((a, b) => b - a))

    const second = await queries.unitView(scopeOf(BUILDING_A), UNIT_SOON, {
      paymentsAfter: first.nextCursor ?? undefined,
    })
    expect(second.payments).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    expect(second.payments[0]?.amount).toBe(money(50_020))
  })

  test('an unknown unit is 404 (DOC-66 §6)', async () => {
    await expect(queries.unitView(scopeOf(BUILDING_A), ids.next())).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  test('a refund flag and a receipt are attached to their payment (DOC-66 §5, DR-327)', async () => {
    const view = await queries.unitView(scopeOf(BUILDING_A), UNIT_SOON)
    const [newest, second] = view.payments
    expect(newest?.receipts).toEqual([
      {
        id: expect.any(String),
        number: 'BL-2610-0001',
        chargeId: chargeSoon.chargeId,
        status: 'issued',
      },
    ])
    expect(newest?.moneyLogFlags).toEqual([])
    expect(second?.moneyLogFlags).toHaveLength(1)
    expect(second?.moneyLogFlags[0]?.outcome).toBe('refunded')
  })

  test('REG cross-building: a unit of another building is 404 and never shown (DOC-12 §14)', async () => {
    await expect(queries.unitView(scopeOf(BUILDING_A), UNIT_FOREIGN)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    const own = await queries.list(scopeOf(BUILDING_B), { limit: 50 })
    expect(own.rows.map((row) => row.unitId)).toEqual([UNIT_FOREIGN])
  })

  test('the debtUnitDirectory adapter keeps only the units of the building (DOC-66 §5)', async () => {
    const units = new Map<string, { buildingId: string; code: string; floor: number | null }>([
      [UNIT_SOON, { buildingId: BUILDING_A, code: 'A-1508', floor: 15 }],
      [UNIT_FOREIGN, { buildingId: BUILDING_B, code: 'A-1508', floor: 15 }],
    ])
    const residency = {
      getUnits: async (unitIds: string[]) =>
        unitIds.flatMap((unitId) => {
          const unit = units.get(unitId)
          return unit
            ? [{ unitId, code: unit.code, floor: unit.floor, occupancy: 'occupied' as const }]
            : []
        }),
      findUnitsByCodes: async (buildingId: string, codes: readonly string[]) =>
        [...units.entries()]
          .filter(([, unit]) => unit.buildingId === buildingId && codes.includes(unit.code))
          .map(([unitId, unit]) => ({
            unitId,
            code: unit.code,
            occupancy: 'occupied' as const,
            hasActiveOwner: true,
          })),
      unitOwnerNames: async (buildingId: string, unitIds: string[]) =>
        unitIds.map((unitId) => ({
          unitId,
          ownerName: units.get(unitId)?.buildingId === buildingId ? OWNER : null,
        })),
    }
    const port: DebtUnitDirectory = debtUnitDirectory(residency)
    expect(await port.units(BUILDING_A, [UNIT_SOON, UNIT_FOREIGN])).toEqual([
      {
        unitId: UNIT_SOON,
        code: 'A-1508',
        floor: 15,
        areaM2: null,
        ownerName: OWNER,
        ownerPhone: null,
      },
    ])
    expect(await port.units(BUILDING_A, [UNIT_FOREIGN])).toEqual([])
  })
})
