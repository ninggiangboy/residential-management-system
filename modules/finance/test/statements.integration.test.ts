import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { isPgError } from '@core/db'
import type { TestDb } from '@rms/test-support'
import type { TransactionSql } from 'postgres'
import { openTestDb, STAFF } from './ddl-fixture'

/**
 * Every row of DOC-15 §13.3 (`FNM-S01`…`FNM-S12`) against a clone of the migrated template database (DOC-88 §6). Each test
 * builds the rows it needs under its own `crypto.randomUUID()` building, so the twelve stay independent; every statement runs
 * as `rms_app`, the role the application uses. There is no application code here: a business refusal such as
 * `charge_changed` is "the conditional UPDATE returned 0 rows", asserted through the row count and the resulting table
 * state, and a `409` such as `batch_has_payments` is the rollback the count mismatch forces.
 */

const enabled = Boolean(process.env.RMS_POSTGRES_PASSWORD ?? process.env.TEST_ADMIN_DATABASE_URL)
const describeDb = enabled ? describe : describe.skip

/** FNM-S12 races 8 sessions over this many pairs of charges (DOC-15 §13.3 defaults to 300). */
const FNM_S12_PAIRS = Number(process.env.FNM_S12_PAIRS ?? 300)
/** The building day of DOC-15 §10.3 and of the examples (`Asia/Ho_Chi_Minh`, DR-09). */
const ZONE = 'Asia/Ho_Chi_Minh'

/** A connection as `rms_app` (`db.sql`, or a `db.connect(n)` pool the race uses). */
type Pool = ReturnType<TestDb['connect']>
/** Something a statement runs on: a pool or a transaction opened on one. */
type Conn = Pool | TransactionSql

