import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { NotFoundError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import {
  type BuildingId,
  type BuildingScope,
  buildingToday,
  type LocalDate,
  type MembershipId,
  money,
  type ResidentAccountId,
  type StaffContext,
  type StaffId,
  type StaffRole,
  type UnitContext,
  type UnitId,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import { ResidentFeeQueries } from '../src/application/queries/resident-fee-queries'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { DrizzleResidentFeeReader } from '../src/infrastructure/persistence/drizzle-resident-fee-reader'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'
import { TEST_ZONE, testPorts } from './support/ports'

/**
 * The P2-15 tests of the resident fee reads E-80…E-83 (DOC-22 §8.4, DOC-58, DR-40, DR-323) on a clone of the migrated
 * template: the real `ResidentFeeQueries` over the Drizzle reader, a `FakeClock` and the module's real payment path (so the
 * allocations, receipts and the DR-40 window are the true ones). Charges are seeded as `draft` with their lines and then
 * moved to `open` — the guard triggers require the lines before the status change (DOC-15 §11).
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
/** The fixture instant: the building day (Asia/Ho_Chi_Minh) is 2026-10-19. */
const AT = new Date('2026-10-19T03:00:00Z')
const DUE = '2026-10-15'
const CHARGE_AMOUNT = 100_000
/** A member's `startedAt` before every fixture payment. */
const SINCE_JANUARY = new Date('2026-01-01T00:00:00Z')
const BATCH_NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }
const ITEM_NAME = { vi: 'Phí quản lý', en: 'Management fee' }

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
let finance: FinanceModule
let residentFees: ResidentFeeQueries
const ids = new UuidV7Generator()
const clock = new FakeClock(AT)

const staff = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

/** The `unit('view_fees')` guard's context (DOC-12 §11.1); `startedAt` is `membership.created_at` (DR-40). */
const unitContext = (buildingId: string, unitId: string, startedAt: Date): UnitContext => ({
  buildingId: buildingId as BuildingId,
  unitId: unitId as UnitId,
  membershipId: ids.next() as MembershipId,
  accountId: ids.next() as ResidentAccountId,
  memberType: 'owner',
  canPay: true,
  startedAt,
  scope: scopeOf(buildingId),
})

/** Move the shared `FakeClock` to `instant` (it only advances). */
function setClock(instant: Date): void {
  clock.advance(instant.getTime() - clock.now().getTime())
}

function buildModule(): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files: {
      read: () => Promise.reject(new Error('no file is read by the resident fee reads')),
      attach: () => Promise.reject(new Error('no file is attached by the resident fee reads')),
      remove: () => Promise.reject(new Error('no file is removed by this test')),
      storeGenerated: () => Promise.reject(new Error('no file is stored by this test')),
      findByOwnerRef: () => Promise.reject(new Error('no file is looked up by this test')),
    },
    ...testPorts(),
  })
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
  admin = db.admin(4)
  audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, financeManifest]),
    purgeGraceMinutes: 0,
  })
  finance = buildModule()
  residentFees = new ResidentFeeQueries(
    new DrizzleResidentFeeReader(database),
    { timeZone: async () => TEST_ZONE },
    clock,
  )
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

/** A `fee_batch` at `status`; a published, recalled or closed row carries the columns its checks require. */
async function insertBatch(spec: {
  readonly building: string
  readonly code: string
  readonly status: 'draft' | 'published' | 'recalled' | 'closed'
  readonly feeMonth?: string
  readonly dueDate?: string
}): Promise<string> {
  const batchId = ids.next()
  const published = spec.status !== 'draft'
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: spec.building,
    code: spec.code,
    name: BATCH_NAME,
    feeMonth: spec.feeMonth ?? '2026-10-01',
    dueDate: spec.dueDate ?? DUE,
    status: spec.status,
    createdBy: ids.next(),
    publishedAt: published ? AT : null,
    publishedBy: published ? ids.next() : null,
    recalledAt: spec.status === 'recalled' ? AT : null,
    recalledBy: spec.status === 'recalled' ? ids.next() : null,
    closedAt: spec.status === 'closed' ? AT : null,
    closedBy: spec.status === 'closed' ? ids.next() : null,
    version: published ? 2 : 1,
  })
  return batchId
}

