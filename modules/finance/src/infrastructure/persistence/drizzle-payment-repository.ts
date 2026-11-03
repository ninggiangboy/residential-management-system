import { type Database, inBuilding } from '@core/db'
import { InvariantError } from '@core/kernel'
import { type BuildingScope, type ChargeStatus, money } from '@rms/shared-types'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type {
  PayableCharge,
  PaymentRepository,
  PaymentView,
  VoidedPaymentParts,
} from '../../domain/payment-repository'
import {
  allocation,
  charge,
  feeBatch,
  payment,
  paymentIntent,
  paymentIntentItem,
  receipt,
  statementLine,
} from './schema'

/** The intent statuses that still hold a charge, for `activeIntentSince` (DOC-22 §5.2, FR-05.6). */
const HOLDING = ['creating', 'pending', 'cancelling'] as const

/**
 * The Drizzle adapter of `PaymentRepository`: the manual payment reads of DOC-22 §5.2, the statement-line match of step 6,
 * and the five void statements of DOC-22 §6 in order. Every method carries the building scope and runs in the caller's
 * ambient transaction (DOC-15 §7.1).
 */
export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly database: Database) {}

  async readCharges(
    scope: BuildingScope,
    unitId: string,
    chargeIds: readonly string[],
  ): Promise<readonly PayableCharge[]> {
    if (chargeIds.length === 0) return []
    const rows = await this.database.executor
      .select({
        id: charge.id,
        unitId: charge.unitId,
        status: charge.status,
        amount: charge.amount,
        version: charge.version,
        batchCode: feeBatch.code,
        activeIntentSince: paymentIntent.createdAt,
      })
      .from(charge)
      .innerJoin(feeBatch, and(inBuilding(feeBatch, scope), eq(feeBatch.id, charge.batchId)))
      .leftJoin(
        paymentIntentItem,
        and(
          eq(paymentIntentItem.chargeId, charge.id),
          eq(paymentIntentItem.buildingId, charge.buildingId),
          isNull(paymentIntentItem.releasedAt),
        ),
      )
      .leftJoin(
        paymentIntent,
        and(
          eq(paymentIntent.id, paymentIntentItem.intentId),
          inArray(paymentIntent.status, [...HOLDING]),
        ),
      )
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.unitId, unitId),
          inArray(charge.id, [...chargeIds]),
        ),
      )
      .orderBy(asc(charge.id))
    return rows.map((row) => ({
      id: row.id,
      unitId: row.unitId,
      status: row.status as ChargeStatus,
      amount: money(row.amount),
      version: row.version,
      batchCode: row.batchCode,
      activeIntentSince: row.activeIntentSince,
    }))
  }

  async chargeStates(
    scope: BuildingScope,
    chargeIds: readonly string[],
  ): Promise<
    ReadonlyArray<{ readonly chargeId: string; readonly status: string; readonly version: number }>
  > {
    if (chargeIds.length === 0) return []
    return this.database.executor
      .select({ chargeId: charge.id, status: charge.status, version: charge.version })
      .from(charge)
      .where(and(inBuilding(charge, scope), inArray(charge.id, [...chargeIds])))
      .orderBy(asc(charge.id))
  }

  async findByClientKey(scope: BuildingScope, clientKey: string): Promise<PaymentView | null> {
    return this.readPayment(scope, eq(payment.clientKey, clientKey))
  }

  async find(scope: BuildingScope, paymentId: string): Promise<PaymentView | null> {
    return this.readPayment(scope, eq(payment.id, paymentId))
  }

  async matchStatementLine(
    scope: BuildingScope,
    lineId: string,
    paymentId: string,
  ): Promise<boolean> {
    const rows = await this.database.executor
      .update(statementLine)
      .set({ matchStatus: 'matched', paymentId, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(statementLine, scope),
          eq(statementLine.id, lineId),
          eq(statementLine.matchStatus, 'unmatched'),
        ),
      )
      .returning({ id: statementLine.id })
    return rows.length === 1
  }

  /**
   * The void of DOC-22 §6 in its statement order: the payment `posted → void` (only `cash`/`bank_transfer`), its live
   * allocations, their `paid` charges back to `open`, its issued receipts, and a linked statement line back to `unmatched`.
   * `null` when the first update returned 0 rows; throws `InvariantError` when fewer charges reopened than allocations
   * voided, so the caller's transaction rolls back (DOC-22 §6).
   */
  async voidPosted(
    scope: BuildingScope,
    paymentId: string,
    reason: string,
    staffId: string,
  ): Promise<VoidedPaymentParts | null> {
    const voided = await this.database.executor
      .update(payment)
      .set({
        status: 'void',
        voidReason: reason,
        voidedAt: sql`now()`,
        voidedBy: staffId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(payment, scope),
          eq(payment.id, paymentId),
          eq(payment.status, 'posted'),
          inArray(payment.source, ['cash', 'bank_transfer']),
        ),
      )
      .returning({ id: payment.id })
    if (voided.length === 0) return null

    const voidedAllocations = await this.database.executor
      .update(allocation)
      .set({ status: 'void', voidedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(allocation, scope),
          eq(allocation.paymentId, paymentId),
          eq(allocation.status, 'live'),
        ),
      )
      .returning({ chargeId: allocation.chargeId })
    const chargeIds = voidedAllocations.map((row) => row.chargeId).sort()

    if (chargeIds.length > 0) {
      const reopened = await this.database.executor
        .update(charge)
        .set({ status: 'open', version: sql`${charge.version} + 1`, updatedAt: sql`now()` })
        .where(
          and(inBuilding(charge, scope), inArray(charge.id, chargeIds), eq(charge.status, 'paid')),
        )
        .returning({ id: charge.id })
      if (reopened.length !== chargeIds.length)
        throw new InvariantError(
          `payment ${paymentId}: ${chargeIds.length} allocations voided but ${reopened.length} charges reopened`,
        )
    }

    const voidedReceipts = await this.database.executor
      .update(receipt)
      .set({ status: 'void', voidedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(receipt, scope),
          eq(receipt.paymentId, paymentId),
          eq(receipt.status, 'issued'),
        ),
      )
      .returning({ receiptId: receipt.id, number: receipt.number })
    const receipts = voidedReceipts.sort((a, b) => a.number.localeCompare(b.number))

    await this.database.executor
      .update(statementLine)
      .set({ matchStatus: 'unmatched', paymentId: null, updatedAt: sql`now()` })
      .where(and(inBuilding(statementLine, scope), eq(statementLine.paymentId, paymentId)))

    return { chargeIds, receipts }
  }

  /** The payment row and its receipts in ascending `charge_id` order (DOC-22 §5.2). */
  private async readPayment(scope: BuildingScope, where: SQL): Promise<PaymentView | null> {
    const [row] = await this.database.executor
      .select({
        id: payment.id,
        unitId: payment.unitId,
        source: payment.source,
        status: payment.status,
        amount: payment.amount,
        receivedAt: payment.receivedAt,
        payerName: payment.payerName,
      })
      .from(payment)
      .where(and(inBuilding(payment, scope), where))
      .limit(1)
    if (!row) return null
    const receipts = await this.database.executor
      .select({
        receiptId: receipt.id,
        number: receipt.number,
        chargeId: receipt.chargeId,
        amount: receipt.amount,
      })
      .from(receipt)
      .where(and(inBuilding(receipt, scope), eq(receipt.paymentId, row.id)))
      .orderBy(asc(receipt.chargeId))
    return {
      paymentId: row.id,
      unitId: row.unitId,
      source: row.source as PaymentView['source'],
      status: row.status as PaymentView['status'],
      amount: money(row.amount),
      receivedAt: row.receivedAt,
      payerName: row.payerName,
      receipts: receipts.map((r) => ({ ...r, amount: money(r.amount) })),
    }
  }
}
