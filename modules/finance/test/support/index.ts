import { createGaplessCounter, Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import { DrizzleOutboxWriter } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { type BuildingScope, buildingToday, money } from '@rms/shared-types'
import { cloneTemplate } from '@rms/test-support'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  type AllocatedPayment,
  type AllocationFailureReason,
  ChargeAllocator,
} from '../../src/application/allocation/charge-allocator'
import { dayPeriod, intentCode } from '../../src/domain/document-codes'
import type { ReceiptContext } from '../../src/domain/receipt-snapshot'
import { DrizzleLedgerRepository } from '../../src/infrastructure/persistence/drizzle-ledger-repository'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
  financeOutbox,
  gatewayEvent,
  paymentIntent,
} from '../../src/infrastructure/persistence/schema'
import { financeManifest } from '../../src/manifest'

/**
 * The harness of P2-03 (DOC-22 §16.2): the real `ChargeAllocator`, the Drizzle ledger repository and the gapless counter over
 * a cloned template, plus the two thin callers `manualPay` and `onlinePay` the race tests release together. The real use cases
 * are P2-08 (`RecordManualPayment`) and P2-06 (`settle()`); this file is their stand-in, not the HTTP contract.
 */
export type AllocationHarness = Awaited<ReturnType<typeof createAllocationHarness>>

const ZONE = 'Asia/Ho_Chi_Minh'
const AT = new Date('2026-10-19T03:00:00Z')
/** The amount of every seeded charge (đồng). */
const CHARGE_AMOUNT = 100_000

/** `allocate` returned 0 rows; the manual caller throws it so its whole transaction rolls back (DOC-22 §4.3). */
export class ChargeChangedError extends Error {
  constructor(
    readonly failed: { readonly chargeId: string; readonly reason: AllocationFailureReason },
  ) {
    super(`charge_changed: ${failed.chargeId} (${failed.reason})`)
    this.name = 'ChargeChangedError'
  }
}

export interface OpenCharge {
  readonly id: string
  readonly unitId: string
  readonly amount: number
}

export interface OnlineOutcome {
  readonly ok: boolean
  readonly outcome: 'posted' | 'charge_already_paid' | 'charge_recalled'
}

