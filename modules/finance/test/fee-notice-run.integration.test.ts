import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import type { BuildingId } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { FeeNoticeCache } from '../src/application/fee-notice-cache'
import type { LogoSource } from '../src/application/logo-source'
import type { PdfInput, PdfRenderer } from '../src/application/pdf-renderer'
import type { NoticeBuilding, NoticeContextSource } from '../src/application/ports'
import { RunFeeNoticeJob } from '../src/application/use-cases/run-fee-notice-job'
import { DrizzleChargeRepository } from '../src/infrastructure/persistence/drizzle-charge-repository'
import { DrizzleFeeNoticeJobRepository } from '../src/infrastructure/persistence/drizzle-fee-notice-job-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'
import { MemoryFilesApi, type StoredFile } from './memory-files-api'

/**
 * The work loop of `fee_notice_run` (P2-13, slice 10b-2; DOC-34 §9.2, DR-294): `RunFeeNoticeJob` over a clone of the
 * migrated template, a fake `PdfRenderer` and the shared in-memory `FilesApi`. PD-24, PD-28, PD-34…PD-36, PD-38 and
 * PD-39 of §16.3; the persistence and the request/status use cases are `fee-notice-job.integration.test.ts`.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const AMOUNT = 984_825
const PDF = new TextEncoder().encode('%PDF-fake')
const TEST_ZONE = 'Asia/Ho_Chi_Minh'
const BATCH_CODE = 'PH-2610-01'

let db: TestDb
let database: Database
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** One `finance.fee_notice_job` row, the columns the tests read (snake_case mapped). */
interface JobRow {
  readonly status: string
  readonly attempts: number
  readonly unitDone: number
  readonly cursorCharge: string | null
  readonly error: unknown
}

/** A `PdfRenderer` that records the unit of every call, may fail some, and may run a hook after each call. */
class FakeRenderer implements PdfRenderer {
  readonly codes: string[] = []

  constructor(
    private readonly options: {
      onCall?: (count: number) => void
      failFor?: (input: PdfInput) => boolean
    } = {},
  ) {}

  get calls(): number {
    return this.codes.length
  }

  async render(input: PdfInput): Promise<Uint8Array> {
    this.codes.push(input.unit.code)
    this.options.onCall?.(this.codes.length)
    if (this.options.failFor?.(input)) throw new Error('render_failed')
    return PDF
  }
}

/** A `PdfRenderer` that blocks its first call until `release()` (PD-24); the two workers share it. */
class GateRenderer implements PdfRenderer {
  private startedResolve: () => void = () => {}
  private releaseResolve: () => void = () => {}
  private blocked = false
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve
  })
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseResolve = resolve
  })

  async render(): Promise<Uint8Array> {
    if (!this.blocked) {
      this.blocked = true
      this.startedResolve()
      await this.gate
    }
    return PDF
  }

  release(): void {
    this.releaseResolve()
  }
}

const noLogo: LogoSource = { load: async () => null }

/** The port of DOC-34 §6.1 (DR-292): the building block and the per-unit owner names. */
class FakeNoticeContext implements NoticeContextSource {
  readonly owners = new Map<string, string | null>()

  async building(): Promise<NoticeBuilding> {
    return {
      name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
      company: { name: { vi: 'Công ty Quản lý Sunrise' }, address: '12 Nguyễn Huệ, Quận 1' },
      address: '12 Nguyễn Huệ, Quận 1',
      hotline: '1900 1234',
      email: 'bql@sunrise.vn',
      workingHours: null,
      logoFile: null,
      gatewayActive: false,
    }
  }

  /** Counts the calls and tells a test hook which one this is (one call per chunk of 20 units). */
  ownerCalls = 0
  onOwnerNames: ((call: number) => void) | undefined

  async ownerNames(_buildingId: string, unitIds: string[]): Promise<Map<string, string | null>> {
    this.ownerCalls += 1
    this.onOwnerNames?.(this.ownerCalls)
    return new Map(unitIds.map((unitId) => [unitId, this.owners.get(unitId) ?? null]))
  }
}

