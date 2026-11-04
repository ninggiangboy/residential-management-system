import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { BuildingId, BuildingScope, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { and, eq, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import type { ManualPaymentInput } from '../src/domain/manual-payment'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { DrizzleReceiptPdfRepository } from '../src/infrastructure/persistence/drizzle-receipt-pdf-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  receipt,
} from '../src/infrastructure/persistence/schema'
import { testPorts } from './support/ports'

/**
 * The data side of `finance.render_receipt_pdf` (DOC-34 §8.2, DR-295; slice 8b-1): `findForRender` and the single
 * conditional `swapPdfFile` of `DrizzleReceiptPdfRepository` over a clone of the migrated template. Every test seeds
 * its own building through the real `recordManualPayment`, then drives the repository directly.
 *
 * # NOTE: `finance.receipt` has no void-reason column (schema.ts), so `ReceiptPdfRow.voidReason` is always `null`
 * # and the void copy prints without a reason (DOC-34 §7.1).
 * # NOTE: `install.ts` needs no change: `FinanceHost` derives `files` from `FinanceModuleDeps`, so widening the
 * # dependency propagates to the host type on its own.
 * # NOTE: §8.4's original-logo fallback is not built here: the slice asks only for the 512 px thumbnail read, so a
 * # thumbnail miss logs `pdf.logo_missing` and answers `null`.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const RECEIVED_ON = '2026-10-19'
const AMOUNT = 2_488_000
const VOIDED_AT = new Date('2026-10-12T03:00:00Z')
const FILE_A = '0192f3c4-0000-7000-8000-0000000000a1'
const FILE_B = '0192f3c4-0000-7000-8000-0000000000b2'

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
let finance: FinanceModule
let repo: DrizzleReceiptPdfRepository
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

const staff = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

function buildModule(ports: ReturnType<typeof testPorts>): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files: {
      read: () => Promise.reject(new Error('no file is read by this test')),
      attach: () => Promise.reject(new Error('no file is attached by this test')),
      remove: () => Promise.reject(new Error('no file is removed by this test')),
      storeGenerated: () => Promise.reject(new Error('no file is stored by this test')),
      findByOwnerRef: () => Promise.reject(new Error('no file is looked up by this test')),
    },
    ...ports,
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
  finance = buildModule(testPorts())
  repo = new DrizzleReceiptPdfRepository(database)
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

/** One issued receipt of a fresh unit, through the real manual payment (DOC-22 §5.2). */
async function seedReceipt(building: string): Promise<string> {
  const unitId = ids.next()
  const batchId = ids.next()
  const chargeId = ids.next()
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: building,
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
    dueDate: '2026-11-10',
    status: 'published',
    createdBy: ids.next(),
    publishedAt: AT,
    publishedBy: ids.next(),
    version: 2,
  })
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId: building,
    batchId,
    unitId,
    unitCode: 'A-1508',
    amount: AMOUNT,
    status: 'draft',
    version: 1,
  })
  await database.executor.insert(chargeLine).values({
    id: ids.next(),
    buildingId: building,
    chargeId,
    position: 1,
    kind: 'fee',
    itemName: { vi: 'Phí quản lý', en: 'Management fee' },
    quantity: '1',
    unitPrice: AMOUNT,
    amount: AMOUNT,
  })
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(chargeTable.buildingId, building), eq(chargeTable.id, chargeId)))

  const input: ManualPaymentInput = {
    unitId,
    chargeIds: [chargeId],
    method: 'cash',
    payerName: 'Trần Minh Anh',
    receivedOn: RECEIVED_ON,
  }
  await finance.useCases.recordManualPayment.execute(staff('manager', building), input, ids.next())

  const [row] = await database.executor
    .select({ id: receipt.id })
    .from(receipt)
    .where(and(eq(receipt.buildingId, building), eq(receipt.chargeId, chargeId)))
  if (!row) throw new Error('no receipt was issued')
  return row.id
}

