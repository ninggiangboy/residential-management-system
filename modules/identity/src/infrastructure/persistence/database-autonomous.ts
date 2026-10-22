import type { Database } from '@core/db'
import type { AutonomousTransaction } from '../../application/ports'

/** `Database.autonomous`: a transaction on a separate pool connection, committed before it returns (DOC-12 §8.1, DR-132). */
export class DatabaseAutonomous implements AutonomousTransaction {
  constructor(private readonly database: Database) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.database.autonomous(fn)
  }
}
