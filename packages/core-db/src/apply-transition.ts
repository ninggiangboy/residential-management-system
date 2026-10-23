import type { Transition } from '@core/kernel'
import { and, eq, getTableColumns, isNull, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Database } from './database'

type Table = PgTable & { id: PgColumn }

/** A timestamp read back as a `Date` has lost the microseconds PostgreSQL may hold, so it is compared at millisecond precision. */
const same = (column: PgColumn, value: unknown): SQL => {
  if (value === null) return isNull(column)
  if (value instanceof Date)
    return sql`date_trunc('milliseconds', ${column}) = ${value.toISOString()}::timestamptz`
  return eq(column, value)
}

/**
 * The one statement that applies a `Transition` (DR-255): `UPDATE … SET <set> WHERE id = :id AND <each expect column> RETURNING *`.
 * It computes nothing; the rule was decided in the aggregate. The row after the change, or `null` when none matched: the state
 * moved since the aggregate was loaded. `stamp` adds columns the aggregate does not own (`updated_at`); `also` adds a guard
 * outside the transition (the building scope, or a token that is spent only while its family is live).
 */
export async function applyTransition<T extends Table, S extends object>(
  database: Database,
  table: T,
  transition: Transition<S>,
  { stamp = {}, also }: { stamp?: Record<string, unknown>; also?: SQL } = {},
): Promise<T['$inferSelect'] | null> {
  const columns = getTableColumns(table) as Record<string, PgColumn>
  const column = (name: string): PgColumn => {
    const found = columns[name]
    if (!found) throw new Error(`Transition names ${name}, which is not a column of the table`)
    return found
  }
  const guard = Object.entries(transition.expect).map(([name, value]) => same(column(name), value))
  const rows = await database.executor
    .update(table)
    .set({ ...transition.set, ...stamp })
    .where(and(eq(table.id, transition.id), ...guard, also))
    .returning()
  return (rows[0] as T['$inferSelect'] | undefined) ?? null
}
