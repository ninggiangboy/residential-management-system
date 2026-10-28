/** One token-bucket rule: a limit of N per period is a capacity of N refilled at N / period (DOC-39 §6). */
export interface RateRule {
  /** `usage-events:ip:<ip>` or `usage-events:session:<uuid>`: never an account (DOC-104 §6.1). */
  key: string
  /** The `details.scope` of the 429 (`usage_events`). */
  scope: string
  capacity: number
  perSeconds: number
}

/** `take` spends one token and throws `RateLimitedError` (429) with `Retry-After` when the bucket is empty. */
export interface RateLimiter {
  take(rule: RateRule): Promise<void>
}

/** What `analytics` asks of `building` (its contract: a module reads another through `./contracts`, DOC-12 §4.4). */
export interface BuildingDirectory {
  isDemo(buildingId: string): Promise<boolean>
}

/** The keys of DOC-41 §13A and §7 that the module reads, and the zone of the rollup (`JOBS_TIME_ZONE`, DOC-104 §14 item 11). */
export interface AnalyticsConfig {
  /** `USAGE_ENABLED`. */
  enabled: boolean
  /** `USAGE_RAW_RETENTION_DAYS`. */
  rawRetentionDays: number
  /** `USAGE_DAILY_RETENTION_DAYS`. */
  dailyRetentionDays: number
  /** `USAGE_EVENTS_PER_MINUTE_PER_IP`. */
  eventsPerMinutePerIp: number
  /** `USAGE_EVENTS_PER_HOUR_PER_SESSION`. */
  eventsPerHourPerSession: number
  /** `JOBS_TIME_ZONE`: the zone that defines the day of the rollup. */
  timeZone: string
}
