import { type Database, inBuilding } from '@core/db'
import { InvariantError } from '@core/kernel'
import { type BuildingScope, type LocalDate, money } from '@rms/shared-types'
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { parseQuantityMilli, quantityText } from '../../domain/charge-line'
import type {
  BilingualName,
  ChargeRecord,
  DraftChargeInsert,
  FeeBatchRecord,
} from '../../domain/fee-batch'
import type { ChargeWithLines, FeeBatchReader } from '../../domain/fee-batch-reader'
import type { DraftChargeSummary, FeeBatchRepository } from '../../domain/fee-batch-repository'
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
  replacesBatchId: row.replacesBatchId,
})

/** `finance.fee_batch` (DOC-15 §5.1) with the statements of DOC-21 §3. */
export class DrizzleFeeBatchRepository implements FeeBatchRepository, FeeBatchReader {
  constructor(private readonly database: Database) {}

  async insert(
    scope: BuildingScope,
    batch: Omit<FeeBatchRecord, 'status' | 'version' | 'createdAt'>,
  ): Promise<FeeBatchRecord> {
    const [row] = await this.database.executor
      .insert(feeBatch)
      .values({
        ...batch,
        replacesBatchId: batch.replacesBatchId ?? null,
        buildingId: scope.buildingId,
        status: 'draft',
        version: 1,
      })
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

  async draftChargeSummary(scope: BuildingScope, batchId: string): Promise<DraftChargeSummary> {
    const rows = await this.database.executor
      .select({ unitCode: charge.unitCode, amount: charge.amount })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId)))
    return {
      count: rows.length,
      nonPositive: rows.filter((row) => row.amount <= 0).map((row) => row.unitCode),
    }
  }

  async publish(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<{ readonly batch: FeeBatchRecord; readonly unitIds: readonly string[] } | null> {
    // DOC-15 §5.1: the batch row first (the arbiter of two publishes, FNM-S01), then its charges; one transaction.
    const [row] = await this.database.executor
      .update(feeBatch)
      .set({
        status: 'published',
        publishedAt: sql`now()`,
        publishedBy: staffId,
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
    if (!row) return null
    const opened = await this.database.executor
      .update(charge)
      .set({ status: 'open', version: sql`${charge.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(inBuilding(charge, scope), eq(charge.batchId, batchId), eq(charge.status, 'draft')),
      )
      .returning({ unitId: charge.unitId })
    return { batch: toBatch(row), unitIds: [...new Set(opened.map((c) => c.unitId))] }
  }

  async extendDueDate(
    scope: BuildingScope,
    batchId: string,
    dueDate: LocalDate,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null> {
    // DOC-21 §3.4: the later-date rule is in the statement too, so two racing Managers never move the date backwards.
    const [row] = await this.database.executor
      .update(feeBatch)
      .set({ dueDate, version: sql`${feeBatch.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(feeBatch, scope),
          eq(feeBatch.id, batchId),
          eq(feeBatch.status, 'published'),
          eq(feeBatch.version, expectedVersion),
          sql`${feeBatch.dueDate} < ${dueDate}`,
        ),
      )
      .returning()
    return row ? toBatch(row) : null
  }

  async openChargeUnits(scope: BuildingScope, batchId: string): Promise<readonly string[]> {
    const rows = await this.database.executor
      .select({ unitId: charge.unitId })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId), eq(charge.status, 'open')))
      .groupBy(charge.unitId)
    return rows.map((row) => row.unitId)
  }

  close(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null> {
    return this.leavePublished(scope, batchId, expectedVersion, {
      status: 'closed',
      closedAt: sql`now()`,
      closedBy: staffId,
    })
  }

  markRecalled(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
    expectedVersion: number,
  ): Promise<FeeBatchRecord | null> {
    return this.leavePublished(scope, batchId, expectedVersion, {
      status: 'recalled',
      recalledAt: sql`now()`,
      recalledBy: staffId,
    })
  }

  /** `published → closed | recalled`, `… WHERE status = 'published' AND version = :v` (DOC-21 §3.5 step 1, §3.6). */
  private async leavePublished(
    scope: BuildingScope,
    batchId: string,
    expectedVersion: number,
    change: Parameters<ReturnType<Database['executor']['update']>['set']>[0],
  ): Promise<FeeBatchRecord | null> {
    const [row] = await this.database.executor
      .update(feeBatch)
      .set({ ...change, version: sql`${feeBatch.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          inBuilding(feeBatch, scope),
          eq(feeBatch.id, batchId),
          eq(feeBatch.status, 'published'),
          eq(feeBatch.version, expectedVersion),
        ),
      )
      .returning()
    return row ? toBatch(row) : null
  }

  async countNotVoid(scope: BuildingScope, batchId: string): Promise<number> {
    const [row] = await this.database.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId), ne(charge.status, 'void')))
    return row?.n ?? 0
  }

  async countPaid(scope: BuildingScope, batchId: string): Promise<number> {
    const [row] = await this.database.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId), eq(charge.status, 'paid')))
    return row?.n ?? 0
  }

  async voidOpenCharges(
    scope: BuildingScope,
    batchId: string,
    staffId: string,
  ): Promise<ReadonlyArray<{ readonly chargeId: string; readonly unitId: string }>> {
    const rows = await this.database.executor
      .update(charge)
      .set({
        status: 'void',
        voidKind: 'recall',
        voidedAt: sql`now()`,
        voidedBy: staffId,
        version: sql`${charge.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId), eq(charge.status, 'open')))
      .returning({ chargeId: charge.id, unitId: charge.unitId })
    return rows
  }

  async copyableCharges(
    scope: BuildingScope,
    batchId: string,
    toBatchId: string,
    newId: () => string,
  ): Promise<readonly DraftChargeInsert[]> {
    // DR-265: every charge but one voided alone (`void_kind = 'single'`); a charge voided by the recall is copied.
    const keep = or(isNull(charge.voidKind), ne(charge.voidKind, 'single'))
    const charges = await this.database.executor
      .select({
        id: charge.id,
        unitId: charge.unitId,
        unitCode: charge.unitCode,
        amount: charge.amount,
      })
      .from(charge)
      .where(and(inBuilding(charge, scope), eq(charge.batchId, batchId), keep))
      .orderBy(asc(charge.unitCode))
    if (charges.length === 0) return []
    const lines = await this.database.executor
      .select()
      .from(chargeLine)
      .where(
        and(
          inBuilding(chargeLine, scope),
          inArray(
            chargeLine.chargeId,
            charges.map((c) => c.id),
          ),
        ),
      )
      .orderBy(asc(chargeLine.chargeId), asc(chargeLine.position))
    const byCharge = new Map<string, DraftChargeInsert['lines'][number][]>()
    for (const line of lines) {
      const quantityMilli = parseQuantityMilli(line.quantity)
      if (quantityMilli === null)
        throw new InvariantError(`charge_line ${line.id} has quantity ${line.quantity}`)
      const list = byCharge.get(line.chargeId) ?? []
      list.push({
        id: newId(),
        kind: line.kind as 'fee' | 'adjustment',
        itemName: line.itemName as BilingualName,
        quantityMilli,
        unitPrice: money(line.unitPrice),
        amount: money(line.amount),
        note: line.note,
      })
      byCharge.set(line.chargeId, list)
    }
    return charges.map((c) => ({
      id: newId(),
      batchId: toBatchId,
      unitId: c.unitId,
      unitCode: c.unitCode,
      amount: money(c.amount),
      lines: byCharge.get(c.id) ?? [],
    }))
  }

  async insertDraftCharges(
    scope: BuildingScope,
    charges: readonly DraftChargeInsert[],
  ): Promise<void> {
    if (charges.length === 0) return
    // Parts of 1,000 rows keep each statement under the bind-parameter limit of the driver.
    for (const part of chunks(charges, 1_000)) {
      await this.database.executor.insert(charge).values(
        part.map((c) => ({
          id: c.id,
          buildingId: scope.buildingId,
          batchId: c.batchId,
          unitId: c.unitId,
          unitCode: c.unitCode,
          amount: Number(c.amount),
          status: 'draft',
          version: 1,
        })),
      )
    }
    const lines = charges.flatMap((c) =>
      c.lines.map((line, index) => ({ chargeId: c.id, position: index + 1, line })),
    )
    for (const part of chunks(lines, 1_000))
      await this.database.executor.insert(chargeLine).values(
        part.map(({ chargeId, position, line }) => ({
          id: line.id,
          buildingId: scope.buildingId,
          chargeId,
          position,
          kind: line.kind,
          itemName: line.itemName,
          quantity: quantityText(line.quantityMilli),
          unitPrice: Number(line.unitPrice),
          amount: Number(line.amount),
          note: line.note,
        })),
      )
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

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
