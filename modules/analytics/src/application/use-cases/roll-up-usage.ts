import type { Clock, UnitOfWork } from '@core/kernel'
import { buildingToday } from '@rms/shared-types'
import { rollupWindow, shiftDay } from '../../domain/rollup-window'
import type {
  UsageDailyRepository,
  UsageEventRepository,
} from '../../domain/usage-event-repository'
import type { AnalyticsConfig } from '../ports'
import { scopeOf } from '../scope-of'

export interface RollUpUsageResult {
  rolled: number
  purgedRaw: number
  purgedDaily: number
}

const DAY_MS = 86_400_000

/**
 * `usage_rollup` for one building (DOC-104 §7.1, DOC-20 §5), in one transaction:
 *   1. recompute the last 3 complete local days of `usage_event` into `usage_daily` (an upsert, so it is idempotent and a day
 *      missed by a failed run is made up by the next one);
 *   2. delete the raw rows older than `USAGE_RAW_RETENTION_DAYS`, but only before the end of the newest rolled-up day;
 *   3. delete the rollup rows older than `USAGE_DAILY_RETENTION_DAYS`.
 * The day is the building's local day: the zone is `JOBS_TIME_ZONE`, one building at a time (DOC-104 §14 item 11).
 */
export class RollUpUsage {
  constructor(
    private readonly events: UsageEventRepository,
    private readonly daily: UsageDailyRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: Pick<
      AnalyticsConfig,
      'rawRetentionDays' | 'dailyRetentionDays' | 'timeZone'
    >,
  ) {}

  execute(buildingId: string): Promise<RollUpUsageResult> {
    const now = this.clock.now()
    const zone = this.config.timeZone
    const today = buildingToday(now, zone)
    const window = rollupWindow(today)
    const scope = scopeOf(buildingId)
    return this.uow.run(async () => {
      const rolled = await this.daily.rollUp(scope, window.from, window.to, zone)
      const purgedRaw = await this.events.purgeBefore(
        scope,
        new Date(now.getTime() - this.config.rawRetentionDays * DAY_MS),
        zone,
      )
      const purgedDaily = await this.daily.purgeBefore(
        scope,
        shiftDay(today, -this.config.dailyRetentionDays),
      )
      return { rolled, purgedRaw, purgedDaily }
    })
  }
}
