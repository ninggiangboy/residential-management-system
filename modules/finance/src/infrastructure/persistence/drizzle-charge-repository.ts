import { type Database, inBuilding } from '@core/db'
import { type BuildingScope, type Money, money } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import { type ChargeLine, quantityText } from '../../domain/charge-line'
import type { ChargeRepository } from '../../domain/charge-repository'
import type { ChargeRecord, DraftChargeInsert } from '../../domain/fee-batch'
import { type ChargeRow, charge, chargeLine, feeBatch } from './schema'

export const toCharge = (
  row: ChargeRow,
  batchStatus: ChargeRecord['batchStatus'],
): ChargeRecord => ({
  id: row.id,
  batchId: row.batchId,
  batchStatus,
  unitId: row.unitId,
  unitCode: row.unitCode,
  amount: money(row.amount),
  status: row.status as ChargeRecord['status'],
  version: row.version,
})

/** `finance.charge` and its lines (DOC-15 §5.2, §5.3) with the draft statements of DOC-21 §3.2. */
export class DrizzleChargeRepository implements ChargeRepository {
  constructor(private readonly database: Database) {}

  private async withBatch(
    scope: BuildingScope,
    where: ReturnType<typeof and>,
  ): Promise<ChargeRecord | null> {
    const [row] = await this.database.executor
      .select({ charge, batchStatus: feeBatch.status })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .where(and(inBuilding(charge, scope), where))
    return row ? toCharge(row.charge, row.batchStatus as ChargeRecord['batchStatus']) : null
  }

  find(scope: BuildingScope, chargeId: string): Promise<ChargeRecord | null> {
    return this.withBatch(scope, eq(charge.id, chargeId))
  }

  findInBatch(scope: BuildingScope, batchId: string, unitId: string): Promise<ChargeRecord | null> {
    return this.withBatch(scope, and(eq(charge.batchId, batchId), eq(charge.unitId, unitId)))
  }

  async replaceDraftLines(
    scope: BuildingScope,
    chargeId: string,
    expectedVersion: number,
    amount: Money,
    lines: readonly (ChargeLine & { readonly id: string })[],
  ): Promise<ChargeRecord | null> {
    const [row] = await this.database.executor
      .update(charge)
      .set({ amount: Number(amount), version: sql`${charge.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.id, chargeId),
          eq(charge.status, 'draft'),
          eq(charge.version, expectedVersion),
        ),
      )
      .returning()
    if (!row) return null
    await this.database.executor
      .delete(chargeLine)
      .where(and(inBuilding(chargeLine, scope), eq(chargeLine.chargeId, chargeId)))
    await this.insertLines(scope, chargeId, lines)
    return toCharge(row, 'draft')
  }

  async insertDraft(scope: BuildingScope, draft: DraftChargeInsert): Promise<ChargeRecord> {
    const [row] = await this.database.executor
      .insert(charge)
      .values({
        id: draft.id,
        buildingId: scope.buildingId,
        batchId: draft.batchId,
        unitId: draft.unitId,
        unitCode: draft.unitCode,
        amount: Number(draft.amount),
        status: 'draft',
        version: 1,
      })
      .returning()
    if (!row) throw new Error('charge insert returned no row')
    await this.insertLines(scope, draft.id, draft.lines)
    return toCharge(row, 'draft')
  }

  async deleteDraft(
    scope: BuildingScope,
    chargeId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const rows = await this.database.executor
      .delete(charge)
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.id, chargeId),
          eq(charge.status, 'draft'),
          eq(charge.version, expectedVersion),
        ),
      )
      .returning({ id: charge.id })
    return rows.length === 1
  }

  private async insertLines(
    scope: BuildingScope,
    chargeId: string,
    lines: readonly (ChargeLine & { readonly id: string })[],
  ): Promise<void> {
    if (lines.length === 0) return
    await this.database.executor.insert(chargeLine).values(
      lines.map((line, index) => ({
        id: line.id,
        buildingId: scope.buildingId,
        chargeId,
        position: index + 1,
        kind: line.kind,
        itemName: line.itemName,
        quantity: quantityText(line.quantityMilli),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
        note: line.note,
      })),
    )
  }
}
