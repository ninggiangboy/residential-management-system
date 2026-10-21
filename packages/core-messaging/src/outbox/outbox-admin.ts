import type { Database } from '@core/db'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { OutboxSource } from './outbox-relay'

export interface DeadLetter {
  source: string
  id: string
  type: string
  attempts: number
  lastError: string | null
  occurredAt: Date
}

/**
 * What an operator does with dead letters (DOC-38 §2.7, RB-05): read them, requeue them, or discard one after reading it.
 * Requeueing is safe because the inbox blocks every handler that already finished, so only the unfinished ones run again.
 */
export class OutboxAdmin {
  constructor(
    private database: Database,
    private sources: readonly OutboxSource[],
  ) {}

  async listDead(): Promise<DeadLetter[]> {
    const dead: DeadLetter[] = []
    for (const { name, table } of this.sources) {
      const rows = await this.database.db
        .select({
          id: table.id,
          type: table.type,
          attempts: table.attempts,
          lastError: table.lastError,
          occurredAt: table.occurredAt,
        })
        .from(table)
        .where(isNotNull(table.deadAt))
        .orderBy(table.id)
      dead.push(...rows.map((row) => ({ source: name, ...row })))
    }
    return dead
  }

  /** Makes dead rows claimable again, by id or by type; returns how many were requeued. */
  async requeue(match: { id: string } | { type: string }): Promise<number> {
    let count = 0
    for (const { table } of this.sources) {
      const selected = 'id' in match ? eq(table.id, match.id) : eq(table.type, match.type)
      const rows = await this.database.db
        .update(table)
        .set({
          deadAt: null,
          attempts: 0,
          lockedUntil: null,
          lastError: null,
          nextAttemptAt: sql`now()`,
        })
        .where(and(isNotNull(table.deadAt), selected))
        .returning({ id: table.id })
      count += rows.length
    }
    return count
  }

  /** Deletes one dead row after it was read; a row that is not dead is never deleted. */
  async discard(id: string): Promise<number> {
    let count = 0
    for (const { table } of this.sources) {
      const rows = await this.database.db
        .delete(table)
        .where(and(isNotNull(table.deadAt), eq(table.id, id)))
        .returning({ id: table.id })
      count += rows.length
    }
    return count
  }
}
