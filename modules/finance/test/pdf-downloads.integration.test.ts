import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import {
  type BuildingId,
  type MembershipId,
  NO_METRICS,
  type ResidentAccountId,
  type StaffContext,
  type StaffId,
  type StaffRole,
  type UnitContext,
  type UnitId,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { and, eq, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import {
  type PdfInput,
  type PdfLanguage,
  type PdfRenderer,
  PdfRenderFailure,
} from '../src/application/pdf-renderer'
import type { NoticeBuilding, NoticeContextSource } from '../src/application/ports'
import { FeeNoticeQueries } from '../src/application/queries/fee-notice-queries'
import {
  RECEIPT_PDF_READ_ROLES,
  ReceiptPdfQueries,
} from '../src/application/queries/receipt-pdf-queries'
import { receiptPdfKey } from '../src/application/receipt-pdf-input'
import type { ChargeStatus, FeeBatchStatus } from '../src/domain/fee-batch'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { DrizzleFeeBatchRepository } from '../src/infrastructure/persistence/drizzle-fee-batch-repository'
import { DrizzleFeeNoticeJobRepository } from '../src/infrastructure/persistence/drizzle-fee-notice-job-repository'
import { DrizzleReceiptPdfRepository } from '../src/infrastructure/persistence/drizzle-receipt-pdf-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  payment,
  receipt,
} from '../src/infrastructure/persistence/schema'
import { MemoryFilesApi, type StoredFile } from './memory-files-api'
import { testPorts } from './support/ports'

/**
 * The on-demand PDF downloads of DOC-34 §8.2: E-106 (`ReceiptPdfQueries.forStaff`) and E-84 (`forUnit`, the DR-40 window of
 * PD-25), plus E-176 (`FeeNoticeQueries.chargeNotice`, §6.3, §8.1). The real `finance` module over a clone of the migrated
 * template, a fake `PdfRenderer` and the shared in-memory `FilesApi`; the routes that wire these query services and the HTTP
 * half are the leader's (PD-25, E-84/E-106/E-176).
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const RECEIVED_ON = '2026-10-19'
const AMOUNT = 2_488_000
const PDF = new TextEncoder().encode('%PDF-fake')

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** A `PdfRenderer` that counts its calls, remembers the last input and fails the next renders when asked (PD-19). */
class FakeRenderer implements PdfRenderer {
  calls = 0
  failTimes = 0
  last: PdfInput | null = null

  async render(input: PdfInput): Promise<Uint8Array> {
    this.calls += 1
    this.last = input
    if (this.failTimes > 0) {
      this.failTimes -= 1
      throw new PdfRenderFailure('render_failed', 'the fake renderer failed once')
    }
    return Uint8Array.from(PDF)
  }
}

const BUILDING: NoticeBuilding = {
  name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
  company: { name: { vi: 'Công ty Quản lý Sunrise' }, address: '12 Nguyễn Huệ, Quận 1' },
  address: '12 Nguyễn Huệ, Quận 1',
  hotline: '1900 1234',
  email: 'bql@sunrise.vn',
  workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: 'Mon – Fri, 8:00 – 17:00' },
  logoFile: '0192f3c4-9d02-7000-8000-00000000f0a1',
  gatewayActive: false,
}

/** The `NoticeContextSource` of DOC-34 §6.1 (DR-292): a fixed building block and per-unit owner names. */
class FakeNoticeContext implements NoticeContextSource {
  readonly owners = new Map<string, string | null>()

  async building(): Promise<NoticeBuilding> {
    return BUILDING
  }

  async ownerNames(_buildingId: string, unitIds: string[]): Promise<Map<string, string | null>> {
    return new Map(unitIds.map((unitId) => [unitId, this.owners.get(unitId) ?? null]))
  }
}

