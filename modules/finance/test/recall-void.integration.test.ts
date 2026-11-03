import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
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
import { financeManifest } from '../src'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The P2-07 tests: recall, single void and `IntentCancellation` (DOC-21 §3.5, §3.9) and their race with a settlement
 * (DOC-22 §10, FR-04.3, FR-49.5). A clone of the migrated template, the real audit module, the real `createFinanceModule`
 * and a unit directory stub. Batches, charges and payment intents are seeded as `rms_migrator` (`db.admin()`); assertions
 * read SQL. `publishedBatch` inserts a charge `draft` then moves it `open`, which bumps its version (support/index.ts),
 * so an open charge starts at version 2 and the batch at 1.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const SEED_AT = new Date('2026-10-19T02:00:00Z')
const PAID_AT = new Date('2026-10-19T02:14:31Z')
const CHARGE_AMOUNT = 100_000
const BATCH_VERSION = 1
const CHARGE_VERSION = 2
const BATCH_NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }
const ITEM_NAME = { vi: 'Phí quản lý', en: 'Management fee' }
const RECALL_REASON = 'the October meter reading was wrong, recall the batch'
const VOID_REASON = 'billed to the wrong unit'

/** The eight ledger invariants of DOC-15 §12.2 (copied from support/index.ts), each answering the number of violating rows. */
const INVARIANTS: ReadonlyArray<readonly [string, string]> = [
  [
    'I1',
    "SELECT count(*)::int AS n FROM finance.charge c WHERE c.status = 'paid' AND 1 <> (SELECT count(*) FROM finance.allocation a WHERE a.charge_id = c.id AND a.status = 'live' AND a.amount = c.amount)",
  ],
  [
    'I2',
    "SELECT count(*)::int AS n FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id WHERE a.status = 'live' AND c.status <> 'paid'",
  ],
  [
    'I3',
    "SELECT count(*)::int AS n FROM finance.payment p WHERE p.status = 'posted' AND p.amount <> coalesce((SELECT sum(a.amount) FROM finance.allocation a WHERE a.payment_id = p.id AND a.status = 'live'), 0)",
  ],
  [
    'I4',
    "SELECT count(*)::int AS n FROM finance.allocation a WHERE a.status = 'live' AND NOT EXISTS (SELECT 1 FROM finance.receipt r WHERE r.allocation_id = a.id AND r.status = 'issued')",
  ],
  [
    'I5',
    "SELECT count(*)::int AS n FROM finance.document_counter d WHERE d.series = 'receipt' AND d.last <> (SELECT count(*) FROM finance.receipt r WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period)",
  ],
  [
    'I6',
    "SELECT count(*)::int AS n FROM finance.gateway_event g WHERE g.outcome = 'posted' AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = g.payment_id AND p.status = 'posted')",
  ],
  [
    'I7',
    "SELECT count(*)::int AS n FROM finance.charge c WHERE c.status IN ('open', 'paid') AND c.amount <> (SELECT sum(l.amount) FROM finance.charge_line l WHERE l.charge_id = c.id)",
  ],
  ['I8', "SELECT count(*)::int AS n FROM finance.gateway_event WHERE outcome = 'pending'"],
]

interface SeededBatch {
  readonly batchId: string
  readonly chargeIds: string[]
}

interface SeededIntent {
  readonly intentId: string
  readonly orderCode: number
  readonly gatewayConfigId: string
  readonly amount: number
}

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let finance: FinanceModule
const ids = new UuidV7Generator()
let batchSeq = 0
let unitSeq = 0
let orderSeq = 2_000_000
let intentSeq = 0
let referenceSeq = 0

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

