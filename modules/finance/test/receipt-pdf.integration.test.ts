import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type {
  FileActor,
  FileDto,
  FileExpectation,
  FilesApi,
  FindByOwnerRefInput,
  StoreGeneratedInput,
} from '@mod/building/contracts'
import {
  type BuildingId,
  type MetricsPort,
  NO_METRICS,
  type StaffContext,
  type StaffId,
  type StaffRole,
} from '@rms/shared-types'
import { cloneTemplate, recordingMetrics, type TestDb } from '@rms/test-support'
import { and, eq, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import { type PdfInput, type PdfRenderer, PdfRenderFailure } from '../src/application/pdf-renderer'
import { receiptPdfKey } from '../src/application/receipt-pdf-input'
import { FINANCE_EVENTS, type ReceiptRenderRequestedPayload } from '../src/contracts'
import type { ManualPaymentInput } from '../src/domain/manual-payment'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { HostPdfRenderer } from '../src/infrastructure/pdf/host-pdf-renderer'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  receipt,
} from '../src/infrastructure/persistence/schema'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The P2-13 receipt PDF flow (DOC-34 §8.2, DR-295): `RenderReceiptPdf`, the handler `finance.render_receipt_pdf` and the
 * five steps of §8.2 over a clone of the migrated template — the real `finance` module, a fake `PdfRenderer` that returns
 * `%PDF-fake`, and an in-memory `FilesApi` with its object store. PD-17…PD-23, and PD-17b with the real renderer. Every
 * test seeds its own building through the real `recordManualPayment`, so the receipts stay independent.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const RECEIVED_ON = '2026-10-19'
const AMOUNT = 2_488_000
const VOIDED_AT = new Date('2026-10-12T03:00:00Z')
const PDF = new TextEncoder().encode('%PDF-fake')

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** A `PdfRenderer` that counts its calls and answers `%PDF-fake`; `failTimes` fails the next renders (PD-21). */
class FakeRenderer implements PdfRenderer {
  calls = 0
  failTimes = 0
  /** When set, a render waits on it: PD-23 holds both renders until the test releases them. */
  gate: ReturnType<typeof makeBarrier> | null = null

  async render(_input: PdfInput): Promise<Uint8Array> {
    this.calls += 1
    if (this.gate) await this.gate.wait()
    if (this.failTimes > 0) {
      this.failTimes -= 1
      throw new PdfRenderFailure('render_failed', 'the fake renderer failed once')
    }
    return PDF
  }
}

interface StoredFile {
  readonly fileId: string
  readonly buildingId: string
  readonly module: string
  readonly purpose: string
  readonly ownerRef: string | null
  status: 'attached' | 'deleted'
  readonly bytes: Uint8Array
  readonly seq: number
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** The real `FilesApi`'s rules for the four methods the use case calls, over an in-memory object store. */
class MemoryFilesApi
  implements Pick<FilesApi, 'read' | 'attach' | 'remove' | 'storeGenerated' | 'findByOwnerRef'>
{
  private seq = 0

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }
  readonly files = new Map<string, StoredFile>()

  constructor(private readonly ids: UuidV7Generator) {}

  /** The receipt PDF path never attaches a file by hand: `storeGenerated` writes it `attached`. */
  async attach(): Promise<void> {
    throw new Error('attach is not used by the receipt PDF')
  }

  async storeGenerated(input: StoreGeneratedInput): Promise<FileDto> {
    const bytes = input.body instanceof Uint8Array ? input.body : await collect(input.body)
    const fileId = this.ids.next()
    this.files.set(fileId, {
      fileId,
      buildingId: input.buildingId,
      module: input.module,
      purpose: input.purpose,
      ownerRef: input.ownerRef,
      status: 'attached',
      bytes,
      seq: this.nextSeq(),
    })
    const dto = this.dto(fileId)
    if (!dto) throw new Error('the stored file vanished')
    return dto
  }