/** A charge as `draft` with one line; `open: true` then moves it to `open` (the trigger requires the line first). */
async function insertCharge(spec: {
  readonly building: string
  readonly batchId: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
  readonly open?: boolean
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
  if (!spec.open) return { chargeId, version: 1 }
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(eq(chargeTable.id, chargeId))
  return { chargeId, version: 2 }
}

/** A batch of one unit's charge: one charge per batch, the key `uq_charge_batch_unit` allows no second. */
async function chargeInNewBatch(spec: {
  readonly building: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
  readonly code: string
  readonly status?: 'draft' | 'published' | 'recalled' | 'closed'
  readonly feeMonth?: string
  readonly dueDate?: string
}): Promise<{ chargeId: string; version: number; batchId: string; unitId: string }> {
  const batchId = await insertBatch({
    building: spec.building,
    code: spec.code,
    status: spec.status ?? 'published',
    feeMonth: spec.feeMonth,
    dueDate: spec.dueDate,
  })
  const charge = await insertCharge({
    building: spec.building,
    batchId,
    unitId: spec.unitId,
    unitCode: spec.unitCode,
    amount: spec.amount,
    open: true,
  })
  return { ...charge, batchId, unitId: spec.unitId }
}

/** A manager records a whole-charge cash payment (DOC-22 §5); answers its payment id. */
async function pay(
  manager: StaffContext,
  unitId: string,
  chargeIds: readonly string[],
  receivedOn: string,
): Promise<string> {
  const result = await finance.useCases.recordManualPayment.execute(
    manager,
    {
      unitId,
      chargeIds: [...chargeIds],
      amount: null,
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: receivedOn as LocalDate,
      bankReference: null,
      statementLineId: null,
      note: null,
      dryRun: false,
    },
    ids.next(),
  )
  if (result.kind !== 'posted') throw new Error('the fixture payment was a dry run')
  return result.payment.paymentId
}

describe('resident fee reads E-80…E-83 (DOC-22 §8.4, DOC-58, DR-40, P2-15)', () => {
  test('RF-01 the DR-40 window: a member added after a payment sees the open charges only (LG-43)', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const open = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 350_000,
      code: 'PH-2610-01',
    })
    const older = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 2_488_000,
      code: 'PH-2609-01',
      feeMonth: '2026-09-01',
      dueDate: '2026-09-10',
    })
    const paymentId = await pay(manager, unit, [older.chargeId], '2026-10-05')
    expect(paymentId).toBeString()

    // A member who joined on 2026-10-10: the 2026-10-05 payment is before their window.
    const late = unitContext(building, unit, new Date('2026-10-10T00:00:00Z'))
    const fees = await residentFees.open(late)
    expect(fees.count).toBe(1)
    expect(fees.items.map((item) => item.chargeId)).toEqual([open.chargeId])
    expect(fees.total).toBe(money(350_000))

    const history = await residentFees.history(late)
    expect(history.items).toEqual([])
    expect(history.summary).toEqual({ outstanding: money(350_000), paidThisYear: money(0) })

    const receipts = await residentFees.receipts(late)
    expect(receipts.items).toEqual([])

    await expect(residentFees.detail(late, older.chargeId)).rejects.toThrow(NotFoundError)
    const openDetail = await residentFees.detail(late, open.chargeId)
    expect(openDetail.status).toBe('open')
    expect(openDetail.amount).toBe(money(350_000))
  })

  test('RF-02 a member since before the payment sees the history, the receipt and the detail', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const charge = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 2_488_000,
      code: 'PH-2609-04',
      feeMonth: '2026-09-01',
      dueDate: '2026-09-10',
    })
    await pay(manager, unit, [charge.chargeId], '2026-10-05')

    const member = unitContext(building, unit, SINCE_JANUARY)
    const history = await residentFees.history(member)
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({
      chargeId: charge.chargeId,
      amount: 2_488_000n,
      batch: { code: 'PH-2609-04', ordinal: 4 },
      payment: { method: 'cash' },
    })
    expect(history.items[0]?.receipt.number).toMatch(/^BL-/)
    // No payer name is returned at all (DR-40: payer names only inside the window and never through this read).
    expect(history.items[0]).not.toHaveProperty('payerName')

    const receipts = await residentFees.receipts(member)
    expect(receipts.items).toHaveLength(1)
    expect(receipts.items[0]).toMatchObject({
      chargeId: charge.chargeId,
      amount: 2_488_000n,
      method: 'cash',
      status: 'issued',
    })
    expect(receipts.items[0]?.number).toBe(history.items[0]?.receipt.number)

    const detail = await residentFees.detail(member, charge.chargeId)
    expect(detail.status).toBe('paid')
    expect(detail.payment?.method).toBe('cash')
    expect(detail.receipt?.number).toBe(history.items[0]?.receipt.number)
    // The reads take a `UnitContext`; no staff role is involved, so a manager-level gate never applies.
    expect(detail.batch.ordinal).toBe(4)
  })

  test("RF-03 another unit's or another building's charge is 404, never a leak", async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const otherUnit = ids.next()
    const otherBuilding = ids.next()
    const mine = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
    })
    const foreignUnit = await chargeInNewBatch({
      building,
      unitId: otherUnit,
      unitCode: 'A-1509',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-02',
    })
    const foreignBuilding = await chargeInNewBatch({
      building: otherBuilding,
      unitId: ids.next(),
      unitCode: 'B-0101',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
    })

    const member = unitContext(building, unit, SINCE_JANUARY)
    expect((await residentFees.detail(member, mine.chargeId)).chargeId).toBe(mine.chargeId)
    await expect(residentFees.detail(member, foreignUnit.chargeId)).rejects.toThrow(NotFoundError)
    await expect(residentFees.detail(member, foreignBuilding.chargeId)).rejects.toThrow(
      NotFoundError,
    )
    await expect(residentFees.detail(member, ids.next())).rejects.toThrow(NotFoundError)
  })

  test('RF-04 the history keyset pages without duplicates or gaps', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const charges: string[] = []
    for (let i = 1; i <= 25; i += 1)
      charges.push(
        (
          await chargeInNewBatch({
            building,
            unitId: unit,
            unitCode: 'A-1508',
            amount: CHARGE_AMOUNT,
            code: `PH-2610-${String(i).padStart(2, '0')}`,
          })
        ).chargeId,
      )
    // One payment for all 25 charges: every row shares `received_at`, so the page boundary is the `(received_at, id)` tiebreak.
    await pay(manager, unit, charges, buildingToday(clock.now(), TEST_ZONE))

    const member = unitContext(building, unit, SINCE_JANUARY)
    const seen: string[] = []
    let after: { receivedAt: Date; chargeId: string } | undefined
    let pages = 0
    for (;;) {
      const page = await residentFees.history(member, { after, limit: 10 })
      pages += 1
      seen.push(...page.items.map((item) => item.chargeId))
      if (!page.next) break
      after = page.next
      expect(pages).toBeLessThan(5)
    }
    expect(pages).toBe(3)
    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
    expect(new Set(seen)).toEqual(new Set(charges))
  })

  test('RF-05 the summary is on the first page only (DR-323)', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const charges: string[] = []
    for (let i = 1; i <= 21; i += 1)
      charges.push(
        (
          await chargeInNewBatch({
            building,
            unitId: unit,
            unitCode: 'A-1508',
            amount: CHARGE_AMOUNT,
            code: `PH-2610-${String(i).padStart(2, '0')}`,
          })
        ).chargeId,
      )
    const beforePaying = await residentFees.history(unitContext(building, unit, SINCE_JANUARY))
    expect(beforePaying.items).toHaveLength(0)
    expect(beforePaying.summary).toEqual({
      outstanding: money(21 * CHARGE_AMOUNT),
      paidThisYear: money(0),
    })

    // One payment for all 21 charges, so the history spills to a second page (limit 20).
    await pay(manager, unit, charges, buildingToday(clock.now(), TEST_ZONE))

    const member = unitContext(building, unit, SINCE_JANUARY)
    const pageOne = await residentFees.history(member)
    expect(pageOne.items).toHaveLength(20)
    expect(pageOne.summary).toEqual({
      outstanding: money(0),
      paidThisYear: money(21 * CHARGE_AMOUNT),
    })
    expect(pageOne.next).not.toBeNull()
    const pageTwo = await residentFees.history(member, { after: pageOne.next ?? undefined })
    expect(pageTwo.items).toHaveLength(1)
    expect(pageTwo.summary).toBeNull()
  })

  test('RF-06 daysPastDue is signed: 0 on the due day, 1 the day after (DOC-22 §8.1)', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const dueToday = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
      dueDate: '2026-10-19',
    })
    const dueYesterday = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-02',
      dueDate: '2026-10-18',
    })
    const member = unitContext(building, unit, SINCE_JANUARY)
    const fees = await residentFees.open(member)
    const byId = new Map(fees.items.map((item) => [item.chargeId, item]))
    expect(byId.get(dueToday.chargeId)?.daysPastDue).toBe(0)
    expect(byId.get(dueToday.chargeId)?.overdue).toBe(false)
    expect(byId.get(dueYesterday.chargeId)?.daysPastDue).toBe(1)
    expect(byId.get(dueYesterday.chargeId)?.overdue).toBe(true)
    expect(fees.items[0]?.dueDate).toBe('2026-10-18' as LocalDate)
    expect(fees.items[0]?.lines).toHaveLength(1)
    expect(fees.items[0]?.lines[0]?.itemName).toEqual(ITEM_NAME)
  })

  test("RF-07 a voided payment's charge is open again and leaves the history (FR-06.5)", async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const charge = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
    })
    const paymentId = await pay(manager, unit, [charge.chargeId], '2026-10-05')
    const member = unitContext(building, unit, SINCE_JANUARY)
    expect((await residentFees.open(member)).count).toBe(0)

    await finance.useCases.voidPayment.execute(manager, paymentId, {
      reason: 'the transfer was reversed',
    })

    const reopened = await residentFees.open(member)
    expect(reopened.items.map((item) => item.chargeId)).toEqual([charge.chargeId])
    expect((await residentFees.history(member)).items).toEqual([])
    const receipts = await residentFees.receipts(member)
    // The decided E-83 shape keeps a voided receipt, marked `void` (DOC-22 §8.4: the same payment-date window).
    expect(receipts.items).toHaveLength(1)
    expect(receipts.items[0]?.status).toBe('void')
    expect((await residentFees.detail(member, charge.chargeId)).status).toBe('open')
  })

  test('RF-08 paidThisYear counts the building-local year, not the UTC one (DOC-58 §5, DR-09)', async () => {
    // 2026-12-31 17:30 UTC is 2027-01-01 00:30 in Asia/Ho_Chi_Minh: the building year is 2027.
    setClock(new Date('2026-12-31T17:30:00Z'))
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const charge = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2701-01',
      feeMonth: '2027-01-01',
      dueDate: '2027-01-15',
    })
    // recorded today, so `received_at` is `now` — 2026-12-31T17:30Z, whose UTC year is 2026 but whose building year is 2027.
    await pay(manager, unit, [charge.chargeId], buildingToday(clock.now(), TEST_ZONE))

    const history = await residentFees.history(unitContext(building, unit, SINCE_JANUARY))
    expect(history.items).toHaveLength(1)
    expect(history.summary).toEqual({
      outstanding: money(0),
      paidThisYear: money(CHARGE_AMOUNT),
    })
  })
})
