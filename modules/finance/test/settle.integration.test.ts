import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import {
  type BuildingId,
  type Money,
  money,
  type StaffContext,
  type StaffId,
  type StaffRole,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq, type SQL, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import type { Confirmation } from '../src/application/settle'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  paymentIntent,
  paymentIntentItem,
} from '../src/infrastructure/persistence/schema'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The P2-06 tests of `settle()` (DOC-23 §6, §16.3, IN-24…IN-53) on a clone of the migrated template, with the real audit
 * module. The fixture is unit `A-1508` with charges A 2,488,000 đ and B 350,000 đ in two published batches, the `fake`
 * driver and a `FakeClock` at 2026-10-19T03:00:00Z; every test builds its own building so they stay independent. The eight
 * invariants of DOC-15 §12.2 are run after each posting test, scoped to the test's building.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
/** The fixture instant: the intent window opens before `paidAt` and closes before the module clock (ck_payment_intent_window). */
const AT = new Date('2026-10-19T02:00:00Z')
/** The module clock (IN-24): the receipt period is the issue month in building time, so `BL-2610-…`. */
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const PAID_AT = new Date('2026-10-19T02:14:31Z')
const CHARGE_A = 2_488_000
const CHARGE_B = 350_000
const TOTAL = CHARGE_A + CHARGE_B
const CLEAN = { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0, I8: 0 }