/** A published batch of `units` open charges at `amount`, one line each; the batch is `version` 1. */
async function publishedBatch(
  buildingId: string,
  units: number,
  amount = CHARGE_AMOUNT,
): Promise<SeededBatch> {
  const batchId = ids.next()
  batchSeq += 1
  const code = `PH-2610-${String(batchSeq).padStart(2, '0')}`
  await admin`INSERT INTO finance.fee_batch
      (id, building_id, code, name, fee_month, due_date, status, created_by, published_at, published_by, version)
    VALUES (${batchId}, ${buildingId}, ${code}, ${admin.json(BATCH_NAME)}, '2026-10-01',
            '2026-11-10', 'published', ${ids.next()}, ${SEED_AT}, ${ids.next()}, 1)`
  const chargeIds: string[] = []
  for (let i = 0; i < units; i += 1) {
    const chargeId = ids.next()
    chargeIds.push(chargeId)
    unitSeq += 1
    await admin`INSERT INTO finance.charge
        (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
      VALUES (${chargeId}, ${buildingId}, ${batchId}, ${ids.next()}, ${`A-${unitSeq}`},
              ${amount}, 'draft', 1)`
    await admin`INSERT INTO finance.charge_line
        (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
      VALUES (${ids.next()}, ${buildingId}, ${chargeId}, 1, 'fee',
              ${admin.json(ITEM_NAME)}, 1, ${amount}, ${amount})`
  }
  await admin`UPDATE finance.charge
      SET status = 'open', version = version + 1, updated_at = now()
    WHERE building_id = ${buildingId} AND batch_id = ${batchId}`
  return { batchId, chargeIds }
}

/** A pending `fake` intent holding `chargeIds` with their `amounts`; one `gateway_config_id`, a unique order code. */
async function intent(
  buildingId: string,
  chargeIds: readonly string[],
  amounts: readonly number[],
): Promise<SeededIntent> {
  const intentId = ids.next()
  orderSeq += 1
  intentSeq += 1
  // Read once, before any await: another seeding caller may move the counters meanwhile.
  const orderCode = orderSeq
  const amount = amounts.reduce((sum, value) => sum + value, 0)
  const gatewayConfigId = ids.next()
  const code = `TT-261019-${String(intentSeq).padStart(4, '0')}`
  await admin`INSERT INTO finance.payment_intent
      (id, building_id, unit_id, code, order_code, amount, status, gateway_config_id, provider, link_id,
       created_by, display_until, expires_at, version, created_at)
    VALUES (${intentId}, ${buildingId}, ${ids.next()}, ${code}, ${orderCode}, ${amount}, 'pending',
            ${gatewayConfigId}, 'fake', ${`link-${orderCode}`}, ${ids.next()},
            ${new Date(SEED_AT.getTime() + 30 * 60_000)},
            ${new Date(SEED_AT.getTime() + 60 * 60_000)}, 1, ${SEED_AT})`
  for (let i = 0; i < chargeIds.length; i += 1)
    await admin`INSERT INTO finance.payment_intent_item
        (id, building_id, intent_id, charge_id, amount)
      VALUES (${ids.next()}, ${buildingId}, ${intentId}, ${chargeIds[i]!}, ${amounts[i]!})`
  return { intentId, orderCode, gatewayConfigId, amount }
}

/** The `Confirmation` of DOC-23 §2.1 the webhook source would build for one intent. */
const confirmation = (buildingId: string, subject: SeededIntent) => {
  referenceSeq += 1
  return {
    buildingId: buildingId as BuildingId,
    gatewayConfigId: subject.gatewayConfigId,
    provider: 'fake',
    reference: `EVT-${String(referenceSeq).padStart(8, '0')}`,
    orderCode: subject.orderCode,
    amount: money(subject.amount),
    paidAt: PAID_AT,
    source: 'webhook' as const,
    payload: {},
  }
}

async function invariantViolations(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const [id, text] of INVARIANTS) {
    const rows = (await admin.unsafe(text)) as unknown as Array<{ n: number }>
    out[id] = Number(rows[0]?.n ?? 0)
  }
  return out
}

function groupsOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
  admin = db.admin()
  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, financeManifest]),
    purgeGraceMinutes: 0,
  })
  finance = createFinanceModule({
    database,
    clock: new FakeClock(new Date('2026-10-01T03:00:00Z')),
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files: {
      read: () => Promise.reject(new Error('no file is read by the recall or void use cases')),
      attach: () =>
        Promise.reject(new Error('no file is attached by the recall or void use cases')),
    },
    ...testPorts(),
  })
})

afterAll(async () => {
  await admin.end({ timeout: 5 })
  await database.close()
  await db.drop()
})

