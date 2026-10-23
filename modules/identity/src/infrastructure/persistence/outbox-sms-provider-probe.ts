import type { Database } from '@core/db'
import type { Clock } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { SmsProviderProbe } from '../../application/ports'

const WINDOW_MS = 10 * 60_000
const CACHE_MS = 15_000

/**
 * The provider counts as down when `smsDownFailures` commands of the last 10 minutes are failing and none was delivered
 * (DOC-26 §5.4, DR-134, AU-S10). The window holds a few thousand rows at most, so the query scans `identity.outbox_messages`
 * with no index of its own; the answer is cached 15 seconds in the process.
 */
export class OutboxSmsProviderProbe implements SmsProviderProbe {
  private cached: { until: number; down: boolean } | null = null

  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly failuresToBeDown: number,
  ) {}

  async isDown(): Promise<boolean> {
    const now = this.clock.now()
    if (this.cached && this.cached.until > now.getTime()) return this.cached.down
    const since = new Date(now.getTime() - WINDOW_MS)
    const [row] = await this.database.executor.execute<{ failing: number; delivered: number }>(sql`
      SELECT count(*) FILTER (WHERE last_error IS NOT NULL AND published_at IS NULL)::int AS failing,
             count(*) FILTER (WHERE published_at IS NOT NULL)::int AS delivered
        FROM identity.outbox_messages
       WHERE type = 'identity.sms_requested.v1' AND occurred_at > ${since.toISOString()}::timestamptz`)
    const down = (row?.failing ?? 0) >= this.failuresToBeDown && (row?.delivered ?? 0) === 0
    this.cached = { until: now.getTime() + CACHE_MS, down }
    return down
  }
}