/** The eight ledger invariants of DOC-15 §12.2, scoped to one building; each answers the number of violating rows. */
const INVARIANTS: ReadonlyArray<readonly [string, (building: string) => SQL]> = [
  [
    'I1',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.charge c WHERE c.building_id = ${b} AND c.status = 'paid' AND 1 <> (SELECT count(*) FROM finance.allocation a WHERE a.charge_id = c.id AND a.status = 'live' AND a.amount = c.amount)`,
  ],
  [
    'I2',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id WHERE a.building_id = ${b} AND a.status = 'live' AND c.status <> 'paid'`,
  ],
  [
    'I3',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.payment p WHERE p.building_id = ${b} AND p.status = 'posted' AND p.amount <> coalesce((SELECT sum(a.amount) FROM finance.allocation a WHERE a.payment_id = p.id AND a.status = 'live'), 0)`,
  ],
  [
    'I4',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.allocation a WHERE a.building_id = ${b} AND a.status = 'live' AND NOT EXISTS (SELECT 1 FROM finance.receipt r WHERE r.allocation_id = a.id AND r.status = 'issued')`,
  ],
  [
    'I5',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.document_counter d WHERE d.building_id = ${b} AND d.series = 'receipt' AND d.last <> (SELECT count(*) FROM finance.receipt r WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period)`,
  ],
  [
    'I6',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.gateway_event g WHERE g.building_id = ${b} AND g.outcome = 'posted' AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = g.payment_id AND p.status = 'posted')`,
  ],
  [
    'I7',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.charge c WHERE c.building_id = ${b} AND c.status IN ('open', 'paid') AND c.amount <> (SELECT sum(l.amount) FROM finance.charge_line l WHERE l.charge_id = c.id)`,
  ],
  [
    'I8',
    (b) =>
      sql`SELECT count(*)::int AS n FROM finance.gateway_event WHERE building_id = ${b} AND outcome = 'pending'`,
  ],
]

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
let finance: FinanceModule
const ids = new UuidV7Generator()
const clock = new FakeClock(MODULE_NOW)

/** Unique per test: the order code, the intent code and the `(provider, reference)` are global keys of the clone. */
let orderSeq = 2_610_153
let intentSeq = 0
let refSeq = 0

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

function ref(): string {
  refSeq += 1
  return `FT${String(refSeq).padStart(10, '0')}`
}

function buildModule(ports: ReturnType<typeof testPorts>): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files: {
      read: () => Promise.reject(new Error('no file is read by settle')),
      attach: () => Promise.reject(new Error('no file is attached by settle')),
    },
    ...ports,
  })
}

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
  finance = buildModule(testPorts())
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

interface Fixture {
  readonly building: string
  readonly unit: string
  readonly chargeA: string
  readonly chargeB: string
  readonly intentId: string
  readonly orderCode: number
  readonly createdBy: string
  readonly gatewayConfigId: string
}

/** Two published batches with one open charge each on a fresh building (support/index.ts `seed`): A 2,488,000 and B 350,000. */
async function seedUnit(
  building: string,
): Promise<{ unit: string; chargeA: string; chargeB: string }> {
  const unit = ids.next()
  const batchA = ids.next()
  const batchB = ids.next()
  const chargeA = ids.next()
  const chargeB = ids.next()
  await database.executor.insert(feeBatch).values([
    {
      id: batchA,
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
    },
    {
      id: batchB,
      buildingId: building,
      code: 'PH-2610-02',
      name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
      feeMonth: '2026-10-01',
      dueDate: '2026-11-10',
      status: 'published',
      createdBy: ids.next(),
      publishedAt: AT,
      publishedBy: ids.next(),
      version: 2,
    },
  ])
  await database.executor.insert(chargeTable).values([
    {
      id: chargeA,
      buildingId: building,
      batchId: batchA,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_A,
      status: 'draft',
      version: 1,
    },
    {
      id: chargeB,
      buildingId: building,
      batchId: batchB,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_B,
      status: 'draft',
      version: 1,
    },
  ])
  await database.executor.insert(chargeLine).values([
    {
      id: ids.next(),
      buildingId: building,
      chargeId: chargeA,
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: CHARGE_A,
      amount: CHARGE_A,
    },
    {
      id: ids.next(),
      buildingId: building,
      chargeId: chargeB,
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: CHARGE_B,
      amount: CHARGE_B,
    },
  ])
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(eq(chargeTable.buildingId, building))
  return { unit, chargeA, chargeB }
}

interface IntentSpec {
  readonly building: string
  readonly unit: string
  readonly amount?: number
  readonly status?: string
  readonly linkId?: string | null
  readonly cancelReason?: string | null
  readonly cancelRequestedAt?: Date | null
  readonly cancelledAt?: Date | null
  readonly expiredAt?: Date | null
  readonly failedAt?: Date | null
}

/** A `finance.payment_intent` row: `pending` by default, with the window `+30`/`+60` minutes of the fixture instant. */
async function insertIntent(spec: IntentSpec): Promise<{
  intentId: string
  orderCode: number
  createdBy: string
  gatewayConfigId: string
}> {
  const intentId = ids.next()
  const createdBy = ids.next()
  const gatewayConfigId = ids.next()
  orderSeq += 1
  intentSeq += 1
  // Read once, before any await: a parallel seeding call may move the counter meanwhile.
  const orderCode = orderSeq
  await database.executor.insert(paymentIntent).values({
    id: intentId,
    buildingId: spec.building,
    unitId: spec.unit,
    code: `TT-261019-${String(intentSeq).padStart(4, '0')}`,
    orderCode,
    amount: spec.amount ?? TOTAL,
    status: spec.status ?? 'pending',
    gatewayConfigId,
    provider: 'fake',
    linkId: spec.linkId === undefined ? `link-${orderCode}` : spec.linkId,
    createdBy,
    createdAt: AT,
    displayUntil: new Date(AT.getTime() + 30 * 60_000),
    expiresAt: new Date(AT.getTime() + 60 * 60_000),
    cancelReason: spec.cancelReason ?? null,
    cancelRequestedAt: spec.cancelRequestedAt ?? null,
    cancelledAt: spec.cancelledAt ?? null,
    expiredAt: spec.expiredAt ?? null,
    failedAt: spec.failedAt ?? null,
  })
  return { intentId, orderCode, createdBy, gatewayConfigId }
}

async function insertItems(
  building: string,
  intentId: string,
  rows: ReadonlyArray<{ chargeId: string; amount: number }>,
  releasedAt: Date | null,
): Promise<void> {
  await database.executor.insert(paymentIntentItem).values(
    rows.map((row) => ({
      id: ids.next(),
      buildingId: building,
      intentId,
      chargeId: row.chargeId,
      amount: row.amount,
      releasedAt,
    })),
  )
}

/** A fresh building with charges A and B and one `pending` intent holding both. */
async function seedFixture(): Promise<Fixture> {
  const building = ids.next()
  const { unit, chargeA, chargeB } = await seedUnit(building)
  const intent = await insertIntent({ building, unit })
  await insertItems(
    building,
    intent.intentId,
    [
      { chargeId: chargeA, amount: CHARGE_A },
      { chargeId: chargeB, amount: CHARGE_B },
    ],
    null,
  )
  return { building, unit, chargeA, chargeB, ...intent }
}

interface ConfirmOverrides {
  readonly reference?: string
  readonly buildingId?: string
  readonly orderCode?: number
  readonly amount?: Money
}

function confirmation(f: Fixture, overrides: ConfirmOverrides = {}): Confirmation {
  return {
    buildingId: (overrides.buildingId ?? f.building) as BuildingId,
    gatewayConfigId: f.gatewayConfigId,
    provider: 'fake',
    reference: overrides.reference ?? 'FT2628273914',
    orderCode: overrides.orderCode ?? f.orderCode,
    amount: overrides.amount ?? money(TOTAL),
    paidAt: PAID_AT,
    source: 'webhook',
    payload: {},
  }
}

async function payments(building: string): Promise<number> {
  const [row] = await admin<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM finance.payment
     WHERE building_id = ${building} AND status = 'posted'`
  return row?.n ?? 0
}

async function receipts(building: string): Promise<number> {
  const [row] = await admin<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM finance.receipt
     WHERE building_id = ${building} AND status = 'issued'`
  return row?.n ?? 0
}

async function receiptNumbers(building: string): Promise<string[]> {
  const rows = await admin<Array<{ number: string }>>`
    SELECT number FROM finance.receipt WHERE building_id = ${building} ORDER BY number`
  return rows.map((row) => row.number)
}

async function liveAllocations(building: string): Promise<number> {
  const [row] = await admin<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM finance.allocation
     WHERE building_id = ${building} AND status = 'live'`
  return row?.n ?? 0
}

async function paymentRow(
  building: string,
): Promise<{ source: string; amount: number; payer_name: string | null } | undefined> {
  const [row] = await admin<Array<{ source: string; amount: number; payer_name: string | null }>>`
    SELECT source, amount::int AS amount, payer_name FROM finance.payment
     WHERE building_id = ${building} AND status = 'posted'`
  return row
}

async function chargeStatus(chargeId: string): Promise<string | undefined> {
  const [row] = await admin<Array<{ status: string }>>`
    SELECT status FROM finance.charge WHERE id = ${chargeId}`
  return row?.status
}

async function intentOf(
  intentId: string,
): Promise<{ status: string; paid_at: Date | null; cancel_reason: string | null } | undefined> {
  const [row] = await admin<
    Array<{ status: string; paid_at: Date | null; cancel_reason: string | null }>
  >`
    SELECT status, paid_at, cancel_reason FROM finance.payment_intent WHERE id = ${intentId}`
  return row
}

async function itemsReleased(intentId: string): Promise<{ released: number; total: number }> {
  const [row] = await admin<Array<{ released: number; total: number }>>`
    SELECT count(*) FILTER (WHERE released_at IS NOT NULL)::int AS released, count(*)::int AS total
      FROM finance.payment_intent_item WHERE intent_id = ${intentId}`
  return { released: row?.released ?? 0, total: row?.total ?? 0 }
}

async function eventByReference(
  reference: string,
): Promise<
  { id: string; outcome: string; payment_id: string | null; intent_id: string | null } | undefined
> {
  const [row] = await admin<
    Array<{ id: string; outcome: string; payment_id: string | null; intent_id: string | null }>
  >`
    SELECT id, outcome, payment_id, intent_id FROM finance.gateway_event
     WHERE provider = 'fake' AND reference = ${reference}`
  return row
}

async function outboxRows(
  building: string,
  type: string,
): Promise<Array<{ aggregate_id: string; payload: Record<string, unknown> }>> {
  return admin<Array<{ aggregate_id: string; payload: Record<string, unknown> }>>`
    SELECT aggregate_id, payload FROM finance.outbox_messages
     WHERE type = ${type} AND payload->>'buildingId' = ${building}
     ORDER BY id`
}

async function auditRows(
  objectId: string,
): Promise<Array<{ action: string; actor_kind: string; actor_id: string | null }>> {
  return admin<Array<{ action: string; actor_kind: string; actor_id: string | null }>>`
    SELECT action, actor_kind, actor_id FROM audit.audit_log WHERE object_id = ${objectId}`
}

async function invariants(building: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const [id, query] of INVARIANTS) {
    const rows = (await database.executor.execute(query(building))) as unknown as Array<{
      n: number
    }>
    out[id] = Number(rows[0]?.n ?? 0)
  }
  return out
}

