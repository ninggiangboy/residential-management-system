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
  statementImport,
  statementLine,
} from '../src/infrastructure/persistence/schema'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The P2-09 tests of the payment void and the money log (DOC-22 §6, §9, §16.3, §16.6): LG-12, LG-19…LG-26, LG-33,
 * LG-45…LG-47, LG-49, LG-52, LG-53 and the run-twice-safe void. A clone of the migrated template, the real audit
 * module and the real `createFinanceModule`; the fixture is unit `A-1508` with charges A 2,488,000 đ and B 350,000 đ
 * on a `FakeClock` at 2026-10-19T03:00:00Z. Every outcome of a `gateway_event` is produced through the real
 * `settle()` (DOC-23 §6). The eight invariants of DOC-15 §12.2 are run after each money test, scoped to the test's
 * building.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
/** The intent window opens before `paidAt` and closes before the module clock (ck_payment_intent_window). */
const AT = new Date('2026-10-19T02:00:00Z')
/** The module clock (IN-24): the receipt period is the issue month in building time, so `BL-2610-…`. */
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const PAID_AT = new Date('2026-10-19T02:14:31Z')
const CHARGE_A = 2_488_000
const CHARGE_B = 350_000
const TOTAL = CHARGE_A + CHARGE_B
/** A charge seeded `draft` then moved `open` starts at version 2 (support/index.ts). */
const CHARGE_VERSION = 2
/** A valid void reason (DOC-22 §6: 5 to 500 characters after trimming). */
const VOID_REASON = 'recorded on the wrong unit'
/** A valid single-void reason (DOC-21 §3.9: 5 to 500 characters after trimming). */
const CHARGE_VOID_REASON = 'billed to the wrong unit'
/** A valid review note (DOC-22 §9.2: 5 to 1,000 characters). */
const REVIEW_NOTE = 'refunded by bank transfer 10/19'
/** The amount of every charge seeded by `seedCharge` (đồng). */
const SMALL = 100_000
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
let dedupSeq = 0
let batchSeq = 0
let unknownSeq = 90_000_000

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

/** The `DomainError` a refused call threw; any other error fails the test. */
async function failureOf(run: () => Promise<unknown>): Promise<DomainError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof DomainError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

/** The error a raw statement threw; a statement that is not refused fails the test. */
async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('expected the statement to be refused')
}

function ref(): string {
  refSeq += 1
  return `FT${String(refSeq).padStart(10, '0')}`
}

/** A lowercase hex SHA-256 of 64 characters (`ck_statement_line_dedup`), unique per building. */
function dedupKey(): string {
  dedupSeq += 1
  return String(dedupSeq).padStart(64, '0')
}

/** An order code no intent of the clone owns, so `settle()` answers `unknown_order`. */
function nextUnknownCode(): number {
  unknownSeq += 1
  return unknownSeq
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
      read: () => Promise.reject(new Error('no file is read by the void or the money log')),
      attach: () => Promise.reject(new Error('no file is attached by the void or the money log')),
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

/** Two published batches with one open charge each on a fresh building: A 2,488,000 and B 350,000 on the unit. */
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

/** A published batch with one open charge of `amount` on `unit`; its version is 2 (draft then open). */
async function seedCharge(
  building: string,
  unit: string,
  amount: number,
  unitCode: string,
): Promise<string> {
  batchSeq += 1
  const batchId = ids.next()
  const chargeId = ids.next()
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: building,
    code: `PH-2699-${String(batchSeq).padStart(2, '0')}`,
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
    dueDate: '2026-11-10',
    status: 'published',
    createdBy: ids.next(),
    publishedAt: AT,
    publishedBy: ids.next(),
    version: 2,
  })
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId: building,
    batchId,
    unitId: unit,
    unitCode,
    amount,
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
    unitPrice: amount,
    amount,
  })
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(eq(chargeTable.id, chargeId))
  return chargeId
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

/** An intent holding `chargeIds`, `pending`, with the sum of `amounts`. */
interface SeededIntent {
  readonly intentId: string
  readonly orderCode: number
  readonly createdBy: string
  readonly gatewayConfigId: string
  readonly amount: number
}