/** Builds the real `finance` module over the shared in-memory `FilesApi` and an injected renderer. */
function buildFinance(
  files: MemoryFilesApi,
  renderer: PdfRenderer,
  noticeContext: NoticeContextSource,
  language: PdfLanguage,
): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files,
    metrics: NO_METRICS,
    noticeContext,
    noticeLanguage: { language: async () => language },
    pdfRenderer: renderer,
    ...testPorts(),
  })
}

/** The module and the two query services a route calls, over one `FilesApi` and one `PdfRenderer`. */
function harness(
  options: {
    renderer?: FakeRenderer
    noticeContext?: FakeNoticeContext
    language?: PdfLanguage
  } = {},
) {
  const files = new MemoryFilesApi(ids)
  const renderer = options.renderer ?? new FakeRenderer()
  const noticeContext = options.noticeContext ?? new FakeNoticeContext()
  const language = options.language ?? 'both'
  const finance = buildFinance(files, renderer, noticeContext, language)
  return {
    finance,
    files,
    renderer,
    receipts: new ReceiptPdfQueries(
      new DrizzleReceiptPdfRepository(database),
      files,
      finance.useCases.renderReceiptPdf,
    ),
    notices: new FeeNoticeQueries(
      new DrizzleFeeNoticeJobRepository(database),
      new DrizzleFeeBatchRepository(database),
      { signedUrl: async () => null, findByOwnerRef: (b, i) => files.findByOwnerRef(b, i) },
      clock,
      finance.useCases.renderFeeNoticePdf,
      { language: async () => language },
    ),
  }
}

const staff = (buildingId: string, role: StaffRole = 'manager'): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

const unit = (buildingId: string, unitId: string, startedAt: Date): UnitContext => ({
  buildingId: buildingId as BuildingId,
  unitId: unitId as UnitId,
  membershipId: ids.next() as MembershipId,
  accountId: ids.next() as ResidentAccountId,
  memberType: 'owner',
  canPay: true,
  startedAt,
  scope: { buildingId: buildingId as BuildingId },
})

const run = <T>(call: () => Promise<T>) =>
  call().then(
    () => 'ok',
    (error: unknown) => {
      if (!(error instanceof DomainError)) throw error
      return error.code
    },
  )

interface SeededReceipt {
  readonly receiptId: string
  readonly number: string
  readonly unitId: string
  readonly receivedAt: Date
}

/** One issued receipt of a fresh unit, through the real manual payment (DOC-22 §5.2): the fixture of E-84 and E-106. */
async function seedReceipt(finance: FinanceModule, building: string): Promise<SeededReceipt> {
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
  await finance.useCases.recordManualPayment.execute(
    staff(building),
    {
      unitId,
      chargeIds: [chargeId],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: RECEIVED_ON,
    },
    ids.next(),
  )
  const [row] = await database.executor
    .select({ id: receipt.id, number: receipt.number, paymentId: receipt.paymentId })
    .from(receipt)
    .where(and(eq(receipt.buildingId, building), eq(receipt.chargeId, chargeId)))
  if (!row) throw new Error('no receipt was issued')
  const [pay] = await database.executor
    .select({ receivedAt: payment.receivedAt })
    .from(payment)
    .where(and(eq(payment.buildingId, building), eq(payment.id, row.paymentId)))
  if (!pay) throw new Error('the receipt has no payment')
  return { receiptId: row.id, number: row.number, unitId, receivedAt: pay.receivedAt }
}

/** Voids a receipt directly (the guard allows `status` and `voided_at`); `pdfFile` keeps or clears the pointer. */
async function markVoid(
  building: string,
  receiptId: string,
  pdfFile: string | null,
): Promise<void> {
  await database.executor
    .update(receipt)
    .set({ status: 'void', voidedAt: MODULE_NOW, pdfFile, updatedAt: sql`now()` })
    .where(and(eq(receipt.buildingId, building), eq(receipt.id, receiptId)))
}

interface SeededCharge {
  readonly unitId: string
  readonly batchId: string
  readonly chargeId: string
}

