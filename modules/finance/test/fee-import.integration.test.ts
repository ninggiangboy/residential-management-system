import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, NotFoundError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { FileActor, FileExpectation, FilesApi } from '@mod/building/contracts'
import type { BuildingId, LocalDate, StaffContext, StaffId } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import ExcelJS from 'exceljs'
import { financeManifest } from '../src'
import type { FoundUnitDto } from '../src/application/ports'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'

/**
 * The fee import of DOC-21 §4 (P2-04) on a clone of the migrated template: validation to a stored preview, the commit in one
 * transaction, and what a second "Save", a parallel one, the clock, a publish or a changed unit list does to it. The units come
 * from a directory standing in for `ResidencyApi.findUnitsByCodes` (its query is tested in `residency`).
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const OCTOBER = '2026-10-01' as LocalDate
const HEADER = [
  'Mã căn hộ',
  'Tháng phí',
  'Tên khoản',
  'Số lượng',
  'Đơn giá',
  'Thành tiền',
  'Loại',
  'Ghi chú',
]

let db: TestDb
let database: Database
let finance: FinanceModule
const ids = new UuidV7Generator()
const clock = new FakeClock(new Date('2026-10-01T03:00:00Z'))
const units = new Map<string, FoundUnitDto>()

type Stored = {
  bytes: Uint8Array
  accountId: string
  status: 'verified' | 'attached'
  ownerRef: string | null
}

/** `FilesApi.read` and `attach` in memory, with the rules of DOC-37 §6.4 that the import relies on. */
class MemoryFiles implements Pick<FilesApi, 'read' | 'attach'> {
  readonly stored = new Map<string, Stored>()

  put(accountId: string, bytes: Uint8Array): string {
    const id = crypto.randomUUID()
    this.stored.set(id, { bytes, accountId, status: 'verified', ownerRef: null })
    return id
  }

  async read(actor: FileActor, fileId: string, expect: FileExpectation) {
    const file = this.stored.get(fileId)
    if (!file || (file.status === 'verified' && file.accountId !== actor.accountId))
      throw new NotFoundError()
    if (expect.module !== 'finance' || expect.purpose !== 'import')
      throw new Error('file_not_verified')
    const usable = file.status === 'verified' || file.ownerRef === expect.ownerRef
    if (!usable) throw new Error('file_not_verified')
    return file.bytes
  }

  async attach(actor: FileActor, fileId: string, ownerRef: string) {
    const file = this.stored.get(fileId)
    if (file?.status !== 'verified' || file.accountId !== actor.accountId)
      throw new Error('file_not_verified')
    file.status = 'attached'
    file.ownerRef = ownerRef
  }
}
const files = new MemoryFiles()

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, financeManifest]),
    purgeGraceMinutes: 0,
  })
  finance = createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: {
      findUnitsByCodes: async (_building, codes) =>
        codes.flatMap((code) => {
          const unit = units.get(code.toLowerCase())
          return unit ? [unit] : []
        }),
    },
    files,
  })
})

afterAll(async () => {
  await database.close()
  await db.drop()
})

const manager = (buildingId: string = ids.next()): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role: 'manager',
  scope: { buildingId: buildingId as BuildingId },
})

/** The code of a refused call, or `ok`. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    const details = (error as { details?: unknown }).details
    const rule = Array.isArray(details) ? (details[0] as { code?: string })?.code : undefined
    return rule ? `${error.code}:${rule}` : error.code
  }
}

async function workbookOf(rows: readonly (readonly unknown[])[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Phí')
  for (const row of rows) sheet.addRow([...row])
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Units `<prefix>-1001…` with an active owner, registered in the directory. */
function seedUnits(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const code = `${prefix}-${1001 + i}`
    units.set(code.toLowerCase(), {
      unitId: ids.next(),
      code,
      occupancy: 'occupied',
      hasActiveOwner: true,
    })
    return code
  })
}

/** Two rows per unit, as the sample of FR-01.1: the management fee and the water line. */
const twoRowsEach = (codes: readonly string[]): unknown[][] =>
  codes.flatMap((code) => [
    [code, '10/2026', 'Phí quản lý', 1, 2_488_000, 2_488_000, '', ''],
    [code, '10/2026', 'Nước', '12,345', 15_000, 185_175, '', ''],
  ])

async function newDraft(staff: StaffContext) {
  return finance.useCases.createFeeBatch.execute(staff, {
    name: { vi: 'Phí tháng 10/2026' },
    feeMonth: OCTOBER,
    dueDate: '2026-10-15' as LocalDate,
  })
}

