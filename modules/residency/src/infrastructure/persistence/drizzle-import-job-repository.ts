import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm'
import type { ImportPreview } from '../../domain/import/types'
import type { ImportJobRecord, NewImportJob } from '../../domain/import-job'
import type {
  ImportJobFilter,
  ImportJobRepository,
  ImportJobSummary,
} from '../../domain/import-job-repository'
import { importJob } from './schema'

const toRecord = (row: typeof importJob.$inferSelect): ImportJobRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  kind: row.kind as ImportJobRecord['kind'],
  status: row.status as ImportJobRecord['status'],
  fileId: row.fileKey,
  fileName: row.fileName,
  result: row.result as ImportPreview,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  committedAt: row.committedAt,
})

export class DrizzleImportJobRepository implements ImportJobRepository {
  constructor(private readonly database: Database) {}

  async insert(scope: BuildingScope, job: NewImportJob): Promise<void> {
    await this.database.executor.insert(importJob).values({
      id: job.id,
      buildingId: scope.buildingId,
      kind: job.kind,
      status: job.status,
      fileKey: job.fileId,
      fileName: job.fileName,
      result: job.result,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
    })
  }

  async find(scope: BuildingScope, id: string): Promise<ImportJobRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(importJob)
      .where(and(eq(importJob.id, id), eq(importJob.buildingId, scope.buildingId)))
    return row ? toRecord(row) : null
  }

  async claim(scope: BuildingScope, id: string, now: Date): Promise<ImportJobRecord | null> {
    const [row] = await this.database.executor
      .update(importJob)
      .set({ status: 'committed', committedAt: now })
      .where(
        and(
          eq(importJob.id, id),
          eq(importJob.buildingId, scope.buildingId),
          eq(importJob.status, 'validated'),
          sql`${importJob.expiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      )
      .returning()
    return row ? toRecord(row) : null
  }

  async list(scope: BuildingScope, filter: ImportJobFilter): Promise<ImportJobSummary[]> {
    const now = sql`${filter.now.toISOString()}::timestamptz`
    const conditions: (SQL | undefined)[] = [
      eq(importJob.buildingId, scope.buildingId),
      eq(importJob.kind, filter.kind),
    ]
    // `expired` is derived from `expires_at` as E-73 does, before the hourly job has moved the row.
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
        kind: importJob.kind,
        status: importJob.status,
        fileKey: importJob.fileKey,
        fileName: importJob.fileName,
        counts: sql<ImportPreview['counts']>`${importJob.result}->'counts'`,
        createdBy: importJob.createdBy,
        createdAt: importJob.createdAt,
        expiresAt: importJob.expiresAt,
        committedAt: importJob.committedAt,
      })
      .from(importJob)
      .where(and(...conditions))
      .orderBy(desc(importJob.createdAt), desc(importJob.id))
      .limit(filter.limit + 1)
    return rows.map(({ fileKey, ...row }) => ({
      ...row,
      kind: row.kind as ImportJobRecord['kind'],
      status: row.status as ImportJobRecord['status'],
      fileId: fileKey,
    }))
  }

  async expire(scope: BuildingScope, now: Date, limit: number): Promise<ImportJobRecord[]> {
    const due = this.database.executor
      .select({ id: importJob.id })
      .from(importJob)
      .where(
        and(
          eq(importJob.buildingId, scope.buildingId),
          eq(importJob.status, 'validated'),
          sql`${importJob.expiresAt} <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(limit)
    const rows = await this.database.executor
      .update(importJob)
      .set({ status: 'expired' })
      .where(
        and(
          eq(importJob.buildingId, scope.buildingId),
          eq(importJob.status, 'validated'),
          sql`${importJob.id} IN (${due})`,
        ),
      )
      .returning()
    return rows.map(toRecord)
  }

  async purge(scope: BuildingScope, cutoff: Date, limit: number): Promise<ImportJobRecord[]> {
    const old = this.database.executor
      .select({ id: importJob.id })
      .from(importJob)
      .where(
        and(
          eq(importJob.buildingId, scope.buildingId),
          sql`${importJob.createdAt} < ${cutoff.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(importJob.createdAt)
      .limit(limit)
    const rows = await this.database.executor
      .delete(importJob)
      .where(and(eq(importJob.buildingId, scope.buildingId), sql`${importJob.id} IN (${old})`))
      .returning()
    return rows.map(toRecord)
  }
}
