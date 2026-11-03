import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createGaplessCounter, Database } from '@core/db'
import { DomainError, type UnitOfWork, UuidV7Generator } from '@core/kernel'
import { DrizzleOutboxWriter } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import {
  type BuildingId,
  money,
  type StaffContext,
  type StaffId,
  type StaffRole,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import { ChargeAllocator } from '../src/application/allocation/charge-allocator'
import { IntentCancellation } from '../src/application/intent-cancellation'
import { RecordManualPayment } from '../src/application/use-cases/record-manual-payment'
import type { ManualPaymentInput } from '../src/domain/manual-payment'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { DrizzleIntentRepository } from '../src/infrastructure/persistence/drizzle-intent-repository'
import { DrizzleLedgerRepository } from '../src/infrastructure/persistence/drizzle-ledger-repository'
import { DrizzlePaymentRepository } from '../src/infrastructure/persistence/drizzle-payment-repository'
import {
  allocation,
  chargeLine,
  charge as chargeTable,
  documentCounter,
  feeBatch,
  financeOutbox,
  payment,
  paymentIntent,
  paymentIntentItem,
  receipt,
  statementImport,
  statementLine,
} from '../src/infrastructure/persistence/schema'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The P2-08 tests of `RecordManualPayment` (DOC-22 §5, §16.1, §16.2, FR-05, DR-267, DR-283): the cash and bank-transfer
 * entry of whole charges, the dry run, the idempotent replay of one key, the date window, the statement line, the roles,
 * the rollback with no gap in receipt numbers and the forced `40001` retry. A clone of the migrated template, the real
 * `createFinanceModule`, the real audit module and a `FakeClock` at 2026-10-19T03:00:00Z (building today 2026-10-19 in
 * Asia/Ho_Chi_Minh). Every test seeds its own building so the `BL-2610-…` numbers stay independent. The eight invariants
 * of DOC-15 §12.2 run after each posting test, scoped to the test's building.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const AT = new Date('2026-10-19T02:00:00Z')
const MODULE_NOW = new Date('2026-10-19T03:00:00Z')
const RECEIVED_ON = '2026-10-19'
const PAYER = 'Trần Minh Anh'
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

/** Unique per test: the order code and the `(building, code)` of an intent are keys of the clone. */
let orderSeq = 3_000_000
let intentSeq = 0

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

/** The body of one entry; `overrides` changes one field at a time. */
function manualInput(
  unitId: string,
  chargeIds: readonly string[],
  overrides: Partial<ManualPaymentInput> = {},
): ManualPaymentInput {
  return {
    unitId,
    chargeIds,
    method: 'cash',
    payerName: PAYER,
    receivedOn: RECEIVED_ON,
    ...overrides,
  }
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
      read: () => Promise.reject(new Error('no file is read by the manual payment')),
      attach: () => Promise.reject(new Error('no file is attached by the manual payment')),
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

interface ChargeSpec {
  readonly code: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
}

/** One published batch per spec with one open charge of `unitId`, in the spec order (DOC-21 §5.1). */
async function seedOpenCharges(building: string, specs: readonly ChargeSpec[]): Promise<string[]> {
  const batchIds = specs.map(() => ids.next())
  const chargeIds = specs.map(() => ids.next())
  await database.executor.insert(feeBatch).values(
    specs.map((spec, index) => ({
      id: batchIds[index]!,
      buildingId: building,
      code: spec.code,
      name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
      feeMonth: '2026-10-01',
      dueDate: '2026-11-10',
      status: 'published',
      createdBy: ids.next(),
      publishedAt: AT,
      publishedBy: ids.next(),
      version: 2,
    })),
  )
  await database.executor.insert(chargeTable).values(
    specs.map((spec, index) => ({
      id: chargeIds[index]!,
      buildingId: building,
      batchId: batchIds[index]!,
      unitId: spec.unitId,
      unitCode: spec.unitCode,
      amount: spec.amount,
      status: 'draft',
      version: 1,
    })),
  )
  await database.executor.insert(chargeLine).values(
    specs.map((spec, index) => ({
      id: ids.next(),
      buildingId: building,
      chargeId: chargeIds[index]!,
      position: 1,
      kind: 'fee',
      itemName: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: spec.amount,
      amount: spec.amount,
    })),
  )
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(chargeTable.buildingId, building), inArray(chargeTable.id, chargeIds)))
  return chargeIds
}

