import type { Database } from '@core/db'
import { RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'

/**
 * One token from a bucket of `platform.rate_bucket` (DOC-17 §3.4): one upsert, where a returned row means granted and no row means
 * refused; the refill is computed from the database clock (DOC-16 §4.6). A limit of N per period is a capacity of N and a refill of
 * N / period per second. When refused, `Retry-After` is ceil((1 − tokens) / rate) seconds and the scope names the limit.
 */
export async function takeToken(
  database: Database,
  key: string,
  scope: string,
  capacity: number,
  refillPerSecond: number,
): Promise<void> {
  const granted = await database.executor.execute(sql`
    INSERT INTO platform.rate_bucket AS b (key, tokens, updated_at)
    VALUES (${key}, ${capacity}::float8 - 1, now())
    ON CONFLICT (key) DO UPDATE
       SET tokens = least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${refillPerSecond}::float8) - 1,
           updated_at = now()
     WHERE least(${capacity}::float8, b.tokens + extract(epoch FROM (now() - b.updated_at)) * ${refillPerSecond}::float8) >= 1
    RETURNING tokens`)
  if (granted.length > 0) return
  const [bucket] = await database.executor.execute<{ tokens: number; elapsed: number }>(sql`
    SELECT tokens, extract(epoch FROM (now() - updated_at)) AS elapsed FROM platform.rate_bucket WHERE key = ${key}`)
  const tokens = Math.min(
    capacity,
    Number(bucket?.tokens ?? 0) + Number(bucket?.elapsed ?? 0) * refillPerSecond,
  )
  throw new RateLimitedError(scope, Math.max(1, Math.ceil((1 - tokens) / refillPerSecond)))
}