describe('settle() (DOC-23 §6, §16.3, P2-06)', () => {
  test('IN-24 an exact webhook posts the payment, the allocations, the receipts and the events', async () => {
    const f = await seedFixture()
    const result = await finance.settlement.settle(confirmation(f))

    expect(result.outcome).toBe('posted')
    expect(result.intentId).toBe(f.intentId)
    expect(result.paymentId).not.toBeNull()

    const intent = await intentOf(f.intentId)
    expect(intent?.status).toBe('paid')
    expect(intent?.paid_at).toBeInstanceOf(Date)

    expect(await paymentRow(f.building)).toEqual({
      source: 'online',
      amount: TOTAL,
      payer_name: 'Trần Minh Anh',
    })
    expect(await liveAllocations(f.building)).toBe(2)
    expect(await receiptNumbers(f.building)).toEqual(['BL-2610-0001', 'BL-2610-0002'])
    expect(await itemsReleased(f.intentId)).toEqual({ released: 2, total: 2 })

    const event = await eventByReference('FT2628273914')
    expect(event?.outcome).toBe('posted')
    expect(event?.payment_id).toBe(result.paymentId)

    const posted = await outboxRows(f.building, 'finance.payment_posted.v1')
    expect(posted).toHaveLength(1)
    expect(posted[0]?.payload.payerAccountId).toBe(f.createdBy)
    expect(await outboxRows(f.building, 'finance.receipt_issued.v1')).toHaveLength(2)
    expect(await outboxRows(f.building, 'finance.receipt_render_requested.v1')).toHaveLength(2)
    expect(await outboxRows(f.building, 'finance.money_unposted.v1')).toHaveLength(0)

    const audit = await auditRows(result.paymentId as string)
    expect(audit.map((row) => [row.action, row.actor_kind, row.actor_id])).toEqual([
      ['finance.payment.post', 'system', null],
    ])

    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-25 the same reference delivered 5 times pays once; the rest is already_processed', async () => {
    const f = await seedFixture()
    const reference = ref()
    const first = await finance.settlement.settle(confirmation(f, { reference }))
    const second = await finance.settlement.settle(confirmation(f, { reference }))
    const parallel = await Promise.all([
      finance.settlement.settle(confirmation(f, { reference })),
      finance.settlement.settle(confirmation(f, { reference })),
      finance.settlement.settle(confirmation(f, { reference })),
    ])

    expect(first.outcome).toBe('posted')
    expect([second, ...parallel].map((result) => result.outcome)).toEqual([
      'already_processed',
      'already_processed',
      'already_processed',
      'already_processed',
    ])
    expect(await payments(f.building)).toBe(1)
    expect(await receipts(f.building)).toBe(2)
    const [events] = await admin<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM finance.gateway_event
       WHERE provider = 'fake' AND reference = ${reference}`
    expect(events?.n).toBe(1)
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-26 a short and an over transfer post nothing; each leaves a money_unposted row', async () => {
    const f = await seedFixture()
    const short = ref()
    const over = ref()
    const a = await finance.settlement.settle(
      confirmation(f, { reference: short, amount: money(2_000_000) }),
    )
    const b = await finance.settlement.settle(
      confirmation(f, { reference: over, amount: money(3_000_000) }),
    )

    expect(a.outcome).toBe('amount_short')
    expect(b.outcome).toBe('amount_over')
    expect(await payments(f.building)).toBe(0)
    expect((await intentOf(f.intentId))?.status).toBe('pending')

    expect((await eventByReference(short))?.outcome).toBe('amount_short')
    expect((await eventByReference(over))?.outcome).toBe('amount_over')

    const unposted = await outboxRows(f.building, 'finance.money_unposted.v1')
    expect(unposted).toHaveLength(2)
    expect(
      unposted.map((row) => [row.payload.kind, row.payload.outcome, row.payload.amount]),
    ).toEqual(
      expect.arrayContaining([
        ['gateway_event', 'amount_short', 2_000_000],
        ['gateway_event', 'amount_over', 3_000_000],
      ]),
    )
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-27 a second exact reference for a paid intent is duplicate_transfer', async () => {
    const f = await seedFixture()
    expect((await finance.settlement.settle(confirmation(f, { reference: ref() }))).outcome).toBe(
      'posted',
    )
    const second = await finance.settlement.settle(confirmation(f, { reference: ref() }))
    expect(second.outcome).toBe('duplicate_transfer')
    expect(await payments(f.building)).toBe(1)
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-28 two different exact references released together: one posted, one duplicate_transfer', async () => {
    const f = await seedFixture()
    const gate = makeBarrier(2)
    const run = async (reference: string) => {
      await gate.wait()
      return finance.settlement.settle(confirmation(f, { reference }))
    }
    const runs = [run(ref()), run(ref())]
    await gate.ready
    gate.go()
    const settled = await Promise.allSettled(runs)
    const outcomes = settled
      .map((result) => (result.status === 'fulfilled' ? result.value.outcome : 'rejected'))
      .sort()
    expect(outcomes).toEqual(['duplicate_transfer', 'posted'])
    expect(await payments(f.building)).toBe(1)
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-29 a charge paid in cash before the exact transfer is charge_already_paid', async () => {
    const f = await seedFixture()
    await admin`UPDATE finance.charge SET status = 'paid', version = version + 1, updated_at = now()
                 WHERE id = ${f.chargeA}`
    const result = await finance.settlement.settle(confirmation(f, { reference: ref() }))

    expect(result.outcome).toBe('charge_already_paid')
    expect(await payments(f.building)).toBe(0)
    expect(await receipts(f.building)).toBe(0)
    expect(await chargeStatus(f.chargeB)).toBe('open')
    expect((await intentOf(f.intentId))?.status).toBe('pending')
    const [counter] = await admin<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM finance.document_counter
       WHERE building_id = ${f.building} AND series = 'receipt'`
    expect(counter?.n).toBe(0)
    // I1 is deliberately broken by the hand-paid charge (no allocation), so the invariants are not run here.
  })

  test('IN-30 a charge voided before the exact transfer is charge_recalled', async () => {
    const f = await seedFixture()
    const manager = staff('manager', f.building)
    const [row] = await admin<Array<{ version: number }>>`
      SELECT version FROM finance.charge WHERE id = ${f.chargeA}`
    const version = row?.version ?? 0

    expect(
      await codeOf(() =>
        finance.useCases.voidCharge.execute(manager, f.chargeA, {
          reason: 'billed to the wrong unit',
          version: version + 1,
        }),
      ),
    ).toBe('version_conflict')

    const voided = await finance.useCases.voidCharge.execute(manager, f.chargeA, {
      reason: 'billed to the wrong unit',
      version,
    })
    expect(voided.intentIds).toContain(f.intentId)
    expect((await intentOf(f.intentId))?.status).toBe('cancelling')
    expect(await itemsReleased(f.intentId)).toEqual({ released: 2, total: 2 })
    expect(await chargeStatus(f.chargeA)).toBe('void')

    const result = await finance.settlement.settle(confirmation(f, { reference: ref() }))
    expect(result.outcome).toBe('charge_recalled')
    expect(await payments(f.building)).toBe(0)
    expect(await receipts(f.building)).toBe(0)
    expect(await chargeStatus(f.chargeB)).toBe('open')
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-31 an unknown order code; an order code of another building (DR-282)', async () => {
    const unknown = 33_000_001
    const building = ids.next()
    const referenceUnknown = ref()
    const unknownResult = await finance.settlement.settle({
      buildingId: building as BuildingId,
      gatewayConfigId: ids.next(),
      provider: 'fake',
      reference: referenceUnknown,
      orderCode: unknown,
      amount: money(TOTAL),
      paidAt: PAID_AT,
      source: 'webhook',
      payload: {},
    })
    expect(unknownResult.outcome).toBe('unknown_order')
    expect(unknownResult.gatewayEventId).not.toBeNull()
    expect(unknownResult.intentId).toBeNull()
    const unknownEvent = await eventByReference(referenceUnknown)
    expect(unknownEvent?.outcome).toBe('unknown_order')
    expect(unknownEvent?.intent_id).toBeNull()
    expect(await outboxRows(building, 'finance.money_unposted.v1')).toHaveLength(1)

    const f = await seedFixture()
    const other = ids.next()
    const referenceForeign = ref()
    const foreignResult = await finance.settlement.settle(
      confirmation(f, { buildingId: other, reference: referenceForeign }),
    )
    expect(foreignResult.outcome).toBe('foreign_building')
    expect(foreignResult.gatewayEventId).toBeNull()
    const [noRow] = await admin<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM finance.gateway_event
       WHERE provider = 'fake' AND reference = ${referenceForeign}`
    expect(noRow?.n).toBe(0)
    expect(await invariants(f.building)).toEqual(CLEAN)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('IN-32 an exact transfer posts for an expired, cancelled, cancelling or failed intent', async () => {
    for (const status of ['expired', 'cancelled', 'cancelling', 'failed'] as const) {
      const f = await seedFixture()
      if (status === 'expired')
        await admin`UPDATE finance.payment_intent SET status = 'expired', expired_at = ${AT}
                     WHERE id = ${f.intentId}`
      else if (status === 'failed')
        await admin`UPDATE finance.payment_intent SET status = 'failed', failed_at = ${AT}
                     WHERE id = ${f.intentId}`
      else
        await admin`UPDATE finance.payment_intent
                       SET status = ${status}, cancel_reason = 'resident', cancel_requested_at = ${AT},
                           cancelled_at = ${status === 'cancelled' ? AT : null}
                     WHERE id = ${f.intentId}`

      const result = await finance.settlement.settle(confirmation(f, { reference: ref() }))
      expect(result.outcome).toBe('posted')
      expect((await intentOf(f.intentId))?.status).toBe('paid')
      expect(await invariants(f.building)).toEqual(CLEAN)
    }
  })

  test('IN-33 a confirmation while the intent is still creating posts and pays it', async () => {
    const f = await seedFixture()
    await admin`UPDATE finance.payment_intent SET status = 'creating', link_id = NULL
                 WHERE id = ${f.intentId}`
    const result = await finance.settlement.settle(confirmation(f, { reference: ref() }))
    expect(result.outcome).toBe('posted')
    expect((await intentOf(f.intentId))?.status).toBe('paid')
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-39 a deleted creator leaves payer_name and the snapshot payer null; still posted', async () => {
    const f = await seedFixture()
    const withoutPayer = buildModule(testPorts(new Map([[f.createdBy, null]])))
    const result = await withoutPayer.settlement.settle(confirmation(f, { reference: ref() }))

    expect(result.outcome).toBe('posted')
    expect((await paymentRow(f.building))?.payer_name).toBeNull()
    const [snapshot] = await admin<Array<{ name: string | null }>>`
      SELECT snapshot->'payer'->>'name' AS name FROM finance.receipt
       WHERE building_id = ${f.building} ORDER BY number LIMIT 1`
    expect(snapshot?.name).toBeNull()
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('IN-53 a late exact transfer for a superseded intent cancels the live holder (DR-283)', async () => {
    const f = await seedFixture()
    const superseded = await insertIntent({
      building: f.building,
      unit: f.unit,
      status: 'cancelled',
      linkId: null,
      cancelReason: 'superseded',
      cancelRequestedAt: AT,
      cancelledAt: AT,
    })
    await insertItems(
      f.building,
      superseded.intentId,
      [
        { chargeId: f.chargeA, amount: CHARGE_A },
        { chargeId: f.chargeB, amount: CHARGE_B },
      ],
      AT,
    )

    const result = await finance.settlement.settle(
      confirmation(f, { reference: ref(), orderCode: superseded.orderCode }),
    )
    expect(result.outcome).toBe('posted')
    expect((await intentOf(superseded.intentId))?.status).toBe('paid')

    const holder = await intentOf(f.intentId)
    expect(holder?.status).toBe('cancelling')
    expect(holder?.cancel_reason).toBe('charge_paid')
    expect(await itemsReleased(f.intentId)).toEqual({ released: 2, total: 2 })

    const cancelRows = await outboxRows(f.building, 'finance.intent_cancel_requested.v1')
    expect(cancelRows).toHaveLength(1)
    expect(cancelRows[0]?.payload.reason).toBe('charge_paid')
    expect(cancelRows[0]?.payload.intentId).toBe(f.intentId)

    expect(await payments(f.building)).toBe(1)
    expect(await receipts(f.building)).toBe(2)
    expect(await invariants(f.building)).toEqual(CLEAN)
  })
})