/** The fixture unit: charges A 2,488,000 and B 350,000 in two published batches. */
async function seedUnit(
  building: string,
): Promise<{ unit: string; chargeA: string; chargeB: string }> {
  const unit = ids.next()
  const [chargeA, chargeB] = await seedOpenCharges(building, [
    { code: 'PH-2610-01', unitId: unit, unitCode: 'A-1508', amount: CHARGE_A },
    { code: 'PH-2610-02', unitId: unit, unitCode: 'A-1508', amount: CHARGE_B },
  ])
  return { unit, chargeA: chargeA!, chargeB: chargeB! }
}

/** A `pending` intent holding `rows`, window `+30`/`+60` minutes of the fixture instant (ck_payment_intent_window). */
async function seedHoldingIntent(
  building: string,
  unitId: string,
  rows: ReadonlyArray<{ chargeId: string; amount: number }>,
): Promise<string> {
  const intentId = ids.next()
  orderSeq += 1
  intentSeq += 1
  const orderCode = orderSeq
  const amount = rows.reduce((sum, row) => sum + row.amount, 0)
  await database.executor.insert(paymentIntent).values({
    id: intentId,
    buildingId: building,
    unitId,
    code: `TT-261019-${String(intentSeq).padStart(4, '0')}`,
    orderCode,
    amount,
    status: 'pending',
    gatewayConfigId: ids.next(),
    provider: 'fake',
    linkId: `link-${orderCode}`,
    createdBy: ids.next(),
    createdAt: AT,
    displayUntil: new Date(AT.getTime() + 30 * 60_000),
    expiresAt: new Date(AT.getTime() + 60 * 60_000),
  })
  await database.executor.insert(paymentIntentItem).values(
    rows.map((row) => ({
      id: ids.next(),
      buildingId: building,
      intentId,
      chargeId: row.chargeId,
      amount: row.amount,
      releasedAt: null,
    })),
  )
  return intentId
}

/** A 64-hex dedup key (ck_statement_line_dedup), unique per line. */
const dedupKey = (): string =>
  `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`

/** A `processed` import and one line of it, `unmatched` or `matched` with `paymentId` (DOC-25 §3). */
async function seedStatement(
  building: string,
  options: { matchStatus: 'unmatched' | 'matched'; amount: number; paymentId?: string | null },
): Promise<string> {
  const importId = ids.next()
  await database.executor.insert(statementImport).values({
    id: importId,
    buildingId: building,
    profileKey: 'vcb-default',
    fileKey: `statements/${importId}.csv`,
    status: 'processed',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    lineCount: 1,
    createdBy: ids.next(),
  })
  const lineId = ids.next()
  await database.executor.insert(statementLine).values({
    id: lineId,
    buildingId: building,
    importId,
    lineNo: 1,
    bookedOn: '2026-10-19',
    amount: options.amount,
    content: 'CK den',
    dedupKey: dedupKey(),
    matchStatus: options.matchStatus,
    paymentId: options.paymentId ?? null,
  })
  return lineId
}

/** A `void` payment, to hang a `matched` statement line on without a posted payment (LG-10, LG-11). */
async function seedVoidPayment(building: string, unitId: string): Promise<string> {
  const paymentId = ids.next()
  await database.executor.insert(payment).values({
    id: paymentId,
    buildingId: building,
    unitId,
    source: 'cash',
    amount: 1_000,
    receivedAt: AT,
    payerName: PAYER,
    clientKey: ids.next(),
    recordedBy: ids.next(),
    status: 'void',
    voidReason: 'recorded by mistake',
    voidedAt: AT,
    voidedBy: ids.next(),
  })
  return paymentId
}

async function countPayments(building: string): Promise<number> {
  const rows = await database.executor
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.buildingId, building), eq(payment.status, 'posted')))
  return rows.length
}

async function paymentRow(building: string) {
  const [row] = await database.executor
    .select()
    .from(payment)
    .where(and(eq(payment.buildingId, building), eq(payment.status, 'posted')))
  return row
}

async function liveAllocations(building: string) {
  return database.executor
    .select()
    .from(allocation)
    .where(and(eq(allocation.buildingId, building), eq(allocation.status, 'live')))
}

async function receiptRows(building: string) {
  return database.executor
    .select()
    .from(receipt)
    .where(eq(receipt.buildingId, building))
    .orderBy(asc(receipt.chargeId))
}

