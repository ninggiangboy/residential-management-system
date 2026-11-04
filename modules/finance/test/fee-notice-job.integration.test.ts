import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import type { FileDto, FilesApi, FindByOwnerRefInput } from '@mod/building/contracts'
import type { BuildingId, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import type { NoticeLanguageSource } from '../src/application/ports'
import { FeeNoticeQueries } from '../src/application/queries/fee-notice-queries'
import { RequestFeeNoticeZip } from '../src/application/use-cases/request-fee-notice-zip'
import { DrizzleFeeBatchRepository } from '../src/infrastructure/persistence/drizzle-fee-batch-repository'
import { DrizzleFeeNoticeJobRepository } from '../src/infrastructure/persistence/drizzle-fee-notice-job-repository'
import { makeBarrier } from './support'

/**
 * The persistence and the request/status use cases of the bulk fee notice job (P2-13, slice 10a; DOC-34 §9.1, §9.2 and
 * DR-293, DR-294): `DrizzleFeeNoticeJobRepository`, `RequestFeeNoticeZip` (E-99) and `FeeNoticeQueries.latestJob`
 * (E-177) over a clone of the migrated template. PD-09, PD-24, PD-27, PD-36, PD-39 and the E-177 shapes; the work loop
 * and the ZIP are the next slice, so no renderer is used. The use cases are built directly, because `finance.module.ts`
 * is wired by the leader.
 */

const MODULE_NOW = new Date('2026-10-01T03:15:00Z')
const AT = new Date('2026-10-01T03:00:00Z')
const CHARGE_AMOUNT = 2_488_000
const ZIP_SIZE = 7_373_121

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let repo: DrizzleFeeNoticeJobRepository
let request: RequestFeeNoticeZip
let queries: FeeNoticeQueries
let zips: ZipStore
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** One `finance.fee_batch` status the seed may name (the guard is BEFORE UPDATE, so an insert may name any of them). */
type SeedStatus = 'draft' | 'published' | 'closed' | 'recalled'
type ChargeStatus = 'draft' | 'open' | 'paid' | 'void'

/** The `attached` ZIP rows of the stand-in store, keyed by file id. */
interface StoredZip {
  readonly buildingId: string
  readonly ownerRef: string
  readonly size: number
}

/**
 * A small in-memory stand-in for the two `FilesApi` reads E-177 needs (`signedUrl`, `findByOwnerRef`); the real store is
 * the building module's (DOC-37 §8). `store` writes a file and `remove` deletes it: after that `latestJob` answers
 * `{ expired: true }` (PD-37).
 */
class ZipStore implements Pick<FilesApi, 'signedUrl' | 'findByOwnerRef'> {
  readonly files = new Map<string, StoredZip>()

  store(buildingId: string, ownerRef: string, size: number): string {
    const fileId = ids.next()
    this.files.set(fileId, { buildingId, ownerRef, size })
    return fileId
  }

  remove(fileId: string): void {
    this.files.delete(fileId)
  }

  async findByOwnerRef(buildingId: string, input: FindByOwnerRefInput): Promise<FileDto | null> {
    for (const [fileId, file] of this.files) {
      if (file.buildingId === buildingId && file.ownerRef === input.ownerRef)
        return {
          fileId,
          purpose: 'bulk_zip',
          mime: 'application/zip',
          size: file.size,
          status: 'attached',
          createdAt: AT.toISOString(),
        }
    }
    return null
  }

  async signedUrl(fileId: string): Promise<string | null> {
    return this.files.has(fileId) ? `https://files.test/${fileId}` : null
  }
}

const staff = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

/** The code of a refused call: the `DomainError` code and its first detail rule, or `ok`. */
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

/** Releases `racers` together behind a barrier (`makeBarrier`) and collects their outcomes (DOC-22 §16.2). */
async function race<T>(racers: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  const barrier = makeBarrier(racers.length)
  const started = racers.map(async (racer) => {
    await barrier.wait()
    return racer()
  })
  barrier.go()
  const settled = await Promise.allSettled(started)
  return settled.map((outcome) => {
    if (outcome.status === 'rejected') throw outcome.reason
    return outcome.value
  })
}

/** One `finance.fee_batch` at the wanted status; the guard is BEFORE UPDATE, so an insert may name any status. */
async function seedBatch(buildingId: string, status: SeedStatus, code: string): Promise<string> {
  const batchId = ids.next()
  const published = status !== 'draft'
  const recalled = status === 'recalled'
  const closed = status === 'closed'
  await admin`INSERT INTO finance.fee_batch
      (id, building_id, code, name, fee_month, due_date, status, created_by, version,
       published_at, published_by, recalled_at, recalled_by, closed_at, closed_by)
    VALUES (${batchId}, ${buildingId}, ${code}, ${admin.json({ vi: 'Phí tháng 10/2026' })},
            '2026-10-01', '2026-10-15', ${status}, ${ids.next()}, 1,
            ${published ? AT : null}, ${published ? ids.next() : null},
            ${recalled ? AT : null}, ${recalled ? ids.next() : null},
            ${closed ? AT : null}, ${closed ? ids.next() : null})`
  return batchId
}

/** One charge of a batch at a status the guard's transitions allow: draft → open → paid, or open → void. */
async function seedCharge(
  buildingId: string,
  batchId: string,
  unitCode: string,
  status: ChargeStatus,
): Promise<string> {
  const id = ids.next()
  await admin`INSERT INTO finance.charge
      (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    VALUES (${id}, ${buildingId}, ${batchId}, ${ids.next()}, ${unitCode}, ${CHARGE_AMOUNT}, 'draft', 1)`
  await admin`INSERT INTO finance.charge_line
      (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    VALUES (${ids.next()}, ${buildingId}, ${id}, 1, 'fee', ${admin.json({ vi: 'Phí quản lý' })},
            '1', ${CHARGE_AMOUNT}, ${CHARGE_AMOUNT})`
  if (status === 'draft') return id
  await admin`UPDATE finance.charge
      SET status = 'open', version = version + 1, updated_at = now() WHERE id = ${id}`
  if (status === 'open') return id
  if (status === 'paid') {
    await admin`UPDATE finance.charge
        SET status = 'paid', version = version + 1, updated_at = now() WHERE id = ${id}`
    return id
  }
  await admin`UPDATE finance.charge
      SET status = 'void', void_kind = 'recall', voided_at = now(), voided_by = ${ids.next()},
          version = version + 1, updated_at = now()
    WHERE id = ${id}`
  return id
}

/** Makes the lease of a claimed job look expired, as a worker that died would (DOC-34 §9.2). */
async function expireLease(jobId: string): Promise<void> {
  await db.sql`UPDATE finance.fee_notice_job SET locked_until = now() - interval '10 seconds'
    WHERE id = ${jobId}`
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  admin = db.admin(4)
  zips = new ZipStore()
  repo = new DrizzleFeeNoticeJobRepository(database)
  const batches = new DrizzleFeeBatchRepository(database)
  const noticeLanguage: NoticeLanguageSource = { language: async () => 'vi' }
  request = new RequestFeeNoticeZip(batches, repo, noticeLanguage, ids)
  queries = new FeeNoticeQueries(repo, batches, zips, clock)
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

describe('RequestFeeNoticeZip (E-99, DOC-34 §9.1, DR-293)', () => {
  test('PD-09 a draft and a recalled batch are 409 invalid_transition and write no job', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const draft = await seedBatch(building, 'draft', 'PH-2610-01')
    await seedCharge(building, draft, 'A-1508', 'draft')
    expect(await codeOf(() => request.execute(manager, draft))).toBe('invalid_transition')

    const recalled = await seedBatch(building, 'recalled', 'PH-2610-02')
    await seedCharge(building, recalled, 'A-1508', 'open')
    expect(await codeOf(() => request.execute(manager, recalled))).toBe('invalid_transition')

    const jobs = await db.sql`SELECT 1 FROM finance.fee_notice_job
       WHERE batch_id IN (${draft}, ${recalled})`
    expect(jobs).toHaveLength(0)
  })

  test('a closed batch is accepted, and unit_total counts only open and paid charges', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'closed', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1501', 'open')
    await seedCharge(building, batch, 'A-1502', 'open')
    await seedCharge(building, batch, 'A-1503', 'paid')
    await seedCharge(building, batch, 'A-1504', 'draft')
    await seedCharge(building, batch, 'A-1505', 'void')

    const created = await request.execute(manager, batch)
    expect(created.created).toBe(true)
    expect(created.job.status).toBe('queued')
    expect(created.job.language).toBe('vi')
    expect(created.job.unitTotal).toBe(3)
    expect(created.job.unitDone).toBe(0)
  })

  test("another building's batch is 404", async () => {
    const building = ids.next()
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')
    expect(await codeOf(() => request.execute(staff('manager', ids.next()), batch))).toBe(
      'not_found',
    )
  })

  test('PD-27 two requests released together make one job both answers carry (FNM-111)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')

    const results = await race([
      () => request.execute(manager, batch),
      () => request.execute(manager, batch),
    ])
    const rows = await db.sql`SELECT id FROM finance.fee_notice_job WHERE batch_id = ${batch}`
    expect(rows).toHaveLength(1)
    expect(results[0]?.job.id).toBe(results[1]?.job.id)
    expect(results[0]?.job.id).toBe(rows[0]?.id)
    expect(results.filter((result) => result.created)).toHaveLength(1)
  })

  test('a second request after failed and after ready creates a new job', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')

    const first = await request.execute(manager, batch)
    const failed = await repo.claim(building)
    if (!failed) throw new Error('no claim')
    expect(await repo.finishFailed(failed, { error: { code: 'all_units_failed' } })).toBe(true)
    const afterFailed = await request.execute(manager, batch)
    expect(afterFailed.created).toBe(true)
    expect(afterFailed.job.id).not.toBe(first.job.id)

    const second = await repo.claim(building)
    if (!second) throw new Error('no second claim')
    const zipFile = zips.store(building, `batch/${batch}/zip/${second.id}.zip`, ZIP_SIZE)
    expect(await repo.finishReady(second, { zipFile })).toBe(true)
    const afterReady = await request.execute(manager, batch)
    expect(afterReady.created).toBe(true)
    expect(afterReady.job.id).not.toBe(afterFailed.job.id)
  })
})

