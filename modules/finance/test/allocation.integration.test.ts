import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { isPgError } from '@core/db'
import {
  type AllocationHarness,
  ChargeChangedError,
  createAllocationHarness,
  makeBarrier,
} from './support'

/** `LG15_ATTEMPTS` (master plan §3.3): 10,000 attempts over 8 sessions by default (DOC-22 §16.2). */
const LG15_ATTEMPTS = Number(process.env.LG15_ATTEMPTS ?? 10_000)

let h: AllocationHarness
beforeAll(async () => {
  h = await createAllocationHarness()
})
afterAll(async () => {
  await h.close()
})

describe('the all-or-nothing allocation against PostgreSQL (DOC-22 §4, ADR-0006; LG-14…LG-17)', () => {
  test('LG-14 a manual entry and an online settlement race for each of 500 charges: one winner each', async () => {
    const scope = h.newBuilding()
    const charges = await h.seedOpenCharges(scope, 500)
    const started = performance.now()
    let manualLosers = 0
    let onlineLosers = 0
    for (const charge of charges) {
      const barrier = makeBarrier(2)
      const manual = h.manualPay(scope, [charge.id], barrier.wait).then(
        () => 'won' as const,
        (error: unknown) => {
          expect(error).toBeInstanceOf(ChargeChangedError)
          return 'lost' as const
        },
      )
      const online = h.onlinePay(scope, [charge.id], barrier.wait)
      await barrier.ready
      barrier.go()
      const [manualResult, onlineResult] = await Promise.all([manual, online])
      if (manualResult === 'lost') manualLosers += 1
      if (!onlineResult.ok) {
        onlineLosers += 1
        expect(onlineResult.outcome).toBe('charge_already_paid')
      }
    }
    const elapsed = Math.round(performance.now() - started)
    console.info(`LG-14: 500 charges, a manual and an online each, in ${elapsed} ms`)
    expect(manualLosers + onlineLosers).toBe(500)
    const [payments] = await h.db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.payment
       WHERE building_id = ${scope.buildingId} AND status = 'posted'`
    expect(payments?.n).toBe(500)
    const [twice] = await h.db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT charge_id FROM finance.allocation
         WHERE building_id = ${scope.buildingId} AND status = 'live'
         GROUP BY charge_id HAVING count(*) > 1) x`
    expect(twice?.n).toBe(0)
    const [events] = await h.db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.gateway_event
       WHERE building_id = ${scope.buildingId} AND outcome = 'charge_already_paid'`
    expect(events?.n).toBe(onlineLosers)
  })

  test('LG-15 8 sessions race over (A, B) and (B, A) pairs: no deadlock, one payment per pair, I1…I8 clean', async () => {
    const scope = h.newBuilding()
    const sessions = 8
    const pairs = Math.max(1, Math.ceil(LG15_ATTEMPTS / sessions))
    const seeded = await h.seedPairs(scope, pairs)
    const deadlocks: unknown[] = []
    const barrier = makeBarrier(sessions)
    const started = performance.now()
    const workers = Array.from({ length: sessions }, (_, session) =>
      (async () => {
        await barrier.wait()
        for (const [a, b] of seeded) {
          const order = session % 2 === 0 ? [a, b] : [b, a]
          try {
            await h.manualPay(scope, order)
          } catch (error) {
            if (isPgError(error, '40P01')) deadlocks.push(error)
          }
        }
      })(),
    )
    await barrier.ready
    barrier.go()
    await Promise.all(workers)
    const elapsed = Math.round(performance.now() - started)
    console.info(`LG-15: ${sessions * pairs} attempts over ${pairs} pairs in ${elapsed} ms`)
    expect(deadlocks).toHaveLength(0)
    const [payments] = await h.db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.payment
       WHERE building_id = ${scope.buildingId} AND status = 'posted'`
    expect(payments?.n).toBe(pairs)
    const [live] = await h.db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.allocation
       WHERE building_id = ${scope.buildingId} AND status = 'live'`
    expect(live?.n).toBe(pairs * 2)
    expect(await h.invariantViolations()).toEqual({
      I1: 0,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
  })

  test('LG-16 two, four and eight sessions pay the same charge: exactly one wins', async () => {
    for (const size of [2, 4, 8]) {
      const scope = h.newBuilding()
      const [charge] = await h.seedOpenCharges(scope, 1)
      if (!charge) throw new Error('seed')
      const barrier = makeBarrier(size)
      const attempts = Array.from({ length: size }, () =>
        h.manualPay(scope, [charge.id], barrier.wait),
      )
      await barrier.ready
      barrier.go()
      const results = await Promise.allSettled(attempts)
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      for (const loser of results.filter((result) => result.status === 'rejected'))
        expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ChargeChangedError)
      const [payments] = await h.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.payment
         WHERE building_id = ${scope.buildingId} AND status = 'posted'`
      expect(payments?.n).toBe(1)
      const [live] = await h.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.allocation
         WHERE building_id = ${scope.buildingId} AND status = 'live'`
      expect(live?.n).toBe(1)
    }
  })

  test('LG-17 one hundred concurrent receipts: unique, gapless numbers and a counter equal to the count', async () => {
    const scope = h.newBuilding()
    const charges = await h.seedOpenCharges(scope, 100)
    const started = performance.now()
    const attempts = charges.map((charge) => h.manualPay(scope, [charge.id]))
    const results = await Promise.allSettled(attempts)
    const elapsed = Math.round(performance.now() - started)
    console.info(`LG-17: 100 concurrent receipts in ${elapsed} ms`)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(100)
    const receipts = await h.db.sql<{ number: string }[]>`
      SELECT number FROM finance.receipt WHERE building_id = ${scope.buildingId} ORDER BY number`
    expect(receipts.map((row) => row.number)).toEqual(
      Array.from({ length: 100 }, (_, index) => `BL-2610-${String(index + 1).padStart(4, '0')}`),
    )
    const [counter] = await h.db.sql<{ last: number }[]>`
      SELECT last FROM finance.document_counter
       WHERE building_id = ${scope.buildingId} AND series = 'receipt' AND period = '2610'`
    expect(counter?.last).toBe(100)
    expect((await h.invariantViolations()).I5).toBe(0)
  })
})