async function validate(
  staff: StaffContext,
  batchId: string,
  rows: readonly (readonly unknown[])[],
) {
  const fileId = files.put(staff.staffId, await workbookOf([HEADER, ...rows]))
  return finance.useCases.validateFeeImport.execute(staff, {
    batchId,
    fileId,
    fileName: 'phi-10.xlsx',
  })
}

const commit = (staff: StaffContext, importId: string) =>
  finance.useCases.commitFeeImport.execute(staff, importId)

async function chargesOf(batchId: string) {
  const [row] = await db.sql`
    SELECT count(DISTINCT c.id)::int AS charges, count(l.id)::int AS lines, coalesce(sum(l.amount), 0)::bigint AS total
      FROM finance.charge c LEFT JOIN finance.charge_line l ON l.charge_id = c.id
     WHERE c.batch_id = ${batchId}`
  return { charges: row?.charges as number, lines: row?.lines as number, total: Number(row?.total) }
}

const jobCount = async (buildingId: string) => {
  const [row] =
    await db.sql`SELECT count(*)::int AS n FROM finance.import_job WHERE building_id = ${buildingId}`
  return row?.n as number
}

async function publish(staff: StaffContext, batchId: string) {
  // The publish use case is P2-05; the state is set as the migrator, which the guard trigger allows for draft → published.
  await db.admin()`UPDATE finance.fee_batch SET status = 'published', published_at = now(), published_by = ${staff.staffId},
                   version = version + 1 WHERE id = ${batchId}`
}

describe('the 240-row file of FR-01.1 (IM-50, IM-65, IM-72)', () => {
  const staff = manager()
  let batchId: string
  let importId: string
  const codes = seedUnits('A', 120)

  /** Rows 12, 57, 58 and 201 wrong: an unknown unit, the next month, a repeated item, an amount that is not the product. */
  function sample(): unknown[][] {
    const rows = twoRowsEach(codes)
    const at = (sheetRow: number) => rows[sheetRow - 2] as unknown[]
    at(12)[0] = 'A-9999'
    at(57)[1] = '11/2026'
    at(58).splice(0, 3, at(56)[0], '10/2026', 'phí quản lý')
    at(201)[5] = 185_000
    return rows
  }

  test('IM-50 236 valid rows and 4 errors with row, column and code; the job is validated; nothing is written', async () => {
    batchId = (await newDraft(staff)).id
    const job = await validate(staff, batchId, sample())
    importId = job.id
    expect(job.status).toBe('validated')
    expect(job.result.counts).toEqual({
      rows: 240,
      valid: 236,
      errors: 4,
      warnings: 0,
      charges: 120,
      lines: 236,
      totalAmount: 120 * (2_488_000 + 185_175) - 2 * 2_488_000 - 2 * 185_175,
    })
    expect(job.result.issues.map((issue) => [issue.row, issue.column, issue.code])).toEqual([
      [12, 'unit_code', 'unit_not_found'],
      [57, 'fee_month', 'fee_month_mismatch'],
      [58, 'item_name', 'charge_item_duplicate'],
      [201, 'amount', 'amount_mismatch'],
    ])
    expect(job.result.issues[2]?.params).toEqual({ item: 'phí quản lý', firstRow: 56 })
    expect(job.result.validRows).toHaveLength(50)
    expect(files.stored.get(job.fileId)?.ownerRef).toBe(`import:${job.id}`)
    expect(await chargesOf(batchId)).toEqual({ charges: 0, lines: 0, total: 0 })
  })

  test('IM-65 the commit writes exactly 236 lines in 120 charges, bumps the batch version and audits created/replaced', async () => {
    const result = await commit(staff, importId)
    expect(result.committed).toEqual({ created: 120, replaced: 0 })
    expect(result.job.status).toBe('committed')
    expect(await chargesOf(batchId)).toEqual({
      charges: 120,
      lines: 236,
      total: 120 * (2_488_000 + 185_175) - 2 * 2_488_000 - 2 * 185_175,
    })
    const [batch] = await db.sql`SELECT version FROM finance.fee_batch WHERE id = ${batchId}`
    expect(batch?.version).toBe(2)
    const [first] = await db.sql`
      SELECT c.unit_code, c.amount::bigint AS amount, array_agg(l.position ORDER BY l.position) AS positions
        FROM finance.charge c JOIN finance.charge_line l ON l.charge_id = c.id
       WHERE c.batch_id = ${batchId} AND c.unit_code = ${codes[0] as string} GROUP BY c.id`
    expect([first?.unit_code, Number(first?.amount), first?.positions]).toEqual([
      codes[0],
      2_673_175,
      [1, 2],
    ])
    const audit =
      await db.sql`SELECT action, details FROM audit.audit_log WHERE object_id = ${importId}`
    expect(audit.map((row) => row.action)).toEqual(['finance.batch.import_commit'])
    expect(audit[0]?.details).toMatchObject({ created: 120, replaced: 0, batchId })
  })

  test('save twice: one commit, the same answer, the rows once (FR-01.3)', async () => {
    const again = await commit(staff, importId)
    expect(again.committed).toEqual({ created: 120, replaced: 0 })
    expect((await chargesOf(batchId)).lines).toBe(236)
    const audit = await db.sql`SELECT 1 FROM audit.audit_log WHERE object_id = ${importId}`
    expect(audit).toHaveLength(1)
  })

  test('IM-72 two commits of one job released together: one writes, both get its answer, the draft has the rows once', async () => {
    const job = await validate(staff, batchId, twoRowsEach(codes.slice(0, 30)))
    const answers = await Promise.all([commit(staff, job.id), commit(staff, job.id)])
    expect(answers.map((answer) => answer.committed)).toEqual([
      { created: 30, replaced: 120 },
      { created: 30, replaced: 120 },
    ])
    expect(await chargesOf(batchId)).toMatchObject({ charges: 30, lines: 60 })
    const audit = await db.sql`SELECT 1 FROM audit.audit_log WHERE object_id = ${job.id}`
    expect(audit).toHaveLength(1)
  })
})