  async findByOwnerRef(buildingId: string, input: FindByOwnerRefInput): Promise<FileDto | null> {
    const match = this.attached(buildingId, input).sort((a, b) => b.seq - a.seq)[0]
    return match ? (this.dto(match.fileId) ?? null) : null
  }

  async read(_actor: FileActor, fileId: string, expect: FileExpectation): Promise<Uint8Array> {
    const file = this.files.get(fileId)
    if (!file || file.status !== 'attached' || file.ownerRef !== expect.ownerRef)
      throw new Error('file_not_verified')
    return file.bytes
  }

  async remove(_actor: FileActor, fileId: string): Promise<void> {
    const file = this.files.get(fileId)
    if (file) file.status = 'deleted'
  }

  /** The `attached` rows of a building, module, purpose and ownerRef, in insert order. */
  attached(
    buildingId: string,
    input: { module: string; purpose: string; ownerRef: string },
  ): StoredFile[] {
    return [...this.files.values()].filter(
      (file) =>
        file.status === 'attached' &&
        file.buildingId === buildingId &&
        file.module === input.module &&
        file.purpose === input.purpose &&
        file.ownerRef === input.ownerRef,
    )
  }

  /** Every row of a key, `attached` or `deleted` (the PD-23 check). */
  all(ownerRef: string, buildingId: string): StoredFile[] {
    return [...this.files.values()].filter(
      (file) => file.ownerRef === ownerRef && file.buildingId === buildingId,
    )
  }

  private dto(fileId: string): FileDto | undefined {
    const file = this.files.get(fileId)
    if (!file) return undefined
    return {
      fileId: file.fileId,
      purpose: file.purpose as FileDto['purpose'],
      mime: 'application/pdf',
      size: file.bytes.byteLength,
      status: file.status,
      createdAt: AT.toISOString(),
    }
  }
}

/** The building's fee-notice language at a first render (DOC-34 §7.3): `both` for the fixture. */
const NOTICE_LANGUAGE = { language: async () => 'both' as const }

/** Builds the real `finance` module over an in-memory `FilesApi` and an injected `PdfRenderer`. */
function buildFinance(
  files: MemoryFilesApi,
  renderer: PdfRenderer,
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
    noticeLanguage: NOTICE_LANGUAGE,
    pdfRenderer: renderer,
    ...testPorts(),
  })
}

function harness(options: { renderer?: FakeRenderer; metrics?: MetricsPort } = {}) {
  const files = new MemoryFilesApi(ids)
  const renderer = options.renderer ?? new FakeRenderer()
  return { finance: buildFinance(files, renderer, options.metrics), files, renderer }
}

const staff = (buildingId: string, role: StaffRole = 'manager'): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

/** One issued receipt of a fresh unit, through the real manual payment (DOC-22 §5.2): the fixture of every test. */
async function seedReceipt(finance: FinanceModule, building: string): Promise<string> {
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
  await finance.useCases.recordManualPayment.execute(staff(building), input, ids.next())
  const [row] = await database.executor
    .select({ id: receipt.id })
    .from(receipt)
    .where(and(eq(receipt.buildingId, building), eq(receipt.chargeId, chargeId)))
  if (!row) throw new Error('no receipt was issued')
  return row.id
}

/** The current pointer of a receipt, read directly. */
async function pointerOf(building: string, receiptId: string): Promise<string | null> {
  const [row] = await database.executor
    .select({ pdfFile: receipt.pdfFile })
    .from(receipt)
    .where(and(eq(receipt.buildingId, building), eq(receipt.id, receiptId)))
  return row?.pdfFile ?? null
}

/** Voids a receipt directly (the guard allows `status`, `voided_at` and `pdf_file`); `pdfFile` keeps or clears the pointer. */
async function markVoid(
  building: string,
  receiptId: string,
  pdfFile: string | null,
): Promise<void> {
  await database.executor
    .update(receipt)
    .set({ status: 'void', voidedAt: VOIDED_AT, pdfFile, updatedAt: sql`now()` })
    .where(and(eq(receipt.buildingId, building), eq(receipt.id, receiptId)))
}

