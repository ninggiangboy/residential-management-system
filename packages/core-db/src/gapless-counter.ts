import { InvariantError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { Database } from './database'

/** Only a bare lower-case schema name may be interpolated as an identifier (DOC-14 §11). */
const SCHEMA_NAME = /^[a-z_]+$/

/**
 * The gapless counter of DOC-12 §9.5: one `document_counter` table per schema (DOC-14 §10).
 * The scope is structural, like `scope.ts`: a core package may not import `@rms/shared-types`.
 */
export interface GaplessCounter {
  /** DOC-12 §9.5 upsert in the caller's transaction; a rollback leaves no gap (DOC-14 §10). */
  next(scope: { readonly buildingId: string }, series: string, period: string): Promise<number>
}

// `document_counter` of DOC-14 §10 through the DOC-12 §9.5 upsert.
// Runs in the caller's transaction; `updated_at = now()` is part of the DO UPDATE.
export class SqlGaplessCounter implements GaplessCounter {
  constructor(
    private readonly database: Database,
    private readonly schema: string,
  ) {
    // A schema name that cannot be interpolated as an identifier is a construction bug.
    if (!SCHEMA_NAME.test(schema))
      throw new InvariantError(`Not a schema name: ${JSON.stringify(schema)}`)
  }

  async next(
    scope: { readonly buildingId: string },
    series: string,
    period: string,
  ): Promise<number> {
    // A counter outside a transaction is a bug: its upsert commits on its own connection.
    // A rollback cannot undo it, so the series would have a gap (DOC-14 §10, DR-10).
    if (!this.database.inTransaction)
      throw new InvariantError('GaplessCounter.next must run inside a transaction')
    const table = sql`${sql.identifier(this.schema)}.${sql.identifier('document_counter')}`
    const [row] = await this.database.executor.execute<{ last: number }>(sql`
      INSERT INTO ${table} (building_id, series, period, last)
      VALUES (${scope.buildingId}, ${series}, ${period}, 1)
      ON CONFLICT (building_id, series, period)
      DO UPDATE SET last = document_counter.last + 1, updated_at = now()
      RETURNING last`)
    if (!row) throw new InvariantError('the document_counter upsert returned no row')
    return row.last
  }
}

/** Builds the counter of a module's schema; the constructor validates the name. */
export const createGaplessCounter = (database: Database, schema: string): GaplessCounter =>
  new SqlGaplessCounter(database, schema)
