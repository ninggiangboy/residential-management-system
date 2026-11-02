import { type Database, inBuilding } from '@core/db'
import { InvariantError } from '@core/kernel'
import { type BuildingScope, type ChargeStatus, type Money, money } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import type {
  ChargeState,
  LedgerRepository,
  NewAllocation,
  NewPayment,
  NewReceipt,
} from '../../domain/ledger-repository'
import type { BilingualText, ReceiptCharge, ReceiptLine } from '../../domain/receipt-snapshot'
import { allocation, charge, chargeLine, feeBatch, payment, receipt } from './schema'

/** The lines of a charge in position order, as the receipt snapshot freezes them (DOC-15 §7.3). */
const toReceiptLine = (row: {
  kind: string
  itemName: unknown
  quantity: string
  unitPrice: number
  amount: number
  note: string | null
}): ReceiptLine => ({
  kind: row.kind as ReceiptLine['kind'],
  name: row.itemName as BilingualText,
  quantity: row.quantity,
  unitPrice: row.unitPrice,
  amount: row.amount,
  note: row.note,
})

export class DrizzleLedgerRepository implements LedgerRepository {
  constructor(private readonly database: Database) {}

  async payOpenCharge(scope: BuildingScope, chargeId: string, expected: Money): Promise<boolean> {
    const rows = await this.database.executor
      .update(charge)
      .set({ status: 'paid', version: sql`${charge.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.id, chargeId),
          eq(charge.status, 'open'),
          eq(charge.amount, Number(expected)),
        ),
      )
      .returning({ id: charge.id })
    return rows.length > 0
  }

  async readChargeState(scope: BuildingScope, chargeId: string): Promise<ChargeState | null> {
    const [row] = await this.database.executor
      .select({ chargeId: charge.id, status: charge.status, amount: charge.amount })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.id, chargeId)))
      .limit(1)
    return row
      ? { chargeId: row.chargeId, status: row.status as ChargeStatus, amount: money(row.amount) }
      : null
  }

  async readChargeForReceipt(
    scope: BuildingScope,
    chargeId: string,
  ): Promise<ReceiptCharge | null> {
    const [head] = await this.database.executor
      .select({
        unitId: charge.unitId,
        unitCode: charge.unitCode,
        amount: charge.amount,
        batchId: charge.batchId,
      })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.id, chargeId)))
      .limit(1)
    if (!head) return null
    const [batch] = await this.database.executor
      .select({ code: feeBatch.code, name: feeBatch.name, feeMonth: feeBatch.feeMonth })
      .from(feeBatch)
      .where(and(inBuilding(feeBatch, scope), eq(feeBatch.id, head.batchId)))
      .limit(1)
    if (!batch) throw new InvariantError(`charge ${chargeId} names a batch outside the building`)
    const lines = await this.database.executor
      .select({
        kind: chargeLine.kind,
        itemName: chargeLine.itemName,
        quantity: chargeLine.quantity,
        unitPrice: chargeLine.unitPrice,
        amount: chargeLine.amount,
        note: chargeLine.note,
      })
      .from(chargeLine)
      .where(and(inBuilding(chargeLine, scope), eq(chargeLine.chargeId, chargeId)))
      .orderBy(chargeLine.position)
    return {
      chargeId,
      unitId: head.unitId,
      unitCode: head.unitCode,
      amount: money(head.amount),
      batch: { code: batch.code, name: batch.name as BilingualText, feeMonth: batch.feeMonth },
      lines: lines.map(toReceiptLine),
    }
  }

  async insertAllocation(scope: BuildingScope, a: NewAllocation): Promise<void> {
    await this.database.executor.insert(allocation).values({
      id: a.id,
      buildingId: scope.buildingId,
      paymentId: a.paymentId,
      chargeId: a.chargeId,
      amount: Number(a.amount),
      status: 'live',
    })
  }

  async insertReceipt(scope: BuildingScope, r: NewReceipt): Promise<void> {
    await this.database.executor.insert(receipt).values({
      id: r.id,
      buildingId: scope.buildingId,
      number: r.number,
      allocationId: r.allocationId,
      paymentId: r.paymentId,
      chargeId: r.chargeId,
      unitId: r.unitId,
      amount: Number(r.amount),
      snapshot: r.snapshot,
      status: 'issued',
      issuedAt: r.issuedAt,
    })
  }

  async insertPayment(scope: BuildingScope, p: NewPayment): Promise<void> {
    await this.database.executor.insert(payment).values({
      id: p.id,
      buildingId: scope.buildingId,
      unitId: p.unitId,
      source: p.source,
      amount: Number(p.amount),
      receivedAt: p.receivedAt,
      payerName: p.payerName,
      provider: p.provider,
      gatewayReference: p.gatewayReference,
      intentId: p.intentId,
      bankReference: p.bankReference,
      statementLineId: p.statementLineId,
      clientKey: p.clientKey,
      recordedBy: p.recordedBy,
      note: p.note,
      status: 'posted',
    })
  }
}