/** PD-22: whatever the pointer is, it names an `attached` file. */
async function assertAttachedPointer(
  files: MemoryFilesApi,
  building: string,
  receiptId: string,
): Promise<void> {
  const pointer = await pointerOf(building, receiptId)
  if (pointer === null) return
  expect(files.files.get(pointer)?.status).toBe('attached')
}

const run = (
  finance: FinanceModule,
  building: string,
  receiptId: string,
  variant: 'issued' | 'void',
  origin: 'handler' | 'inline' = 'handler',
) => finance.useCases.renderReceiptPdf.execute({ buildingId: building, receiptId, variant, origin })

const attachedRows = (files: MemoryFilesApi, building: string, ownerRef: string) =>
  files.attached(building, { module: 'finance', purpose: 'receipt_pdf', ownerRef })

function message(payload: ReceiptRenderRequestedPayload): Envelope {
  return {
    id: ids.next(),
    type: FINANCE_EVENTS.receiptRenderRequested,
    source: 'finance',
    aggregateId: payload.receiptId,
    occurredAt: MODULE_NOW.toISOString(),
    payload: { ...payload },
    headers: {},
  }
}

const handlerOf = (finance: FinanceModule) =>
  finance.handlers?.find((handler) => handler.eventType === FINANCE_EVENTS.receiptRenderRequested)

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