async function intentFor(
  building: string,
  unit: string,
  charges: ReadonlyArray<{ chargeId: string; amount: number }>,
): Promise<SeededIntent> {
  const amount = charges.reduce((sum, charge) => sum + charge.amount, 0)
  const intent = await insertIntent({ building, unit, amount })
  await insertItems(
    building,
    intent.intentId,
    charges.map((charge) => ({ chargeId: charge.chargeId, amount: charge.amount })),
    null,
  )
  return { ...intent, amount }
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
    reference: overrides.reference ?? ref(),
    orderCode: overrides.orderCode ?? f.orderCode,
    amount: overrides.amount ?? money(TOTAL),
    paidAt: PAID_AT,
    source: 'webhook',
    payload: {},
  }
}

/** The confirmation of a seeded intent (DOC-23 §2.1), with the amount or the order code overridden. */
interface ConfirmOf {
  readonly reference?: string
  readonly amount?: Money
  readonly orderCode?: number
}

function confirmationOf(
  building: string,
  subject: SeededIntent,
  overrides: ConfirmOf = {},
): Confirmation {
  return {
    buildingId: building as BuildingId,
    gatewayConfigId: subject.gatewayConfigId,
    provider: 'fake',
    reference: overrides.reference ?? ref(),
    orderCode: overrides.orderCode ?? subject.orderCode,
    amount: overrides.amount ?? money(subject.amount),
    paidAt: PAID_AT,
    source: 'webhook',
    payload: {},
  }
}

/** A `statement_import` and one `unmatched` line of `amount` on a fresh import; returns the line id. */
async function seedStatementLine(building: string, amount: number): Promise<string> {
  const importId = ids.next()
  const lineId = ids.next()
  await database.executor.insert(statementImport).values({
    id: importId,
    buildingId: building,
    profileKey: 'generic',
    fileKey: 'statements/oct.csv',
    fileName: 'oct.csv',
    status: 'processed',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-19',
    createdBy: ids.next(),
  })
  await database.executor.insert(statementLine).values({
    id: lineId,
    buildingId: building,
    importId,
    lineNo: 1,
    bookedOn: '2026-10-19',
    amount,
    content: 'TRAN MINH ANH',
    bankReference: ref(),
    dedupKey: dedupKey(),
    matchStatus: 'unmatched',
  })
  return lineId
}

/** A posted manual payment of whole charges; throws when the write did not post. */
async function payManual(
  staffContext: StaffContext,
  input: {
    readonly unitId: string
    readonly chargeIds: readonly string[]
    readonly method: 'cash' | 'bank_transfer'
    readonly payerName: string
    readonly receivedOn: string
    readonly statementLineId?: string | null
  },
): Promise<string> {
  const result = await finance.useCases.recordManualPayment.execute(staffContext, input, ids.next())
  if (result.kind !== 'posted') throw new Error('expected a posted payment')
  return result.payment.paymentId
}

/** A `gateway_event` row `unknown_order` on a fresh order code; returns the event id. */
async function openUnknownRow(building: string): Promise<string> {
  const result = await finance.settlement.settle({
    buildingId: building as BuildingId,
    gatewayConfigId: ids.next(),
    provider: 'fake',
    reference: ref(),
    orderCode: nextUnknownCode(),
    amount: money(1_000),
    paidAt: PAID_AT,
    source: 'webhook',
    payload: {},
  })
  if (result.outcome !== 'unknown_order')
    throw new Error(`expected unknown_order, got ${result.outcome}`)
  return result.gatewayEventId as string
}

interface PaymentState {
  readonly status: string
  readonly void_reason: string | null
  readonly voided_by: string | null
  readonly voided_at: string | null
}

interface AuditRow {
  readonly action: string
  readonly reason: string | null
  readonly changes: unknown[]
  readonly actor_kind: string
  readonly actor_id: string | null
}

async function chargeState(
  chargeId: string,
): Promise<{ status: string; version: number } | undefined> {
  const [row] = await admin<Array<{ status: string; version: number }>>`
    SELECT status, version FROM finance.charge WHERE id = ${chargeId}`
  return row
}

async function allocationStatuses(chargeId: string): Promise<string[]> {
  const rows = await admin<Array<{ status: string }>>`
    SELECT status FROM finance.allocation WHERE charge_id = ${chargeId} ORDER BY status`
  return rows.map((row) => row.status)
}

