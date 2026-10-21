import { type Database, isPgError } from '@core/db'
import { sql } from 'drizzle-orm'
import type { JobRunRecord, JobRunStore } from './job'

/** undefined_table / invalid_schema_name: the module that owns `job_run` is not migrated yet, which reads as "no runs". */
const MISSING = ['42P01', '3F000']

/**
 * `building.job_run` through raw SQL (DOC-17 §3.2). The table is created by the migrations of the `building` module; until
 * then a read answers "no runs" and a write fails, which the runner logs and survives.
 */
export class SqlJobRunStore implements JobRunStore {
  constructor(private database: Database) {}

  async record(run: JobRunRecord): Promise<void> {
    await this.database.db.execute(sql`
      insert into building.job_run (id, name, started_at, finished_at, status, details)
      values (${run.id}, ${run.name}, ${run.startedAt.toISOString()}::timestamptz, ${run.finishedAt.toISOString()}::timestamptz, ${run.status}, ${JSON.stringify(run.details)}::jsonb)`)
  }

  async lastSuccesses(): Promise<ReadonlyMap<string, Date>> {
    try {
      const rows = await this.database.db.execute<{ name: string; last_success: string | Date }>(
        sql`select name, max(finished_at) as last_success from building.job_run where status = 'succeeded' group by name`,
      )
      return new Map(rows.map((row) => [row.name, new Date(row.last_success)]))
    } catch (err) {
      if (isPgError(err, ...MISSING)) return new Map()
      throw err
    }
  }
}