/** Builds the work loop over the shared in-memory `FilesApi` and an injected renderer. */
function harness(options: { renderer?: PdfRenderer } = {}) {
  const files = new MemoryFilesApi(ids)
  const renderer = options.renderer ?? new FakeRenderer()
  const noticeContext = new FakeNoticeContext()
  const jobs = new DrizzleFeeNoticeJobRepository(database)
  const run = new RunFeeNoticeJob(
    new DrizzleChargeRepository(database),
    jobs,
    new FeeNoticeCache(files, noLogo, renderer),
    files,
    noticeContext,
    { timeZone: async () => TEST_ZONE },
    clock,
    silent,
    1,
  )
  return { run, jobs, files, renderer, noticeContext }
}

/** One published `PH-2610-01` batch with `count` open charges, one per unit `A-0001…`. */
async function seedBatch(buildingId: string, count: number): Promise<string> {
  const batchId = ids.next()
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId,
    code: BATCH_CODE,
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
    dueDate: '2026-11-10',
    status: 'published',
    createdBy: ids.next(),
    publishedAt: AT,
    publishedBy: ids.next(),
    version: 1,
  })
  const charges: (typeof chargeTable.$inferInsert)[] = []
  const lines: (typeof chargeLine.$inferInsert)[] = []
  for (let index = 0; index < count; index += 1) {
    const chargeId = ids.next()
    charges.push({
      id: chargeId,
      buildingId,
      batchId,
      unitId: ids.next(),
      unitCode: `A-${String(index + 1).padStart(4, '0')}`,
      amount: AMOUNT,
      status: 'draft',
      version: 1,
    })
    lines.push({
      id: ids.next(),
      buildingId,
      chargeId,
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: AMOUNT,
      amount: AMOUNT,
    })
  }
  await database.executor.insert(chargeTable).values(charges)
  await database.executor.insert(chargeLine).values(lines)
  // The guard keeps lines immutable once a charge is open: lines first, then the transition.
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: 2 })
    .where(eq(chargeTable.batchId, batchId))
  return batchId
}

/** The one job of a batch, from the real repository. */
async function createJob(
  jobs: DrizzleFeeNoticeJobRepository,
  buildingId: string,
  batchId: string,
): Promise<string> {
  const { job } = await jobs.request(
    { buildingId: buildingId as BuildingId },
    { id: ids.next(), batchId, language: 'vi', requestedBy: ids.next() },
  )
  return job.id
}

/** One `finance.fee_notice_job` row of a run, or `undefined`. */
async function jobRow(jobId: string): Promise<JobRow | undefined> {
  const [row] = await db.sql`SELECT status, attempts, unit_done, cursor_charge, error
    FROM finance.fee_notice_job WHERE id = ${jobId}`
  if (!row) return undefined
  return {
    status: row.status as string,
    attempts: Number(row.attempts),
    unitDone: Number(row.unit_done),
    cursorCharge: (row.cursor_charge as string | null) ?? null,
    error: row.error,
  }
}

/** Makes the lease of a claimed job look expired, as a worker that died would (DOC-34 §9.2). */
async function expireLease(jobId: string): Promise<void> {
  await db.sql`UPDATE finance.fee_notice_job SET locked_until = now() - interval '10 seconds'
    WHERE id = ${jobId}`
}

/** The `bulk_zip` row of a run, or `undefined`. */
const bulkZip = (files: MemoryFilesApi): StoredFile | undefined =>
  [...files.files.values()].find(
    (file) => file.purpose === 'bulk_zip' && file.status === 'attached',
  )

/** The end-of-central-directory offset of an archive with no comment (PD-38). */
function eocd(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1)
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  throw new Error('no end-of-central-directory record')
}

