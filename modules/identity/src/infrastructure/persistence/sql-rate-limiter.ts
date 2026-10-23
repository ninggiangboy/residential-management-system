import type { Database } from '@core/db'
import { RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { RateLimiter, RateRule } from '../../application/ports'

/**
 * The token bucket of DOC-16 §4.6 in one upsert: a returned row means granted, no row means refused, and the refill is computed
 * from the database clock. A limit of N per period is a capacity of N and a refill of N / period. The unauthenticated families
 * live in `identity.rate_bucket`, so a flood cannot touch the table the rest of the API uses (DR-85); the buckets of a signed-in
 * staff member live in `platform.rate_bucket` (DOC-26 §6).
 */
export class SqlRateLimiter implements RateLimiter {
  constructor(
    private readonly database: Database,
    private readonly table: 'identity.rate_bucket' | 'platform.rate_bucket',
  ) {}

  async take({ key, capacity, perSeconds }: RateRule): Promise<void> {
    const rate = capacity / perSeconds
    const [schema, name] = this.table.split('.') as [string, string]
    const bucket = sql`${sql.identifier(schema)}.${sql.identifier(name)}`
    const granted = await this.database.executor.execute(sql`
      INSERT INTO ${bucket} AS b (key, tokens, updated_at)
      VALUES (${key}, ${capacity}::float8 - 1, now())
      ON CONFLICT (key) DO UPDATE
         SET tokens = least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${rate}::float8) - 1,
             updated_at = now()
       WHERE least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${rate}::float8) >= 1
      RETURNING tokens`)
    if (granted.length > 0) return
    const [row] = await this.database.executor.execute<{ tokens: number; elapsed: number }>(sql`
      SELECT tokens, extract(epoch FROM (now() - updated_at)) AS elapsed FROM ${bucket} WHERE key = ${key}`)
    const tokens = Math.min(capacity, Number(row?.tokens ?? 0) + Number(row?.elapsed ?? 0) * rate)
    // `Retry-After` is ceil((1 − tokens) / rate) seconds (DOC-26 §6).
    throw new RateLimitedError(
      key.split(':')[0] ?? 'identity',
      Math.max(1, Math.ceil((1 - tokens) / rate)),
    )
  }
}
