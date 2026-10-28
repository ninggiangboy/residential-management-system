import type { Database } from '@core/db'
import { RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { RateLimiter, RateRule } from '../../application/ports'

/**
 * The token bucket of DOC-16 §4.6 in one upsert, in `platform.rate_bucket` (DR-64): a returned row means granted, no row means
 * refused, and the refill is computed from the database clock. A limit of N per period is a capacity of N and a refill of
 * N / period. The 429 names the scope of the rule (`usage_events`), not the first word of the key.
 */
export class SqlRateLimiter implements RateLimiter {
  constructor(private readonly database: Database) {}

  async take({ key, scope, capacity, perSeconds }: RateRule): Promise<void> {
    const rate = capacity / perSeconds
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
    throw new RateLimitedError(scope, Math.max(1, Math.ceil((1 - tokens) / rate)))
  }
}