describe('RenderReceiptPdf (DOC-34 §8.2, DR-295, P2-13)', () => {
  test('PD-20 the handler stores the issued copy, sets the pointer and writes one row', async () => {
    const building = ids.next()
    const { finance, files, renderer } = harness()
    const receiptId = await seedReceipt(finance, building)
    const handler = handlerOf(finance)
    if (!handler) throw new Error('no render handler')

    await handler.handle(message({ buildingId: building, receiptId, variant: 'issued' }))

    const key = receiptPdfKey(receiptId, 'issued')
    const rows = attachedRows(files, building, key)
    expect(rows).toHaveLength(1)
    expect(renderer.calls).toBe(1)
    expect(await pointerOf(building, receiptId)).toBe(rows[0]?.fileId ?? null)
    await assertAttachedPointer(files, building, receiptId)
  })

  test('DR-295 the void copy replaces the issued one and deletes it in the same transaction', async () => {
    const building = ids.next()
    const { finance, files } = harness()
    const receiptId = await seedReceipt(finance, building)
    const issued = await run(finance, building, receiptId, 'issued')
    const issuedId = issued.fileId as string

    await markVoid(building, receiptId, issuedId)
    const voided = await run(finance, building, receiptId, 'void')
    expect(voided.outcome).toBe('rendered')
    expect(await pointerOf(building, receiptId)).toBe(voided.fileId)
    expect(files.files.get(issuedId)?.status).toBe('deleted')
    expect(attachedRows(files, building, receiptPdfKey(receiptId, 'void'))).toHaveLength(1)
    await assertAttachedPointer(files, building, receiptId)
  })

  test('PD-21 a voided receipt skips the late issued request', async () => {
    const building = ids.next()
    const { finance, renderer } = harness()
    const receiptId = await seedReceipt(finance, building)
    await markVoid(building, receiptId, null)

    const late = await run(finance, building, receiptId, 'issued')
    expect(late.outcome).toBe('skipped')
    expect(late.bytes).toBeNull()
    expect(renderer.calls).toBe(0)
  })

  test('PD-20, PD-22 a redelivery renders nothing, and a file left by a dead attempt is reused', async () => {
    const building = ids.next()
    const { finance, files, renderer } = harness()
    const receiptId = await seedReceipt(finance, building)
    const first = await run(finance, building, receiptId, 'issued')
    expect(first.outcome).toBe('rendered')

    const second = await run(finance, building, receiptId, 'issued')
    expect(second.outcome).toBe('skipped')
    expect(renderer.calls).toBe(1)
    const key = receiptPdfKey(receiptId, 'issued')
    expect(attachedRows(files, building, key)).toHaveLength(1)

    // The crash window: the file is under the key, the pointer is still null — the redelivery reuses it.
    const other = ids.next()
    const otherReceipt = await seedReceipt(finance, other)
    const orphanKey = receiptPdfKey(otherReceipt, 'issued')
    const orphan = await files.storeGenerated({
      buildingId: other,
      module: 'finance',
      purpose: 'receipt_pdf',
      ownerRef: orphanKey,
      mime: 'application/pdf',
      body: new TextEncoder().encode('%PDF-orphan'),
    })
    const reuse = await run(finance, other, otherReceipt, 'issued')
    expect(reuse.outcome).toBe('reused')
    expect(reuse.fileId).toBe(orphan.fileId)
    expect(renderer.calls).toBe(1)
    expect(await pointerOf(other, otherReceipt)).toBe(orphan.fileId)
    await assertAttachedPointer(files, other, otherReceipt)
  })

  test('DOC-34 §10 a render failure propagates, leaves no file or pointer, and the next attempt succeeds', async () => {
    const building = ids.next()
    const { finance, files, renderer } = harness()
    const receiptId = await seedReceipt(finance, building)
    renderer.failTimes = 1

    const failure = await run(finance, building, receiptId, 'issued').then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(PdfRenderFailure)
    expect(await pointerOf(building, receiptId)).toBeNull()
    expect(attachedRows(files, building, receiptPdfKey(receiptId, 'issued'))).toHaveLength(0)

    const retry = await run(finance, building, receiptId, 'issued')
    expect(retry.outcome).toBe('rendered')
    expect(renderer.calls).toBe(2)
    await assertAttachedPointer(files, building, receiptId)
  })

  test('DR-295 the pointer never points at nothing', async () => {
    const building = ids.next()
    const { finance, files } = harness()
    const receiptId = await seedReceipt(finance, building)
    await assertAttachedPointer(files, building, receiptId)

    const issued = await run(finance, building, receiptId, 'issued')
    await assertAttachedPointer(files, building, receiptId)
    await markVoid(building, receiptId, issued.fileId)
    await assertAttachedPointer(files, building, receiptId)
    await run(finance, building, receiptId, 'void')
    await assertAttachedPointer(files, building, receiptId)
  })

  test('PD-23 a barrier race leaves exactly one attached row and deletes the other', async () => {
    const building = ids.next()
    const gate = makeBarrier(2)
    const renderer = new FakeRenderer()
    renderer.gate = gate
    const { finance, files } = harness({ renderer })
    const receiptId = await seedReceipt(finance, building)

    const runs = [
      run(finance, building, receiptId, 'issued', 'handler'),
      run(finance, building, receiptId, 'issued', 'inline'),
    ]
    await gate.ready
    gate.go()
    const results = await Promise.all(runs)

    const key = receiptPdfKey(receiptId, 'issued')
    expect(attachedRows(files, building, key)).toHaveLength(1)
    expect(files.all(key, building).filter((row) => row.status === 'deleted')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'raced')).toHaveLength(1)
    await assertAttachedPointer(files, building, receiptId)
  })

  test('PD-20 with the real renderer and templates, an issued receipt renders end to end', async () => {
    const building = ids.next()
    const metrics = recordingMetrics()
    const renderer = new HostPdfRenderer({ role: 'worker', size: 1, metrics, logger: silent })
    const files = new MemoryFilesApi(ids)
    const finance = buildFinance(files, renderer, metrics)
    try {
      const receiptId = await seedReceipt(finance, building)
      const result = await run(finance, building, receiptId, 'issued')
      expect(result.outcome).toBe('rendered')
      expect(new TextDecoder().decode(result.bytes?.subarray(0, 5))).toBe('%PDF-')
    } finally {
      await renderer.close()
    }
  }, 30_000)
})