async function liveAllocations(chargeId: string): Promise<number> {
  const [row] = await admin<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM finance.allocation
     WHERE charge_id = ${chargeId} AND status = 'live'`
  return row?.n ?? 0
}

async function receipts(building: string): Promise<Array<{ number: string; status: string }>> {
  return admin<Array<{ number: string; status: string }>>`
    SELECT number, status FROM finance.receipt WHERE building_id = ${building} ORDER BY number`
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

async function auditRows(objectId: string, action: string): Promise<AuditRow[]> {
  return admin<AuditRow[]>`
    SELECT action, reason, changes, actor_kind, actor_id FROM audit.audit_log
     WHERE object_id = ${objectId} AND action = ${action}`
}

async function paymentState(
  building: string,
  paymentId: string,
): Promise<PaymentState | undefined> {
  const [row] = await admin<PaymentState[]>`
    SELECT status, void_reason, voided_by, voided_at::text AS voided_at FROM finance.payment
     WHERE building_id = ${building} AND id = ${paymentId}`
  return row
}

async function statementState(
  building: string,
  lineId: string,
): Promise<{ match_status: string; payment_id: string | null } | undefined> {
  const [row] = await admin<Array<{ match_status: string; payment_id: string | null }>>`
    SELECT match_status, payment_id FROM finance.statement_line
     WHERE building_id = ${building} AND id = ${lineId}`
  return row
}

async function eventReview(
  building: string,
  eventId: string,
): Promise<{ reviewed_at: string | null; review_note: string | null } | undefined> {
  const [row] = await admin<Array<{ reviewed_at: string | null; review_note: string | null }>>`
    SELECT reviewed_at::text AS reviewed_at, review_note FROM finance.gateway_event
     WHERE building_id = ${building} AND id = ${eventId}`
  return row
}

/** The payments, allocations and charges of one building as their JSON rows, ordered by id. */
async function ledgerRows(building: string): Promise<{
  payments: unknown[]
  allocations: unknown[]
  charges: unknown[]
}> {
  const payments = await admin<Array<{ row: unknown }>>`
    SELECT to_jsonb(p) AS row FROM finance.payment p WHERE p.building_id = ${building} ORDER BY p.id`
  const allocations = await admin<Array<{ row: unknown }>>`
    SELECT to_jsonb(a) AS row FROM finance.allocation a
     WHERE a.building_id = ${building} ORDER BY a.id`
  const charges = await admin<Array<{ row: unknown }>>`
    SELECT to_jsonb(c) AS row FROM finance.charge c WHERE c.building_id = ${building} ORDER BY c.id`
  return {
    payments: payments.map((row) => row.row),
    allocations: allocations.map((row) => row.row),
    charges: charges.map((row) => row.row),
  }
}

/** The gateway_event and statement_line rows of one building as their JSON rows, ordered by id (DR-16, LG-52). */
async function logRows(building: string): Promise<{ events: unknown[]; lines: unknown[] }> {
  const events = await admin<Array<{ row: unknown }>>`
    SELECT to_jsonb(g) AS row FROM finance.gateway_event g
     WHERE g.building_id = ${building} ORDER BY g.id`
  const lines = await admin<Array<{ row: unknown }>>`
    SELECT to_jsonb(l) AS row FROM finance.statement_line l
     WHERE l.building_id = ${building} ORDER BY l.id`
  return { events: events.map((row) => row.row), lines: lines.map((row) => row.row) }
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

describe('the payment void and the money log (DOC-22 §6, §9, P2-09)', () => {
  test('LG-21 a cash payment of A and B is voided: payment, allocations, charges, receipts and events', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    const paidVersion = (await chargeState(chargeA))?.version ?? 0
    expect((await chargeState(chargeA))?.status).toBe('paid')

    const out = await finance.useCases.voidPayment.execute(manager, paymentId, {
      reason: VOID_REASON,
    })
    expect(out.payment.status).toBe('void')
    expect([...out.chargeIds].sort()).toEqual([chargeA, chargeB].sort())

    const payment = await paymentState(building, paymentId)
    expect(payment?.status).toBe('void')
    expect(payment?.void_reason).toBe(VOID_REASON)
    expect(payment?.voided_by).not.toBeNull()

    expect(await allocationStatuses(chargeA)).toEqual(['void'])
    expect(await allocationStatuses(chargeB)).toEqual(['void'])
    for (const chargeId of [chargeA, chargeB]) {
      const state = await chargeState(chargeId)
      expect(state?.status).toBe('open')
      expect(state?.version).toBe(paidVersion + 1)
    }

    expect(await receipts(building)).toEqual([
      { number: 'BL-2610-0001', status: 'void' },
      { number: 'BL-2610-0002', status: 'void' },
    ])

    const audit = await auditRows(paymentId, 'finance.payment.void')
    expect(audit).toHaveLength(1)
    expect(audit[0]?.reason).toBe(VOID_REASON)
    expect(audit[0]?.actor_kind).toBe('staff')
    expect(audit[0]?.changes).toEqual([{ field: 'status', before: 'posted', after: 'void' }])

    expect(await outboxRows(building, 'finance.payment_voided.v1')).toHaveLength(1)
    const renders = await outboxRows(building, 'finance.receipt_render_requested.v1')
    expect(renders.filter((row) => row.payload.variant === 'void')).toHaveLength(2)

    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-22 a 4-character and a 501-character reason are refused and change nothing', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })

    const voidPayment = finance.useCases.voidPayment
    const attempt = (reason: string) => voidPayment.execute(manager, paymentId, { reason })
    expect(await codeOf(() => attempt('abcd'))).toBe('validation_failed:reason_too_short')
    expect(await codeOf(() => attempt('x'.repeat(501)))).toBe('validation_failed:reason_too_long')

    expect((await paymentState(building, paymentId))?.status).toBe('posted')
    expect((await chargeState(chargeA))?.status).toBe('paid')
    expect((await chargeState(chargeB))?.status).toBe('paid')
    expect(await allocationStatuses(chargeA)).toEqual(['live'])
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-23 an online payment is not voidable and a direct update is refused', async () => {
    const f = await seedFixture()
    const manager = staff('manager', f.building)
    const settled = await finance.settlement.settle(confirmation(f))
    expect(settled.outcome).toBe('posted')
    const paymentId = settled.paymentId as string

    const voidPayment = finance.useCases.voidPayment
    const voidRun = () => voidPayment.execute(manager, paymentId, { reason: VOID_REASON })
    expect(await codeOf(voidRun)).toBe('payment_not_voidable')
    expect((await paymentState(f.building, paymentId))?.status).toBe('posted')

    // ck_payment_void_source is the database's second net: a void of an online row fails the check.
    const directVoid = () =>
      admin`UPDATE finance.payment
               SET status = 'void', void_reason = 'x', voided_at = now(), voided_by = ${ids.next()}
             WHERE id = ${paymentId}`
    const refused = (await rejects(directVoid)) as { code?: string }
    expect(refused.code).toBe('23514')
    expect((await paymentState(f.building, paymentId))?.status).toBe('posted')
    expect(await invariants(f.building)).toEqual(CLEAN)
  })

  test('LG-24 a void returns a linked statement line to unmatched with payment_id null', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA } = await seedUnit(building)
    const lineId = await seedStatementLine(building, CHARGE_A)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA],
      method: 'bank_transfer',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
      statementLineId: lineId,
    })
    expect(await statementState(building, lineId)).toEqual({
      match_status: 'matched',
      payment_id: paymentId,
    })

    await finance.useCases.voidPayment.execute(manager, paymentId, { reason: VOID_REASON })
    expect(await statementState(building, lineId)).toEqual({
      match_status: 'unmatched',
      payment_id: null,
    })
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-26 a second void is invalid_transition and changes nothing', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    await finance.useCases.voidPayment.execute(manager, paymentId, { reason: VOID_REASON })

    const before = await paymentState(building, paymentId)
    const voidPayment = finance.useCases.voidPayment
    const voidRun = () => voidPayment.execute(manager, paymentId, { reason: VOID_REASON })
    expect(await codeOf(voidRun)).toBe('invalid_transition')
    expect(await paymentState(building, paymentId)).toEqual(before)
    expect((await chargeState(chargeA))?.status).toBe('open')
    expect(await liveAllocations(chargeA)).toBe(0)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-12 and LG-33 a charge voided by the payment void is paid again with the next number', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const first = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    await finance.useCases.voidPayment.execute(manager, first, { reason: VOID_REASON })

    const second = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    expect(second).not.toBe(first)

    expect(await receipts(building)).toEqual([
      { number: 'BL-2610-0001', status: 'void' },
      { number: 'BL-2610-0002', status: 'void' },
      { number: 'BL-2610-0003', status: 'issued' },
    ])
    expect(await allocationStatuses(chargeB)).toEqual(['live', 'void'])
    expect((await chargeState(chargeA))?.status).toBe('open')
    expect((await chargeState(chargeB))?.status).toBe('paid')
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-19 a payment void and a new entry for one of its charges race 20 times', async () => {
    for (let round = 0; round < 20; round += 1) {
      const building = ids.next()
      const manager = staff('manager', building)
      const { unit, chargeA } = await seedUnit(building)
      const paymentId = await payManual(manager, {
        unitId: unit,
        chargeIds: [chargeA],
        method: 'cash',
        payerName: 'Trần Minh Anh',
        receivedOn: '2026-10-19',
      })

      const gate = makeBarrier(2)
      const voidRun = (async () => {
        await gate.wait()
        return finance.useCases.voidPayment.execute(manager, paymentId, { reason: VOID_REASON })
      })()
      const payRun = (async () => {
        await gate.wait()
        return finance.useCases.recordManualPayment.execute(
          manager,
          {
            unitId: unit,
            chargeIds: [chargeA],
            method: 'cash',
            payerName: 'Trần Minh Anh',
            receivedOn: '2026-10-19',
          },
          ids.next(),
        )
      })()
      await gate.ready
      gate.go()
      const [voidResult, payResult] = await Promise.allSettled([voidRun, payRun])
      if (voidResult.status === 'rejected') throw voidResult.reason

      let paidAgain = false
      if (payResult.status === 'fulfilled') {
        expect(payResult.value.kind).toBe('posted')
        paidAgain = true
      } else {
        const error = payResult.reason
        if (!(error instanceof DomainError)) throw error
        expect(error.code).toBe('charge_changed')
      }

      expect(await liveAllocations(chargeA)).toBe(paidAgain ? 1 : 0)
      expect((await chargeState(chargeA))?.status).toBe(paidAgain ? 'paid' : 'open')
      expect(await invariants(building)).toEqual(CLEAN)
    }
  }, 120_000)

  test('P2-09 a void is run-twice-safe: two parallel voids leave exactly one audit row', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })

    const gate = makeBarrier(2)
    const run = async () => {
      await gate.wait()
      return finance.useCases.voidPayment.execute(manager, paymentId, { reason: VOID_REASON })
    }
    const first = run()
    const second = run()
    await gate.ready
    gate.go()
    const settled = await Promise.allSettled([first, second])
    const fulfilled = settled.filter((result) => result.status === 'fulfilled')
    const refused = settled.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(refused).toHaveLength(1)
    const error = (refused[0] as PromiseRejectedResult).reason
    if (!(error instanceof DomainError)) throw error
    expect(error.code).toBe('invalid_transition')

    expect(await auditRows(paymentId, 'finance.payment.void')).toHaveLength(1)
    expect((await paymentState(building, paymentId))?.status).toBe('void')
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-53 every settle outcome is one gateway_event and the viewer lists the open ones', async () => {
    const building = ids.next()
    const uP = ids.next()
    const uS = ids.next()
    const uO = ids.next()
    const uD = ids.next()
    const uE = ids.next()
    const chargeP = await seedCharge(building, uP, SMALL, 'A-2001')
    const chargeS = await seedCharge(building, uS, SMALL, 'A-2002')
    const chargeO = await seedCharge(building, uO, SMALL, 'A-2003')
    const chargeD = await seedCharge(building, uD, SMALL, 'A-2004')
    const chargeE = await seedCharge(building, uE, SMALL, 'A-2005')
    const intentP = await intentFor(building, uP, [{ chargeId: chargeP, amount: SMALL }])
    const intentS = await intentFor(building, uS, [{ chargeId: chargeS, amount: SMALL }])
    const intentO = await intentFor(building, uO, [{ chargeId: chargeO, amount: SMALL }])
    const intentD = await intentFor(building, uD, [{ chargeId: chargeD, amount: SMALL }])
    const intentE = await intentFor(building, uE, [{ chargeId: chargeE, amount: SMALL }])

    const posted = await finance.settlement.settle(confirmationOf(building, intentP))
    const short = await finance.settlement.settle(
      confirmationOf(building, intentS, { amount: money(SMALL - 1_000) }),
    )
    const over = await finance.settlement.settle(
      confirmationOf(building, intentO, { amount: money(SMALL + 1_000) }),
    )
    const duplicate = await finance.settlement.settle(confirmationOf(building, intentP))
    const unknown = await finance.settlement.settle(
      confirmationOf(building, intentP, { orderCode: nextUnknownCode() }),
    )
    const manager = staff('manager', building)
    await payManual(manager, {
      unitId: uD,
      chargeIds: [chargeD],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    const alreadyPaid = await finance.settlement.settle(confirmationOf(building, intentD))
    await finance.useCases.voidCharge.execute(manager, chargeE, {
      reason: CHARGE_VOID_REASON,
      version: CHARGE_VERSION,
    })
    const recalled = await finance.settlement.settle(confirmationOf(building, intentE))

    expect(posted.outcome).toBe('posted')
    expect(short.outcome).toBe('amount_short')
    expect(over.outcome).toBe('amount_over')
    expect(duplicate.outcome).toBe('duplicate_transfer')
    expect(unknown.outcome).toBe('unknown_order')
    expect(alreadyPaid.outcome).toBe('charge_already_paid')
    expect(recalled.outcome).toBe('charge_recalled')

    const scope = { buildingId: building as BuildingId }
    const open = await finance.queries.moneyLog.list(scope, { openOnly: true })
    expect(open.rows.map((row) => row.status).sort()).toEqual([
      'amount_over',
      'amount_short',
      'charge_already_paid',
      'charge_recalled',
      'duplicate_transfer',
      'unknown_order',
    ])
    const all = await finance.queries.moneyLog.list(scope, { includePosted: true })
    expect(all.rows).toHaveLength(7)
    expect(all.rows.filter((row) => row.status === 'posted')).toHaveLength(1)

    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-45 a review is once-only; an already reviewed row and a short note are refused', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const unit = ids.next()
    const charge = await seedCharge(building, unit, SMALL, 'A-3001')
    const intent = await intentFor(building, unit, [{ chargeId: charge, amount: SMALL }])
    const short = await finance.settlement.settle(
      confirmationOf(building, intent, { amount: money(SMALL - 1_000) }),
    )
    expect(short.outcome).toBe('amount_short')
    const eventId = short.gatewayEventId as string

    const reviewRow = finance.useCases.reviewMoneyLogRow
    const review = (note: string) => reviewRow.execute(manager, 'gateway_event', eventId, { note })
    const reviewed = await review(REVIEW_NOTE)
    expect(reviewed.kind).toBe('gateway_event')
    expect(reviewed.reviewedAt).toBeInstanceOf(Date)
    expect((await eventReview(building, eventId))?.reviewed_at).not.toBeNull()

    const audit = await auditRows(eventId, 'finance.money_log.review')
    expect(audit).toHaveLength(1)
    expect(audit[0]?.reason).toBe(REVIEW_NOTE)

    const again = await failureOf(() => review(REVIEW_NOTE))
    expect(again.code).toBe('money_log_already_reviewed')
    expect((again.details as { reviewedAt?: string }).reviewedAt).toBeDefined()

    expect(await codeOf(() => review('abcd'))).toBe('validation_failed:reason_too_short')
  })

  test('LG-46 the unfixable rows: posted, matched and missing', async () => {
    const f = await seedFixture()
    const manager = staff('manager', f.building)
    const posted = await finance.settlement.settle(confirmation(f))
    expect(posted.outcome).toBe('posted')
    const reviewRow = finance.useCases.reviewMoneyLogRow
    const review = (kind: 'gateway_event' | 'statement_line', id: string) =>
      reviewRow.execute(manager, kind, id, { note: REVIEW_NOTE })
    const postedId = posted.gatewayEventId as string
    expect(await codeOf(() => review('gateway_event', postedId))).toBe('invalid_transition')

    const lineId = await seedStatementLine(f.building, TOTAL)
    const matched = () =>
      admin`UPDATE finance.statement_line SET match_status = 'matched', payment_id = ${posted.paymentId}
             WHERE building_id = ${f.building} AND id = ${lineId}`
    await matched()
    expect(await codeOf(() => review('statement_line', lineId))).toBe('invalid_transition')
    expect(await codeOf(() => review('gateway_event', ids.next()))).toBe('not_found')
  })

  test('LG-47 a review leaves the payments, allocations and charges identical', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA, chargeB],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    const eventId = await openUnknownRow(building)

    const before = await ledgerRows(building)
    const reviewed = await finance.useCases.reviewMoneyLogRow.execute(
      manager,
      'gateway_event',
      eventId,
      { note: REVIEW_NOTE },
    )
    expect(reviewed.reviewedAt).toBeInstanceOf(Date)
    expect(await ledgerRows(building)).toEqual(before)
  })

  test('LG-52 a manual payment, a single void and a payment void leave the log identical', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    await seedStatementLine(building, 500_000)
    await openUnknownRow(building)

    const before = await logRows(building)
    const paymentId = await payManual(manager, {
      unitId: unit,
      chargeIds: [chargeA],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    await finance.useCases.voidCharge.execute(manager, chargeB, {
      reason: CHARGE_VOID_REASON,
      version: CHARGE_VERSION,
    })
    await finance.useCases.voidPayment.execute(manager, paymentId, { reason: VOID_REASON })

    expect(await logRows(building)).toEqual(before)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-49 the viewer filters and keysets newest first with no duplicate across pages', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const u1 = ids.next()
    const u2 = ids.next()
    const u3 = ids.next()
    const x1 = await seedCharge(building, u1, SMALL, 'A-4001')
    const x2 = await seedCharge(building, u2, SMALL, 'A-4002')
    const x3 = await seedCharge(building, u3, SMALL, 'A-4003')
    const i1 = await intentFor(building, u1, [{ chargeId: x1, amount: SMALL }])
    const i2 = await intentFor(building, u2, [{ chargeId: x2, amount: SMALL }])
    const i3 = await intentFor(building, u3, [{ chargeId: x3, amount: SMALL }])
    await payManual(manager, {
      unitId: u1,
      chargeIds: [x1],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    await payManual(manager, {
      unitId: u2,
      chargeIds: [x2],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: '2026-10-19',
    })
    expect((await finance.settlement.settle(confirmationOf(building, i1))).outcome).toBe(
      'charge_already_paid',
    )
    expect((await finance.settlement.settle(confirmationOf(building, i2))).outcome).toBe(
      'charge_already_paid',
    )
    const short = await finance.settlement.settle(
      confirmationOf(building, i3, { amount: money(SMALL - 1_000) }),
    )
    expect(short.outcome).toBe('amount_short')
    await openUnknownRow(building)
    const reviewRow = finance.useCases.reviewMoneyLogRow
    await reviewRow.execute(manager, 'gateway_event', short.gatewayEventId as string, {
      note: REVIEW_NOTE,
    })

    const scope = { buildingId: building as BuildingId }
    const byOutcome = await finance.queries.moneyLog.list(scope, { outcome: 'charge_already_paid' })
    expect(byOutcome.rows).toHaveLength(2)
    expect(byOutcome.rows.every((row) => row.status === 'charge_already_paid')).toBe(true)

    const byUnit = await finance.queries.moneyLog.list(scope, { unitId: u1 })
    expect(byUnit.rows).toHaveLength(1)
    expect(byUnit.rows[0]?.unitId).toBe(u1)

    const open = await finance.queries.moneyLog.list(scope, { openOnly: true })
    expect(open.rows).toHaveLength(3)

    const all = await finance.queries.moneyLog.list(scope, { includePosted: true, limit: 100 })
    expect(all.rows).toHaveLength(4)

    const page1 = await finance.queries.moneyLog.list(scope, { includePosted: true, limit: 2 })
    expect(page1.rows).toHaveLength(2)
    const after = page1.next
    if (!after) throw new Error('the first page must carry a keyset cursor')
    const page2 = await finance.queries.moneyLog.list(scope, {
      includePosted: true,
      limit: 2,
      after,
    })
    expect(page2.rows).toHaveLength(2)
    expect(page2.next).toBeNull()

    const paged = [...page1.rows, ...page2.rows].map((row) => row.id)
    expect(paged).toEqual(all.rows.map((row) => row.id))
    expect(new Set(paged).size).toBe(4)
    expect(await invariants(building)).toEqual(CLEAN)
  })
})
