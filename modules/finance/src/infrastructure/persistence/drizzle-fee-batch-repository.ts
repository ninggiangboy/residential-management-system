import { type Database, inBuilding } from '@core/db'
import type { BuildingScope, LocalDate } from '@rms/shared-types'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { BilingualName, ChargeRecord, FeeBatchRecord } from '../../domain/fee-batch'
import type { ChargeWithLines, FeeBatchReader } from '../../domain/fee-batch-reader'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { toCharge } from './drizzle-charge-repository'
import { charge, chargeLine, type FeeBatchRow, feeBatch } from './schema'

export const toBatch = (row: FeeBatchRow): FeeBatchRecord => ({
  id: row.id,
  code: row.code,
  name: row.name as BilingualName,
  feeMonth: row.feeMonth as LocalDate,
  dueDate: row.dueDate as LocalDate,
  status: row.status as FeeBatchRecord['status'],
  version: row.version,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
})

/** `finance.fee_batch` (DOC-15 §5.1) with the statements of DOC-21 §3.1, §3.2 and §3.8. */
export class DrizzleFeeBatchRepository implements FeeBatchRepository, FeeBatchReader {
  constructor(private readonly database: Database) {}

  async insert(
    scope: BuildingScope,
    batch: Omit<FeeBatchRecord, 'status' | 'version' | 'createdAt'>,
  ): Promise<FeeBatchRecord> {
    const [row] = await this.database.executor
      .insert(feeBatch)
      .values({ ...batch, buildingId: scope.buildingId, status: 'draft', version: 1 })
      .returning()
    if (!row) throw new Error('fee_batch insert returned no row')
    return toBatch(row)
  }

  async find(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(feeBatch)
      .where(and(inBuilding(feeBatch, scope), eq(feeBatch.id, batchId)))
    return row ? toBatch(row) : null
  }

  findBatch(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord | null> {
    return this.find(scope, batchId)
  }

  async updateDraftHeader(
    scope: BuildingScope,
    batchId: string,
    edit: { readonly name: BilingualName; readonly dueDate: LocalDate },
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null> {
    const [row] = await this.database.executor
      .update(feeBatch)
      .set({
        name: edit.name,
        dueDate: edit.dueDate,
        version: sql`${feeBatch.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(feeBatch, scope),
          eq(feeBatch.id, batchId),
          eq(feeBatch.status, 'draft'),
          eq(feeBatch.version, expectedVersion),
        ),
      )
      .returning()
    return row ? toBatch(row) : null
  }

  async bumpDraftVersion(scope: BuildingScope, batchId: string): Promise<boolean> {
    const rows = await this.database.executor
      .update(feeBatch)
      .set({ version: sql`${feeBatch.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(inBuilding(feeBatch, scope), eq(feeBatch.id, batchId), eq(feeBatch.status, 'draft')),
      )
      .returning({ id: feeBatch.id })
    return rows.length === 1
  }

  async deleteDraft(
    scope: BuildingScope,
    batchId: string,
    expectedVersion: number,
  ): Promise<{ readonly code: string; readonly chargeCount: number } | null> {
    // Counted first, in the same transaction: the cascade removes the charges with the batch (DR-12).
    const [count] = await this.database.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId)))
    const [row] = await this.database.executor
      .delete(feeBatch)
      .where(
        and(
          inBuilding(feeBatch, scope),
          eq(feeBatch.id, batchId),
          eq(feeBatch.status, 'draft'),
          eq(feeBatch.version, expectedVersion),
        ),
      )
      .returning({ code: feeBatch.code })
    return row ? { code: row.code, chargeCount: count?.n ?? 0 } : null
  }

  async chargesOf(scope: BuildingScope, batchId: string): Promise<readonly ChargeWithLines[]> {
    const batch = await this.find(scope, batchId)
    if (!batch) return []
    const charges = await this.database.executor
      .select()
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId)))
      .orderBy(asc(charge.unitCode))
    const lines = await this.database.executor
      .select()
      .from(chargeLine)
      .innerJoin(charge, eq(charge.id, chargeLine.chargeId))
      .where(and(inBuilding(chargeLine, scope), eq(charge.batchId, batchId)))
      .orderBy(asc(chargeLine.chargeId), asc(chargeLine.position))
    const byCharge = new Map<string, ChargeWithLines['lines'][number][]>()
    for (const { charge_line: line } of lines) {
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
    return charges.map((row) => ({
      ...toCharge(row, batch.status as ChargeRecord['batchStatus']),
      lines: byCharge.get(row.id) ?? [],
    }))
  }
}