/** A charge for A-1508 of a fresh unit (DR-292): the source of every E-176 notice. */
async function seedCharge(
  building: string,
  options: { batchStatus?: FeeBatchStatus; chargeStatus?: ChargeStatus; code?: string } = {},
): Promise<SeededCharge> {
  const unitId = ids.next()
  const batchId = ids.next()
  const chargeId = ids.next()
  const batchStatus = options.batchStatus ?? 'published'
  const chargeStatus = options.chargeStatus ?? 'open'
  const draft = batchStatus === 'draft'
  const recalled = batchStatus === 'recalled'
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: building,
    code: options.code ?? 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
    dueDate: '2026-11-10',
    status: batchStatus,
    createdBy: ids.next(),
    publishedAt: draft ? null : AT,
    publishedBy: draft ? null : ids.next(),
    recalledAt: recalled ? AT : null,
    recalledBy: recalled ? ids.next() : null,
    version: 1,
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
  if (chargeStatus !== 'draft') {
    await database.executor
      .update(chargeTable)
      .set({ status: chargeStatus, version: 2 })
      .where(and(eq(chargeTable.buildingId, building), eq(chargeTable.id, chargeId)))
  }
  return { unitId, batchId, chargeId }
}

const noticeRows = (files: MemoryFilesApi, building: string): StoredFile[] =>
  [...files.files.values()].filter(
    (file) =>
      file.buildingId === building &&
      file.purpose === 'fee_notice_pdf' &&
      file.status === 'attached',
  )

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
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

