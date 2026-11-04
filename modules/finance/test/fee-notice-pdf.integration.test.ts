import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq } from 'drizzle-orm'
import { financeManifest } from '../src'
import type { PdfInput, PdfLanguage, PdfRenderer } from '../src/application/pdf-renderer'
import type { NoticeBuilding, NoticeContextSource } from '../src/application/ports'
import type { ChargeStatus, FeeBatchStatus } from '../src/domain/fee-batch'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'
import { MemoryFilesApi, type StoredFile } from './memory-files-api'
import { testPorts } from './support/ports'

/**
 * The P2-13 fee-notice cache (DOC-34 §6.3, §8.1; DR-292, DR-293): `RenderFeeNoticePdf` over a clone of the migrated
 * template, the real `finance` module, a fake `PdfRenderer` and the shared in-memory `FilesApi`. PD-06, PD-07, PD-08
 * and PD-17…PD-19 (§16.2); the routes E-176 and E-183 join with P2-15 and P2-25.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const AMOUNT = 984_825
const PDF = new TextEncoder().encode('%PDF-fake')

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** A `PdfRenderer` that counts its calls, remembers the last input (PD-08) and answers `%PDF-fake`. */
class FakeRenderer implements PdfRenderer {
  calls = 0
  last: PdfInput | null = null

  async render(input: PdfInput): Promise<Uint8Array> {
    this.calls += 1
    this.last = input
    return PDF
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

/** The port of DOC-34 §6.1 (DR-292): a building block a test may edit (PD-07, PD-18) and per-unit owner names. */
class FakeNoticeContext implements NoticeContextSource {
  data: NoticeBuilding = BUILDING
  readonly owners = new Map<string, string | null>()

  async building(): Promise<NoticeBuilding> {
    return this.data
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
  metrics: MetricsPort = NO_METRICS,
): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files,
    metrics,
    noticeContext,
    pdfRenderer: renderer,
    ...testPorts(),
  })
}

function harness(
  options: {
    renderer?: FakeRenderer
    noticeContext?: FakeNoticeContext
    metrics?: MetricsPort
  } = {},
) {
  const files = new MemoryFilesApi(ids)
  const renderer = options.renderer ?? new FakeRenderer()
  const noticeContext = options.noticeContext ?? new FakeNoticeContext()
  return {
    finance: buildFinance(files, renderer, noticeContext, options.metrics),
    files,
    renderer,
    noticeContext,
  }
}

interface Seeded {
  readonly unitId: string
  readonly batchId: string
  readonly chargeId: string
}

/** A published PH-2610-01 batch for A-1508 with two lines (DR-292): the source of every notice here. */
async function seedBatch(
  building: string,
  options: { batchStatus?: FeeBatchStatus; chargeStatus?: ChargeStatus; code?: string } = {},
): Promise<Seeded> {
  const unitId = ids.next()
  const batchId = ids.next()
  const chargeId = ids.next()
  const batchStatus = options.batchStatus ?? 'published'
  const chargeStatus = options.chargeStatus ?? 'open'
  const draft = batchStatus === 'draft'
  const recalled = batchStatus === 'recalled'
  const voided = chargeStatus === 'void'
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
    // The guard keeps lines immutable once the charge is open: lines first, then the transitions.
    status: 'draft',
    version: 1,
  })
  await database.executor.insert(chargeLine).values([
    {
      id: ids.next(),
      buildingId: building,
      chargeId,
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '85',
      unitPrice: 12000,
      amount: 1020000,
    },
    {
      id: ids.next(),
      buildingId: building,
      chargeId,
      position: 2,
      kind: 'adjustment',
      itemName: { vi: 'Điều chỉnh', en: 'Adjustment' },
      quantity: '1',
      unitPrice: 0,
      amount: -35175,
      note: 'Trừ phí nước tính thừa T9',
    },
  ])
  if (chargeStatus !== 'draft') {
    await database.executor
      .update(chargeTable)
      .set({ status: 'open', version: 2 })
      .where(eq(chargeTable.id, chargeId))
  }
  if (chargeStatus === 'paid') {
    await database.executor
      .update(chargeTable)
      .set({ status: 'paid', version: 3 })
      .where(eq(chargeTable.id, chargeId))
  }
  if (voided) {
    await database.executor
      .update(chargeTable)
      .set({
        status: 'void',
        voidKind: 'single',
        voidReason: 'Test void reason',
        voidedAt: AT,
        voidedBy: ids.next(),
        version: 3,
      })
      .where(eq(chargeTable.id, chargeId))
  }
  return { unitId, batchId, chargeId }
}

/** The `fee_notice_pdf` rows of a building, whatever their key (PD-17, PD-18). */
const noticeRows = (files: MemoryFilesApi, building: string): StoredFile[] =>
  [...files.files.values()].filter(
    (file) =>
      file.buildingId === building &&
      file.purpose === 'fee_notice_pdf' &&
      file.status === 'attached',
  )

const run = (
  finance: FinanceModule,
  building: string,
  chargeId: string,
  language: PdfLanguage,
  wantBytes: boolean,
) =>
  finance.useCases.renderFeeNoticePdf.execute({
    buildingId: building,
    chargeId,
    language,
    wantBytes,
  })

