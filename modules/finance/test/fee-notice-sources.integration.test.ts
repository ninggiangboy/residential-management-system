import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import type { BuildingId } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq } from 'drizzle-orm'
import type { ChargeNoticeRow } from '../src/domain/charge-repository'
import { DrizzleChargeRepository } from '../src/infrastructure/persistence/drizzle-charge-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'

/**
 * The chunk read of the bulk fee notices (DOC-34 §9.2 phase 1/2, DR-294; P2-13):
 * `DrizzleChargeRepository.listNoticeSources` over a clone of the migrated template. The 45 charges come in
 * chunks of 20, 20 and 5 by id; a void and a draft charge are left out; another building's batch is empty.
 */

const AT = new Date('2026-10-19T02:00:00Z')
const AMOUNT = 984_825

let db: TestDb
let database: Database
let repo: DrizzleChargeRepository
const ids = new UuidV7Generator()

/** One published batch (the guard is BEFORE UPDATE, so the insert may name `published`). */
async function seedBatch(building: string, code: string): Promise<string> {
  const batchId = ids.next()
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: building,
    code,
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
    dueDate: '2026-11-10',
    status: 'published',
    createdBy: ids.next(),
    publishedAt: AT,
    publishedBy: ids.next(),
    version: 1,
  })
  return batchId
}

/** One charge of the batch at `status`; the lines come first, then the transitions (the guard). */
async function seedCharge(
  building: string,
  batchId: string,
  unitCode: string,
  status: 'open' | 'paid' | 'void' | 'draft',
): Promise<string> {
  const chargeId = ids.next()
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId: building,
    batchId,
    unitId: ids.next(),
    unitCode,
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
  if (status !== 'draft') {
    await database.executor
      .update(chargeTable)
      .set({ status: 'open', version: 2 })
      .where(eq(chargeTable.id, chargeId))
  }
  if (status === 'paid') {
    await database.executor
      .update(chargeTable)
      .set({ status: 'paid', version: 3 })
      .where(eq(chargeTable.id, chargeId))
  }
  if (status === 'void') {
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
  return chargeId
}

const idOf = (row: ChargeNoticeRow): string => row.charge.id
const lastId = (rows: readonly ChargeNoticeRow[]): string | null => rows.at(-1)?.charge.id ?? null

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  repo = new DrizzleChargeRepository(database)
})

afterAll(async () => {
  await database.close()
  await db.drop()
})

describe('DrizzleChargeRepository.listNoticeSources (DOC-34 §9.2 phase 1, DR-294; P2-13)', () => {
  test('the batch reads in chunks of 20 by id; a void and a draft charge are left out', async () => {
    const building = ids.next()
    const batchId = await seedBatch(building, 'PH-2610-01')
    const wanted: string[] = []
    for (let index = 1; index <= 20; index += 1)
      wanted.push(await seedCharge(building, batchId, `A-${1000 + index}`, 'open'))
    const voidId = await seedCharge(building, batchId, 'A-2000', 'void')
    const draftId = await seedCharge(building, batchId, 'A-2001', 'draft')
    for (let index = 21; index <= 45; index += 1)
      wanted.push(
        await seedCharge(building, batchId, `A-${1000 + index}`, index === 25 ? 'paid' : 'open'),
      )

    const scope = { buildingId: building as BuildingId }
    const first = await repo.listNoticeSources(scope, batchId, null, 20)
    const second = await repo.listNoticeSources(scope, batchId, lastId(first), 20)
    const third = await repo.listNoticeSources(scope, batchId, lastId(second), 20)
    const fourth = await repo.listNoticeSources(scope, batchId, lastId(third), 20)

    expect(first.map(idOf)).toEqual(wanted.slice(0, 20))
    expect(second.map(idOf)).toEqual(wanted.slice(20, 40))
    expect(third.map(idOf)).toEqual(wanted.slice(40))
    expect(fourth).toEqual([])
    expect(wanted).toHaveLength(45)

    expect(first[0]?.batch).toMatchObject({ code: 'PH-2610-01', status: 'published' })
    expect(first[0]?.lines.map((line) => line.position)).toEqual([1])
    expect(second.some((row) => row.charge.id === wanted[24])).toBe(true)
    expect(second.find((row) => row.charge.id === wanted[24])?.charge.status).toBe('paid')
    expect([...first, ...second, ...third].map(idOf)).not.toContain(voidId)
    expect([...first, ...second, ...third].map(idOf)).not.toContain(draftId)
  })

  test('another building\u2019s batch is empty', async () => {
    const building = ids.next()
    const batchId = await seedBatch(building, 'PH-2610-01')
    await seedCharge(building, batchId, 'A-1508', 'open')
    const other = ids.next()
    const otherBatch = await seedBatch(other, 'PH-2610-01')
    await seedCharge(other, otherBatch, 'A-1508', 'open')
    const scope = { buildingId: building as BuildingId }
    expect(await repo.listNoticeSources(scope, otherBatch, null, 20)).toEqual([])
  })
})