async function receiptNumbers(building: string): Promise<string[]> {
  const rows = await database.executor
    .select({ number: receipt.number })
    .from(receipt)
    .where(eq(receipt.buildingId, building))
    .orderBy(asc(receipt.number))
  return rows.map((row) => row.number)
}

async function chargeStatus(chargeId: string): Promise<string | undefined> {
  const [row] = await database.executor
    .select({ status: chargeTable.status })
    .from(chargeTable)
    .where(eq(chargeTable.id, chargeId))
  return row?.status
}

async function counterRow(building: string) {
  const [row] = await database.executor
    .select()
    .from(documentCounter)
    .where(and(eq(documentCounter.buildingId, building), eq(documentCounter.series, 'receipt')))
  return row
}

async function outboxByType(building: string, type: string) {
  return database.executor
    .select({ aggregateId: financeOutbox.aggregateId })
    .from(financeOutbox)
    .where(
      and(eq(financeOutbox.type, type), sql`${financeOutbox.payload}->>'buildingId' = ${building}`),
    )
}

async function auditFor(objectId: string): Promise<Array<{ action: string }>> {
  return (await database.executor.execute(
    sql`SELECT action FROM audit.audit_log WHERE object_id = ${objectId}`,
  )) as unknown as Array<{ action: string }>
}

async function intentRow(intentId: string) {
  const [row] = await database.executor
    .select({ status: paymentIntent.status, cancelReason: paymentIntent.cancelReason })
    .from(paymentIntent)
    .where(eq(paymentIntent.id, intentId))
  return row
}

async function releasedItems(intentId: string) {
  return database.executor
    .select({ releasedAt: paymentIntentItem.releasedAt })
    .from(paymentIntentItem)
    .where(eq(paymentIntentItem.intentId, intentId))
}