describe('recall (DOC-21 §3.5; LG-70…LG-72, FR-04.1…4)', () => {
  test('LG-70 recall voids 240 charges, cancels a cross-batch intent and writes the events (FR-04.1)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 240)
    const other = await publishedBatch(building, 1)
    const held = await intent(
      building,
      [batch.chargeIds[0]!, batch.chargeIds[1]!, other.chargeIds[0]!],
      [CHARGE_AMOUNT, CHARGE_AMOUNT, CHARGE_AMOUNT],
    )

    const out = await finance.useCases.recallFeeBatch.execute(manager, batch.batchId, {
      reason: RECALL_REASON,
      version: BATCH_VERSION,
    })
    expect(out.chargeCount).toBe(240)
    expect(out.intentIds).toEqual([held.intentId])

    const [voided] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND status = 'void' AND void_kind = 'recall'`
    expect(voided?.n).toBe(240)

    const [cancel] = await admin<{ status: string; cancel_reason: string; released: number }[]>`
      SELECT i.status, i.cancel_reason,
             (SELECT count(*)::int FROM finance.payment_intent_item it
               WHERE it.intent_id = i.id AND it.released_at IS NOT NULL) AS released
        FROM finance.payment_intent i WHERE i.id = ${held.intentId}`
    expect(cancel?.status).toBe('cancelling')
    expect(cancel?.cancel_reason).toBe('batch_recalled')
    expect(cancel?.released).toBe(3)

    const events = await admin<{ type: string; payload: Record<string, unknown> }[]>`
      SELECT type, payload FROM finance.outbox_messages
       WHERE payload->>'buildingId' = ${building}
         AND type IN ('finance.batch_recalled.v1', 'finance.intent_cancel_requested.v1')`
    const recalled = events.filter((row) => row.type === 'finance.batch_recalled.v1')
    const cancels = events.filter((row) => row.type === 'finance.intent_cancel_requested.v1')
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.payload).toMatchObject({ part: 1, parts: 1 })
    expect((recalled[0]?.payload as { unitIds: string[] } | undefined)?.unitIds).toHaveLength(240)
    expect(cancels).toHaveLength(1)
    expect(cancels[0]?.payload).toMatchObject({ reason: 'batch_recalled', intentId: held.intentId })

    const audit = await admin<{ action: string; reason: string }[]>`
      SELECT action, reason FROM audit.audit_log
       WHERE action = 'finance.batch.recall' AND object_id = ${batch.batchId}`
    expect(audit).toHaveLength(1)
    expect(audit[0]?.reason).toBe(RECALL_REASON)

    const [row] = await admin<{ status: string; version: number; recalled_at: Date | null }[]>`
      SELECT status, version, recalled_at FROM finance.fee_batch WHERE id = ${batch.batchId}`
    expect(row?.status).toBe('recalled')
    expect(row?.version).toBe(BATCH_VERSION + 1)
    expect(row?.recalled_at).not.toBeNull()
  })

  test('LG-71 recall refuses a batch with a payment; its reasons and versions (FR-04.2)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 240)
    const held = await intent(building, [batch.chargeIds[0]!], [CHARGE_AMOUNT])
    expect((await finance.settlement.settle(confirmation(building, held))).outcome).toBe('posted')

    const refused = await failureOf(() =>
      finance.useCases.recallFeeBatch.execute(manager, batch.batchId, {
        reason: RECALL_REASON,
        version: BATCH_VERSION,
      }),
    )
    expect(refused.code).toBe('batch_has_payments')
    expect(refused.details).toEqual({ paidCount: 1 })

    const [open] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND status = 'open'`
    const [paid] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND status = 'paid'`
    expect(open?.n).toBe(239)
    expect(paid?.n).toBe(1)

    const [row] = await admin<{ status: string; version: number }[]>`
      SELECT status, version FROM finance.fee_batch WHERE id = ${batch.batchId}`
    expect(row).toEqual({ status: 'published', version: BATCH_VERSION })

    const [events] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.outbox_messages
       WHERE type = 'finance.batch_recalled.v1' AND payload->>'buildingId' = ${building}`
    expect(events?.n).toBe(0)

    const recall = finance.useCases.recallFeeBatch
    const attempt = (version?: number, reason = RECALL_REASON) =>
      recall.execute(manager, batch.batchId, { reason, version })
    expect(await codeOf(() => attempt(BATCH_VERSION, 'abcd'))).toBe(
      'validation_failed:reason_too_short',
    )
    expect(await codeOf(() => attempt(BATCH_VERSION, 'x'.repeat(501)))).toBe(
      'validation_failed:reason_too_long',
    )
    expect(await codeOf(() => attempt(9))).toBe('version_conflict')

    const recalled = await publishedBatch(building, 1)
    await recall.execute(manager, recalled.batchId, {
      reason: RECALL_REASON,
      version: BATCH_VERSION,
    })
    expect(
      await codeOf(() =>
        recall.execute(manager, recalled.batchId, {
          reason: RECALL_REASON,
          version: BATCH_VERSION + 1,
        }),
      ),
    ).toBe('invalid_transition')
  })

  test('LG-72 a charge voided alone is not counted by the recall (DR-97)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 240)
    await finance.useCases.voidCharge.execute(manager, batch.chargeIds[0]!, {
      reason: VOID_REASON,
      version: CHARGE_VERSION,
    })

    const out = await finance.useCases.recallFeeBatch.execute(manager, batch.batchId, {
      reason: RECALL_REASON,
      version: BATCH_VERSION,
    })
    expect(out.chargeCount).toBe(239)

    const [recalled] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND void_kind = 'recall'`
    const [single] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND void_kind = 'single'`
    expect(recalled?.n).toBe(239)
    expect(single?.n).toBe(1)
  })
})