describe('the claim, the fence and the give-up (DOC-34 §9.2, DR-294, PD-24/PD-36/PD-39)', () => {
  test('PD-24 a worker that lost its lease writes nothing; the next claim succeeds', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')
    await request.execute(manager, batch)

    const a = await repo.claim(building)
    if (!a) throw new Error('A did not claim')
    expect(a.attempts).toBe(1)
    await expireLease(a.id)

    const b = await repo.claim(building)
    if (!b) throw new Error('B did not claim')
    expect(b.id).toBe(a.id)
    expect(b.attempts).toBe(2)

    expect(await repo.saveProgress(a, { unitDone: 1, cursorCharge: null })).toBe(false)
    expect(await repo.finishReady(a, { zipFile: zips.store(building, 'a.zip', 1) })).toBe(false)
    expect(await repo.saveProgress(b, { unitDone: 1, cursorCharge: null })).toBe(true)
    expect(await repo.finishReady(b, { zipFile: zips.store(building, 'b.zip', 1) })).toBe(true)

    const [row] = await db.sql`SELECT status, attempts FROM finance.fee_notice_job
       WHERE id = ${a.id}`
    expect([row?.status, row?.attempts]).toEqual(['ready', 2])
  })

  test('PD-36 a job claimed three times and expired again is failed with attempts_exhausted', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')
    const created = await request.execute(manager, batch)

    for (const attempt of [1, 2, 3]) {
      const claimed = await repo.claim(building)
      if (!claimed) throw new Error(`claim ${attempt} found nothing`)
      expect(claimed.attempts).toBe(attempt)
      await expireLease(claimed.id)
    }
    expect(await repo.giveUpExhausted(building)).toBe(1)

    const [row] = await db.sql`SELECT status, error FROM finance.fee_notice_job
       WHERE id = ${created.job.id}`
    expect(row?.status).toBe('failed')
    expect((row?.error as { code?: string } | null)?.code).toBe('attempts_exhausted')
    expect(await repo.claim(building)).toBeNull()
  })

  test('PD-39 a claim on a ready job finds nothing', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')
    const created = await request.execute(manager, batch)

    const claimed = await repo.claim(building)
    if (!claimed) throw new Error('no claim')
    const zipFile = zips.store(building, `batch/${batch}/zip/${created.job.id}.zip`, ZIP_SIZE)
    expect(await repo.finishReady(claimed, { zipFile })).toBe(true)

    expect(await repo.claim(building)).toBeNull()
  })
})

