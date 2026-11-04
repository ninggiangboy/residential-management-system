import type { TestDb } from '@rms/test-support'

/**
 * The finance objects of the matrix world (DOC-39 §4.5, P2-15): per building a draft batch with a draft charge, a published batch
 * with an open charge, a paid charge with its payment and receipt, and a gateway event of the money log. The payment is recorded
 * through `POST /staff/payments`, so its allocation, receipt and ledger rows are the ones the module writes.
 */
export interface FinanceObjects {
  /** A draft batch and its draft charge (E-91…E-95, E-170…E-172, E-94). */
  draftBatch: string
  draftCharge: string
  /** The same for the Manager: E-171 and E-172 delete theirs, and the Admin's cell runs first (the next cell would find nothing). */
  spareDraftBatch: string
  spareDraftCharge: string
  /** A published batch and its open charge (E-81, E-96…E-100, E-176). */
  publishedBatch: string
  openCharge: string
  /** The payment that paid a charge, and the receipt it issued (E-84, E-105, E-106). */
  paymentId: string
  receiptId: string
  /** A `gateway_event` row (E-109). */
  gatewayEvent: string
}

export interface FinanceWorld {
  b1: FinanceObjects
  b2: FinanceObjects
}

type Sql = TestDb['sql']

type Call = (
  path: string,
  init?: RequestInit & { json?: unknown; token?: string },
) => Promise<Response> | Response

export interface FinanceBuilding {
  id: string
  unitId: string
  unitCode: string
  adminId: string
  adminToken: string
}

async function publishedBatch(
  sql: Sql,
  b: FinanceBuilding,
  code: string,
  amount: number,
): Promise<{ batchId: string; chargeId: string }> {
  const batchId = crypto.randomUUID()
  const chargeId = crypto.randomUUID()
  await sql`
    INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, status, created_by, published_at, published_by, version)
    VALUES (${batchId}, ${b.id}, ${code}, '{"vi":"Phí tháng","en":"Monthly fee"}'::jsonb,
            '2026-10-01'::date, '2026-11-10'::date, 'published', ${b.adminId}, now(), ${b.adminId}, 2)`
  await sql`
    INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    VALUES (${chargeId}, ${b.id}, ${batchId}, ${b.unitId}, ${b.unitCode}, ${amount}, 'draft', 1)`
  await sql`
    INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    VALUES (${crypto.randomUUID()}, ${b.id}, ${chargeId}, 1, 'fee',
            '{"vi":"Phí quản lý","en":"Management fee"}'::jsonb, 1, ${amount}, ${amount})`
  await sql`UPDATE finance.charge SET status = 'open', version = 2, updated_at = now() WHERE id = ${chargeId}`
  return { batchId, chargeId }
}

async function draftBatch(
  sql: Sql,
  b: FinanceBuilding,
  code: string,
): Promise<{ batchId: string; chargeId: string }> {
  const batchId = crypto.randomUUID()
  const chargeId = crypto.randomUUID()
  await sql`
    INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, status, created_by, version)
    VALUES (${batchId}, ${b.id}, ${code}, '{"vi":"Phí nháp","en":"Draft fee"}'::jsonb,
            '2026-09-01'::date, '2026-10-10'::date, 'draft', ${b.adminId}, 1)`
  await sql`
    INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    VALUES (${chargeId}, ${b.id}, ${batchId}, ${b.unitId}, ${b.unitCode}, 200000, 'draft', 1)`
  await sql`
    INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    VALUES (${crypto.randomUUID()}, ${b.id}, ${chargeId}, 1, 'fee',
            '{"vi":"Phí quản lý","en":"Management fee"}'::jsonb, 1, 200000, 200000)`
  return { batchId, chargeId }
}

async function seedBuilding(sql: Sql, call: Call, b: FinanceBuilding): Promise<FinanceObjects> {
  const draft = await draftBatch(sql, b, 'PH-2609-01')
  const spare = await draftBatch(sql, b, 'PH-2609-02')

  const open = await publishedBatch(sql, b, 'PH-2610-01', 300_000)
  const toPay = await publishedBatch(sql, b, 'PH-2610-02', 400_000)

  const paid = await call('/staff/payments', {
    method: 'POST',
    token: b.adminToken,
    headers: { 'idempotency-key': crypto.randomUUID() },
    json: {
      unitId: b.unitId,
      chargeIds: [toPay.chargeId],
      method: 'cash',
      payerName: 'Matrix Payer',
      receivedOn: new Date().toISOString().slice(0, 10),
    },
  })
  if (paid.status !== 201)
    throw new Error(`matrix payment of ${b.unitCode}: ${paid.status} ${await paid.text()}`)
  const payment = (await paid.json()) as {
    paymentId: string
    receipts: Array<{ receiptId: string }>
  }
  const receiptId = payment.receipts[0]?.receiptId
  if (!receiptId) throw new Error(`matrix payment of ${b.unitCode} issued no receipt`)

  // E-177 reads the notice job of the published batch: it answers 404 until E-99 has made one.
  const job = await call(`/staff/fee-batches/${open.batchId}/pdf`, {
    method: 'POST',
    token: b.adminToken,
    json: {},
  })
  if (job.status !== 202)
    throw new Error(`matrix notice job of ${b.unitCode}: ${job.status} ${await job.text()}`)

  const gatewayEvent = crypto.randomUUID()
  await sql`
    INSERT INTO finance.gateway_event (id, building_id, provider, reference, order_code, amount, paid_at, source, payload, intent_id, unit_id, outcome, received_at)
    VALUES (${gatewayEvent}, ${b.id}, 'fake', ${crypto.randomUUID()}, ${null}, 100000, now(),
            'webhook', '{}'::jsonb, ${null}, ${b.unitId}, 'unknown_order', now())`

  return {
    draftBatch: draft.batchId,
    draftCharge: draft.chargeId,
    spareDraftBatch: spare.batchId,
    spareDraftCharge: spare.chargeId,
    publishedBatch: open.batchId,
    openCharge: open.chargeId,
    paymentId: payment.paymentId,
    receiptId,
    gatewayEvent,
  }
}

/** Seeds both buildings; the admin tokens are those of `staff.admin` (B1) and `staff.admin_b2` (B2). */
export async function seedFinance(
  sql: Sql,
  call: Call,
  b1: FinanceBuilding,
  b2: FinanceBuilding,
): Promise<FinanceWorld> {
  return { b1: await seedBuilding(sql, call, b1), b2: await seedBuilding(sql, call, b2) }
}
