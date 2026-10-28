import type { AnalyticsConfig, RateLimiter } from './ports'

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 3600
export const USAGE_RATE_SCOPE = 'usage_events'

/**
 * The two buckets of E-173 and E-174 (DOC-104 §6.1, DOC-39 §6), both in `platform.rate_bucket`. The IP bucket is spent before the
 * body is validated, by the route; the session bucket after, because the session id is only known then, by the use case. Neither
 * key holds an account.
 */
export class UsageRateLimits {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly config: Pick<
      AnalyticsConfig,
      'eventsPerMinutePerIp' | 'eventsPerHourPerSession'
    >,
  ) {}

  takeIp(ip: string): Promise<void> {
    return this.limiter.take({
      key: `usage-events:ip:${ip}`,
      scope: USAGE_RATE_SCOPE,
      capacity: this.config.eventsPerMinutePerIp,
      perSeconds: MINUTE_SECONDS,
    })
  }

  takeSession(sessionId: string): Promise<void> {
    return this.limiter.take({
      key: `usage-events:session:${sessionId}`,
      scope: USAGE_RATE_SCOPE,
      capacity: this.config.eventsPerHourPerSession,
      perSeconds: HOUR_SECONDS,
    })
  }
}
