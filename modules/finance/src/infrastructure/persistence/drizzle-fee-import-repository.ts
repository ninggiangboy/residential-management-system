import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm'
import { quantityText } from '../../domain/charge-line'
import type { DraftChargeInsert } from '../../domain/fee-batch'
import type { FeeImportJobRecord, NewFeeImportJob } from '../../domain/fee-import/job'
import type {
  FeeImportCommitted,
  FeeImportCounts,
  FeeImportPreview,
} from '../../domain/fee-import/types'
import type {
  FeeImportJobFilter,
  FeeImportJobSummary,
  FeeImportRepository,
} from '../../domain/fee-import-repository'
import { charge, feeBatch, importJob } from './schema'

/** Rows of one bulk statement (DOC-21 §4.5 step 4). The driver binds no `smallint[]` or `numeric[]`: they travel as `int[]` and `text[]`. */
const CHUNK = 1000

function* chunks<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let from = 0; from < items.length; from += CHUNK) yield items.slice(from, from + CHUNK)
}

type JobRow = typeof importJob.$inferSelect

const batchIdOf = (params: unknown): string => (params as { batchId: string }).batchId

const toJob = (row: JobRow): FeeImportJobRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  kind: 'fee_batch',
  status: row.status as FeeImportJobRecord['status'],
  fileId: row.fileKey,
  fileName: row.fileName,
  batchId: batchIdOf(row.params),
  result: row.result as FeeImportPreview,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  committedAt: row.committedAt,
})

