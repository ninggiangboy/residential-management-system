import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createGaplessCounter, Database } from '@core/db'
import { cloneTemplate, type TestDb } from '@rms/test-support'

/**
 * The counter against PostgreSQL (DOC-14 §10; DOC-22 §16.1 LG-11…LG-17). It lives under `test/`, so the unit run
 * skips it; `test:integration` runs it on a clone of the migrated template (DOC-88 §6).
 */

let db: TestDb
let database: Database

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
})
afterAll(async () => {
  await database.close()
  await db.drop()
})

const building = () => crypto.randomUUID()
const counter = () => createGaplessCounter(database, 'finance')
const next = (scope: { buildingId: string }, series: string, period: string) =>
  database.transaction(() => counter().next(scope, series, period))

describe('GaplessCounter against PostgreSQL (DOC-14 §10)', () => {
  test('LG-17 100 concurrent receipts are unique and gapless', async () => {
    const scope = { buildingId: building() }
    const started = performance.now()
    const receipts = await Promise.all(
      Array.from({ length: 100 }, () => next(scope, 'receipt', '2610')),
    )
    const elapsed = Math.round(performance.now() - started)
    console.log(`LG-17: 100 concurrent receipts in ${elapsed} ms`)
    expect(receipts.toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    )
    const rows = await db.sql<{ last: number }[]>`
      SELECT last FROM finance.document_counter
       WHERE building_id = ${scope.buildingId} AND series = 'receipt' AND period = '2610'`
    expect(Number(rows[0]?.last)).toBe(100)
  })

  test('LG-11 a rolled-back transaction leaves no gap (FNM-S02)', async () => {
    const scope = { buildingId: building() }
    await expect(
      database.transaction(async () => {
        expect(await counter().next(scope, 'receipt', '2613')).toBe(1)
        throw new Error('the settlement failed at its last statement')
      }),
    ).rejects.toThrow('the settlement failed')
    expect(await next(scope, 'receipt', '2613')).toBe(1)
    expect(await next(scope, 'receipt', '2613')).toBe(2)
  })

  test('an intent, a batch and a receipt in one building are independent series', async () => {
    const scope = { buildingId: building() }
    expect(await next(scope, 'receipt', '2610')).toBe(1)
    expect(await next(scope, 'batch', '2610')).toBe(1)
    expect(await next(scope, 'intent', '261031')).toBe(1)
    expect(await next(scope, 'receipt', '2610')).toBe(2)
  })

  test('two periods and two buildings are independent', async () => {
    const october = { buildingId: building() }
    const november = { buildingId: building() }
    expect(await next(october, 'receipt', '2610')).toBe(1)
    expect(await next(october, 'receipt', '2611')).toBe(1)
    expect(await next(november, 'receipt', '2610')).toBe(1)
    expect(await next(october, 'receipt', '2610')).toBe(2)
  })

  test('a counter taken outside a transaction is refused', async () => {
    await expect(counter().next({ buildingId: building() }, 'receipt', '2610')).rejects.toThrow(
      'inside a transaction',
    )
  })
})