/** The `DomainError` code of a refused call, or `ok`. */
async function codeOf(runCall: () => Promise<unknown>): Promise<string> {
  try {
    await runCall()
    return 'ok'
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    return error.code
  }
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
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

describe('RenderFeeNoticePdf (DOC-34 §6.3, §8.1; DR-292, DR-293; P2-13)', () => {
  test('PD-17 a published charge renders once and is served from the cache the second time', async () => {
    const building = ids.next()
    const context = new FakeNoticeContext()
    const { finance, files, renderer } = harness({ noticeContext: context })
    const { unitId, batchId, chargeId } = await seedBatch(building)
    context.owners.set(unitId, 'Trần Minh Anh')

    const first = await run(finance, building, chargeId, 'vi', true)
    expect(first.cached).toBe(false)
    expect(first.fileName).toBe('PH-2610-01-A-1508.pdf')
    expect(first.bytes).not.toBeNull()

    const rows = noticeRows(files, building)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.ownerRef).toMatch(
      new RegExp(`^batch/${batchId}/unit/${unitId}/vi/[0-9a-f]{16}\\.pdf$`),
    )
    expect(renderer.calls).toBe(1)

    const second = await run(finance, building, chargeId, 'vi', true)
    expect(second.cached).toBe(true)
    expect(second.fileId).toBe(first.fileId)
    expect(second.bytes).not.toBeNull()
    expect(renderer.calls).toBe(1)
    expect(noticeRows(files, building)).toHaveLength(1)
  })

  test('PD-18 the language and then a logo change make new rows; the first row stays', async () => {
    const building = ids.next()
    const context = new FakeNoticeContext()
    const { finance, files } = harness({ noticeContext: context })
    const { unitId, chargeId } = await seedBatch(building)
    context.owners.set(unitId, 'Trần Minh Anh')

    const vi = await run(finance, building, chargeId, 'vi', false)
    const en = await run(finance, building, chargeId, 'en', false)
    context.data = { ...context.data, logoFile: ids.next() }
    const enLogo = await run(finance, building, chargeId, 'en', false)

    expect(noticeRows(files, building)).toHaveLength(3)
    expect(new Set([vi.fileId, en.fileId, enLogo.fileId]).size).toBe(3)
    expect(files.files.get(vi.fileId as string)?.status).toBe('attached')
  })

  test('PD-19 a void charge and a recalled batch are 409; another building\u2019s charge is 404', async () => {
    const building = ids.next()
    const { finance } = harness()
    const voided = await seedBatch(building, { chargeStatus: 'void' })
    const recalled = await seedBatch(building, { batchStatus: 'recalled', code: 'PH-2610-02' })
    const foreign = await seedBatch(ids.next())

    expect(await codeOf(() => run(finance, building, voided.chargeId, 'vi', false))).toBe(
      'invalid_transition',
    )
    expect(await codeOf(() => run(finance, building, recalled.chargeId, 'vi', false))).toBe(
      'invalid_transition',
    )
    expect(await codeOf(() => run(finance, building, foreign.chargeId, 'vi', false))).toBe(
      'not_found',
    )
  })

  test('PD-06 a draft renders every time and writes no row', async () => {
    const building = ids.next()
    const context = new FakeNoticeContext()
    const { finance, files, renderer } = harness({ noticeContext: context })
    const { unitId, chargeId } = await seedBatch(building, {
      batchStatus: 'draft',
      chargeStatus: 'draft',
    })
    context.owners.set(unitId, 'Trần Minh Anh')

    const first = await run(finance, building, chargeId, 'vi', true)
    const second = await run(finance, building, chargeId, 'vi', true)

    expect(first.cached).toBe(false)
    expect(first.fileId).toBeNull()
    expect(first.bytes).not.toBeNull()
    expect(second.fileId).toBeNull()
    expect(renderer.calls).toBe(2)
    expect(noticeRows(files, building)).toHaveLength(0)
  })

  test('PD-07 the gateway switch changes the hash', async () => {
    const building = ids.next()
    const context = new FakeNoticeContext()
    const { finance, files } = harness({ noticeContext: context })
    const { unitId, chargeId } = await seedBatch(building)
    context.owners.set(unitId, 'Trần Minh Anh')

    const off = await run(finance, building, chargeId, 'vi', false)
    context.data = { ...context.data, gatewayActive: true }
    const on = await run(finance, building, chargeId, 'vi', false)

    expect(off.fileId).not.toBe(on.fileId)
    expect(noticeRows(files, building)).toHaveLength(2)
  })

  test('PD-08 a unit without an owner renders with no owner name', async () => {
    const building = ids.next()
    const { finance, renderer } = harness()
    const { chargeId } = await seedBatch(building)

    const result = await run(finance, building, chargeId, 'vi', true)

    expect(result.cached).toBe(false)
    const notice = renderer.last
    if (notice?.kind !== 'fee_notice') throw new Error('the renderer got no fee notice')
    expect(notice.unit.ownerName).toBeNull()
  })
})
