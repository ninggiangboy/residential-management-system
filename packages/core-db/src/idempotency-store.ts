import { sql } from 'drizzle-orm'
import type { Database } from './database'

/** Whose key it is (the shape `@core/http` declares; `core-db` may not import it, so the adapter matches it by shape). */
export interface IdempotencyAccount {
  kind: 'staff' | 'resident'
  id: string
}

export interface StoredKey {
  requestHash: string
  status: 'in_progress' | 'completed'
  responseStatus: number | null
  responseBody: unknown
  createdAt: Date
}

/**
 * `platform.idempotency_key` (DOC-17 §3) for the wrapper of `@core/http`. The table is the platform's, with no `building_id`
 * (DOC-14 §5.3 allow-list), and a key belongs to an account, not to a building. Every statement joins the open transaction.
 */
export class SqlIdempotencyStore {
  constructor(private readonly database: Database) {}

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.database.run(fn)
  }

  async claim(account: IdempotencyAccount, key: string, requestHash: string): Promise<boolean> {
    // A conflict with a row another transaction has not committed waits for it: commit gives zero rows, rollback gives one.
    const rows = await this.database.executor.execute(
      sql`INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash)
          VALUES (${account.kind}, ${account.id}, ${key}, ${requestHash})
          ON CONFLICT (account_kind, account_id, key) DO NOTHING
          RETURNING key`,
    )
    return rows.length === 1
  }

  async find(account: IdempotencyAccount, key: string): Promise<StoredKey | null> {
    const [row] = await this.database.executor.execute(
      sql`SELECT request_hash, status, response_status, response_body, created_at
            FROM platform.idempotency_key
           WHERE account_kind = ${account.kind} AND account_id = ${account.id} AND key = ${key}`,
    )
    if (!row) return null
    return {
      requestHash: row.request_hash as string,
      status: row.status as StoredKey['status'],
      responseStatus: row.response_status as number | null,
      responseBody: row.response_body,
      createdAt: new Date(row.created_at as string | Date),
    }
  }

  async complete(
    account: IdempotencyAccount,
    key: string,
    response: { status: number; body: unknown },
  ): Promise<void> {
    await this.database.executor.execute(
      sql`UPDATE platform.idempotency_key
             SET status = 'completed', response_status = ${response.status},
                 response_body = ${JSON.stringify(response.body)}::jsonb
           WHERE account_kind = ${account.kind} AND account_id = ${account.id} AND key = ${key}`,
    )
  }

  async release(account: IdempotencyAccount, key: string, olderThan?: Date): Promise<boolean> {
    const stale = olderThan
      ? sql`AND status = 'in_progress' AND created_at < ${olderThan.toISOString()}::timestamptz`
      : sql``
    const rows = await this.database.executor.execute(
      sql`DELETE FROM platform.idempotency_key
           WHERE account_kind = ${account.kind} AND account_id = ${account.id} AND key = ${key} ${stale}
           RETURNING key`,
    )
    return rows.length === 1
  }

  /** The sweep of DOC-38 §4.2 and DOC-20: keys older than 24 hours go. Returns how many. */
  async purge(olderThan: Date): Promise<number> {
    const rows = await this.database.executor.execute(
      sql`DELETE FROM platform.idempotency_key
           WHERE created_at < ${olderThan.toISOString()}::timestamptz RETURNING key`,
    )
    return rows.length
  }
}
