import { AsyncLocalStorage } from 'node:async_hooks'
import type { UnitOfWork } from '@core/core'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// biome-ignore lint/suspicious/noExplicitAny: the schema generic does not matter — only the query builder is used
export type DrizzleDb = PostgresJsDatabase<any>
/** An open Database or transaction — same query builder interface. */
export type Executor = Pick<DrizzleDb, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

/** A Drizzle transaction: an `Executor` that can open a nested transaction, which PostgreSQL runs as a savepoint. */
type Transaction = Executor & { transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> }

export interface DatabaseOptions {
  url: string
  poolMax: number
  prepare: boolean
}

/**
 * ONE connection pool + transaction context shared by all modules. Modules differ only by Postgres schema
 * (a module's tables live in its own schema, with no cross-module FK), so one transaction can span several modules.
 */
export class Database implements UnitOfWork {
  private readonly txStorage = new AsyncLocalStorage<Transaction>()
  readonly client: postgres.Sql
  readonly db: DrizzleDb

  constructor(options: DatabaseOptions) {
    this.client = postgres(options.url, {
      max: options.poolMax,
      prepare: options.prepare,
      onnotice: () => {},
    })
    this.db = drizzle(this.client)
  }

  /** The current transaction if inside `run`, otherwise the pool. */
  get executor(): Executor {
    return this.txStorage.getStore() ?? this.db
  }

  get inTransaction(): boolean {
    return this.txStorage.getStore() !== undefined
  }

  /** When nested, joins the outer transaction (no savepoint). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn()
    return this.transaction(fn)
  }

  /**
   * Begins a transaction. Inside an open one it is a savepoint: if `fn` throws, only its own writes are rolled back and
   * the error propagates, so the caller can catch it and carry on in the outer transaction (DOC-12 §8.1).
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.txStorage.getStore()
    const begin = <R>(body: (tx: Transaction) => Promise<R>) =>
      outer
        ? outer.transaction(body)
        : this.db.transaction((tx) => body(tx as unknown as Transaction))
    return begin((tx) => this.txStorage.run(tx, fn))
  }

  /**
   * Runs `fn` in its own transaction on a separate pool connection, outside the ambient one, and commits it before returning,
   * so its writes survive a rollback of the caller's transaction. Needs a pool of two or more connections (DOC-12 §8.1).
   */
  async autonomous<T>(fn: () => Promise<T>): Promise<T> {
    return this.txStorage.exit(() => this.transaction(fn))
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`)
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 })
  }
}

/** True if the driver error (drizzle wraps it in `cause`) carries one of these SQLSTATE codes. */
export function isPgError(err: unknown, ...codes: string[]): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 3 && current; depth++) {
    const code = (current as { code?: string }).code
    if (code && codes.includes(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Unique violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return isPgError(err, '23505')
}
