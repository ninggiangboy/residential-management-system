import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@rms/test-support'
import {
  ADJUST_ITEM,
  ALLOC_1508,
  ALLOC_1508_NEW,
  ALLOC_1509,
  B1,
  B2,
  BATCH_NAME,
  BATCH1,
  CHARGE_121,
  CHARGE_1508,
  CHARGE_1509,
  CHARGE_1510,
  DEDUP_KEY,
  EVENT_PENDING,
  EVENT_SHORT,
  FAKE_LINK,
  FEE_ITEM,
  GATEWAY_CONFIG,
  IMPORT_DOC,
  IMPORT_JOB,
  INTENT_1,
  INTENT_2,
  INTENT_CANCELLING,
  ITEM_1509,
  LINE_1508_1,
  LINE_1508_2,
  LINE_1508_ADJ,
  LINE_1509,
  LINE_1510,
  NOTICE_JOB,
  NOTICE_JOB_READY,
  openTestDb,
  PAYMENT_K,
  PAYMENT_K2,
  PDF_FILE,
  RECEIPT_1508,
  RECEIPT_1509,
  REJECTION,
  REMINDER,
  SNAPSHOT,
  STAFF,
  STMT_LINE,
  UNIT_1508,
  UNIT_1509,
  UNIT_1510,
  UNIT_B2,
} from './ddl-fixture'

/**
 * Every row of DOC-15 §13.2 (`FNM-01`…`FNM-123`) against a clone of the migrated template database (DOC-88 §6). One
 * building holds the batch `PH-2610-01` and the charges A-1508, A-1509 and A-1510 of the fixture; a second building
 * serves the cross-building rows. The tests run in order and share the state the earlier accepted rows built, as §13.1
 * describes. Every statement runs as `rms_app`, so a missing grant fails here; the only exception is `setval` of the
 * order-code sequence (FNM-83), which needs `UPDATE` on the sequence and is run by `rms_migrator` (DOC-19 §4).
 */

const enabled = Boolean(process.env.RMS_POSTGRES_PASSWORD ?? process.env.TEST_ADMIN_DATABASE_URL)
const describeDb = enabled ? describe : describe.skip

