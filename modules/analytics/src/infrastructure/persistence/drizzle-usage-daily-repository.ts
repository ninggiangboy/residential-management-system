import type { Database } from '@core/db'
import type { BuildingScope, LocalDate } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import type { UsageDailyRepository } from '../../domain/usage-event-repository'

export class DrizzleUsageDailyRepository implements UsageDailyRepository {
  constructor(private readonly database: Database) {}

  /**
   * DOC-104 §7.1: the day is the local day of the building's zone, and the statement recomputes it from the raw rows, so running it
   * again leaves the same rows. `seconds` is the sum of `duration_s` of the `app_close` rows (0 for every other event).
   */
  async rollUp(
    scope: BuildingScope,
    from: LocalDate,
    to: LocalDate,
    timeZone: string,
  ): Promise<number> {
    const upserted = await this.database.executor.execute(sql`
      INSERT INTO analytics.usage_daily (building_id, day, app, platform, audience, event, name, events, sessions, seconds)
      SELECT e.building_id, (e.occurred_at AT TIME ZONE ${timeZone})::date, e.app, e.platform, e.audience, e.event, e.name,
             count(*), count(DISTINCT e.session_id), coalesce(sum(e.duration_s), 0)
        FROM analytics.usage_event e
       WHERE e.building_id = ${scope.buildingId}::uuid
         AND e.occurred_at >= (${from}::timestamp AT TIME ZONE ${timeZone})
         AND e.occurred_at <  (${to}::timestamp AT TIME ZONE ${timeZone})
       GROUP BY 1, 2, 3, 4, 5, 6, 7
      ON CONFLICT (building_id, day, app, platform, audience, event, name)
      DO UPDATE SET events = EXCLUDED.events, sessions = EXCLUDED.sessions, seconds = EXCLUDED.seconds`)
    return upserted.count
  }

  async purgeBefore(scope: BuildingScope, before: LocalDate): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM analytics.usage_daily WHERE building_id = ${scope.buildingId}::uuid AND day < ${before}::date`)
    return deleted.count
  }
}
