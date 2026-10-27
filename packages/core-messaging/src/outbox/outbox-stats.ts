import type { Database } from '@core/db'
import { isNull, sql } from 'drizzle-orm'
import type { OutboxSource } from './outbox-relay'

/**
 * What the metrics read from the outboxes (DOC-40 §4.2): per source, the age of the oldest message that is neither published nor
 * dead, and the dead letters. Both are cheap on the small tables the retention leaves (DOC-38 §2.6).
 */
export class OutboxStats {
  constructor(
    private database: Database,
    private sources: readonly OutboxSource[],
  ) {}

  /** `outbox_oldest_unpublished_age_seconds`: 0 when the source has nothing waiting. Uses the clock of the database. */
  oldestUnpublishedAgeSeconds(): Promise<Array<{ source: string; seconds: number }>> {
    return Promise.all(
      this.sources.map(async ({ name, table }) => {
        const [row] = await this.database.db
          .select({
            age: sql<string | null>`extract(epoch from now() - min(${table.occurredAt}))::float8`,
          })
          .from(table)
          .where(sql`${isNull(table.publishedAt)} and ${isNull(table.deadAt)}`)
        return { source: name, seconds: Number(row?.age ?? 0) }
      }),
    )
  }

  /** `outbox_dead_letters`. */
  deadLetters(): Promise<Array<{ source: string; count: number }>> {
    return Promise.all(
      this.sources.map(async ({ name, table }) => {
        const [row] = await this.database.db
          .select({ dead: sql<number>`count(*)::int` })
          .from(table)
          .where(sql`${table.deadAt} is not null`)
        return { source: name, count: row?.dead ?? 0 }
      }),
    )
  }
}