async function lineRow(lineId: string) {
  const [row] = await database.executor
    .select({ matchStatus: statementLine.matchStatus, paymentId: statementLine.paymentId })
    .from(statementLine)
    .where(eq(statementLine.id, lineId))
  return row
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

describe('recordManualPayment() (DOC-22 §5, §16.1, §16.2, P2-08)', () => {
  test('LG-01 a cash entry pays two charges with two receipts', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    const result = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB]),
      ids.next(),
    )

    expect(result.kind).toBe('posted')
    if (result.kind !== 'posted') return
    expect(result.replayed).toBe(false)
    expect(result.payment.amount).toBe(money(TOTAL))
    expect(result.payment.source).toBe('cash')

    expect(await countPayments(building)).toBe(1)
    expect(await liveAllocations(building)).toHaveLength(2)
    expect(await receiptNumbers(building)).toEqual(['BL-2610-0001', 'BL-2610-0002'])
    expect(await chargeStatus(chargeA)).toBe('paid')
    expect(await chargeStatus(chargeB)).toBe('paid')

    expect(await outboxByType(building, 'finance.payment_posted.v1')).toHaveLength(1)
    expect(await outboxByType(building, 'finance.receipt_issued.v1')).toHaveLength(2)
    expect(await outboxByType(building, 'finance.receipt_render_requested.v1')).toHaveLength(2)

    const auditRows = await auditFor(result.payment.paymentId)
    expect(auditRows.map((row) => row.action)).toEqual(['finance.payment.post'])

    const rows = await receiptRows(building)
    expect(result.payment.receipts).toEqual(
      rows.map((row) => ({
        receiptId: row.id,
        number: row.number,
        chargeId: row.chargeId,
        amount: money(row.amount),
      })),
    )

    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-02 an amount that differs from the sum is 422 allocation_mismatch', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    const error = await failureOf(() =>
      finance.useCases.recordManualPayment.execute(
        manager,
        manualInput(unit, [chargeA, chargeB], { amount: 2_000_000 }),
        ids.next(),
      ),
    )
    expect(error.code).toBe('allocation_mismatch')
    expect(error.details).toEqual({ expected: TOTAL, got: 2_000_000 })
    expect(await countPayments(building)).toBe(0)
    expect(await chargeStatus(chargeA)).toBe('open')
    expect(await chargeStatus(chargeB)).toBe('open')
  })

  test('LG-03 a charge paid before the entry is 409 charge_changed', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    const first = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeB]),
      ids.next(),
    )
    expect(first.kind).toBe('posted')

    const error = await failureOf(() =>
      finance.useCases.recordManualPayment.execute(
        manager,
        manualInput(unit, [chargeA, chargeB]),
        ids.next(),
      ),
    )
    expect(error.code).toBe('charge_changed')
    const changed = (error.details as { charges: Array<{ chargeId: string; status: string }> })
      .charges
    expect(changed.some((charge) => charge.chargeId === chargeB && charge.status === 'paid')).toBe(
      true,
    )

    expect(await chargeStatus(chargeA)).toBe('open')
    expect(await countPayments(building)).toBe(1)
    expect((await counterRow(building))?.last).toBe(1)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-04 one key replays in sequence and in parallel', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const key = ids.next()

    const first = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB]),
      key,
    )
    const second = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB]),
      key,
    )
    expect(first.kind).toBe('posted')
    expect(second.kind).toBe('posted')
    if (first.kind !== 'posted' || second.kind !== 'posted') return
    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.payment).toEqual(first.payment)
    expect(await countPayments(building)).toBe(1)

    const parallelBuilding = ids.next()
    const parallelManager = staff('manager', parallelBuilding)
    const pair = await seedUnit(parallelBuilding)
    const parallelKey = ids.next()
    const gate = makeBarrier(2)
    const call = () =>
      gate
        .wait()
        .then(() =>
          finance.useCases.recordManualPayment.execute(
            parallelManager,
            manualInput(pair.unit, [pair.chargeA, pair.chargeB]),
            parallelKey,
          ),
        )
    const runs = [call(), call()]
    await gate.ready
    gate.go()
    const results = await Promise.all(runs)
    expect(await countPayments(parallelBuilding)).toBe(1)
    for (const result of results) expect(result.kind).toBe('posted')
    const payments = results.map((result) => (result.kind === 'posted' ? result.payment : null))
    expect(payments[1]).toEqual(payments[0])
    const replayed = results.map((result) => (result.kind === 'posted' ? result.replayed : null))
    expect(replayed.filter((flag) => flag === false)).toHaveLength(1)
    expect(replayed.filter((flag) => flag === true)).toHaveLength(1)
    expect(await invariants(parallelBuilding)).toEqual(CLEAN)
  })

  test('LG-05 the receivedOn window: future, 91 days, 90 days', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          manager,
          manualInput(unit, [chargeA], { receivedOn: '2026-10-20' }),
          ids.next(),
        ),
      ),
    ).toBe('validation_failed:received_on_future')
    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          manager,
          manualInput(unit, [chargeA], { receivedOn: '2026-07-20' }),
          ids.next(),
        ),
      ),
    ).toBe('validation_failed:received_on_too_old')

    const backdated = await finance.useCases.recordManualPayment.execute(
      staff('admin', building),
      manualInput(unit, [chargeA, chargeB], { receivedOn: '2026-07-20' }),
      ids.next(),
    )
    expect(backdated.kind).toBe('posted')
    expect((await paymentRow(building))?.receivedAt).toEqual(new Date('2026-07-20T05:00:00Z'))

    const other = ids.next()
    const otherManager = staff('manager', other)
    const fresh = await seedUnit(other)
    const ninety = await finance.useCases.recordManualPayment.execute(
      otherManager,
      manualInput(fresh.unit, [fresh.chargeA, fresh.chargeB], { receivedOn: '2026-07-21' }),
      ids.next(),
    )
    expect(ninety.kind).toBe('posted')
    expect((await paymentRow(other))?.receivedAt).toEqual(new Date('2026-07-21T05:00:00Z'))
    expect(await invariants(building)).toEqual(CLEAN)
    expect(await invariants(other)).toEqual(CLEAN)
  })

  test('LG-06 a held charge warns in the dry run and the entry cancels it', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const intentId = await seedHoldingIntent(building, unit, [
      { chargeId: chargeB, amount: CHARGE_B },
    ])

    const dry = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB], { dryRun: true }),
      ids.next(),
    )
    expect(dry.kind).toBe('dry_run')
    if (dry.kind !== 'dry_run') return
    expect(dry.amount).toBe(money(TOTAL))
    expect(dry.receiptCount).toBe(2)
    expect(dry.warnings).toEqual([{ chargeId: chargeB, code: 'active_intent', since: AT }])

    const posted = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB]),
      ids.next(),
    )
    expect(posted.kind).toBe('posted')

    const intent = await intentRow(intentId)
    expect(intent?.status).toBe('cancelling')
    expect(intent?.cancelReason).toBe('charge_paid')
    const items = await releasedItems(intentId)
    expect(items).toHaveLength(1)
    expect(items[0]?.releasedAt).not.toBeNull()
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-07 a dry run writes nothing and reserves no number', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    const dry = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB], { dryRun: true }),
      ids.next(),
    )
    expect(dry.kind).toBe('dry_run')
    if (dry.kind !== 'dry_run') return
    expect(dry.amount).toBe(money(TOTAL))
    expect(dry.receiptCount).toBe(2)
    expect(dry.lines.map((line) => line.chargeId)).toEqual([chargeA, chargeB])
    expect(dry.lines.every((line) => !('number' in line))).toBe(true)
    expect('receipts' in dry).toBe(false)

    expect(await countPayments(building)).toBe(0)
    expect(await receiptRows(building)).toHaveLength(0)
    expect(await counterRow(building)).toBeUndefined()
    expect(await outboxByType(building, 'finance.payment_posted.v1')).toHaveLength(0)
  })

  test('LG-08 the charge-id limits, the duplicate and the other unit', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA } = await seedUnit(building)

    const tooMany = Array.from({ length: 51 }, () => ids.next())
    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          manager,
          manualInput(unit, tooMany),
          ids.next(),
        ),
      ),
    ).toBe('validation_failed:too_many_charges')
    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(manager, manualInput(unit, []), ids.next()),
      ),
    ).toBe('validation_failed:too_few_charges')

    const otherUnit = ids.next()
    const [otherCharge] = await seedOpenCharges(building, [
      { code: 'PH-2610-03', unitId: otherUnit, unitCode: 'A-1509', amount: 500_000 },
    ])
    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          manager,
          manualInput(unit, [otherCharge!]),
          ids.next(),
        ),
      ),
    ).toBe('not_found')

    const duplicate = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeA]),
      ids.next(),
    )
    expect(duplicate.kind).toBe('posted')
    if (duplicate.kind !== 'posted') return
    expect(duplicate.payment.receipts).toHaveLength(1)
    expect(await countPayments(building)).toBe(1)
    expect(await receiptNumbers(building)).toEqual(['BL-2610-0001'])
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-09 a Technician and a Guard are forbidden', async () => {
    const building = ids.next()
    const { unit, chargeA } = await seedUnit(building)

    for (const role of ['technician', 'guard'] as const) {
      expect(
        await codeOf(() =>
          finance.useCases.recordManualPayment.execute(
            staff(role, building),
            manualInput(unit, [chargeA]),
            ids.next(),
          ),
        ),
      ).toBe('forbidden')
    }
    expect(await countPayments(building)).toBe(0)
  })

  test('LG-10 statementLineId: an unmatched line matches, a matched line is 409', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const unmatched = await seedStatement(building, { matchStatus: 'unmatched', amount: TOTAL })

    const posted = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB], {
        method: 'bank_transfer',
        statementLineId: unmatched,
      }),
      ids.next(),
    )
    expect(posted.kind).toBe('posted')
    if (posted.kind !== 'posted') return
    const line = await lineRow(unmatched)
    expect(line?.matchStatus).toBe('matched')
    expect(line?.paymentId).toBe(posted.payment.paymentId)
    expect(await invariants(building)).toEqual(CLEAN)

    const second = ids.next()
    const secondManager = staff('manager', second)
    const secondPair = await seedUnit(second)
    const paid = await finance.useCases.recordManualPayment.execute(
      secondManager,
      manualInput(secondPair.unit, [secondPair.chargeA, secondPair.chargeB]),
      ids.next(),
    )
    expect(paid.kind).toBe('posted')
    if (paid.kind !== 'posted') return
    const matched = await seedStatement(second, {
      matchStatus: 'matched',
      amount: CHARGE_A,
      paymentId: paid.payment.paymentId,
    })
    const [chargeC] = await seedOpenCharges(second, [
      { code: 'PH-2610-03', unitId: secondPair.unit, unitCode: 'A-1508', amount: 500_000 },
    ])
    const before = await countPayments(second)
    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          secondManager,
          manualInput(secondPair.unit, [chargeC!], {
            method: 'bank_transfer',
            statementLineId: matched,
          }),
          ids.next(),
        ),
      ),
    ).toBe('invalid_transition')
    expect(await countPayments(second)).toBe(before)
    expect((await counterRow(second))?.last).toBe(2)
    expect(await chargeStatus(chargeC!)).toBe('open')
  })

  test('LG-11/LG-30 a failed entry rolls back and the next one takes 0001 again', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)
    const voidPayment = await seedVoidPayment(building, unit)
    const matched = await seedStatement(building, {
      matchStatus: 'matched',
      amount: TOTAL,
      paymentId: voidPayment,
    })

    expect(
      await codeOf(() =>
        finance.useCases.recordManualPayment.execute(
          manager,
          manualInput(unit, [chargeA, chargeB], {
            method: 'bank_transfer',
            statementLineId: matched,
          }),
          ids.next(),
        ),
      ),
    ).toBe('invalid_transition')

    expect(await countPayments(building)).toBe(0)
    expect(await chargeStatus(chargeA)).toBe('open')
    expect(await chargeStatus(chargeB)).toBe('open')
    expect(await counterRow(building)).toBeUndefined()

    const posted = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, [chargeA, chargeB]),
      ids.next(),
    )
    expect(posted.kind).toBe('posted')
    expect(await receiptNumbers(building)).toEqual(['BL-2610-0001', 'BL-2610-0002'])
    expect((await counterRow(building))?.last).toBe(2)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-13 fifty charges get fifty receipts numbered 0001…0050', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const unit = ids.next()
    const chargeIds = await seedOpenCharges(
      building,
      Array.from({ length: 50 }, (_, index) => ({
        code: `PH-2610-${String(index + 1).padStart(2, '0')}`,
        unitId: unit,
        unitCode: 'A-1508',
        amount: 100_000,
      })),
    )

    const result = await finance.useCases.recordManualPayment.execute(
      manager,
      manualInput(unit, chargeIds),
      ids.next(),
    )
    expect(result.kind).toBe('posted')
    if (result.kind !== 'posted') return
    expect(await countPayments(building)).toBe(1)
    expect(await liveAllocations(building)).toHaveLength(50)
    const expected = Array.from(
      { length: 50 },
      (_, index) => `BL-2610-${String(index + 1).padStart(4, '0')}`,
    )
    expect(await receiptNumbers(building)).toEqual(expected)

    const ordered = await receiptRows(building)
    const ascending = [...chargeIds].sort()
    expect(ordered.map((row) => row.chargeId)).toEqual(ascending)
    expect(ordered.map((row) => row.number)).toEqual(expected)
    expect(await invariants(building)).toEqual(CLEAN)
  })

  test('LG-20 a forced 40001 is retried and the counter advances once', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const { unit, chargeA, chargeB } = await seedUnit(building)

    let calls = 0
    const flaky: UnitOfWork = {
      run: <T>(fn: () => Promise<T>): Promise<T> => {
        calls += 1
        if (calls === 1)
          return Promise.reject(
            Object.assign(new Error('serialization failure'), { code: '40001' }),
          )
        return database.run(fn)
      },
    }

    const ports = testPorts()
    const counter = createGaplessCounter(database, 'finance')
    const ledger = new DrizzleLedgerRepository(database)
    const intents = new DrizzleIntentRepository(database)
    const payments = new DrizzlePaymentRepository(database)
    const outbox = new DrizzleOutboxWriter(database, financeOutbox, () => ids.next(), {
      source: 'finance',
      types: new Set(Object.keys(financeManifest.outboxPolicies)),
      maxPayloadBytes: ports.outboxMaxPayloadBytes,
    })
    const allocator = new ChargeAllocator(ledger, counter, outbox, clock, ids)
    const cancellation = new IntentCancellation(intents, outbox, clock)
    const useCase = new RecordManualPayment(
      flaky,
      payments,
      ledger,
      allocator,
      cancellation,
      ports.calendar,
      ports.receiptBuildings,
      outbox,
      audit.audited,
      clock,
      ids,
      silent,
      { retries: 3, sleep: async () => {}, random: () => 0 },
    )

    const result = await useCase.execute(manager, manualInput(unit, [chargeA, chargeB]), ids.next())
    expect(result.kind).toBe('posted')
    expect(calls).toBe(2)
    expect(await countPayments(building)).toBe(1)
    expect(await receiptNumbers(building)).toEqual(['BL-2610-0001', 'BL-2610-0002'])
    expect((await counterRow(building))?.last).toBe(2)
    expect(await invariants(building)).toEqual(CLEAN)
  })
})