describe('re-import and the batch state (IM-64, IM-66, IM-67, IM-71, DQ-79)', () => {
  test('IM-66, IM-67 a corrected file replaces the draft, the charge added by hand included', async () => {
    const staff = manager()
    const codes = seedUnits('B', 120)
    const batchId = (await newDraft(staff)).id
    await commit(staff, (await validate(staff, batchId, twoRowsEach(codes))).id)
    const [byHand] = seedUnits('BH', 1)
    await finance.useCases.addDraftCharge.execute(staff, batchId, {
      unitCode: byHand as string,
      lines: [{ itemName: { vi: 'Phí gửi xe' }, amount: 120_000 }],
    })
    expect((await chargesOf(batchId)).charges).toBe(121)
    const corrected = await validate(staff, batchId, twoRowsEach(codes.slice(0, 100)))
    expect((await commit(staff, corrected.id)).committed).toEqual({ created: 100, replaced: 121 })
    expect(await chargesOf(batchId)).toMatchObject({ charges: 100, lines: 200 })
    const left =
      await db.sql`SELECT 1 FROM finance.charge WHERE batch_id = ${batchId} AND unit_code = ${byHand as string}`
    expect(left).toHaveLength(0)
  })

  test('IM-64 a published batch is 409 invalid_transition, another building’s batch 404; no job is stored', async () => {
    const staff = manager()
    const [code] = seedUnits('C', 1)
    const rows = twoRowsEach([code as string])
    const published = (await newDraft(staff)).id
    await publish(staff, published)
    expect(await codeOf(() => validate(staff, published, rows))).toBe('invalid_transition')
    const theirs = (await newDraft(manager())).id
    expect(await codeOf(() => validate(staff, theirs, rows))).toBe('not_found')
    expect(await jobCount(staff.buildingId)).toBe(0)
  })

  test('DQ-79 a commit after the batch was published is 409 invalid_transition and writes nothing', async () => {
    const staff = manager()
    const codes = seedUnits('D', 3)
    const batchId = (await newDraft(staff)).id
    const job = await validate(staff, batchId, twoRowsEach(codes))
    await publish(staff, batchId)
    expect(await codeOf(() => commit(staff, job.id))).toBe('invalid_transition')
    expect(await chargesOf(batchId)).toMatchObject({ charges: 0 })
    expect((await finance.queries.feeImports.get(staff, job.id)).status).toBe('validated')
  })

  test('IM-71 the job of a discarded draft is 404 not_found', async () => {
    const staff = manager()
    const codes = seedUnits('E', 2)
    const batch = await newDraft(staff)
    const job = await validate(staff, batch.id, twoRowsEach(codes))
    await finance.useCases.discardFeeBatch.execute(staff, batch.id, batch.version)
    expect(await codeOf(() => commit(staff, job.id))).toBe('not_found')
  })
})

