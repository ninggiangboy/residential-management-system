import type { Database } from '@core/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { IntentReader } from '../../domain/intent-reader'
import { paymentIntent } from './schema'

/** The statuses of an intent whose link may still be paid (DOC-15 §6.1 state machine). */
const ACTIVE = ['creating', 'pending', 'cancelling']

export class DrizzleIntentReader implements IntentReader {
  constructor(private readonly database: Database) {}

  async hasActive(buildingId: string, provider: string): Promise<boolean> {
    const rows = await this.database.executor
      .select({ found: sql<number>`1` })
      .from(paymentIntent)
      .where(
        and(
          eq(paymentIntent.buildingId, buildingId),
          eq(paymentIntent.provider, provider),
          inArray(paymentIntent.status, ACTIVE),
        ),
      )
      .limit(1)
    return rows.length > 0
  }
}