/** The current pointer of a receipt, read directly (the test's own check). */
async function pointerOf(building: string, receiptId: string): Promise<string | null> {
  const [row] = await database.executor
    .select({ pdfFile: receipt.pdfFile })
    .from(receipt)
    .where(and(eq(receipt.buildingId, building), eq(receipt.id, receiptId)))
  return row?.pdfFile ?? null
}

/** Void a receipt, pointing it at the issued copy; the guard allows status, voided_at and pdf_file changes. */
async function makeVoid(building: string, receiptId: string, pdfFile: string): Promise<void> {
  await database.executor
    .update(receipt)
    .set({ status: 'void', pdfFile, voidedAt: VOIDED_AT, updatedAt: sql`now()` })
    .where(and(eq(receipt.buildingId, building), eq(receipt.id, receiptId)))
}

describe('DrizzleReceiptPdfRepository (DOC-34 §8.2, DR-295)', () => {
  test('findForRender reads a receipt; a void, then null across buildings', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)

    const issued = await repo.findForRender(scopeOf(building), receiptId)
    expect(issued).not.toBeNull()
    expect(issued?.id).toBe(receiptId)
    expect(issued?.status).toBe('issued')
    expect(issued?.pdfFile).toBeNull()
    expect(issued?.voidedAt).toBeNull()
    expect(issued?.voidReason).toBeNull()
    expect(issued?.snapshot.unitCode).toBe('A-1508')
    expect(issued?.number).toMatch(/^BL-\d{4}-\d{4,}$/)

    await makeVoid(building, receiptId, FILE_A)
    const voided = await repo.findForRender(scopeOf(building), receiptId)
    expect(voided?.status).toBe('void')
    expect(voided?.voidedAt).not.toBeNull()

    expect(await repo.findForRender(scopeOf(ids.next()), receiptId)).toBeNull()
  })

  test('an issued swap sets a null pointer and reports nothing replaced', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)

    const result = await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_A,
      expectedStatus: 'issued',
    })
    expect(result).toEqual({ replaced: null })
    expect(await pointerOf(building, receiptId)).toBe(FILE_A)
  })

  test('a second swap of the same file is a no-op (IS DISTINCT FROM)', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)
    await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_A,
      expectedStatus: 'issued',
    })

    const result = await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_A,
      expectedStatus: 'issued',
    })
    expect(result).toBeNull()
    expect(await pointerOf(building, receiptId)).toBe(FILE_A)
  })

  test('an issued copy never replaces a pointer', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)
    await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_A,
      expectedStatus: 'issued',
    })

    const result = await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_B,
      expectedStatus: 'issued',
    })
    expect(result).toBeNull()
    expect(await pointerOf(building, receiptId)).toBe(FILE_A)
  })

  test('the void swap replaces the issued copy and reports it', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)
    await makeVoid(building, receiptId, FILE_A)

    const result = await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_B,
      expectedStatus: 'void',
    })
    expect(result).toEqual({ replaced: FILE_A })
    expect(await pointerOf(building, receiptId)).toBe(FILE_B)
  })

  test('a swap whose expected status is wrong is a no-op', async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)

    const result = await repo.swapPdfFile(scopeOf(building), {
      receiptId,
      newFile: FILE_A,
      expectedStatus: 'void',
    })
    expect(result).toBeNull()
    expect(await pointerOf(building, receiptId)).toBeNull()
  })

  test("another building's receipt id is not found and cannot be swapped", async () => {
    const building = ids.next()
    const receiptId = await seedReceipt(building)
    const other = scopeOf(ids.next())

    expect(await repo.findForRender(other, receiptId)).toBeNull()
    expect(
      await repo.swapPdfFile(other, {
        receiptId,
        newFile: FILE_A,
        expectedStatus: 'issued',
      }),
    ).toBeNull()
    expect(await pointerOf(building, receiptId)).toBeNull()
  })
})