describeDb('the finance statements against PostgreSQL (DOC-15 §13.3)', () => {
  let db: TestDb
  let started = false

  beforeAll(async () => {
    db = await openTestDb()
    started = true
  })
  afterAll(async () => {
    if (!started) return
    await db.drop()
  })

  /** A jsonb value: postgres.js sends the text and the SQL casts it (`::text::jsonb`); a bare string would become a JSON string. */
  const j = (value: unknown) => JSON.stringify(value)

  /** DOC-15 §13.1: the SQLSTATE a statement must raise. A failure reports the code, so a wrong code fails the test. */
  async function rejects(run: () => Promise<unknown>, code: string): Promise<void> {
    let caught: unknown
    try {
      await run()
    } catch (error) {
      caught = error
    }
    const actual = (caught as { code?: string } | undefined)?.code
    if (actual !== code) throw new Error(`expected SQLSTATE ${code}, got ${actual ?? 'no error'}`)
  }

  /** The conditional UPDATE of §7.2 returned 0 rows: the caller rolls its transaction back (`charge_changed`). */
  class ChargeChanged extends Error {
    constructor(readonly chargeId: string) {
      super(`charge_changed: ${chargeId}`)
      this.name = 'ChargeChanged'
    }
  }

  /** DOC-15 §5.1: the recall statement's `0 rows` or `updated <> expected`. */
  class RecallRefused extends Error {
    constructor(readonly reason: 'invalid_transition' | 'batch_has_payments') {
      super(reason)
      this.name = 'RecallRefused'
    }
  }

  interface LineSpec {
    position: number
    kind: 'fee' | 'adjustment'
    quantity: string
    unitPrice: number
    amount: number
    note?: string
  }
  interface ChargeSpec {
    id: string
    unitId: string
    unitCode: string
    amount: number
    lines: LineSpec[]
  }

  /** The item at `index`, or a failure: keeps a missing fixture row from passing a test as `undefined`. */
  function at<T>(items: readonly T[], index: number): T {
    const item = items[index]
    if (!item) throw new Error(`the fixture has no row at index ${index}`)
    return item
  }

  /** A charge of one fee line (quantity 1) whose amount equals its line. */
  function simpleCharge(unitCode: string, amount: number): ChargeSpec {
    return {
      id: crypto.randomUUID(),
      unitId: crypto.randomUUID(),
      unitCode,
      amount,
      lines: [{ position: 1, kind: 'fee', quantity: '1', unitPrice: amount, amount }],
    }
  }

  /** §5.1–§5.3: a draft batch with its charges and lines, on the test's own building. */
  async function seedDraft(
    buildingId: string,
    batchId: string,
    code: string,
    charges: ChargeSpec[],
    dueDate = '2026-10-15',
  ): Promise<void> {
    await db.sql`
      INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
      VALUES (${batchId}, ${buildingId}, ${code}, ${j({ vi: 'Phí tháng 10/2026', en: 'October 2026 fees' })}::text::jsonb, '2026-10-01', ${dueDate}, ${STAFF})`
    for (const charge of charges) {
      await db.sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
        VALUES (${charge.id}, ${buildingId}, ${batchId}, ${charge.unitId}, ${charge.unitCode}, ${charge.amount})`
      for (const line of charge.lines) {
        const itemName =
          line.kind === 'fee'
            ? { vi: 'Phí quản lý', en: 'Management fee' }
            : { vi: 'Điều chỉnh', en: 'Adjustment' }
        await db.sql`
          INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount, note)
          VALUES (${crypto.randomUUID()}, ${buildingId}, ${charge.id}, ${line.position}, ${line.kind}, ${j(itemName)}::text::jsonb, ${line.quantity}, ${line.unitPrice}, ${line.amount}, ${line.note ?? null})`
      }
    }
  }

  /** The publish of §5.1: the batch `draft → published` and its charges `draft → open` in one statement; returns the opened ids. */
  async function publish(
    buildingId: string,
    batchId: string,
    expectedVersion = 1,
  ): Promise<string[]> {
    const rows = await db.sql<{ id: string }[]>`
      WITH b AS (
        UPDATE finance.fee_batch
           SET status = 'published', published_at = now(), published_by = ${STAFF}, version = version + 1, updated_at = now()
         WHERE id = ${batchId} AND building_id = ${buildingId} AND status = 'draft' AND version = ${expectedVersion}
        RETURNING id)
      UPDATE finance.charge c
         SET status = 'open', version = c.version + 1, updated_at = now()
        FROM b
       WHERE c.building_id = ${buildingId} AND c.batch_id = b.id AND c.status = 'draft'
      RETURNING c.id`
    return rows.map((row) => row.id)
  }

  /** A published batch whose charges are open, on the test's own building. */
  async function seedPublished(
    buildingId: string,
    specs: Array<{ unitCode: string; amount: number }>,
    options: { code?: string; dueDate?: string } = {},
  ): Promise<{ batchId: string; charges: ChargeSpec[] }> {
    const batchId = crypto.randomUUID()
    const charges = specs.map((spec) => simpleCharge(spec.unitCode, spec.amount))
    await seedDraft(buildingId, batchId, options.code ?? 'PH-2610-01', charges, options.dueDate)
    const opened = await publish(buildingId, batchId)
    if (opened.length !== charges.length)
      throw new Error('the publish statement did not open every charge')
    return { batchId, charges }
  }

  /**
   * The all-or-nothing manual entry of §7.2: one payment, then each charge in ascending `charge.id` order — the conditional
   * UPDATE, the allocation, a receipt number from the counter of §4. A charge whose UPDATE returns 0 rows throws, so the whole
   * transaction rolls back (`charge_changed`, FNM-S03). `gapMs` sleeps between two charges to widen the race (FNM-S12).
   */
  async function payCharges(
    pool: Pool,
    buildingId: string,
    chargeIds: string[],
    options: { gapMs?: number } = {},
  ): Promise<{ ok: true } | { ok: false; failedChargeId: string }> {
    try {
      await pool.begin(async (sql) => {
        const charges: Array<{ id: string; amount: number; unit_id: string; unit_code: string }> =
          []
        for (const id of [...chargeIds].sort()) {
          const rows = await sql<
            { id: string; amount: string; unit_id: string; unit_code: string }[]
          >`
            SELECT id, amount, unit_id, unit_code FROM finance.charge
             WHERE building_id = ${buildingId} AND id = ${id}`
          const row = rows[0]
          if (!row) throw new Error(`charge ${id} is missing`)
          charges.push({ ...row, amount: Number(row.amount) })
        }
        const unitId = at(charges, 0).unit_id
        const total = charges.reduce((sum, charge) => sum + charge.amount, 0)
        const paymentId = crypto.randomUUID()
        await sql`
          INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by)
          VALUES (${paymentId}, ${buildingId}, ${unitId}, 'cash', ${total}, now(), 'Trần Minh Anh', ${crypto.randomUUID()}, ${STAFF})`
        for (const [index, charge] of charges.entries()) {
          const paid = await sql<{ id: string }[]>`
            UPDATE finance.charge
               SET status = 'paid', version = version + 1, updated_at = now()
             WHERE id = ${charge.id} AND building_id = ${buildingId} AND status = 'open' AND amount = ${charge.amount}
            RETURNING id`
          if (paid.length === 0) throw new ChargeChanged(charge.id)
          const allocationId = crypto.randomUUID()
          await sql`
            INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
            VALUES (${allocationId}, ${buildingId}, ${paymentId}, ${charge.id}, ${charge.amount})`
          const [counter] = await sql<{ last: number }[]>`
            INSERT INTO finance.document_counter (building_id, series, period, last)
            VALUES (${buildingId}, 'receipt', '2610', 1)
            ON CONFLICT (building_id, series, period)
            DO UPDATE SET last = document_counter.last + 1, updated_at = now()
            RETURNING last`
          const number = `BL-2610-${String(counter?.last ?? 0).padStart(4, '0')}`
          await sql`
            INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
            VALUES (${crypto.randomUUID()}, ${buildingId}, ${number}, ${allocationId}, ${paymentId}, ${charge.id}, ${charge.unit_id}, ${charge.amount}, ${j({ unitCode: charge.unit_code, amount: charge.amount })}::text::jsonb)`
          if (options.gapMs && index < charges.length - 1) await Bun.sleep(options.gapMs)
        }
      })
      return { ok: true }
    } catch (error) {
      if (error instanceof ChargeChanged) return { ok: false, failedChargeId: error.chargeId }
      throw error
    }
  }

  /** The recall of §5.1: the batch row, the expected count of non-void charges read after it, then the open charges voided. */
  async function recall(
    buildingId: string,
    batchId: string,
  ): Promise<
    | { ok: true; expected: number; updated: number }
    | {
        ok: false
        reason: 'invalid_transition' | 'batch_has_payments'
        expected: number
        updated: number
      }
  > {
    let expected = 0
    let updated = 0
    try {
      await db.sql.begin(async (sql) => {
        const rows = await sql<{ id: string }[]>`
          UPDATE finance.fee_batch
             SET status = 'recalled', recalled_at = now(), recalled_by = ${STAFF}, version = version + 1, updated_at = now()
           WHERE id = ${batchId} AND building_id = ${buildingId} AND status = 'published'
          RETURNING id`
        if (rows.length === 0) throw new RecallRefused('invalid_transition')
        const [count] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM finance.charge
           WHERE building_id = ${buildingId} AND batch_id = ${batchId} AND status <> 'void'`
        expected = count?.n ?? 0
        const voided = await sql<{ id: string }[]>`
          UPDATE finance.charge
             SET status = 'void', void_kind = 'recall', voided_at = now(), voided_by = ${STAFF}, version = version + 1, updated_at = now()
           WHERE building_id = ${buildingId} AND batch_id = ${batchId} AND status = 'open'
          RETURNING id`
        updated = voided.length
        if (updated !== expected) throw new RecallRefused('batch_has_payments')
      })
      return { ok: true, expected, updated }
    } catch (error) {
      if (error instanceof RecallRefused)
        return { ok: false, reason: error.reason, expected, updated }
      throw error
    }
  }

  /**
   * The eight invariants of §12.2, each scoped to this test's building. `invariant_check` runs them per building (DOC-15
   * §12.2, DOC-22); the scope is what keeps the twelve tests independent on the one database they share.
   */
  async function invariantViolations(
    pool: Pool,
    buildingId: string,
  ): Promise<Record<string, number>> {
    const [i1] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge c
       WHERE c.building_id = ${buildingId} AND c.status = 'paid' AND 1 <> (SELECT count(*) FROM finance.allocation a
                                                                              WHERE a.charge_id = c.id AND a.status = 'live' AND a.amount = c.amount)`
    const [i2] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id
       WHERE a.building_id = ${buildingId} AND a.status = 'live' AND c.status <> 'paid'`
    const [i3] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.payment p
       WHERE p.building_id = ${buildingId} AND p.status = 'posted' AND p.amount <> coalesce((SELECT sum(a.amount) FROM finance.allocation a
                                                                                              WHERE a.payment_id = p.id AND a.status = 'live'), 0)`
    const [i4] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.allocation a
       WHERE a.building_id = ${buildingId} AND a.status = 'live' AND NOT EXISTS (SELECT 1 FROM finance.receipt r WHERE r.allocation_id = a.id AND r.status = 'issued')`
    const [i5] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.document_counter d
       WHERE d.building_id = ${buildingId} AND d.series = 'receipt' AND d.last <> (SELECT count(*) FROM finance.receipt r
                                                                                   WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period)`
    const [i6] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.gateway_event g
       WHERE g.building_id = ${buildingId} AND g.outcome = 'posted' AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = g.payment_id AND p.status = 'posted')`
    const [i7] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge c
       WHERE c.building_id = ${buildingId} AND c.status IN ('open', 'paid') AND c.amount <> (SELECT sum(l.amount) FROM finance.charge_line l WHERE l.charge_id = c.id)`
    const [i8] = await pool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.gateway_event WHERE building_id = ${buildingId} AND outcome = 'pending'`
    return {
      I1: i1?.n ?? 0,
      I2: i2?.n ?? 0,
      I3: i3?.n ?? 0,
      I4: i4?.n ?? 0,
      I5: i5?.n ?? 0,
      I6: i6?.n ?? 0,
      I7: i7?.n ?? 0,
      I8: i8?.n ?? 0,
    }
  }

  /** Every session awaits this before its first statement, then `go` releases them together (DOC-22 §16.2). */
  function barrier(size: number): {
    wait: () => Promise<void>
    ready: Promise<void>
    go: () => void
  } {
    let arrived = 0
    let release: () => void = () => {}
    let allReady: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      allReady = resolve
    })
    return {
      ready,
      go: () => release(),
      wait: async () => {
        arrived += 1
        if (arrived >= size) allReady()
        await gate
      },
    }
  }

  test('FNM-S01 publish of §5.1 run twice on a draft of 3 charges: 3 charges opened, then 0', async () => {
    const buildingId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    await seedDraft(buildingId, batchId, 'PH-2610-01', [
      simpleCharge('A-1508', 2638000),
      simpleCharge('A-1509', 350000),
      simpleCharge('A-1510', 500000),
    ])
    expect(await publish(buildingId, batchId)).toHaveLength(3)
    expect(await publish(buildingId, batchId)).toHaveLength(0)
    const [batch] = await db.sql<{ status: string }[]>`
      SELECT status FROM finance.fee_batch WHERE id = ${batchId} AND building_id = ${buildingId}`
    expect(batch?.status).toBe('published')
    const [open] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE building_id = ${buildingId} AND batch_id = ${batchId} AND status = 'open'`
    expect(open?.n).toBe(3)
  })

  test('FNM-S02 receipt counter upsert rolled back, then again: BL-2610-0001 both times, no gap', async () => {
    const buildingId = crypto.randomUUID()
    const upsert = async (pool: Conn): Promise<string> => {
      const [row] = await pool<{ last: number }[]>`
        INSERT INTO finance.document_counter (building_id, series, period, last)
        VALUES (${buildingId}, 'receipt', '2610', 1)
        ON CONFLICT (building_id, series, period)
        DO UPDATE SET last = document_counter.last + 1, updated_at = now()
        RETURNING last`
      return `BL-2610-${String(row?.last ?? 0).padStart(4, '0')}`
    }
    let rolledBack = ''
    await db.sql
      .begin(async (sql) => {
        rolledBack = await upsert(sql)
        throw new Error('roll back the fixture')
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'roll back the fixture') throw error
      })
    const again = await upsert(db.sql)
    expect(rolledBack).toBe('BL-2610-0001')
    expect(again).toBe('BL-2610-0001')
  })

  test('FNM-S03 manual payment of A-1510 alone, then of A-1509 and A-1510 together: charge_changed', async () => {
    const buildingId = crypto.randomUUID()
    const { charges } = await seedPublished(buildingId, [
      { unitCode: 'A-1509', amount: 350000 },
      { unitCode: 'A-1510', amount: 500000 },
    ])
    const a1509 = at(charges, 0)
    const a1510 = at(charges, 1)
    expect(await payCharges(db.sql, buildingId, [a1510.id])).toEqual({ ok: true })
    expect(await payCharges(db.sql, buildingId, [a1509.id, a1510.id])).toEqual({
      ok: false,
      failedChargeId: a1510.id,
    })
    const states = await db.sql<{ unit_code: string; status: string }[]>`
      SELECT unit_code, status FROM finance.charge WHERE building_id = ${buildingId} ORDER BY unit_code`
    expect(states.map((row) => ({ unit_code: row.unit_code, status: row.status }))).toEqual([
      { unit_code: 'A-1509', status: 'open' },
      { unit_code: 'A-1510', status: 'paid' },
    ])
    const [payments] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.payment WHERE building_id = ${buildingId} AND status = 'posted'`
    const [receipts] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.receipt WHERE building_id = ${buildingId} AND status = 'issued'`
    expect(payments?.n).toBe(1)
    expect(receipts?.n).toBe(1)
    // A code path that skipped the conditional UPDATE still cannot commit a second live allocation (uq_allocation_charge_live, FNM-47).
    const [payment] = await db.sql<{ id: string }[]>`
      SELECT id FROM finance.payment WHERE building_id = ${buildingId} AND status = 'posted'`
    await rejects(
      () => db.sql`
        INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
        VALUES (${crypto.randomUUID()}, ${buildingId}, ${payment!.id}, ${a1510.id}, 500000)`,
      '23505',
    )
  })

  test('FNM-S04 recall of a batch with 2 open and 1 voided alone, then of a batch with 1 paid charge', async () => {
    const buildingId = crypto.randomUUID()
    const recallable = await seedPublished(
      buildingId,
      [
        { unitCode: 'A-1508', amount: 2638000 },
        { unitCode: 'A-1509', amount: 350000 },
        { unitCode: 'A-1510', amount: 500000 },
      ],
      { code: 'PH-2610-01' },
    )
    await db.sql`
      UPDATE finance.charge
         SET status = 'void', void_kind = 'single', void_reason = 'billed to the wrong unit', voided_at = now(), voided_by = ${STAFF}, version = version + 1, updated_at = now()
       WHERE id = ${at(recallable.charges, 2).id} AND building_id = ${buildingId}`
    expect(await recall(buildingId, recallable.batchId)).toEqual({
      ok: true,
      expected: 2,
      updated: 2,
    })
    const [recalled] = await db.sql<{ status: string }[]>`
      SELECT status FROM finance.fee_batch WHERE id = ${recallable.batchId} AND building_id = ${buildingId}`
    expect(recalled?.status).toBe('recalled')

    const withPaid = await seedPublished(
      buildingId,
      [
        { unitCode: 'A-1508', amount: 2638000 },
        { unitCode: 'A-1509', amount: 350000 },
        { unitCode: 'A-1510', amount: 500000 },
      ],
      { code: 'PH-2610-02' },
    )
    expect(await payCharges(db.sql, buildingId, [at(withPaid.charges, 0).id])).toEqual({ ok: true })
    expect(await recall(buildingId, withPaid.batchId)).toEqual({
      ok: false,
      reason: 'batch_has_payments',
      expected: 3,
      updated: 2,
    })
    const [stillPublished] = await db.sql<{ status: string }[]>`
      SELECT status FROM finance.fee_batch WHERE id = ${withPaid.batchId} AND building_id = ${buildingId}`
    expect(stillPublished?.status).toBe('published')
    const [open] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE building_id = ${buildingId} AND batch_id = ${withPaid.batchId} AND status = 'open'`
    expect(open?.n).toBe(2)
  })

  test('FNM-S05 the settle entry insert of §8.1 for FT2628273914, then the same from the re-query: 1 row, then 0', async () => {
    const buildingId = crypto.randomUUID()
    const insert = (source: string) => db.sql<{ id: string }[]>`
      INSERT INTO finance.gateway_event (id, building_id, provider, reference, order_code, amount, paid_at, source, payload, outcome)
      VALUES (${crypto.randomUUID()}, ${buildingId}, 'payos', 'FT2628273914', 2610153, 2638000, now(), ${source}, '{}'::jsonb, 'pending')
      ON CONFLICT (provider, reference) DO NOTHING
      RETURNING id`
    expect(await insert('webhook')).toHaveLength(1)
    expect(await insert('requery')).toHaveLength(0)
  })

  test('FNM-S06 the debt query of DR-18 for building day 2026-10-16 (due 2026-10-15): A-1508 and A-1509 in 1-30', async () => {
    const buildingId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    await seedDraft(buildingId, batchId, 'PH-2610-01', [
      {
        id: crypto.randomUUID(),
        unitId: crypto.randomUUID(),
        unitCode: 'A-1508',
        amount: 2638000,
        lines: [
          { position: 1, kind: 'fee', quantity: '1', unitPrice: 2488000, amount: 2488000 },
          { position: 2, kind: 'fee', quantity: '12.345', unitPrice: 15000, amount: 185175 },
          {
            position: 3,
            kind: 'adjustment',
            quantity: '1',
            unitPrice: 0,
            amount: -35175,
            note: 'Trừ phí nước tính thừa tháng 9',
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        unitId: crypto.randomUUID(),
        unitCode: 'A-1509',
        amount: 350000,
        lines: [{ position: 1, kind: 'fee', quantity: '1', unitPrice: 350000, amount: 350000 }],
      },
    ])
    expect(await publish(buildingId, batchId)).toHaveLength(2)
    const rows = await db.sql<
      { unit_code: string; outstanding: string; days_late: number; bucket: string }[]
    >`
      SELECT c.unit_code,
             sum(c.amount)::bigint AS outstanding,
             (DATE '2026-10-16' - b.due_date) AS days_late,
             CASE WHEN (DATE '2026-10-16' - b.due_date) BETWEEN 1 AND 30 THEN '1-30'
                  WHEN (DATE '2026-10-16' - b.due_date) BETWEEN 31 AND 60 THEN '31-60'
                  ELSE '60+' END AS bucket
        FROM finance.charge c JOIN finance.fee_batch b ON b.id = c.batch_id
       WHERE c.building_id = ${buildingId} AND c.status = 'open'
       GROUP BY c.unit_id, c.unit_code, b.due_date
       ORDER BY c.unit_code`
    expect(
      rows.map((row) => ({
        code: row.unit_code,
        amount: Number(row.outstanding),
        bucket: row.bucket,
      })),
    ).toEqual([
      { code: 'A-1508', amount: 2638000, bucket: '1-30' },
      { code: 'A-1509', amount: 350000, bucket: '1-30' },
    ])
    expect(rows.every((row) => row.days_late === 1)).toBe(true)
  })

  test('FNM-S07 invariants I1…I8 clean, then I1 = 1 after a paid charge with no allocation', async () => {
    const buildingId = crypto.randomUUID()
    const { charges } = await seedPublished(buildingId, [
      { unitCode: 'A-1508', amount: 2638000 },
      { unitCode: 'A-1509', amount: 350000 },
      { unitCode: 'A-1510', amount: 500000 },
    ])
    expect(await invariantViolations(db.sql, buildingId)).toEqual({
      I1: 0,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
    await db.sql`
      UPDATE finance.charge SET status = 'paid', version = version + 1, updated_at = now()
       WHERE id = ${at(charges, 0).id} AND building_id = ${buildingId}`
    expect(await invariantViolations(db.sql, buildingId)).toEqual({
      I1: 1,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
  })

  test('FNM-S08 fee import commit twice, then the commit of a job past expires_at: 1, 0, 0', async () => {
    const buildingId = crypto.randomUUID()
    const params = j({ batchId: crypto.randomUUID() })
    const jobId = crypto.randomUUID()
    await db.sql`
      INSERT INTO finance.import_job (id, building_id, kind, status, file_key, params, result, created_by, expires_at)
      VALUES (${jobId}, ${buildingId}, 'fee_batch', 'validated', 'imports/fees.xlsx', ${params}::text::jsonb, '{}'::jsonb, ${STAFF}, now() + interval '24 hours')`
    const commit = (id: string) => db.sql<{ id: string }[]>`
      UPDATE finance.import_job SET status = 'committed', committed_at = now()
       WHERE id = ${id} AND building_id = ${buildingId} AND status = 'validated' AND expires_at > now()
      RETURNING id`
    expect(await commit(jobId)).toHaveLength(1)
    expect(await commit(jobId)).toHaveLength(0)
    const expiredId = crypto.randomUUID()
    await db.sql`
      INSERT INTO finance.import_job (id, building_id, kind, status, file_key, params, result, created_by, created_at, expires_at)
      VALUES (${expiredId}, ${buildingId}, 'fee_batch', 'validated', 'imports/old.xlsx', ${params}::text::jsonb, '{}'::jsonb, ${STAFF}, now() - interval '2 days', now() - interval '1 day')`
    expect(await commit(expiredId)).toHaveLength(0)
  })

  test('FNM-S09 reminder insert twice on the same building day: 1, 0', async () => {
    const buildingId = crypto.randomUUID()
    const unitId = crypto.randomUUID()
    const insert = () => db.sql<{ id: string }[]>`
      INSERT INTO finance.debt_reminder (id, building_id, unit_id, reminder_day, sent_by, charge_count, amount)
      VALUES (${crypto.randomUUID()}, ${buildingId}, ${unitId}, (now() AT TIME ZONE ${ZONE})::date, ${STAFF}, 1, 2638000)
      ON CONFLICT (building_id, unit_id, reminder_day) DO NOTHING
      RETURNING id`
    expect(await insert()).toHaveLength(1)
    expect(await insert()).toHaveLength(0)
  })

  test('FNM-S10 the open money-log rows of the building: 1 (the unknown_order row)', async () => {
    const buildingId = crypto.randomUUID()
    await db.sql`
      INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome)
      VALUES (${crypto.randomUUID()}, ${buildingId}, 'payos', ${`FT-${crypto.randomUUID()}`}, 1000, now(), 'requery', '{}'::jsonb, 'unknown_order')`
    await db.sql`
      INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome)
      VALUES (${crypto.randomUUID()}, ${buildingId}, 'payos', ${`FT-${crypto.randomUUID()}`}, 1000, now(), 'webhook', '{}'::jsonb, 'pending')`
    const [open] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.gateway_event
       WHERE building_id = ${buildingId} AND outcome NOT IN ('pending', 'posted') AND reviewed_at IS NULL`
    expect(open?.n).toBe(1)
  })

  test('FNM-S11 two claims of intent_requery on 30 due intents, limit 20: 20, then 10, disjoint', async () => {
    const buildingId = crypto.randomUUID()
    for (let index = 0; index < 30; index += 1) {
      await db.sql`
        INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, provider, link_id, created_by, display_until, expires_at, status, next_check_at)
        VALUES (${crypto.randomUUID()}, ${buildingId}, ${crypto.randomUUID()}, ${`TT-261019-${String(index + 1).padStart(4, '0')}`}, nextval('finance.order_code_seq'), 1000, ${crypto.randomUUID()}, 'payos', ${`link-${index}`}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes', 'pending', now() - interval '1 minute')`
    }
    const claim = (sql: Conn) => sql<{ id: string }[]>`
      UPDATE finance.payment_intent
         SET next_check_at = now() + interval '60 seconds', last_checked_at = now()
       WHERE id IN (
         SELECT id FROM finance.payment_intent
          WHERE building_id = ${buildingId} AND status IN ('creating', 'pending', 'cancelling') AND next_check_at <= now()
          ORDER BY next_check_at, id
          LIMIT 20
          FOR UPDATE SKIP LOCKED)
      RETURNING id`
    const conn = db.connect(2)
    let firstIds: string[] = []
    let secondIds: string[] = []
    let firstClaimed: () => void = () => {}
    let releaseSecond: () => void = () => {}
    const claimed = new Promise<void>((resolve) => {
      firstClaimed = resolve
    })
    const secondClaimed = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    // The first claim holds its 20 rows locked (the transaction stays open) while the second runs and skips them (SKIP LOCKED).
    const first = conn.begin(async (sql) => {
      firstIds = (await claim(sql)).map((row) => row.id)
      firstClaimed()
      await secondClaimed
    })
    await claimed
    const second = conn.begin(async (sql) => {
      secondIds = (await claim(sql)).map((row) => row.id)
      releaseSecond()
    })
    await Promise.all([first, second])
    await conn.end()
    expect(firstIds).toHaveLength(20)
    expect(secondIds).toHaveLength(10)
    expect(secondIds.filter((id) => firstIds.includes(id))).toHaveLength(0)
    expect(new Set([...firstIds, ...secondIds]).size).toBe(30)
  })

  test('FNM-S12 8 sessions race over (A, B) and (B, A) pairs: one winner each, no deadlock', async () => {
    const buildingId = crypto.randomUUID()
    const sessions = 8
    const pairsCount = Math.max(1, FNM_S12_PAIRS)
    const specs = Array.from({ length: pairsCount }, (_, index) => [
      { unitCode: `U-${index}-A`, amount: 100000 },
      { unitCode: `U-${index}-B`, amount: 250000 },
    ]).flat()
    const { charges } = await seedPublished(buildingId, specs)
    const pairs: Array<readonly [string, string]> = []
    for (let index = 0; index < pairsCount; index += 1)
      pairs.push([at(charges, 2 * index).id, at(charges, 2 * index + 1).id])

    const conn = db.connect(sessions)
    const gate = barrier(sessions)
    const deadlocks: unknown[] = []
    let refused = 0
    const started = performance.now()
    const workers = Array.from({ length: sessions }, (_, session) =>
      (async () => {
        await gate.wait()
        for (const [a, b] of pairs) {
          const order = session < 4 ? [a, b] : [b, a]
          try {
            const result = await payCharges(conn, buildingId, order, { gapMs: 2 })
            if (!result.ok) refused += 1
          } catch (error) {
            if (isPgError(error, '40P01')) deadlocks.push(error)
            else throw error
          }
        }
      })(),
    )
    await gate.ready
    gate.go()
    const settled = await Promise.allSettled(workers)
    const elapsed = Math.round(performance.now() - started)
    console.info(
      `FNM-S12: ${sessions * pairsCount} attempts over ${pairsCount} pairs in ${elapsed} ms`,
    )
    await conn.end()

    expect(deadlocks).toHaveLength(0)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(0)
    expect(refused).toBe((sessions - 1) * pairsCount)
    const [paid] = await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.charge WHERE building_id = ${buildingId} AND status = 'paid'`
    expect(paid?.n).toBe(pairsCount * 2)
    const [payments] = await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.payment WHERE building_id = ${buildingId} AND status = 'posted'`
    expect(payments?.n).toBe(pairsCount)
    const [receipts] = await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.receipt WHERE building_id = ${buildingId} AND status = 'issued'`
    expect(receipts?.n).toBe(pairsCount * 2)
    const [twice] = await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT charge_id FROM finance.allocation
           WHERE building_id = ${buildingId} AND status = 'live'
           GROUP BY charge_id HAVING count(*) > 1) x`
    expect(twice?.n).toBe(0)
    const [counter] = await db.sql<{ last: number }[]>`
        SELECT last FROM finance.document_counter
         WHERE building_id = ${buildingId} AND series = 'receipt' AND period = '2610'`
    expect(counter?.last).toBe(pairsCount * 2)
    expect(await invariantViolations(db.sql, buildingId)).toEqual({
      I1: 0,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
  }, 120_000)
})