describe('ReceiptPdfQueries (E-84, E-106; DOC-34 §8.2, PD-25)', () => {
  test('E-106, PD-25 a receipt renders once and the stored copy is served the second time', async () => {
    const building = ids.next()
    const { finance, files, renderer, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    const member = staff(building)

    const first = await receipts.forStaff(member, seeded.receiptId)
    expect(first.fileName).toBe(`${seeded.number}.pdf`)
    expect(new TextDecoder().decode(first.bytes.subarray(0, 5))).toBe('%PDF-')
    expect(renderer.calls).toBe(1)
    const key = receiptPdfKey(seeded.receiptId, 'issued')
    expect(
      files.attached(building, { module: 'finance', purpose: 'receipt_pdf', ownerRef: key }),
    ).toHaveLength(1)

    const second = await receipts.forStaff(member, seeded.receiptId)
    expect(renderer.calls).toBe(1)
    expect(second.bytes).toEqual(first.bytes)
  })

  test('E-84 a receipt of the unit inside the DR-40 window renders for the resident', async () => {
    const building = ids.next()
    const { finance, renderer, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    const member = unit(building, seeded.unitId, new Date(seeded.receivedAt.getTime() - 1000))

    const result = await receipts.forUnit(member, seeded.receiptId)
    expect(result.fileName).toBe(`${seeded.number}.pdf`)
    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe('%PDF-')
    expect(renderer.calls).toBe(1)
  })

  test('PD-25 a payment before `startedAt` (DR-40 window) is 404', async () => {
    const building = ids.next()
    const { finance, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    const member = unit(building, seeded.unitId, new Date(seeded.receivedAt.getTime() + 1000))

    expect(await run(() => receipts.forUnit(member, seeded.receiptId))).toBe('not_found')
  })

  test('E-84 another unit\u2019s receipt is 404', async () => {
    const building = ids.next()
    const { finance, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    const member = unit(building, ids.next(), new Date(0))

    expect(await run(() => receipts.forUnit(member, seeded.receiptId))).toBe('not_found')
  })

  test('E-106 a receipt of another building is 404', async () => {
    const building = ids.next()
    const { finance, receipts } = harness()
    const seeded = await seedReceipt(finance, building)

    expect(await run(() => receipts.forStaff(staff(ids.next()), seeded.receiptId))).toBe(
      'not_found',
    )
  })

  test('PD-21 a void receipt serves the VOID variant', async () => {
    const building = ids.next()
    const { finance, renderer, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    await markVoid(building, seeded.receiptId, null)

    const result = await receipts.forStaff(staff(building), seeded.receiptId)
    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe('%PDF-')
    const input = renderer.last
    if (input?.kind !== 'receipt') throw new Error('the renderer got no receipt')
    expect(input.void).not.toBeNull()
  })

  test('PD-19 a failing renderer is the typed 503 service_unavailable with a 5-second hint', async () => {
    const building = ids.next()
    const { finance, renderer, receipts } = harness()
    const seeded = await seedReceipt(finance, building)
    renderer.failTimes = 1

    const error = await receipts.forStaff(staff(building), seeded.receiptId).then(
      () => null,
      (failure: unknown) => failure,
    )
    expect(error).toBeInstanceOf(DomainError)
    if (!(error instanceof DomainError)) throw new Error('not a domain error')
    expect(error.code).toBe('service_unavailable')
    expect(error.kind).toBe('unavailable')
    expect(error.retryAfterSeconds).toBe(5)
  })

  test('the staff roles of E-106 are the Manager and the Admin', () => {
    expect([...RECEIPT_PDF_READ_ROLES]).toEqual(['admin', 'manager'])
  })
})

describe('FeeNoticeQueries.chargeNotice (E-176; DOC-34 §6.3, §8.1)', () => {
  test('PD-17 a published charge renders once, then is served from the cache', async () => {
    const building = ids.next()
    const { notices, renderer } = harness()
    const { chargeId } = await seedCharge(building)

    const first = await notices.chargeNotice(staff(building), chargeId)
    expect(first.fileName).toBe('PH-2610-01-A-1508.pdf')
    expect(first.cached).toBe(false)
    expect(new TextDecoder().decode(first.bytes.subarray(0, 5))).toBe('%PDF-')

    const second = await notices.chargeNotice(staff(building), chargeId)
    expect(second.cached).toBe(true)
    expect(second.bytes).toEqual(first.bytes)
    expect(renderer.calls).toBe(1)
  })

  test('PD-06 a draft carries the draft mark, is never cached and honours `language`', async () => {
    const building = ids.next()
    const { notices, renderer } = harness()
    const { chargeId } = await seedCharge(building, {
      batchStatus: 'draft',
      chargeStatus: 'draft',
      code: 'PH-2610-02',
    })

    const result = await notices.chargeNotice(staff(building), chargeId, { language: 'en' })
    expect(result.cached).toBe(false)
    const input = renderer.last
    if (input?.kind !== 'fee_notice') throw new Error('the renderer got no fee notice')
    expect(input.draft).toBe(true)
    expect(input.language).toBe('en')
  })

  test('PD-19 a recalled batch is 409 invalid_transition, another building\u2019s charge is 404', async () => {
    const building = ids.next()
    const { notices } = harness()
    const recalled = await seedCharge(building, { batchStatus: 'recalled', code: 'PH-2610-03' })
    const foreign = await seedCharge(ids.next())

    expect(await run(() => notices.chargeNotice(staff(building), recalled.chargeId))).toBe(
      'invalid_transition',
    )
    expect(await run(() => notices.chargeNotice(staff(building), foreign.chargeId))).toBe(
      'not_found',
    )
  })

  test('PD-19 a failing renderer is the typed 503 service_unavailable with a 5-second hint', async () => {
    const building = ids.next()
    const { notices, files, renderer } = harness()
    const { chargeId } = await seedCharge(building)
    renderer.failTimes = 1

    const error = await notices.chargeNotice(staff(building), chargeId).then(
      () => null,
      (failure: unknown) => failure,
    )
    expect(error).toBeInstanceOf(DomainError)
    if (!(error instanceof DomainError)) throw new Error('not a domain error')
    expect(error.code).toBe('service_unavailable')
    expect(error.retryAfterSeconds).toBe(5)
    expect(noticeRows(files, building)).toHaveLength(0)
  })
})
