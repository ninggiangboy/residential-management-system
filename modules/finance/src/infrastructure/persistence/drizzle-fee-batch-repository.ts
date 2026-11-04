import { type Database, inBuilding } from '@core/db'
import { InvariantError } from '@core/kernel'
import { type BuildingScope, type LocalDate, type Money, money } from '@rms/shared-types'
import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import { parseQuantityMilli, quantityText } from '../../domain/charge-line'
import type {
  BilingualName,
  ChargeRecord,
  ChargeStatus,
  DraftChargeInsert,
  FeeBatchRecord,
  FeeBatchStatus,
} from '../../domain/fee-batch'
import type {
  BatchChargeItem,
  BatchChargeLine,
  BatchChargeQuery,
  ChargeWithLines,
  FeeBatchListItem,
  FeeBatchListResult,
  FeeBatchPageQuery,
  FeeBatchReader,
  FeeBatchStatusCounts,
  FeeBatchView,
  FeeBatchViewCounts,
} from '../../domain/fee-batch-reader'
import type { DraftChargeSummary, FeeBatchRepository } from '../../domain/fee-batch-repository'
import { toCharge } from './drizzle-charge-repository'
import { charge, chargeLine, type FeeBatchRow, feeBatch, importJob } from './schema'

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

  /** E-89 (DOC-66 §5): one statement per page — the rows with their aggregates — plus the counts on the first page. */
  async listBatches(scope: BuildingScope, page: FeeBatchPageQuery): Promise<FeeBatchListResult> {
    const where = [sql`b.building_id = ${scope.buildingId}`]
    if (page.status) where.push(sql`b.status = ${page.status}`)
    if (page.month) where.push(sql`b.fee_month = ${`${page.month}-01`}::date`)
    if (page.q) {
      const like = contains(page.q)
      where.push(
        sql`(b.code ILIKE ${like} OR b.name->>'vi' ILIKE ${like} OR b.name->>'en' ILIKE ${like})`,
      )
    }
    if (page.after)
      where.push(sql`(b.fee_month, b.id) < (${page.after.feeMonth}::date, ${page.after.id}::uuid)`)
    const rows = (await this.database.executor.execute(sql`
      SELECT b.id, b.code, b.name, b.fee_month::text AS fee_month, b.status, b.due_date::text AS due_date,
             b.created_by, b.version,
             count(c.id)::int AS unit_count,
             coalesce(sum(c.amount) FILTER (WHERE c.status <> 'void'), 0) AS total,
             coalesce(sum(c.amount) FILTER (WHERE c.status = 'paid'), 0) AS collected
        FROM finance.fee_batch b
        LEFT JOIN finance.charge c ON c.batch_id = b.id AND c.building_id = b.building_id
       WHERE ${sql.join(where, sql` AND `)}
       GROUP BY b.id
       ORDER BY b.fee_month DESC, b.id DESC
       LIMIT ${page.limit}`)) as unknown as FeeBatchListRow[]
    const result: {
      rows: FeeBatchListItem[]
      counts?: FeeBatchStatusCounts
      totalCount?: number
    } = { rows: rows.map(toListItem) }
    if (!page.after) {
      const [counts] = (await this.database.executor.execute(sql`
        SELECT count(*) FILTER (WHERE b.status = 'draft')::int AS draft,
               count(*) FILTER (WHERE b.status = 'published')::int AS published,
               count(*) FILTER (WHERE b.status = 'closed')::int AS closed,
               count(*) FILTER (WHERE b.status = 'recalled')::int AS recalled,
               count(*)::int AS total
          FROM finance.fee_batch b
         WHERE b.building_id = ${scope.buildingId}`)) as unknown as FeeBatchCountsRow[]
      result.counts = {
        draft: Number(counts?.draft ?? 0),
        published: Number(counts?.published ?? 0),
        closed: Number(counts?.closed ?? 0),
        recalled: Number(counts?.recalled ?? 0),
      }
      result.totalCount = Number(counts?.total ?? 0)
    }
    return result
  }

  /** E-91 (DOC-66 §5): the header, the counts, the replaces links and the latest committed import. */
  async findBatchView(scope: BuildingScope, batchId: string): Promise<FeeBatchView | null> {
    const [row] = await this.database.executor
      .select()
      .from(feeBatch)
      .where(and(inBuilding(feeBatch, scope), eq(feeBatch.id, batchId)))
    if (!row) return null
    const [counts, replaces, replacedBy, source] = await Promise.all([
      this.viewCounts(scope, batchId),
      row.replacesBatchId ? this.batchRef(scope, row.replacesBatchId) : Promise.resolve(null),
      this.database.executor
        .select({ id: feeBatch.id, code: feeBatch.code })
        .from(feeBatch)
        .where(and(inBuilding(feeBatch, scope), eq(feeBatch.replacesBatchId, batchId)))
        .orderBy(asc(feeBatch.code)),
      this.latestImport(scope, batchId),
    ])
    return {
      id: row.id,
      code: row.code,
      name: row.name as BilingualName,
      feeMonth: row.feeMonth as LocalDate,
      dueDate: row.dueDate as LocalDate,
      status: row.status as FeeBatchStatus,
      version: row.version,
      createdBy: { id: row.createdBy, name: null },
      publishedAt: row.publishedAt,
      replaces,
      replacedBy,
      counts: counts.counts,
      total: counts.total,
      source,
    }
  }

  /** E-93 (DOC-66 §5): one statement per page, ordered `unit_code, id`; the lines join only when asked for. */
  async chargesPage(
    scope: BuildingScope,
    batchId: string,
    page: BatchChargeQuery,
  ): Promise<readonly BatchChargeItem[]> {
    const filters: SQL[] = []
    if (page.status) filters.push(sql`c.status = ${page.status}`)
    if (page.voidKind) filters.push(sql`c.void_kind = ${page.voidKind}`)
    if (page.q) filters.push(sql`c.unit_code ILIKE ${contains(page.q)}`)
    if (page.after)
      filters.push(sql`(c.unit_code, c.id) > (${page.after.unitCode}, ${page.after.id}::uuid)`)
    const more = filters.length > 0 ? sql` AND ${sql.join(filters, sql` AND `)}` : sql``
    const rows = (await this.database.executor.execute(sql`
      SELECT c.id, c.unit_id, c.unit_code, c.amount, c.status, c.void_kind, c.version,
             (SELECT count(*)::int FROM finance.charge_line l WHERE l.charge_id = c.id) AS line_count
        FROM finance.charge c
       WHERE c.building_id = ${scope.buildingId} AND c.batch_id = ${batchId}::uuid${more}
       ORDER BY c.unit_code, c.id
       LIMIT ${page.limit}`)) as unknown as BatchChargeRow[]
    const items = rows.map(toBatchChargeItem)
    if (!page.includeLines || items.length === 0) return items
    const lines = await this.database.executor
      .select()
      .from(chargeLine)
      .where(
        and(
          inBuilding(chargeLine, scope),
          inArray(
            chargeLine.chargeId,
            items.map((item) => item.chargeId),
          ),
        ),
      )
      .orderBy(asc(chargeLine.chargeId), asc(chargeLine.position))
    const byCharge = new Map<string, BatchChargeLine[]>()
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
    return items.map((item) => ({ ...item, lines: byCharge.get(item.chargeId) ?? [] }))
  }

  /** The id and code of a batch in the scope (the `replaces` link of E-91). */
  private async batchRef(
    scope: BuildingScope,
    batchId: string,
  ): Promise<{ readonly id: string; readonly code: string } | null> {
    const [row] = await this.database.executor
      .select({ id: feeBatch.id, code: feeBatch.code })
      .from(feeBatch)
      .where(and(inBuilding(feeBatch, scope), eq(feeBatch.id, batchId)))
    return row ?? null
  }

  /** The counts and the billed total of E-91 in one statement (DOC-66 §5). `missing` is `null`: no port lists owned units. */
  private async viewCounts(
    scope: BuildingScope,
    batchId: string,
  ): Promise<{ readonly counts: FeeBatchViewCounts; readonly total: Money }> {
    const [row] = (await this.database.executor.execute(sql`
      SELECT count(*)::int AS charges,
             count(*) FILTER (WHERE c.status = 'open')::int AS open,
             count(*) FILTER (WHERE c.status = 'paid')::int AS paid,
             count(*) FILTER (WHERE c.status = 'void')::int AS void,
             coalesce(sum(c.amount) FILTER (WHERE c.status <> 'void'), 0) AS total,
             (SELECT count(*)::int FROM finance.charge_line l
                JOIN finance.charge c2 ON c2.id = l.charge_id AND c2.building_id = l.building_id
               WHERE c2.batch_id = ${batchId}::uuid AND c2.building_id = ${scope.buildingId}) AS lines
        FROM finance.charge c
       WHERE c.building_id = ${scope.buildingId} AND c.batch_id = ${batchId}::uuid`)) as unknown as FeeBatchViewCountsRow[]
    return {
      counts: {
        charges: Number(row?.charges ?? 0),
        lines: Number(row?.lines ?? 0),
        open: Number(row?.open ?? 0),
        paid: Number(row?.paid ?? 0),
        void: Number(row?.void ?? 0),
        missing: null,
      },
      total: money(Number(row?.total ?? 0)),
    }
  }

  /** The latest committed fee import of a batch (DOC-21 §4.5, E-91 `source`), or `null` for a hand-built draft. */
  private async latestImport(
    scope: BuildingScope,
    batchId: string,
  ): Promise<{ readonly importedAt: Date } | null> {
    const [row] = await this.database.executor
      .select({ committedAt: importJob.committedAt })
      .from(importJob)
      .where(
        and(
          inBuilding(importJob, scope),
          eq(importJob.status, 'committed'),
          sql`${importJob.params}->>'batchId' = ${batchId}`,
        ),
      )
      .orderBy(desc(importJob.committedAt))
      .limit(1)
    return row?.committedAt ? { importedAt: row.committedAt } : null
  }
}

