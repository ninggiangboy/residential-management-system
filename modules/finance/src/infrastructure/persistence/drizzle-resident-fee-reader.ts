import { type Database, inBuilding } from '@core/db'
import { type BuildingScope, type LocalDate, type Money, money } from '@rms/shared-types'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { BilingualName, ChargeStatus } from '../../domain/fee-batch'
import type { PaymentSource } from '../../domain/receipt-snapshot'
import type {
  ResidentChargeDetail,
  ResidentChargeLine,
  ResidentChargeView,
  ResidentFeeBatch,
  ResidentFeeBatchDetail,
  ResidentFeeCursor,
  ResidentFeeReader,
  ResidentHistoryRow,
  ResidentOpenCharge,
  ResidentReceiptCursor,
  ResidentReceiptRow,
} from '../../domain/resident-fee-reader'
import { allocation, charge, chargeLine, feeBatch, payment, receipt } from './schema'

/**
 * The resident fee reads of E-80…E-83 (DOC-22 §8.4, DOC-58, DR-40, DR-323). "Open" is an `open` charge of a `published` or
 * `closed` batch (DR-18); the DR-40 window is one filter on `payment.received_at >= startedAt`, and it never touches the open
 * charges. The building day is the caller's, computed once per request (DR-09).
 *
 * `ordinal` is the batch's rank within its fee month: the counter assigns `PH-YYMM-NN` per `(building, 'batch', YYMM)`, so the
 * third dash-field of `fee_batch.code` is that rank (reissue takes the next number, so a corrected batch gets a new ordinal).
 */
export class DrizzleResidentFeeReader implements ResidentFeeReader {
  constructor(private readonly database: Database) {}

