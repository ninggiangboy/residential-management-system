import type { Database } from '@core/db'
import { RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { ReminderRateLimiter } from '../../application/use-cases/send-debt-reminders'

/** The bucket `reminder:account:<id>` in `platform.rate_bucket`, `DEBT_REMINDER_PER_HOUR` per hour (DOC-22 §8.5, DR-64, LG-40). */
export class SqlReminderRateLimiter implements ReminderRateLimiter {
  constructor(
    private readonly database: Database,
    private readonly perHour: number,
  ) {}

  /** The token bucket of DOC-16 §4.6 in one upsert: a returned row is granted, no row is refused. */
  async take(accountId: string): Promise<void> {
    const key = `reminder:account:${accountId}`
    const capacity = this.perHour
    const rate = capacity / 3600
    const granted = await this.database.executor.execute(sql`
      INSERT INTO platform.rate_bucket AS b (key, tokens, updated_at)
      VALUES (${key}, ${capacity}::float8 - 1, now())
      ON CONFLICT (key) DO UPDATE
         SET tokens = least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${rate}::float8) - 1,
             updated_at = now()
       WHERE least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${rate}::float8) >= 1
      RETURNING tokens`)
    if (granted.length > 0) return
    const [row] = await this.database.executor.execute<{ tokens: number; elapsed: number }>(sql`
      SELECT tokens, extract(epoch FROM (now() - updated_at)) AS elapsed FROM platform.rate_bucket WHERE key = ${key}`)
    const tokens = Math.min(capacity, Number(row?.tokens ?? 0) + Number(row?.elapsed ?? 0) * rate)
    throw new RateLimitedError('debt_reminder', Math.max(1, Math.ceil((1 - tokens) / rate)))
  }
}
