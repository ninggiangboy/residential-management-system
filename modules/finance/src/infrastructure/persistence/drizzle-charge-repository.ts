import { type Database, inBuilding } from '@core/db'
import { type BuildingScope, type LocalDate, type Money, money } from '@rms/shared-types'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { type ChargeLine, quantityText } from '../../domain/charge-line'
import type { ChargeNoticeRow, ChargeRepository } from '../../domain/charge-repository'
import type {
  BilingualName,
  ChargeRecord,
  ChargeStatus,
  DraftChargeInsert,
  FeeBatchStatus,
} from '../../domain/fee-batch'
import { allocation, type ChargeRow, charge, chargeLine, feeBatch } from './schema'

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

  /** The one read of the fee notice (DOC-34 §8.1, DR-292): the charge of the scope, its batch and its lines in `position` order. */
  async findForNotice(scope: BuildingScope, chargeId: string): Promise<ChargeNoticeRow | null> {
    const [row] = await this.database.executor
      .select({ charge, batch: feeBatch })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .where(and(inBuilding(charge, scope), eq(charge.id, chargeId)))
      .limit(1)
    if (!row) return null
    const lines = await this.database.executor
      .select()
      .from(chargeLine)
      .where(and(inBuilding(chargeLine, scope), eq(chargeLine.chargeId, chargeId)))
      .orderBy(asc(chargeLine.position))
    return {
      charge: {
        id: row.charge.id,
        unitId: row.charge.unitId,
        unitCode: row.charge.unitCode,
        amount: money(row.charge.amount),
        status: row.charge.status as ChargeStatus,
      },
      batch: {
        id: row.batch.id,
        code: row.batch.code,
        name: row.batch.name as BilingualName,
        feeMonth: row.batch.feeMonth as LocalDate,
        dueDate: row.batch.dueDate as LocalDate,
        publishedAt: row.batch.publishedAt,
        status: row.batch.status as FeeBatchStatus,
      },
      lines: lines.map((line) => ({
        position: line.position,
        kind: line.kind as 'fee' | 'adjustment',
        itemName: line.itemName as BilingualName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        note: line.note,
      })),
    }
  }

  /** The chunk read of DOC-34 §9.2 phase 1/2 (DR-294): the batch's open and paid charges after `afterChargeId`, by id. */
  async listNoticeSources(
    scope: BuildingScope,
    batchId: string,
    afterChargeId: string | null,
    limit: number,
  ): Promise<ChargeNoticeRow[]> {
    const rows = await this.database.executor
      .select({ charge, batch: feeBatch })
      .from(charge)
      .innerJoin(feeBatch, eq(feeBatch.id, charge.batchId))
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.batchId, batchId),
          inArray(charge.status, ['open', 'paid']),
          afterChargeId === null ? undefined : gt(charge.id, afterChargeId),
        ),
      )
      .orderBy(asc(charge.id))
      .limit(limit)
    if (rows.length === 0) return []
    const lines = await this.database.executor
      .select()
      .from(chargeLine)
      .where(
        and(
          inBuilding(chargeLine, scope),
          inArray(
            chargeLine.chargeId,
            rows.map((row) => row.charge.id),
          ),
        ),
      )
      .orderBy(asc(chargeLine.chargeId), asc(chargeLine.position))
    const byCharge = new Map<string, ChargeNoticeRow['lines'][number][]>()
    for (const line of lines) {
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
    return rows.map((row) => ({
      charge: {
        id: row.charge.id,
        unitId: row.charge.unitId,
        unitCode: row.charge.unitCode,
        amount: money(row.charge.amount),
        status: row.charge.status as ChargeStatus,
      },
      batch: {
        id: row.batch.id,
        code: row.batch.code,
        name: row.batch.name as BilingualName,
        feeMonth: row.batch.feeMonth as LocalDate,
        dueDate: row.batch.dueDate as LocalDate,
        publishedAt: row.batch.publishedAt,
        status: row.batch.status as FeeBatchStatus,
      },
      lines: byCharge.get(row.charge.id) ?? [],
    }))
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

  async hasLiveAllocation(scope: BuildingScope, chargeId: string): Promise<boolean> {
    const rows = await this.database.executor
      .select({ id: allocation.id })
      .from(allocation)
      .where(
        and(
          inBuilding(allocation, scope),
          eq(allocation.chargeId, chargeId),
          eq(allocation.status, 'live'),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  async voidOpen(
    scope: BuildingScope,
    chargeId: string,
    reason: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<ChargeRecord | null> {
    const [row] = await this.database.executor
      .update(charge)
      .set({
        status: 'void',
        voidKind: 'single',
        voidReason: reason,
        voidedAt: sql`now()`,
        voidedBy: staffId,
        version: sql`${charge.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(charge, scope),
          eq(charge.id, chargeId),
          eq(charge.status, 'open'),
          eq(charge.version, expectedVersion),
        ),
      )
      .returning()
    // The batch of an open charge is `published` or `closed`; the caller read it before the update.
    return row ? toCharge(row, 'published') : null
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