/** A barrier: every session awaits it before its first statement, then `go` releases them together (DOC-22 §16.2). */
export function makeBarrier(size: number): {
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

/** The eight ledger invariants of DOC-15 §12.2, each answering the number of violating rows. */
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

export async function createAllocationHarness() {
  const db = await cloneTemplate('empty')
  const database = new Database({ url: db.url, poolMax: 20, prepare: false })
  const clock = new FakeClock(AT)
  const ids = new UuidV7Generator()
  const ledger = new DrizzleLedgerRepository(database)
  const counter = createGaplessCounter(database, 'finance')
  const outbox = new DrizzleOutboxWriter(database, financeOutbox, () => ids.next(), {
    source: 'finance',
    types: new Set(Object.keys(financeManifest.outboxPolicies ?? {})),
    maxPayloadBytes: 65_536,
  })
  const allocator = new ChargeAllocator(ledger, counter, outbox, clock, ids)
  const context: ReceiptContext = {
    timeZone: ZONE,
    company: {
      name: { vi: 'Công ty Quản lý An Phú', en: 'An Phu Property Management Co.' },
      address: '12 Nguyễn Văn Linh, Quận 7',
      hotline: '028 3775 1234',
      logoKey: null,
    },
    building: { name: { vi: 'Chung cư Sunrise', en: 'Sunrise Residences' } },
    payer: { name: 'Trần Minh Anh', memberType: null },
  }
  let codeSeq = 0
  let orderSeq = 1_000_000
  let intentSeq = 0
  let eventSeq = 0
  let unitSeq = 0

  async function seed(
    scope: BuildingScope,
    plan: ReadonlyArray<readonly number[]>,
  ): Promise<OpenCharge[]> {
    const batches: (typeof feeBatch.$inferInsert)[] = []
    const charges: (typeof chargeTable.$inferInsert)[] = []
    const lines: (typeof chargeLine.$inferInsert)[] = []
    const open: OpenCharge[] = []
    for (const amounts of plan) {
      const unitId = ids.next()
      for (const amount of amounts) {
        const batchId = ids.next()
        const chargeId = ids.next()
        codeSeq += 1
        unitSeq += 1
        batches.push({
          id: batchId,
          buildingId: scope.buildingId,
          code: `PH-2610-${String(codeSeq).padStart(2, '0')}`,
          name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
          feeMonth: '2026-10-01',
          dueDate: '2026-11-10',
          status: 'published',
          createdBy: ids.next(),
          publishedAt: AT,
          publishedBy: ids.next(),
          version: 1,
        })
        charges.push({
          id: chargeId,
          buildingId: scope.buildingId,
          batchId,
          unitId,
          unitCode: `A-${unitSeq}`,
          amount,
          status: 'draft',
          version: 1,
        })
        lines.push({
          id: ids.next(),
          buildingId: scope.buildingId,
          chargeId,
          position: 1,
          kind: 'fee',
          itemName: { vi: 'Phí quản lý', en: 'Management fee' },
          quantity: '1',
          unitPrice: amount,
          amount,
        })
        open.push({ id: chargeId, unitId, amount })
      }
    }
    await database.executor.insert(feeBatch).values(batches)
    await database.executor.insert(chargeTable).values(charges)
    await database.executor.insert(chargeLine).values(lines)
    await database.executor
      .update(chargeTable)
      .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
      .where(eq(chargeTable.buildingId, scope.buildingId))
    return open
  }

  async function load(scope: BuildingScope, chargeIds: readonly string[]): Promise<OpenCharge[]> {
    const rows = await database.executor
      .select({ id: chargeTable.id, unitId: chargeTable.unitId, amount: chargeTable.amount })
      .from(chargeTable)
      .where(
        and(eq(chargeTable.buildingId, scope.buildingId), inArray(chargeTable.id, [...chargeIds])),
      )
    return rows.map((row) => ({ id: row.id, unitId: row.unitId, amount: row.amount }))
  }

  async function manualPay(
    scope: BuildingScope,
    chargeIds: readonly string[],
    before?: () => Promise<void>,
  ): Promise<void> {
    const charges = await load(scope, chargeIds)
    const total = charges.reduce((sum, charge) => sum + charge.amount, 0)
    const unitId = charges[0]?.unitId
    if (!unitId) throw new Error('manualPay needs a charge')
    await database.transaction(async () => {
      if (before) await before()
      const paymentId = ids.next()
      await ledger.insertPayment(scope, {
        id: paymentId,
        unitId,
        source: 'cash',
        amount: money(total),
        receivedAt: AT,
        payerName: 'Trần Minh Anh',
        provider: null,
        gatewayReference: null,
        intentId: null,
        clientKey: ids.next(),
        recordedBy: ids.next(),
        bankReference: null,
        statementLineId: null,
        note: null,
      })
      const payment: AllocatedPayment = {
        paymentId,
        source: 'cash',
        receivedAt: AT,
        gatewayReference: null,
        bankReference: null,
      }
      const result = await allocator.allocate(
        scope,
        payment,
        charges.map((charge) => ({ chargeId: charge.id, expectedAmount: money(charge.amount) })),
        context,
      )
      if (!result.ok) throw new ChargeChangedError(result.failed)
    })
  }

  async function onlinePay(
    scope: BuildingScope,
    chargeIds: readonly string[],
    before?: () => Promise<void>,
  ): Promise<OnlineOutcome> {
    const charges = await load(scope, chargeIds)
    const total = charges.reduce((sum, charge) => sum + charge.amount, 0)
    const unitId = charges[0]?.unitId
    if (!unitId) throw new Error('onlinePay needs a charge')
    return database.transaction(async () => {
      if (before) await before()
      const intentId = ids.next()
      orderSeq += 1
      eventSeq += 1
      intentSeq += 1
      const reference = `FT${String(eventSeq).padStart(10, '0')}`
      await database.executor.insert(paymentIntent).values({
        id: intentId,
        buildingId: scope.buildingId,
        unitId,
        code: intentCode(dayPeriod(buildingToday(AT, ZONE)), intentSeq),
        orderCode: orderSeq,
        amount: total,
        status: 'pending',
        gatewayConfigId: ids.next(),
        provider: 'payos',
        linkId: `link-${orderSeq}`,
        createdBy: ids.next(),
        // The fixture instant, not now(): ck_payment_intent_window compares the window with created_at (DOC-15 §6.1).
        createdAt: AT,
        displayUntil: new Date(AT.getTime() + 30 * 60_000),
        expiresAt: new Date(AT.getTime() + 60 * 60_000),
      })
      const eventId = ids.next()
      await database.executor.insert(gatewayEvent).values({
        id: eventId,
        buildingId: scope.buildingId,
        provider: 'payos',
        reference,
        orderCode: orderSeq,
        amount: total,
        paidAt: AT,
        source: 'requery',
        payload: {},
        intentId,
        unitId,
        outcome: 'pending',
      })
      let outcome: OnlineOutcome['outcome'] = 'posted'
      let paymentId: string | null = null
      try {
        await database.transaction(async () => {
          const id = ids.next()
          await ledger.insertPayment(scope, {
            id,
            unitId,
            source: 'online',
            amount: money(total),
            receivedAt: AT,
            payerName: 'Trần Minh Anh',
            provider: 'payos',
            gatewayReference: reference,
            intentId,
            clientKey: null,
            recordedBy: null,
            bankReference: null,
            statementLineId: null,
            note: null,
          })
          const result = await allocator.allocate(
            scope,
            {
              paymentId: id,
              source: 'online',
              receivedAt: AT,
              gatewayReference: reference,
              bankReference: null,
            },
            charges.map((charge) => ({
              chargeId: charge.id,
              expectedAmount: money(charge.amount),
            })),
            context,
          )
          if (!result.ok) throw new ChargeChangedError(result.failed)
          await database.executor
            .update(paymentIntent)
            .set({
              status: 'paid',
              paidAt: AT,
              gatewayReference: reference,
              version: sql`${paymentIntent.version} + 1`,
              updatedAt: AT,
            })
            .where(eq(paymentIntent.id, intentId))
          paymentId = id
        })
      } catch (error) {
        if (!(error instanceof ChargeChangedError)) throw error
        const state = await ledger.readChargeState(scope, error.failed.chargeId)
        outcome = state?.status === 'void' ? 'charge_recalled' : 'charge_already_paid'
      }
      await database.executor
        .update(gatewayEvent)
        .set({ outcome, paymentId })
        .where(eq(gatewayEvent.id, eventId))
      return { ok: outcome === 'posted', outcome }
    })
  }

  async function invariantViolations(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const [id, text] of INVARIANTS) {
      const rows = (await database.executor.execute(sql.raw(text))) as unknown as Array<{
        n: number
      }>
      out[id] = Number(rows[0]?.n ?? 0)
    }
    return out
  }

  return {
    db,
    database,
    ids,
    context,
    newBuilding: () => ({ buildingId: ids.next() as BuildingScope['buildingId'] }),
    seedOpenCharges: (scope: BuildingScope, count: number) =>
      seed(
        scope,
        Array.from({ length: count }, () => [CHARGE_AMOUNT]),
      ),
    seedPairs: async (scope: BuildingScope, count: number) => {
      const open = await seed(
        scope,
        Array.from({ length: count }, () => [CHARGE_AMOUNT, CHARGE_AMOUNT]),
      )
      const pairs: Array<readonly [string, string]> = []
      for (let index = 0; index < count; index += 1)
        pairs.push([open[2 * index]?.id ?? '', open[2 * index + 1]?.id ?? ''])
      return pairs
    },
    manualPay,
    onlinePay,
    invariantViolations,
    close: async () => {
      await database.close()
      await db.drop()
    },
  }
}
