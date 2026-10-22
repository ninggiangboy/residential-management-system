import type { Database } from '@core/db'
import { RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { UploadRateLimiter } from '../../application/ports'

/**
 * The bucket `upload:account:<id>` in `platform.rate_bucket`, 60 per hour (DR-64, DOC-17 §3.4). One upsert: a returned row means
 * granted, no row means refused, and the refill is computed from the database clock (DOC-16 §4.6). A limit of N per hour is a
 * capacity of N and a refill of N / 3600 per second.
 */
export class SqlUploadRateLimiter implements UploadRateLimiter {
  constructor(
    private readonly database: Database,
    private readonly perHour: number,
  ) {}

  async take(accountId: string): Promise<void> {
    const key = `upload:account:${accountId}`
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
    const [bucket] = await this.database.executor.execute<{ tokens: number; elapsed: number }>(sql`
      SELECT tokens, extract(epoch FROM (now() - updated_at)) AS elapsed FROM platform.rate_bucket WHERE key = ${key}`)
    const tokens = Math.min(
      capacity,
      Number(bucket?.tokens ?? 0) + Number(bucket?.elapsed ?? 0) * rate,
    )
    // `Retry-After` is ceil((1 − tokens) / rate) seconds (DOC-16 §4.6).
    throw new RateLimitedError('upload', Math.max(1, Math.ceil((1 - tokens) / rate)))
  }
}