describe('FeeNoticeQueries.latestJob (E-177, DOC-34 §9.1, PD-37)', () => {
  test('queued, then ready with a signed ZIP, then expired when the file is gone', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await seedBatch(building, 'published', 'PH-2610-01')
    await seedCharge(building, batch, 'A-1508', 'open')
    const created = await request.execute(manager, batch, { language: 'both' })

    const queued = await queries.latestJob(manager, batch)
    expect(queued.id).toBe(created.job.id)
    expect(queued.status).toBe('queued')
    expect(queued.language).toBe('both')
    expect(queued.unitTotal).toBe(1)
    expect(queued.unitDone).toBe(0)
    expect(queued.zip).toBeNull()
    expect(queued.error).toBeNull()
    expect(queued.finishedAt).toBeNull()

    const claimed = await repo.claim(building)
    if (!claimed) throw new Error('no claim')
    const zipFile = zips.store(building, `batch/${batch}/zip/${created.job.id}.zip`, ZIP_SIZE)
    expect(await repo.finishReady(claimed, { zipFile })).toBe(true)

    const ready = await queries.latestJob(manager, batch)
    expect(ready.status).toBe('ready')
    expect(ready.unitDone).toBe(1)
    expect(ready.zip).toEqual({
      url: `https://files.test/${zipFile}`,
      expiresAt: new Date(MODULE_NOW.getTime() + 900_000).toISOString(),
      fileName: 'PH-2610-01-both.zip',
      size: ZIP_SIZE,
    })

    zips.remove(zipFile)
    const gone = await queries.latestJob(manager, batch)
    expect(gone.zip).toEqual({ expired: true })
  })

  test('404 for a batch with no job and for another building', async () => {
    const building = ids.next()
    const empty = await seedBatch(building, 'published', 'PH-2610-01')
    expect(await codeOf(() => queries.latestJob(staff('manager', building), empty))).toBe(
      'not_found',
    )

    const batch = await seedBatch(building, 'published', 'PH-2610-02')
    await seedCharge(building, batch, 'A-1508', 'open')
    await request.execute(staff('manager', building), batch)
    expect(await codeOf(() => queries.latestJob(staff('manager', ids.next()), batch))).toBe(
      'not_found',
    )
  })
})