describe('jobs that cannot be committed (IM-51, IM-54, IM-68, IM-69, IM-70)', () => {
  test('IM-51 5,001 rows are 400 too_many_rows and no job; 5,000 rows are accepted', async () => {
    const staff = manager()
    const codes = seedUnits('F', 2501)
    const batchId = (await newDraft(staff)).id
    const tooMany = twoRowsEach(codes).slice(0, 5001)
    expect(await codeOf(() => validate(staff, batchId, tooMany))).toBe(
      'validation_failed:too_many_rows',
    )
    expect(await jobCount(staff.buildingId)).toBe(0)
    const job = await validate(staff, batchId, tooMany.slice(0, 5000))
    expect([job.status, job.result.counts.valid, job.result.counts.charges]).toEqual([
      'validated',
      5000,
      2500,
    ])
  })

  test('IM-54, IM-70 no price and no amount column: the job is failed with import_no_price; the commit is 409 import_not_ready', async () => {
    const staff = manager()
    const batchId = (await newDraft(staff)).id
    const fileId = files.put(
      staff.staffId,
      await workbookOf([
        ['Mã căn hộ', 'Tháng phí', 'Tên khoản', 'Số lượng'],
        ['A-1001', '10/2026', 'Phí quản lý', 1],
      ]),
    )
    const job = await finance.useCases.validateFeeImport.execute(staff, { batchId, fileId })
    expect(job.status).toBe('failed')
    expect(job.result.issues).toEqual([
      {
        row: 1,
        unitCode: null,
        column: null,
        severity: 'fail',
        code: 'import_no_price',
        params: {},
      },
    ])
    expect(await codeOf(() => commit(staff, job.id))).toBe('import_not_ready')
  })

  test('IM-68 a commit 24 h after the preview is 409 import_expired and writes nothing (FakeClock)', async () => {
    const staff = manager()
    const codes = seedUnits('G', 2)
    const batchId = (await newDraft(staff)).id
    const job = await validate(staff, batchId, twoRowsEach(codes))
    clock.advance(24 * 3_600_000)
    try {
      expect(await codeOf(() => commit(staff, job.id))).toBe('import_expired')
      expect((await finance.queries.feeImports.get(staff, job.id)).status).toBe('expired')
    } finally {
      clock.advance(-24 * 3_600_000)
    }
    expect(await chargesOf(batchId)).toMatchObject({ charges: 0 })
  })

  test('IM-69 a unit that lost its owner since the preview makes the commit 409 import_stale; nothing is written', async () => {
    const staff = manager()
    const codes = seedUnits('H', 3)
    const batchId = (await newDraft(staff)).id
    const job = await validate(staff, batchId, twoRowsEach(codes))
    const unit = units.get((codes[1] as string).toLowerCase()) as FoundUnitDto
    units.set((codes[1] as string).toLowerCase(), { ...unit, hasActiveOwner: false })
    expect(await codeOf(() => commit(staff, job.id))).toBe('import_stale')
    expect(await chargesOf(batchId)).toMatchObject({ charges: 0 })
    expect((await finance.queries.feeImports.get(staff, job.id)).status).toBe('validated')
  })

  test('the history list: newest first, the counts only, paged', async () => {
    const staff = manager()
    const codes = seedUnits('J', 1)
    const batchId = (await newDraft(staff)).id
    const first = await validate(staff, batchId, twoRowsEach(codes))
    const second = await validate(staff, batchId, twoRowsEach(codes))
    const page = await finance.queries.feeImports.list(staff, { limit: 1 })
    expect(page.items.map((item) => [item.id, item.batchId, item.counts.lines])).toEqual([
      [second.id, batchId, 2],
    ])
    const rest = await finance.queries.feeImports.list(staff, {
      limit: 1,
      after: page.next ?? undefined,
    })
    expect(rest.items.map((item) => item.id)).toEqual([first.id])
    expect(rest.next).toBeNull()
  })
})

describe('cost (IM-77, DOC-21 §4.6)', () => {
  test('IM-77 the 2,000-row file of FR-01.7: validation within 10 s (NFR-12); both times recorded', async () => {
    const staff = manager()
    const codes = seedUnits('K', 1000)
    const batchId = (await newDraft(staff)).id
    const rows = twoRowsEach(codes)
    let began = performance.now()
    const job = await validate(staff, batchId, rows)
    const validateMs = performance.now() - began
    began = performance.now()
    const result = await commit(staff, job.id)
    const commitMs = performance.now() - began
    console.info(
      `IM-77 2,000 rows: validate ${validateMs.toFixed(0)} ms, commit ${commitMs.toFixed(0)} ms (1,000 charges, 2,000 lines)`,
    )
    expect(job.result.counts.valid).toBe(2000)
    expect(result.committed.created).toBe(1000)
    expect(validateMs).toBeLessThan(10_000)
  })
})