describe('single void (DOC-21 §3.9; LG-76…LG-78, FR-49)', () => {
  test('LG-76 voiding one open charge stores the reason and writes the audit and the event (FR-49.1)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 240)
    const chargeId = batch.chargeIds[0]!
    const out = await finance.useCases.voidCharge.execute(manager, chargeId, {
      reason: VOID_REASON,
      version: CHARGE_VERSION,
    })
    expect(out.charge.status).toBe('void')
    expect(out.intentIds).toEqual([])

    const [row] = await admin<
      {
        status: string
        void_kind: string
        void_reason: string
        version: number
      }[]
    >`
      SELECT status, void_kind, void_reason, version FROM finance.charge WHERE id = ${chargeId}`
    expect(row).toEqual({
      status: 'void',
      void_kind: 'single',
      void_reason: VOID_REASON,
      version: CHARGE_VERSION + 1,
    })

    const audit = await admin<{ action: string; object_type: string; reason: string }[]>`
      SELECT action, object_type, reason FROM audit.audit_log
       WHERE action = 'finance.charge.void' AND object_id = ${chargeId}`
    expect(audit).toHaveLength(1)
    expect(audit[0]?.object_type).toBe('charge')
    expect(audit[0]?.reason).toBe(VOID_REASON)

    const events = await admin<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM finance.outbox_messages
       WHERE type = 'finance.charge_voided.v1' AND payload->>'buildingId' = ${building}`
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      batchId: batch.batchId,
      unitId: out.charge.unitId,
      feeMonth: '2026-10',
    })

    const [open] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge
       WHERE batch_id = ${batch.batchId} AND status = 'open'`
    expect(open?.n).toBe(239)
  })

  test('LG-77 the refusals: paid, reason, role, version, already void, no If-Match (FR-49.2)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 4)
    const paidCharge = batch.chargeIds[0]!
    const openCharge = batch.chargeIds[1]!
    const toVoid = batch.chargeIds[2]!
    const held = await intent(building, [paidCharge], [CHARGE_AMOUNT])
    expect((await finance.settlement.settle(confirmation(building, held))).outcome).toBe('posted')

    const voidCharge = finance.useCases.voidCharge
    const attempt = (chargeId: string, version?: number, reason = VOID_REASON) =>
      voidCharge.execute(manager, chargeId, { reason, version })
    expect(await codeOf(() => attempt(paidCharge, CHARGE_VERSION))).toBe('charge_not_voidable')
    expect(await codeOf(() => attempt(openCharge, CHARGE_VERSION, 'nope'))).toBe(
      'validation_failed:reason_too_short',
    )
    expect(
      await codeOf(() =>
        voidCharge.execute(staff('technician', building), openCharge, {
          reason: VOID_REASON,
          version: CHARGE_VERSION,
        }),
      ),
    ).toBe('forbidden')
    expect(await codeOf(() => attempt(openCharge, 9))).toBe('version_conflict')
    expect(await codeOf(() => attempt(openCharge, undefined))).toBe('precondition_required')

    await attempt(toVoid, CHARGE_VERSION)
    expect(await codeOf(() => attempt(toVoid, CHARGE_VERSION))).toBe('invalid_transition')
  })

  test('LG-78 voiding a held charge cancels its intent as a whole, in the same transaction (FR-49.3)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await publishedBatch(building, 2)
    const first = batch.chargeIds[0]!
    const held = await intent(
      building,
      [first, batch.chargeIds[1]!],
      [CHARGE_AMOUNT, CHARGE_AMOUNT],
    )

    const out = await finance.useCases.voidCharge.execute(manager, first, {
      reason: VOID_REASON,
      version: CHARGE_VERSION,
    })
    expect(out.intentIds).toEqual([held.intentId])

    const [row] = await admin<
      {
        charge_status: string
        intent_status: string
        cancel_reason: string
        released: number
        cancels: number
      }[]
    >`
      SELECT (SELECT c.status FROM finance.charge c WHERE c.id = ${first}) AS charge_status,
             i.status AS intent_status, i.cancel_reason AS cancel_reason,
             (SELECT count(*)::int FROM finance.payment_intent_item it
               WHERE it.intent_id = i.id AND it.released_at IS NOT NULL) AS released,
             (SELECT count(*)::int FROM finance.outbox_messages o
               WHERE o.type = 'finance.intent_cancel_requested.v1'
                 AND o.payload->>'intentId' = i.id::text) AS cancels
        FROM finance.payment_intent i WHERE i.id = ${held.intentId}`
    expect(row).toEqual({
      charge_status: 'void',
      intent_status: 'cancelling',
      cancel_reason: 'charge_voided',
      released: 2,
      cancels: 1,
    })
  })
})

