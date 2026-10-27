import type { Database } from '@core/db'
import { sql } from 'drizzle-orm'
import type { DemoResetLimiter, DemoResetLock } from '../../application/ports'
import { takeToken } from '../persistence/sql-token-bucket'

/** The lock of DOC-36 §10.2 and the setting that opens the delete guards of the ledger for the demo building only (DR-243). */
export class SqlDemoResetLock implements DemoResetLock {
  constructor(private readonly database: Database) {}

  async acquire(buildingId: string): Promise<boolean> {
    const [row] = await this.database.executor.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('job:demo_reset')) as locked`,
    )
    if (!row?.locked) return false
    await this.database.executor.execute(
      sql`select set_config('rms.demo_reset', ${buildingId}, true)`,
    )
    return true
  }
}

/** `demo-reset:building:<id>`, one per minute (E-56). */
export class SqlDemoResetLimiter implements DemoResetLimiter {
  constructor(private readonly database: Database) {}

  take(buildingId: string): Promise<void> {
    return takeToken(this.database, `demo-reset:building:${buildingId}`, 'demo-reset', 1, 1 / 60)
  }
}
