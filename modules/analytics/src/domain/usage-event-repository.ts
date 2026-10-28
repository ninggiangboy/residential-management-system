import type {
  BuildingScope,
  LocalDate,
  UsageApp,
  UsageAudience,
  UsagePlatform,
} from '@rms/shared-types'
import type { UsageRow } from './usage-batch'

/** The rows of one batch and what is common to them (DOC-104 §6.3). */
export interface NewUsageEvents {
  /** From the `Clock` port: `occurred_at` is this minus `ageMs`, to the second. */
  receivedAt: Date
  app: UsageApp
  platform: UsagePlatform
  appVersion: string
  audience: UsageAudience
  sessionId: string
  rows: readonly UsageRow[]
}

/** `analytics.usage_event` (DOC-17 §9A.1): written once, never updated, deleted by age. */
export interface UsageEventRepository {
  /** One statement for the whole batch; returns the rows written. */
  insertBatch(scope: BuildingScope, batch: NewUsageEvents): Promise<number>
  /**
   * Deletes the raw events older than `cutoff`, but only those before the end of the newest rolled-up day of the building
   * (DOC-20 §5): with nothing rolled up it deletes nothing. `timeZone` is the zone that defines the day.
   */
  purgeBefore(scope: BuildingScope, cutoff: Date, timeZone: string): Promise<number>
}

/** `analytics.usage_daily` (DOC-17 §9A.2): recomputed from the raw rows, so a second run changes nothing. */
export interface UsageDailyRepository {
  /** Recomputes the days `[from, to)` of the building in `timeZone` from the raw rows; returns the rows upserted. */
  rollUp(scope: BuildingScope, from: LocalDate, to: LocalDate, timeZone: string): Promise<number>
  /** Deletes the rollup rows of the days before `before`. */
  purgeBefore(scope: BuildingScope, before: LocalDate): Promise<number>
}