const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`

export class DrizzleFeeImportRepository implements FeeImportRepository {
  constructor(private readonly database: Database) {}

  async insertJob(scope: BuildingScope, job: NewFeeImportJob): Promise<void> {
    await this.database.executor.insert(importJob).values({
      id: job.id,
      buildingId: scope.buildingId,
      kind: 'fee_batch',
      status: job.status,
      fileKey: job.fileId,
      fileName: job.fileName,
      params: { batchId: job.batchId },
      result: job.result,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
    })
  }

  async findJob(scope: BuildingScope, id: string): Promise<FeeImportJobRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(importJob)
      .where(and(inBuilding(importJob, scope), eq(importJob.id, id)))
    return row ? toJob(row) : null
  }

  async claimJob(scope: BuildingScope, id: string, now: Date): Promise<FeeImportJobRecord | null> {
    const [row] = await this.database.executor
      .update(importJob)
      .set({ status: 'committed', committedAt: now })
      .where(
        and(
          inBuilding(importJob, scope),
          eq(importJob.id, id),
          eq(importJob.status, 'validated'),
          sql`${importJob.expiresAt} > ${at(now)}`,
        ),
      )
      .returning()
    return row ? toJob(row) : null
  }

  async recordCommitted(
    scope: BuildingScope,
    id: string,
    committed: FeeImportCommitted,
  ): Promise<void> {
    await this.database.executor
      .update(importJob)
      .set({
        result: sql`${importJob.result} || jsonb_build_object('committed', ${JSON.stringify(committed)}::text::jsonb)`,
      })
      .where(and(inBuilding(importJob, scope), eq(importJob.id, id)))
  }

  async listJobs(scope: BuildingScope, filter: FeeImportJobFilter): Promise<FeeImportJobSummary[]> {
    const now = at(filter.now)
    const conditions: (SQL | undefined)[] = [inBuilding(importJob, scope)]
    // `expired` is derived from `expires_at` as E-73 does, before any job has moved the row.
    if (filter.status === 'validated')
      conditions.push(eq(importJob.status, 'validated'), sql`${importJob.expiresAt} > ${now}`)
    else if (filter.status === 'expired')
      conditions.push(
        or(
          eq(importJob.status, 'expired'),
          and(eq(importJob.status, 'validated'), sql`${importJob.expiresAt} <= ${now}`),
        ),
      )
    else if (filter.status) conditions.push(eq(importJob.status, filter.status))
    if (filter.after) {
      const { createdAt, id } = filter.after
      conditions.push(
        or(
          lt(importJob.createdAt, createdAt),
          and(eq(importJob.createdAt, createdAt), lt(importJob.id, id)),
        ),
      )
    }
    const rows = await this.database.executor
      .select({
        id: importJob.id,
        buildingId: importJob.buildingId,
        status: importJob.status,
        fileKey: importJob.fileKey,
        fileName: importJob.fileName,
        params: importJob.params,
        counts: sql<FeeImportCounts>`${importJob.result}->'counts'`,
        createdBy: importJob.createdBy,
        createdAt: importJob.createdAt,
        expiresAt: importJob.expiresAt,
        committedAt: importJob.committedAt,
      })
      .from(importJob)
      .where(and(...conditions))
      .orderBy(desc(importJob.createdAt), desc(importJob.id))
      .limit(filter.limit + 1)
    return rows.map(({ fileKey, params, status, ...row }) => ({
      ...row,
      kind: 'fee_batch' as const,
      status: status as FeeImportJobSummary['status'],
      fileId: fileKey,
      batchId: batchIdOf(params),
    }))
  }

  async lockDraftBatch(scope: BuildingScope, batchId: string): Promise<number | null> {
    const [row] = await this.database.executor
      .update(feeBatch)
      .set({ version: sql`${feeBatch.version} + 1`, updatedAt: sql`now()` })
      .where(
        and(inBuilding(feeBatch, scope), eq(feeBatch.id, batchId), eq(feeBatch.status, 'draft')),
      )
      .returning({ version: feeBatch.version })
    return row?.version ?? null
  }

  async deleteDraftCharges(scope: BuildingScope, batchId: string): Promise<number> {
    const rows = await this.database.executor
      .delete(charge)
      .where(
        and(inBuilding(charge, scope), eq(charge.batchId, batchId), eq(charge.status, 'draft')),
      )
      .returning({ id: charge.id })
    return rows.length
  }

  async insertDraftCharges(
    scope: BuildingScope,
    charges: readonly DraftChargeInsert[],
  ): Promise<{ readonly charges: number; readonly lines: number }> {
    let written = 0
    for (const part of chunks(charges)) {
      const result = await this.database.executor.execute(sql`
        INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
        SELECT c.id, ${scope.buildingId}::uuid, c.batch_id, c.unit_id, c.unit_code, c.amount, 'draft', 1
          FROM unnest(
                 ${sql.param(part.map((row) => row.id))}::uuid[],
                 ${sql.param(part.map((row) => row.batchId))}::uuid[],
                 ${sql.param(part.map((row) => row.unitId))}::uuid[],
                 ${sql.param(part.map((row) => row.unitCode))}::text[],
                 ${sql.param(part.map((row) => Number(row.amount)))}::bigint[]
               ) AS c(id, batch_id, unit_id, unit_code, amount)`)
      written += result.count
    }
    const lines = charges.flatMap((row) =>
      row.lines.map((line, index) => ({ ...line, chargeId: row.id, position: index + 1 })),
    )
    let linesWritten = 0
    for (const part of chunks(lines)) {
      const result = await this.database.executor.execute(sql`
        INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount, note)
        SELECT l.id, ${scope.buildingId}::uuid, l.charge_id, l.position::smallint, l.kind, l.item_name::jsonb, l.quantity::numeric(12,3),
               l.unit_price, l.amount, l.note
          FROM unnest(
                 ${sql.param(part.map((line) => line.id))}::uuid[],
                 ${sql.param(part.map((line) => line.chargeId))}::uuid[],
                 ${sql.param(part.map((line) => line.position))}::int[],
                 ${sql.param(part.map((line) => line.kind))}::text[],
                 ${sql.param(part.map((line) => JSON.stringify(line.itemName)))}::text[],
                 ${sql.param(part.map((line) => quantityText(line.quantityMilli)))}::text[],
                 ${sql.param(part.map((line) => Number(line.unitPrice)))}::bigint[],
                 ${sql.param(part.map((line) => Number(line.amount)))}::bigint[],
                 ${sql.param(part.map((line) => line.note))}::text[]
               ) AS l(id, charge_id, position, kind, item_name, quantity, unit_price, amount, note)`)
      linesWritten += result.count
    }
    return { charges: written, lines: linesWritten }
  }
}