/** The central-directory entries: name and compression method (0 = stored), PD-38. */
function centralEntries(data: Uint8Array): Array<{ name: string; method: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const start = eocd(view)
  const count = view.getUint16(start + 10, true)
  let offset = view.getUint32(start + 16, true)
  const entries: Array<{ name: string; method: number }> = []
  for (let index = 0; index < count; index += 1) {
    const method = view.getUint16(offset + 10, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const unzip = Bun.which('unzip')
if (!unzip)
  console.log(
    'fee-notice-run.integration.test: `unzip` is not on PATH, skipping the `unzip -t` check',
  )

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
})

afterAll(async () => {
  await database.close()
  await db.drop()
})

describe('RunFeeNoticeJob (DOC-34 §9.2; DR-294; P2-13)', () => {
  test('PD-28 a run aborted after the first chunk resumes after the cursor and renders each unit once', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 45)
    const controller = new AbortController()
    const renderer = new FakeRenderer({
      onCall: (count) => {
        if (count >= 20) controller.abort()
      },
    })
    const { run, jobs, files } = harness({ renderer })
    const jobId = await createJob(jobs, buildingId, batchId)

    const first = await run.execute({ buildingId, signal: controller.signal })
    expect(first.outcome).toBe('aborted')

    const afterFirst = await jobRow(jobId)
    expect(afterFirst?.unitDone).toBe(20)
    expect(afterFirst?.cursorCharge).not.toBeNull()

    await expireLease(jobId)
    const second = await run.execute({ buildingId })
    expect(second.outcome).toBe('ready')

    expect(renderer.calls).toBe(45)
    expect(new Set(renderer.codes).size).toBe(45)

    const row = await jobRow(jobId)
    expect(row?.attempts).toBe(2)

    const zip = bulkZip(files)
    if (!zip) throw new Error('the run stored no ZIP')
    const entries = unzipSync(zip.bytes)
    expect(Object.keys(entries).filter((name) => name.endsWith('.pdf'))).toHaveLength(45)
    const manifest = entries[`${BATCH_CODE}/manifest.csv`]
    if (!manifest) throw new Error('the ZIP holds no manifest')
    const rows = new TextDecoder().decode(manifest).split('\n')
    expect(rows.filter((line) => line.endsWith(',ok'))).toHaveLength(45)
  })

  test('PD-28 a shutdown during the ZIP phase publishes nothing: the job stays running and the next claim redoes phase 2', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 45)
    const controller = new AbortController()
    const { run, jobs, noticeContext, files } = harness()
    // Phase 1 reads the owners of 3 chunks (45 units); the 4th call is the first chunk of phase 2.
    noticeContext.onOwnerNames = (call) => {
      if (call === 4) controller.abort()
    }
    const jobId = await createJob(jobs, buildingId, batchId)

    const first = await run.execute({ buildingId, signal: controller.signal })
    expect(first.outcome).toBe('aborted')
    const afterFirst = await jobRow(jobId)
    expect(afterFirst?.status).toBe('running')
    expect(bulkZip(files)).toBeUndefined()

    await expireLease(jobId)
    noticeContext.onOwnerNames = undefined
    const second = await run.execute({ buildingId })
    expect(second.outcome).toBe('ready')
    expect((await jobRow(jobId))?.attempts).toBe(2)
  })

  test('PD-34 a unit whose render fails twice is left out and listed failed; the job is ready', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 3)
    const renderer = new FakeRenderer({ failFor: (input) => input.unit.code === 'A-0002' })
    const { run, jobs, files } = harness({ renderer })
    const jobId = await createJob(jobs, buildingId, batchId)

    expect((await run.execute({ buildingId })).outcome).toBe('ready')

    const zip = bulkZip(files)
    if (!zip) throw new Error('the run stored no ZIP')
    const entries = unzipSync(zip.bytes)
    expect(Object.keys(entries).filter((name) => name.endsWith('.pdf'))).toHaveLength(2)
    const manifest = entries[`${BATCH_CODE}/manifest.csv`]
    if (!manifest) throw new Error('the ZIP holds no manifest')
    expect(new TextDecoder().decode(manifest)).toContain('A-0002,,failed')

    const row = await jobRow(jobId)
    expect(row?.status).toBe('ready')
  })

  test('PD-35 every render failing ends the job failed with all_units_failed and no ZIP', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 3)
    const renderer = new FakeRenderer({ failFor: () => true })
    const { run, jobs, files } = harness({ renderer })
    const jobId = await createJob(jobs, buildingId, batchId)

    expect((await run.execute({ buildingId })).outcome).toBe('failed')

    const row = await jobRow(jobId)
    expect(row?.status).toBe('failed')
    expect((row?.error as { code?: string } | null)?.code).toBe('all_units_failed')
    expect(bulkZip(files)).toBeUndefined()
  })

  test('PD-36 a job claimed three times and expired again is failed with attempts_exhausted', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 2)
    const { run, jobs } = harness()
    const jobId = await createJob(jobs, buildingId, batchId)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await jobs.claim(buildingId)
      if (!claimed) throw new Error(`claim ${attempt} found nothing`)
      expect(claimed.attempts).toBe(attempt)
      await expireLease(claimed.id)
    }

    expect((await run.execute({ buildingId })).outcome).toBe('idle')

    const row = await jobRow(jobId)
    expect(row?.status).toBe('failed')
    expect((row?.error as { code?: string } | null)?.code).toBe('attempts_exhausted')
  })

  test.skipIf(!unzip)(
    'PD-38 the stored ZIP passes `unzip -t`, names the units and holds the manifest last',
    async () => {
      const buildingId = ids.next()
      const batchId = await seedBatch(buildingId, 3)
      const { run, jobs, files } = harness()
      await createJob(jobs, buildingId, batchId)

      expect((await run.execute({ buildingId })).outcome).toBe('ready')

      const zip = bulkZip(files)
      if (!zip) throw new Error('the run stored no ZIP')
      expect(centralEntries(zip.bytes).map((entry) => entry.name)).toEqual([
        `${BATCH_CODE}/A-0001.pdf`,
        `${BATCH_CODE}/A-0002.pdf`,
        `${BATCH_CODE}/A-0003.pdf`,
        `${BATCH_CODE}/manifest.csv`,
      ])
      const manifest = unzipSync(zip.bytes)[`${BATCH_CODE}/manifest.csv`]
      if (!manifest) throw new Error('the ZIP holds no manifest')
      expect([...manifest.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

      const dir = mkdtempSync(join(tmpdir(), 'fee-notice-run-'))
      const path = join(dir, `${BATCH_CODE}.zip`)
      writeFileSync(path, zip.bytes)
      try {
        expect(Bun.spawnSync(['unzip', '-t', path]).exitCode).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  test('PD-39 a second run on a ready job claims nothing and writes one ZIP', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 2)
    const { run, jobs, files } = harness()
    await createJob(jobs, buildingId, batchId)

    expect((await run.execute({ buildingId })).outcome).toBe('ready')
    expect([...files.files.values()].filter((file) => file.purpose === 'bulk_zip')).toHaveLength(1)

    expect(await run.execute({ buildingId })).toEqual({ outcome: 'idle', jobId: null })
    expect([...files.files.values()].filter((file) => file.purpose === 'bulk_zip')).toHaveLength(1)
  })

  test('PD-24 a worker whose lease expired writes nothing; the job finishes once with attempts 2', async () => {
    const buildingId = ids.next()
    const batchId = await seedBatch(buildingId, 2)
    const renderer = new GateRenderer()
    const { run, jobs } = harness({ renderer })
    const jobId = await createJob(jobs, buildingId, batchId)

    const workerA = run.execute({ buildingId })
    await renderer.started
    await expireLease(jobId)

    const workerB = await run.execute({ buildingId })
    expect(workerB.outcome).toBe('ready')

    renderer.release()
    const a = await workerA
    expect(a.outcome).toBe('lost_lease')
    expect(a.jobId).toBe(jobId)

    const row = await jobRow(jobId)
    expect([row?.status, row?.attempts]).toEqual(['ready', 2])
  })
})