describeDb('the finance DDL against PostgreSQL (DOC-15 §13.2)', () => {
  let db: TestDb
  let admin: ReturnType<TestDb['admin']>
  let started = false

  beforeAll(async () => {
    db = await openTestDb()
    admin = db.admin(1)
    started = true
  })
  afterAll(async () => {
    if (!started) return
    await admin.end()
    await db.drop()
  })

  /**
   * DOC-15 §13.1: the SQLSTATE a statement must raise — `23505` unique, `23514` check, `23503` foreign key, `23000`
   * a trigger of §11, `2200H` the sequence ceiling. A failure reports the code, so a wrong code fails the test.
   */
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

  /** A jsonb value: postgres.js sends the text and the SQL casts it (`::text::jsonb`); a bare string would become a JSON string. */
  const j = (value: unknown) => JSON.stringify(value)

  test('FNM-01 a draft batch PH-2610-01 of fee month 2026-10-01 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
      VALUES (${BATCH1}, ${B1}, 'PH-2610-01', ${BATCH_NAME}::text::jsonb, '2026-10-01', '2026-10-15', ${STAFF})`
  })

  test('FNM-02 a second batch with the same code in the same building is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
        VALUES (${crypto.randomUUID()}, ${B1}, 'PH-2610-01', ${BATCH_NAME}::text::jsonb, '2026-10-01', '2026-10-15', ${STAFF})`,
      '23505',
    )
  })

  test('FNM-03 the same code in another building is accepted', async () => {
    await db.sql`
      INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
      VALUES (${crypto.randomUUID()}, ${B2}, 'PH-2610-01', ${BATCH_NAME}::text::jsonb, '2026-10-01', '2026-10-15', ${STAFF})`
  })

  test('FNM-04 a fee month that is not the first day of the month is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
        VALUES (${crypto.randomUUID()}, ${B1}, 'PH-2610-04', ${BATCH_NAME}::text::jsonb, '2026-10-15', '2026-10-15', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-05 a code that is not PH-YYMM-NN is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
        VALUES (${crypto.randomUUID()}, ${B1}, 'PH-26-10-02', ${BATCH_NAME}::text::jsonb, '2026-10-01', '2026-10-15', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-06 a name without the vi key is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
        VALUES (${crypto.randomUUID()}, ${B1}, 'PH-2610-06', ${j({ en: 'October 2026 fees' })}::text::jsonb, '2026-10-01', '2026-10-15', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-07 a published status without published_at is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, status, created_by)
        VALUES (${crypto.randomUUID()}, ${B1}, 'PH-2610-07', ${BATCH_NAME}::text::jsonb, '2026-10-01', '2026-10-15', 'published', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-08 a draft charge A-1508 of 2,638,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
      VALUES (${CHARGE_1508}, ${B1}, ${BATCH1}, ${UNIT_1508}, 'A-1508', 2638000)`
  })

  test('FNM-09 a second charge for the same batch and unit is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${BATCH1}, ${UNIT_1508}, 'A-1508', 2638000)`,
      '23505',
    )
  })

  test('FNM-10 a charge amount of 0 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${BATCH1}, ${UNIT_B2}, 'A-1511', 0)`,
      '23514',
    )
  })

  test('FNM-11 a charge of an unknown batch is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${crypto.randomUUID()}, ${UNIT_B2}, 'A-1512', 1000)`,
      '23503',
    )
  })

  test('FNM-12 a fee line 1 x 2,488,000 = 2,488,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
      VALUES (${LINE_1508_1}, ${B1}, ${CHARGE_1508}, 1, 'fee', ${FEE_ITEM}::text::jsonb, 1, 2488000, 2488000)`
  })

  test('FNM-13 a fee line 12.345 x 15,000 with amount 185,000 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${LINE_1508_2}, ${B1}, ${CHARGE_1508}, 2, 'fee', ${FEE_ITEM}::text::jsonb, '12.345', 15000, 185000)`,
      '23514',
    )
  })

  test('FNM-14 the same line with amount 185,175 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
      VALUES (${LINE_1508_2}, ${B1}, ${CHARGE_1508}, 2, 'fee', ${FEE_ITEM}::text::jsonb, '12.345', 15000, 185175)`
  })

  test('FNM-15 an adjustment of -35,175 without a note is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${LINE_1508_ADJ}, ${B1}, ${CHARGE_1508}, 3, 'adjustment', ${ADJUST_ITEM}::text::jsonb, 1, 0, -35175)`,
      '23514',
    )
  })

  test('FNM-16 the same adjustment with its note is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount, note)
      VALUES (${LINE_1508_ADJ}, ${B1}, ${CHARGE_1508}, 3, 'adjustment', ${ADJUST_ITEM}::text::jsonb, 1, 0, -35175, 'Trừ phí nước tính thừa tháng 9')`
  })

  test('FNM-17 a fee line with quantity 0 and amount 0 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${CHARGE_1508}, 4, 'fee', ${FEE_ITEM}::text::jsonb, 0, 100, 0)`,
      '23514',
    )
  })

  test('FNM-18 a second line at position 1 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${CHARGE_1508}, 1, 'fee', ${FEE_ITEM}::text::jsonb, 1, 1000, 1000)`,
      '23505',
    )
  })

  test('FNM-19 the draft amount set to 2,638,000 with version + 1 is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET amount = 2638000, version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1508}`
  })

  test('FNM-20 the draft amount set to 2,700,000 is accepted, it is a draft', async () => {
    await db.sql`
      UPDATE finance.charge SET amount = 2700000, version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1508}`
  })

  test('FNM-21 that charge moved to open is refused, the amount differs from its lines', async () => {
    await rejects(
      () =>
        db.sql`UPDATE finance.charge SET status = 'open', updated_at = now() WHERE id = ${CHARGE_1508}`,
      '23000',
    )
  })

  test('FNM-22 the draft amount back to 2,638,000 is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET amount = 2638000, version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1508}`
  })

  test('FNM-23 a draft charge A-1509 of 350,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
      VALUES (${CHARGE_1509}, ${B1}, ${BATCH1}, ${UNIT_1509}, 'A-1509', 350000)`
  })

  test('FNM-24 its line 1 x 350,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
      VALUES (${LINE_1509}, ${B1}, ${CHARGE_1509}, 1, 'fee', ${FEE_ITEM}::text::jsonb, 1, 350000, 350000)`
  })

  test('FNM-25 a draft charge A-1510 of 500,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount)
      VALUES (${CHARGE_1510}, ${B1}, ${BATCH1}, ${UNIT_1510}, 'A-1510', 500000)`
  })

  test('FNM-26 its line 1 x 500,000 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
      VALUES (${LINE_1510}, ${B1}, ${CHARGE_1510}, 1, 'fee', ${FEE_ITEM}::text::jsonb, 1, 500000, 500000)`
  })

  test('FNM-27 publish moves the batch to published and its 3 charges to open in one statement', async () => {
    await db.sql.begin(async (sql) => {
      await sql`
        WITH b AS (
          UPDATE finance.fee_batch
             SET status = 'published', published_at = now(), published_by = ${STAFF}, version = version + 1, updated_at = now()
           WHERE id = ${BATCH1} AND building_id = ${B1} AND status = 'draft' AND version = 1
          RETURNING id)
        UPDATE finance.charge c
           SET status = 'open', version = c.version + 1, updated_at = now()
          FROM b
         WHERE c.building_id = ${B1} AND c.batch_id = b.id AND c.status = 'draft'`
    })
  })

  test('FNM-28 the amount of an open charge is refused once changed', async () => {
    await rejects(
      () =>
        db.sql`UPDATE finance.charge SET amount = amount + 1, updated_at = now() WHERE id = ${CHARGE_1508}`,
      '23000',
    )
  })

  test('FNM-29 a line of an open charge is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.charge_line SET amount = amount + 1 WHERE id = ${LINE_1508_1}`,
      '23000',
    )
  })

  test('FNM-30 a line inserted into an open charge is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${CHARGE_1508}, 5, 'fee', ${FEE_ITEM}::text::jsonb, 1, 1000, 1000)`,
      '23000',
    )
  })

  test('FNM-31 the lines of an open charge are refused on delete', async () => {
    await rejects(
      () => db.sql`DELETE FROM finance.charge_line WHERE charge_id = ${CHARGE_1508}`,
      '23000',
    )
  })

  test('FNM-32 an open charge is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.charge WHERE id = ${CHARGE_1510}`, '23000')
  })

  test('FNM-33 a published batch is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.fee_batch WHERE id = ${BATCH1}`, '23000')
  })

  test('FNM-34 the fee month of a published batch is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.fee_batch SET fee_month = '2026-09-01' WHERE id = ${BATCH1}`,
      '23000',
    )
  })

  test('FNM-35 the due date of the published batch moved to 2026-10-25 is accepted', async () => {
    await db.sql`
      UPDATE finance.fee_batch SET due_date = '2026-10-25', updated_at = now() WHERE id = ${BATCH1}`
  })

  test('FNM-36 the batch from published back to draft is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.fee_batch SET status = 'draft', published_at = NULL, published_by = NULL WHERE id = ${BATCH1}`,
      '23000',
    )
  })

  test('FNM-37 a single void of A-1510 with a 3-character reason is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.charge SET status = 'void', void_kind = 'single', void_reason = 'sai', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
         WHERE id = ${CHARGE_1510}`,
      '23514',
    )
  })

  test('FNM-38 a void status without void_kind is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.charge SET status = 'void', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
         WHERE id = ${CHARGE_1510}`,
      '23514',
    )
  })

  test('FNM-39 a single void of A-1510 with a real reason is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET status = 'void', void_kind = 'single', void_reason = 'billed to the wrong unit', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
       WHERE id = ${CHARGE_1510}`
  })

  test('FNM-40 the voided charge back to open is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.charge SET status = 'open', void_kind = NULL, void_reason = NULL, voided_at = NULL, voided_by = NULL, updated_at = now()
         WHERE id = ${CHARGE_1510}`,
      '23000',
    )
  })

  test('FNM-41 a cash payment without a payer name is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, client_key, recorded_by)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'cash', 2988000, now(), 'K1', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-42 a cash payment without an idempotency key is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, recorded_by)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'cash', 2988000, now(), 'Trần Minh Anh', ${STAFF})`,
      '23514',
    )
  })

  test('FNM-43 a cash payment of 2,988,000 with key K is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by)
      VALUES (${PAYMENT_K}, ${B1}, ${UNIT_1508}, 'cash', 2988000, now(), 'Trần Minh Anh', 'K', ${STAFF})`
  })

  test('FNM-44 a second payment with key K is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'cash', 2638000, now(), 'Trần Minh Anh', 'K', ${STAFF})`,
      '23505',
    )
  })

  test('FNM-45 A-1508 open to paid by the conditional update with amount 2,638,000 is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET status = 'paid', version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1508} AND building_id = ${B1} AND status = 'open' AND amount = 2638000`
  })

  test('FNM-46 a live allocation of A-1508 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
      VALUES (${ALLOC_1508}, ${B1}, ${PAYMENT_K}, ${CHARGE_1508}, 2638000)`
  })

  test('FNM-47 a second live allocation of A-1508 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${PAYMENT_K}, ${CHARGE_1508}, 2638000)`,
      '23505',
    )
  })

  test('FNM-48 A-1509 open to paid is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET status = 'paid', version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1509} AND building_id = ${B1} AND status = 'open'`
  })

  test('FNM-49 a live allocation of A-1509 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
      VALUES (${ALLOC_1509}, ${B1}, ${PAYMENT_K}, ${CHARGE_1509}, 350000)`
  })

  test('FNM-50 a single void of the paid A-1509 is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.charge SET status = 'void', void_kind = 'single', void_reason = 'billed twice', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
         WHERE id = ${CHARGE_1509}`,
      '23000',
    )
  })

  test('FNM-51 a receipt BL-2610-0153 for the allocation of A-1508 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
      VALUES (${RECEIPT_1508}, ${B1}, 'BL-2610-0153', ${ALLOC_1508}, ${PAYMENT_K}, ${CHARGE_1508}, ${UNIT_1508}, 2638000, ${SNAPSHOT}::text::jsonb)`
  })

  test('FNM-52 another receipt numbered BL-2610-0153 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
        VALUES (${crypto.randomUUID()}, ${B1}, 'BL-2610-0153', ${ALLOC_1509}, ${PAYMENT_K}, ${CHARGE_1509}, ${UNIT_1509}, 350000, ${SNAPSHOT}::text::jsonb)`,
      '23505',
    )
  })

  test('FNM-53 a second receipt for the same allocation is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
        VALUES (${crypto.randomUUID()}, ${B1}, 'BL-2610-0999', ${ALLOC_1508}, ${PAYMENT_K}, ${CHARGE_1508}, ${UNIT_1508}, 2638000, ${SNAPSHOT}::text::jsonb)`,
      '23505',
    )
  })

  test('FNM-54 the number BL-261-0154 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
        VALUES (${crypto.randomUUID()}, ${B1}, 'BL-261-0154', ${ALLOC_1509}, ${PAYMENT_K}, ${CHARGE_1509}, ${UNIT_1509}, 350000, ${SNAPSHOT}::text::jsonb)`,
      '23514',
    )
  })

  test('FNM-55 a receipt BL-2610-0154 for A-1509 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.receipt (id, building_id, number, allocation_id, payment_id, charge_id, unit_id, amount, snapshot)
      VALUES (${RECEIPT_1509}, ${B1}, 'BL-2610-0154', ${ALLOC_1509}, ${PAYMENT_K}, ${CHARGE_1509}, ${UNIT_1509}, 350000, ${SNAPSHOT}::text::jsonb)`
  })

  test('FNM-56 the payment amount is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.payment SET amount = amount + 1 WHERE id = ${PAYMENT_K}`,
      '23000',
    )
  })

  test('FNM-57 the allocation amount is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.allocation SET amount = amount + 1 WHERE id = ${ALLOC_1508}`,
      '23000',
    )
  })

  test('FNM-58 the receipt snapshot is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.receipt SET snapshot = '{}'::jsonb WHERE id = ${RECEIPT_1508}`,
      '23000',
    )
  })

  test('FNM-59 setting the receipt pdf_file is accepted', async () => {
    await db.sql`UPDATE finance.receipt SET pdf_file = ${PDF_FILE}, updated_at = now() WHERE id = ${RECEIPT_1508}`
  })

  test('FNM-60 a payment is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.payment WHERE id = ${PAYMENT_K}`, '23000')
  })

  test('FNM-61 an allocation is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.allocation WHERE id = ${ALLOC_1508}`, '23000')
  })

  test('FNM-62 a receipt is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.receipt WHERE id = ${RECEIPT_1508}`, '23000')
  })

  test('FNM-63 a payment void with the 4-character reason sai. is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.payment SET status = 'void', void_reason = 'sai.', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
         WHERE id = ${PAYMENT_K}`,
      '23514',
    )
  })

  test('FNM-64 the void cascade voids the payment, its 2 allocations and 2 receipts and reopens the 2 charges', async () => {
    await db.sql.begin(async (sql) => {
      await sql`
        UPDATE finance.payment SET status = 'void', void_reason = 'the transfer was refused by the bank', voided_at = now(), voided_by = ${STAFF}, updated_at = now()
         WHERE id = ${PAYMENT_K} AND building_id = ${B1} AND status = 'posted' AND source IN ('cash', 'bank_transfer')`
      await sql`
        UPDATE finance.allocation SET status = 'void', voided_at = now(), updated_at = now()
         WHERE building_id = ${B1} AND payment_id = ${PAYMENT_K} AND status = 'live'`
      await sql`
        UPDATE finance.charge SET status = 'open', version = version + 1, updated_at = now()
         WHERE building_id = ${B1} AND id = ANY(ARRAY[${CHARGE_1508}, ${CHARGE_1509}]::uuid[]) AND status = 'paid'`
      await sql`
        UPDATE finance.receipt SET status = 'void', voided_at = now(), updated_at = now()
         WHERE building_id = ${B1} AND payment_id = ${PAYMENT_K} AND status = 'issued'`
    })
  })

  test('FNM-65 the voided allocation back to live is refused', async () => {
    await rejects(
      () =>
        db.sql`UPDATE finance.allocation SET status = 'live', voided_at = NULL WHERE id = ${ALLOC_1508}`,
      '23000',
    )
  })

  test('FNM-66 the voided payment back to posted is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.payment SET status = 'posted', void_reason = NULL, voided_at = NULL, voided_by = NULL WHERE id = ${PAYMENT_K}`,
      '23000',
    )
  })

  test('FNM-67 a new bank-transfer payment of A-1508 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by, bank_reference)
      VALUES (${PAYMENT_K2}, ${B1}, ${UNIT_1508}, 'bank_transfer', 2638000, now(), 'Trần Minh Anh', 'K2', ${STAFF}, 'FT-MANUAL-1')`
  })

  test('FNM-68 A-1508 open to paid again is accepted', async () => {
    await db.sql`
      UPDATE finance.charge SET status = 'paid', version = version + 1, updated_at = now()
       WHERE id = ${CHARGE_1508} AND building_id = ${B1} AND status = 'open'`
  })

  test('FNM-69 a new live allocation of A-1508 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount)
      VALUES (${ALLOC_1508_NEW}, ${B1}, ${PAYMENT_K2}, ${CHARGE_1508}, 2638000)`
  })

  test('FNM-70 an online payment without an intent is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, provider, gateway_reference)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'online', 1000, now(), 'stripe', 'ref_no_intent')`,
      '23514',
    )
  })

  test('FNM-71 an online payment in status void is refused', async () => {
    // The CHECK (ck_payment_void_source) is evaluated before the foreign-key trigger, so the row is refused on the source.
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, provider, gateway_reference, intent_id, status, void_reason, voided_at, voided_by)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'online', 1000, now(), 'stripe', 'ref_void', ${crypto.randomUUID()}, 'void', 'refunded by the bank', now(), ${STAFF})`,
      '23514',
    )
  })

  test('FNM-72 an intent TT-261019-0001 in creating with an order code from the sequence is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at)
      VALUES (${INTENT_1}, ${B1}, ${UNIT_1508}, 'TT-261019-0001', nextval('finance.order_code_seq'), 2638000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes')`
  })

  test('FNM-73 an intent of another building with an order code already used is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at)
        VALUES (${crypto.randomUUID()}, ${B2}, ${UNIT_B2}, 'TT-261019-0002', (SELECT order_code FROM finance.payment_intent WHERE id = ${INTENT_1}), 1000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes')`,
      '23505',
    )
  })

  test('FNM-74 the order code 999,999 is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'TT-261019-0003', 999999, 1000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes')`,
      '23514',
    )
  })

  test('FNM-75 an intent in pending without a link is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at, status)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'TT-261019-0007', 2000007, 1000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes', 'pending')`,
      '23514',
    )
  })

  test('FNM-76 an item that holds A-1509 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment_intent_item (id, building_id, intent_id, charge_id, amount)
      VALUES (${ITEM_1509}, ${B1}, ${INTENT_1}, ${CHARGE_1509}, 350000)`
  })

  test('FNM-77 a second intent in creating is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at)
      VALUES (${INTENT_2}, ${B1}, ${UNIT_1508}, 'TT-261019-0004', 2000004, 350000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes')`
  })

  test('FNM-78 the second intent also holding A-1509 while the first item is unreleased is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment_intent_item (id, building_id, intent_id, charge_id, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${INTENT_2}, ${CHARGE_1509}, 350000)`,
      '23505',
    )
  })

  test('FNM-79 the first intent creating to pending with its link is accepted', async () => {
    await db.sql`
      UPDATE finance.payment_intent SET status = 'pending', link_id = 'plink_1', qr_payload = '00020101', updated_at = now()
       WHERE id = ${INTENT_1}`
  })

  test('FNM-80 pending to cancelling without a reason is refused', async () => {
    await rejects(
      () => db.sql`UPDATE finance.payment_intent SET status = 'cancelling' WHERE id = ${INTENT_1}`,
      '23514',
    )
  })

  test('FNM-81 paid without paid_at and a reference is refused', async () => {
    await rejects(
      () => db.sql`UPDATE finance.payment_intent SET status = 'paid' WHERE id = ${INTENT_1}`,
      '23514',
    )
  })

  test('FNM-82 an intent is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.payment_intent WHERE id = ${INTENT_1}`, '23000')
  })

  test('FNM-83 nextval after setval to the ceiling 34,359,738,367 raises 2200H', async () => {
    await admin`SELECT setval('finance.order_code_seq', 34359738367)`
    await rejects(() => db.sql`SELECT nextval('finance.order_code_seq')`, '2200H')
  })

  test('FNM-84 a gateway_event pending for FT2628273914 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome)
      VALUES (${EVENT_PENDING}, ${B1}, 'payos', 'FT2628273914', 2638000, now(), 'webhook', '{}'::jsonb, 'pending')`
  })

  test('FNM-85 the same payos FT2628273914 from the re-query is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome)
        VALUES (${crypto.randomUUID()}, ${B1}, 'payos', 'FT2628273914', 2638000, now(), 'requery', '{}'::jsonb, 'pending')`,
      '23505',
    )
  })

  test('FNM-86 the outcome amount_short without an intent is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome)
        VALUES (${crypto.randomUUID()}, ${B1}, 'payos', 'FT2628273915', 1000, now(), 'requery', '{}'::jsonb, 'amount_short')`,
      '23514',
    )
  })

  test('FNM-87 the outcome amount_short with an intent and a unit is accepted', async () => {
    await db.sql`
      INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, intent_id, unit_id, outcome)
      VALUES (${EVENT_SHORT}, ${B1}, 'payos', 'FT2628273916', 1000, now(), 'requery', '{}'::jsonb, ${INTENT_1}, ${UNIT_1508}, 'amount_short')`
  })

  test('FNM-88 that outcome changed to charge_already_paid is refused', async () => {
    await rejects(
      () =>
        db.sql`UPDATE finance.gateway_event SET outcome = 'charge_already_paid' WHERE id = ${EVENT_SHORT}`,
      '23000',
    )
  })

  test('FNM-89 a review with the 3-character note ok. is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.gateway_event SET reviewed_at = now(), reviewed_by = ${STAFF}, review_note = 'ok.' WHERE id = ${EVENT_SHORT}`,
      '23514',
    )
  })

  test('FNM-90 a review with a real note is accepted', async () => {
    await db.sql`
      UPDATE finance.gateway_event SET reviewed_at = now(), reviewed_by = ${STAFF}, review_note = 'refunded by bank transfer 10/19' WHERE id = ${EVENT_SHORT}`
  })

  test('FNM-91 the review note changed is refused', async () => {
    await rejects(
      () =>
        db.sql`UPDATE finance.gateway_event SET review_note = 'a different note' WHERE id = ${EVENT_SHORT}`,
      '23000',
    )
  })

  test('FNM-92 the outcome posted without a payment is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, intent_id, outcome)
        VALUES (${crypto.randomUUID()}, ${B1}, 'payos', 'FT2628273917', 1000, now(), 'requery', '{}'::jsonb, ${INTENT_1}, 'posted')`,
      '23514',
    )
  })

  test('FNM-93 an unknown_order row reviewed with the note x is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.gateway_event (id, building_id, provider, reference, amount, paid_at, source, payload, outcome, reviewed_at, reviewed_by, review_note)
        VALUES (${crypto.randomUUID()}, ${B1}, 'payos', 'FT2628273918', 1000, now(), 'requery', '{}'::jsonb, 'unknown_order', now(), ${STAFF}, 'x')`,
      '23514',
    )
  })

  test('FNM-94 a gateway_event is refused on delete', async () => {
    await rejects(
      () => db.sql`DELETE FROM finance.gateway_event WHERE id = ${EVENT_PENDING}`,
      '23000',
    )
  })

  test('FNM-95 the rejection reason replayed is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.webhook_rejection (id, building_id, gateway_config_id, reason, body_sha256)
        VALUES (${crypto.randomUUID()}, ${B1}, ${GATEWAY_CONFIG}, 'replayed', ${'a'.repeat(64)})`,
      '23514',
    )
  })

  test('FNM-96 a rejection excerpt of 2,049 bytes is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.webhook_rejection (id, building_id, gateway_config_id, reason, body_sha256, body_excerpt)
        VALUES (${crypto.randomUUID()}, ${B1}, ${GATEWAY_CONFIG}, 'malformed', ${'a'.repeat(64)}, ${'a'.repeat(2049)})`,
      '23514',
    )
  })

  test('FNM-97 a rejection excerpt of 2,048 bytes is accepted', async () => {
    await db.sql`
      INSERT INTO finance.webhook_rejection (id, building_id, gateway_config_id, reason, body_sha256, body_excerpt)
      VALUES (${REJECTION}, ${B1}, ${GATEWAY_CONFIG}, 'malformed', ${'a'.repeat(64)}, ${'a'.repeat(2048)})`
  })

  test('FNM-98 a statement import processed for 2026-10-01 to 19 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.statement_import (id, building_id, profile_key, file_key, status, period_from, period_to, created_by)
      VALUES (${IMPORT_DOC}, ${B1}, 'generic', 'statements/oct.csv', 'processed', '2026-10-01', '2026-10-19', ${STAFF})`
  })

  test('FNM-99 a statement line of 2,638,000 with reference FT2629100001 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.statement_line (id, building_id, import_id, line_no, booked_on, amount, content, bank_reference, dedup_key)
      VALUES (${STMT_LINE}, ${B1}, ${IMPORT_DOC}, 1, '2026-10-09', 2638000, 'TRAN MINH ANH', 'FT2629100001', ${DEDUP_KEY})`
  })

  test('FNM-100 a line with the same dedup_key is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.statement_line (id, building_id, import_id, line_no, booked_on, amount, bank_reference, dedup_key)
        VALUES (${crypto.randomUUID()}, ${B1}, ${IMPORT_DOC}, 2, '2026-10-10', 2638000, 'FT2629100002', ${DEDUP_KEY})`,
      '23505',
    )
  })

  test('FNM-101 matched without a payment is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.statement_line (id, building_id, import_id, line_no, booked_on, amount, dedup_key, match_status)
        VALUES (${crypto.randomUUID()}, ${B1}, ${IMPORT_DOC}, 3, '2026-10-11', 1000, ${'b'.repeat(64)}, 'matched')`,
      '23514',
    )
  })

  test('FNM-102 matching the line to the bank-transfer payment, which gets reconciled_at, is accepted', async () => {
    await db.sql.begin(async (sql) => {
      await sql`
        UPDATE finance.statement_line SET match_status = 'matched', payment_id = ${PAYMENT_K2}, updated_at = now()
         WHERE id = ${STMT_LINE} AND building_id = ${B1}`
      await sql`
        UPDATE finance.payment SET reconciled_at = now(), updated_at = now()
         WHERE id = ${PAYMENT_K2} AND building_id = ${B1}`
    })
  })

  test('FNM-103 a review of a matched line is refused', async () => {
    await rejects(
      () => db.sql`
        UPDATE finance.statement_line SET reviewed_at = now(), reviewed_by = ${STAFF}, review_note = 'checked against the bank' WHERE id = ${STMT_LINE}`,
      '23514',
    )
  })

  test('FNM-104 the line amount is refused once changed', async () => {
    await rejects(
      () => db.sql`UPDATE finance.statement_line SET amount = amount + 1 WHERE id = ${STMT_LINE}`,
      '23000',
    )
  })

  test('FNM-105 a statement line is refused on delete', async () => {
    await rejects(() => db.sql`DELETE FROM finance.statement_line WHERE id = ${STMT_LINE}`, '23000')
  })

  test('FNM-106 a cash payment with a statement_line_id is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by, statement_line_id)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, 'cash', 1000, now(), 'Trần Minh Anh', 'S1', ${STAFF}, ${STMT_LINE})`,
      '23514',
    )
  })

  test('FNM-107 the import kind unit_owner in the finance table is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.import_job (id, building_id, kind, status, file_key, params, result, created_by, expires_at)
        VALUES (${crypto.randomUUID()}, ${B1}, 'unit_owner', 'validated', 'imports/units.xlsx', ${j({ batchId: BATCH1 })}::text::jsonb, '{}'::jsonb, ${STAFF}, now() + interval '24 hours')`,
      '23514',
    )
  })

  test('FNM-108 a fee import without params.batchId is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.import_job (id, building_id, kind, status, file_key, params, result, created_by, expires_at)
        VALUES (${crypto.randomUUID()}, ${B1}, 'fee_batch', 'validated', 'imports/fees.xlsx', '{}'::jsonb, '{}'::jsonb, ${STAFF}, now() + interval '24 hours')`,
      '23514',
    )
  })

  test('FNM-109 a fee import validated with batchId is accepted', async () => {
    await db.sql`
      INSERT INTO finance.import_job (id, building_id, kind, status, file_key, params, result, created_by, expires_at)
      VALUES (${IMPORT_JOB}, ${B1}, 'fee_batch', 'validated', 'imports/fees.xlsx', ${j({ batchId: BATCH1 })}::text::jsonb, '{}'::jsonb, ${STAFF}, now() + interval '24 hours')`
  })

  test('FNM-110 a bulk fee-notice request for the batch is accepted', async () => {
    await db.sql`
      INSERT INTO finance.fee_notice_job (id, building_id, batch_id, language, unit_total, requested_by)
      VALUES (${NOTICE_JOB}, ${B1}, ${BATCH1}, 'both', 3, ${STAFF})`
  })

  test('FNM-111 a second active request for the same batch is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_notice_job (id, building_id, batch_id, language, unit_total, requested_by)
        VALUES (${crypto.randomUUID()}, ${B1}, ${BATCH1}, 'vi', 3, ${STAFF})`,
      '23505',
    )
  })

  test('FNM-112 a request ready without a ZIP is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fee_notice_job (id, building_id, batch_id, status, language, unit_total, requested_by, finished_at)
        VALUES (${NOTICE_JOB_READY}, ${B1}, ${BATCH1}, 'ready', 'both', 3, ${STAFF}, now())`,
      '23514',
    )
  })

  test('FNM-113 a reminder to A-1508 on 2026-10-19 is accepted', async () => {
    await db.sql`
      INSERT INTO finance.debt_reminder (id, building_id, unit_id, reminder_day, sent_by, charge_count, amount)
      VALUES (${REMINDER}, ${B1}, ${UNIT_1508}, '2026-10-19', ${STAFF}, 1, 2638000)`
  })

  test('FNM-114 a second reminder to A-1508 the same day is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.debt_reminder (id, building_id, unit_id, reminder_day, sent_by, charge_count, amount)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1508}, '2026-10-19', ${STAFF}, 1, 2638000)`,
      '23505',
    )
  })

  test('FNM-115 a fake link paid without a reference is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.fake_gateway_link (id, building_id, gateway_config_id, order_code, link_id, amount, description, status, expires_at, paid_at)
        VALUES (${FAKE_LINK}, ${B1}, ${GATEWAY_CONFIG}, 1500000, 'lnk_fake', 500000, 'Fake link', 'paid', now() + interval '1 hour', now())`,
      '23514',
    )
  })

  test('FNM-116 the counter series ticket in finance is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.document_counter (building_id, series, period, last) VALUES (${B1}, 'ticket', '2610', 0)`,
      '23514',
    )
  })

  test('FNM-117 a counter row is refused on delete', async () => {
    await db.sql`
      INSERT INTO finance.document_counter (building_id, series, period, last) VALUES (${B1}, 'receipt', '2610', 0)`
    await rejects(
      () =>
        db.sql`DELETE FROM finance.document_counter WHERE building_id = ${B1} AND series = 'receipt' AND period = '2610'`,
      '23000',
    )
  })

  test('FNM-118 with rms.demo_reset set to building 2 a receipt of building 1 is still refused on delete', async () => {
    await rejects(
      () =>
        db.sql.begin(async (sql) => {
          await sql`SELECT set_config('rms.demo_reset', ${B2}, true)`
          await sql`DELETE FROM finance.receipt WHERE building_id = ${B1}`
        }),
      '23000',
    )
  })

  test('FNM-119 with rms.demo_reset set to building 1 its own receipt is deleted, then rolled back', async () => {
    await db.sql
      .begin(async (sql) => {
        await sql`SELECT set_config('rms.demo_reset', ${B1}, true)`
        const rows = await sql`DELETE FROM finance.receipt WHERE building_id = ${B1} RETURNING id`
        expect(rows.length).toBeGreaterThan(0)
        throw new Error('roll back the fixture')
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'roll back the fixture') throw error
      })
  })

  test('FNM-120 the demo-reset setting is empty after that transaction, it was local', async () => {
    const [row] = await db.sql<{ reset: string }[]>`
      SELECT coalesce(current_setting('rms.demo_reset', true), '') AS reset`
    expect(row?.reset).toBe('')
  })

  test('FNM-121 a charge that is not void carrying a void reason is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, void_reason)
        VALUES (${CHARGE_121}, ${B1}, ${BATCH1}, ${UNIT_B2}, 'A-1211', 1000, 'draft', 'this reason is long enough')`,
      '23514',
    )
  })

  test('FNM-122 an intent creating to cancelling with batch_recalled and no link yet is accepted', async () => {
    await db.sql`
      INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at)
      VALUES (${INTENT_CANCELLING}, ${B1}, ${UNIT_1510}, 'TT-261019-0005', 2000005, 1000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes')`
    await db.sql`
      UPDATE finance.payment_intent SET status = 'cancelling', cancel_reason = 'batch_recalled', cancel_requested_at = now(), updated_at = now()
       WHERE id = ${INTENT_CANCELLING}`
  })

  test('FNM-123 an intent expired without a link is refused', async () => {
    await rejects(
      () => db.sql`
        INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, gateway_config_id, created_by, display_until, expires_at, status, expired_at)
        VALUES (${crypto.randomUUID()}, ${B1}, ${UNIT_1510}, 'TT-261019-0006', 2000006, 1000, ${GATEWAY_CONFIG}, ${STAFF}, now() + interval '30 minutes', now() + interval '60 minutes', 'expired', now())`,
      '23514',
    )
  })
})