  async openCharges(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
    limit: number,
  ): Promise<readonly ResidentOpenCharge[]> {
    const rows = await this.database.executor
      .select({
        id: charge.id,
        amount: charge.amount,
        code: feeBatch.code,
        name: feeBatch.name,
        feeMonth: feeBatch.feeMonth,
        dueDate: feeBatch.dueDate,
        ordinal: ordinalOf(),
        daysPastDue: daysPastDueOf(today),
      })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          eq(charge.status, 'open'),
          inArray(feeBatch.status, ['published', 'closed']),
        ),
      )
      .orderBy(asc(feeBatch.dueDate), asc(charge.id))
      .limit(limit)
    if (rows.length === 0) return []
    const lines = await this.linesOf(
      scope,
      rows.map((row) => row.id),
    )
    return rows.map((row) => ({
      chargeId: row.id,
      batch: batchOf(row),
      amount: money(row.amount),
      dueDate: row.dueDate as LocalDate,
      daysPastDue: Number(row.daysPastDue),
      lines: lines.get(row.id) ?? [],
    }))
  }

  async chargeDetail(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
    chargeId: string,
  ): Promise<ResidentChargeDetail | null> {
    const [row] = await this.database.executor
      .select({
        id: charge.id,
        status: charge.status,
        amount: charge.amount,
        code: feeBatch.code,
        name: feeBatch.name,
        feeMonth: feeBatch.feeMonth,
        dueDate: feeBatch.dueDate,
        publishedAt: feeBatch.publishedAt,
        ordinal: ordinalOf(),
        daysPastDue: daysPastDueOf(today),
        voidedAt: charge.voidedAt,
        receivedAt: payment.receivedAt,
        method: payment.source,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
      })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .leftJoin(
        allocation,
        and(
          eq(allocation.chargeId, charge.id),
          eq(allocation.status, 'live'),
          eq(allocation.buildingId, charge.buildingId),
        ),
      )
      .leftJoin(
        payment,
        and(eq(payment.id, allocation.paymentId), eq(payment.buildingId, charge.buildingId)),
      )
      .leftJoin(
        receipt,
        and(eq(receipt.allocationId, allocation.id), eq(receipt.buildingId, charge.buildingId)),
      )
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          eq(charge.id, chargeId),
          inArray(charge.status, ['open', 'paid', 'void']),
        ),
      )
      .limit(1)
    if (!row) return null
    const status = row.status as ChargeStatus
    const lines = await this.linesOf(scope, [row.id])
    const charged: ResidentChargeView = {
      chargeId: row.id,
      status,
      batch: {
        ...batchOf(row),
        dueDate: row.dueDate as LocalDate,
        publishedAt: row.publishedAt,
      } satisfies ResidentFeeBatchDetail,
      amount: money(row.amount),
      dueDate: row.dueDate as LocalDate,
      daysPastDue: Number(row.daysPastDue),
      lines: lines.get(row.id) ?? [],
      payment:
        status === 'paid' && row.receivedAt
          ? { receivedAt: row.receivedAt, method: row.method as PaymentSource }
          : null,
      receipt:
        status === 'paid' && row.receiptId && row.receiptNumber
          ? { id: row.receiptId, number: row.receiptNumber }
          : null,
    }
    return { charge: charged, visibleFrom: visibleFromOf(status, row.receivedAt, row.voidedAt) }
  }

  async history(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    after: ResidentFeeCursor | undefined,
    limit: number,
  ): Promise<readonly ResidentHistoryRow[]> {
    const keyset = after
      ? sql`(${payment.receivedAt}, ${charge.id}) < (${after.receivedAt.toISOString()}::timestamptz, ${after.chargeId}::uuid)`
      : undefined
    const rows = await this.database.executor
      .select({
        id: charge.id,
        amount: charge.amount,
        code: feeBatch.code,
        name: feeBatch.name,
        feeMonth: feeBatch.feeMonth,
        ordinal: ordinalOf(),
        receivedAt: payment.receivedAt,
        method: payment.source,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
      })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .innerJoin(
        allocation,
        and(
          eq(allocation.chargeId, charge.id),
          eq(allocation.status, 'live'),
          eq(allocation.buildingId, charge.buildingId),
        ),
      )
      .innerJoin(
        payment,
        and(eq(payment.id, allocation.paymentId), eq(payment.buildingId, charge.buildingId)),
      )
      .innerJoin(
        receipt,
        and(eq(receipt.allocationId, allocation.id), eq(receipt.buildingId, charge.buildingId)),
      )
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          eq(charge.status, 'paid'),
          gte(payment.receivedAt, startedAt),
          keyset,
        ),
      )
      .orderBy(desc(payment.receivedAt), desc(charge.id))
      .limit(limit)
    return rows.map((row) => ({
      chargeId: row.id,
      batch: batchOf(row),
      amount: money(row.amount),
      payment: { receivedAt: row.receivedAt, method: row.method as PaymentSource },
      receipt: { id: row.receiptId, number: row.receiptNumber },
    }))
  }

  async openOutstanding(scope: BuildingScope, unitId: string): Promise<Money> {
    const [row] = await this.database.executor
      .select({ total: sql<string>`coalesce(sum(${charge.amount}), 0)::bigint` })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          eq(charge.status, 'open'),
          inArray(feeBatch.status, ['published', 'closed']),
        ),
      )
    return money(Number(row?.total ?? 0))
  }

  async paidInRange(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    timeZone: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Money> {
    const [row] = await this.database.executor
      .select({ total: sql<string>`coalesce(sum(${charge.amount}), 0)::bigint` })
      .from(charge)
      .innerJoin(
        allocation,
        and(
          eq(allocation.chargeId, charge.id),
          eq(allocation.status, 'live'),
          eq(allocation.buildingId, charge.buildingId),
        ),
      )
      .innerJoin(
        payment,
        and(eq(payment.id, allocation.paymentId), eq(payment.buildingId, charge.buildingId)),
      )
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          eq(charge.status, 'paid'),
          gte(payment.receivedAt, startedAt),
          sql`(${payment.receivedAt} AT TIME ZONE ${timeZone})::date >= ${from}::date`,
          sql`(${payment.receivedAt} AT TIME ZONE ${timeZone})::date < ${to}::date`,
        ),
      )
    return money(Number(row?.total ?? 0))
  }

  async receipts(
    scope: BuildingScope,
    unitId: string,
    startedAt: Date,
    after: ResidentReceiptCursor | undefined,
    limit: number,
  ): Promise<readonly ResidentReceiptRow[]> {
    const keyset = after
      ? sql`(${receipt.issuedAt}, ${receipt.id}) < (${after.issuedAt.toISOString()}::timestamptz, ${after.receiptId}::uuid)`
      : undefined
    const rows = await this.database.executor
      .select({
        receiptId: receipt.id,
        number: receipt.number,
        chargeId: receipt.chargeId,
        amount: receipt.amount,
        issuedAt: receipt.issuedAt,
        receivedAt: payment.receivedAt,
        method: payment.source,
        status: receipt.status,
      })
      .from(receipt)
      .innerJoin(
        payment,
        and(eq(payment.id, receipt.paymentId), eq(payment.buildingId, receipt.buildingId)),
      )
      .where(
        and(
          inBuilding(receipt, scope),
          eq(receipt.unitId, unitId),
          gte(payment.receivedAt, startedAt),
          keyset,
        ),
      )
      .orderBy(desc(receipt.issuedAt), desc(receipt.id))
      .limit(limit)
    return rows.map((row) => ({
      receiptId: row.receiptId,
      number: row.number,
      chargeId: row.chargeId,
      amount: money(row.amount),
      issuedAt: row.issuedAt,
      receivedAt: row.receivedAt,
      method: row.method as PaymentSource,
      status: row.status as 'issued' | 'void',
    }))
  }

  /** The lines of the given charges in `position` order, grouped by charge id (two queries, never one per charge). */
  private async linesOf(
    scope: BuildingScope,
    chargeIds: readonly string[],
  ): Promise<Map<string, ResidentChargeLine[]>> {
    if (chargeIds.length === 0) return new Map()
    const rows = await this.database.executor
      .select()
      .from(chargeLine)
      .where(and(inBuilding(chargeLine, scope), inArray(chargeLine.chargeId, [...chargeIds])))
      .orderBy(asc(chargeLine.chargeId), asc(chargeLine.position))
    const byCharge = new Map<string, ResidentChargeLine[]>()
    for (const line of rows) {
      const list = byCharge.get(line.chargeId) ?? []
      list.push({
        position: line.position,
        kind: line.kind as 'fee' | 'adjustment',
        itemName: line.itemName as BilingualName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        note: line.note,
      })
      byCharge.set(line.chargeId, list)
    }
    return byCharge
  }
}

/** The batch of a resident charge as the list and the history read it. */
const batchOf = (row: {
  readonly code: string
  readonly name: unknown
  readonly feeMonth: string
  readonly ordinal: number
}): ResidentFeeBatch => ({
  code: row.code,
  name: row.name as BilingualName,
  feeMonth: row.feeMonth as LocalDate,
  ordinal: Number(row.ordinal),
})

/** `PH-YYMM-NN` → `NN`: the batch's rank within its fee month (the counter assigns it per `(building, 'batch', YYMM)`). */
const ordinalOf = () => sql<number>`split_part(${feeBatch.code}, '-', 3)::int`

/** Signed building days past due: 0 on the due day, negative before it (DOC-22 §8.1). */
const daysPastDueOf = (today: LocalDate) => sql<number>`${today}::date - ${feeBatch.dueDate}`

/** The DR-40 instant of E-81: the payment's `received_at` for `paid`, `charge.voided_at` for `void` (no payment exists). */
const visibleFromOf = (
  status: ChargeStatus,
  receivedAt: Date | null,
  voidedAt: Date | null,
): Date | null => {
  if (status === 'paid') return receivedAt
  if (status === 'void') return voidedAt
  return null
}