describe('the races with a settlement (DOC-22 §10; LG-79, LG-81, P2-07, FR-04.3, FR-49.5)', () => {
  test('LG-79 a void and an exact settlement of one charge race 200 times (FR-49.5)', async () => {
    let voided = 0
    let settled = 0
    for (let round = 0; round < 200; round += 1) {
      const building = ids.next()
      const manager = staff('manager', building)
      const batch = await publishedBatch(building, 1)
      const chargeId = batch.chargeIds[0]!
      const held = await intent(building, [chargeId], [CHARGE_AMOUNT])
      const barrier = makeBarrier(2)
      const voidRun = (async () => {
        await barrier.wait()
        return finance.useCases.voidCharge.execute(manager, chargeId, {
          reason: VOID_REASON,
          version: CHARGE_VERSION,
        })
      })()
      const settleRun = (async () => {
        await barrier.wait()
        return finance.settlement.settle(confirmation(building, held))
      })()
      await barrier.ready
      barrier.go()
      const [voidResult, settleResult] = await Promise.allSettled([voidRun, settleRun])
      if (settleResult.status === 'rejected') throw settleResult.reason
      if (voidResult.status === 'fulfilled') {
        expect(settleResult.value.outcome).toBe('charge_recalled')
        voided += 1
      } else {
        if (!(voidResult.reason instanceof DomainError)) throw voidResult.reason
        expect(['charge_not_voidable', 'version_conflict']).toContain(voidResult.reason.code)
        expect(settleResult.value.outcome).toBe('posted')
        settled += 1
      }
    }
    console.info(`LG-79: void won ${voided} rounds, settlement won ${settled} rounds`)
    expect(voided + settled).toBe(200)

    const [live] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.charge c
       JOIN finance.allocation a ON a.charge_id = c.id AND a.status = 'live'
      WHERE c.status = 'void'`
    expect(live?.n).toBe(0)
    expect(await invariantViolations()).toEqual({
      I1: 0,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
  }, 600_000)

  test('LG-81 a recall of a batch and an exact settlement of one charge race 200 times (FR-04.3)', async () => {
    let recalled = 0
    let refused = 0
    for (let round = 0; round < 200; round += 1) {
      const building = ids.next()
      const manager = staff('manager', building)
      const batch = await publishedBatch(building, 10)
      const held = await intent(building, [batch.chargeIds[0]!], [CHARGE_AMOUNT])
      const barrier = makeBarrier(2)
      const recallRun = (async () => {
        await barrier.wait()
        return finance.useCases.recallFeeBatch.execute(manager, batch.batchId, {
          reason: RECALL_REASON,
          version: BATCH_VERSION,
        })
      })()
      const settleRun = (async () => {
        await barrier.wait()
        return finance.settlement.settle(confirmation(building, held))
      })()
      await barrier.ready
      barrier.go()
      const [recallResult, settleResult] = await Promise.allSettled([recallRun, settleRun])
      if (settleResult.status === 'rejected') throw settleResult.reason
      if (recallResult.status === 'fulfilled') {
        expect(settleResult.value.outcome).toBe('charge_recalled')
        recalled += 1
      } else {
        if (!(recallResult.reason instanceof DomainError)) throw recallResult.reason
        expect(recallResult.reason.code).toBe('batch_has_payments')
        expect(settleResult.value.outcome).toBe('posted')
        refused += 1
      }
    }
    console.info(`LG-81: recall won ${recalled} rounds, refused ${refused} rounds`)
    expect(recalled + refused).toBe(200)

    const [live] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.fee_batch b
       JOIN finance.charge c ON c.batch_id = b.id
       JOIN finance.allocation a ON a.charge_id = c.id AND a.status = 'live'
      WHERE b.status = 'recalled'`
    expect(live?.n).toBe(0)
    expect(await invariantViolations()).toEqual({
      I1: 0,
      I2: 0,
      I3: 0,
      I4: 0,
      I5: 0,
      I6: 0,
      I7: 0,
      I8: 0,
    })
  }, 600_000)

  test('P2-07 200 batches of 50 charges race a recall against 1…5 settlements (master plan, DOC-21 §3.5)', async () => {
    const started = performance.now()
    const building = ids.next()
    const manager = staff('manager', building)
    const batches: Array<{ batchId: string; intents: SeededIntent[] }> = []
    for (let i = 0; i < 200; i += 1) {
      const batch = await publishedBatch(building, 50)
      const count = (i % 5) + 1
      const intents: SeededIntent[] = []
      for (let j = 0; j < count; j += 1)
        intents.push(await intent(building, [batch.chargeIds[j]!], [CHARGE_AMOUNT]))
      batches.push({ batchId: batch.batchId, intents })
    }

    let posted = 0
    let recalled = 0
    let refused = 0
    let confirmations = 0
    for (const group of groupsOf(batches, 20)) {
      const lanes = group.map((entry) => {
        const barrier = makeBarrier(1 + entry.intents.length)
        const recall = (async () => {
          await barrier.wait()
          return finance.useCases.recallFeeBatch.execute(manager, entry.batchId, {
            reason: RECALL_REASON,
            version: BATCH_VERSION,
          })
        })()
        const settles = entry.intents.map((subject) =>
          (async () => {
            await barrier.wait()
            return finance.settlement.settle(confirmation(building, subject))
          })(),
        )
        return { barrier, recall, settles }
      })
      for (const lane of lanes) await lane.barrier.ready
      for (const lane of lanes) lane.barrier.go()
      // Settled together, so a lane that rejects before its turn is never an unhandled rejection.
      const outcomes = await Promise.all(
        lanes.map(async (lane) => ({
          recall: (await Promise.allSettled([lane.recall]))[0]!,
          settles: await Promise.allSettled(lane.settles),
        })),
      )
      for (const lane of outcomes) {
        if (lane.recall.status === 'fulfilled') recalled += 1
        else {
          const error = lane.recall.reason
          if (!(error instanceof DomainError) || error.code !== 'batch_has_payments') throw error
          refused += 1
        }
        for (const settle of lane.settles) {
          if (settle.status === 'rejected') throw settle.reason
          confirmations += 1
          if (settle.value.outcome === 'posted') posted += 1
          else if (settle.value.outcome !== 'charge_recalled')
            throw new Error(`unexpected settle outcome: ${settle.value.outcome}`)
        }
      }
    }
    const elapsed = Math.round(performance.now() - started)
    console.info(
      `P2-07: 200 batches of 50 charges in ${elapsed} ms — ${recalled} recalled, ` +
        `${refused} refused, ${posted} posted, ${confirmations - posted} recalled payments`,
    )
    expect(recalled + refused).toBe(200)

    const [bad] = await admin<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.fee_batch b
         JOIN finance.charge c ON c.batch_id = b.id
         JOIN finance.allocation a ON a.charge_id = c.id AND a.status = 'live'
        WHERE b.building_id = ${building} AND b.status = 'recalled'`
    expect(bad?.n).toBe(0)

    const [logRows] = await admin<{ n: number }[]>`
        SELECT count(*)::int AS n FROM finance.gateway_event
         WHERE building_id = ${building} AND outcome = 'charge_recalled'`
    expect(posted + (logRows?.n ?? 0)).toBe(confirmations)
  }, 600_000)
})