/** One row of the E-89 query before `Money`/`LocalDate` conversion (DOC-66 §5). */
interface FeeBatchListRow {
  readonly id: string
  readonly code: string
  readonly name: unknown
  readonly fee_month: string
  readonly status: string
  readonly due_date: string
  readonly created_by: string
  readonly version: number
  readonly unit_count: number
  readonly total: string
  readonly collected: string
}

/** The building's batch counts, on the first page of E-89 (DOC-66 §5). */
interface FeeBatchCountsRow {
  readonly draft: number
  readonly published: number
  readonly closed: number
  readonly recalled: number
  readonly total: number
}

/** The counts and billed total of E-91 before conversion (DOC-66 §5). */
interface FeeBatchViewCountsRow {
  readonly charges: number
  readonly lines: number
  readonly open: number
  readonly paid: number
  readonly void: number
  readonly total: string
}

/** One row of the E-93 query before conversion (DOC-66 §5). */
interface BatchChargeRow {
  readonly id: string
  readonly unit_id: string
  readonly unit_code: string
  readonly amount: string
  readonly status: string
  readonly void_kind: string | null
  readonly version: number
  readonly line_count: number
}

const toListItem = (row: FeeBatchListRow): FeeBatchListItem => {
  const total = Number(row.total)
  const collected = Number(row.collected)
  return {
    id: row.id,
    code: row.code,
    name: row.name as BilingualName,
    feeMonth: row.fee_month as LocalDate,
    status: row.status as FeeBatchStatus,
    unitCount: Number(row.unit_count),
    total: money(total),
    collected: money(collected),
    collectedRate: total > 0 ? collected / total : null,
    dueDate: row.due_date as LocalDate,
    createdBy: { id: row.created_by, name: null },
    version: Number(row.version),
  }
}

const toBatchChargeItem = (row: BatchChargeRow): BatchChargeItem => ({
  chargeId: row.id,
  unitId: row.unit_id,
  unitCode: row.unit_code,
  ownerName: null,
  amount: money(Number(row.amount)),
  status: row.status as ChargeStatus,
  voidKind: (row.void_kind as 'recall' | 'single' | null) ?? null,
  version: Number(row.version),
  lineCount: Number(row.line_count),
})

/** `%q%` for a case-insensitive `ILIKE`, its wildcards escaped (`\` is the LIKE escape by default). */
const contains = (q: string): string => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
