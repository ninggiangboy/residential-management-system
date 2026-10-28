import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import type { NewUsageEvents, UsageEventRepository } from '../../domain/usage-event-repository'

export class DrizzleUsageEventRepository implements UsageEventRepository {
  constructor(private readonly database: Database) {}

  /**
   * DOC-104 §6.3: one `INSERT … SELECT FROM unnest(…)` for the whole batch, no transaction around it. `occurred_at` is the receive
   * time minus `ageMs`, cut to the second; the phone's clock is never read. `duration_s` is `NULL` for every event but `app_close`.
   */
  async insertBatch(scope: BuildingScope, batch: NewUsageEvents): Promise<number> {
    const rows = batch.rows
    const written = await this.database.executor.execute(sql`
      INSERT INTO analytics.usage_event (id, building_id, occurred_at, app, platform, app_version, audience, session_id, event, name, duration_s)
      SELECT e.id, ${scope.buildingId}::uuid,
             date_trunc('second', ${batch.receivedAt.toISOString()}::timestamptz - e.age_ms * interval '1 millisecond'),
             ${batch.app}, ${batch.platform}, ${batch.appVersion}, ${batch.audience}, ${batch.sessionId}::uuid, e.event, e.name, e.duration_s
        FROM unnest(
               ${sql.param(rows.map((row) => row.id))}::uuid[],
               ${sql.param(rows.map((row) => row.event))}::text[],
               ${sql.param(rows.map((row) => row.name))}::text[],
               ${sql.param(rows.map((row) => row.ageMs))}::int[],
               ${sql.param(rows.map((row) => row.durationS))}::int[]
             ) AS e(id, event, name, age_ms, duration_s)`)
    return written.count
  }

  /** DOC-20 §5: raw rows before the cut-off and before the end of the newest rolled-up day of the building. */
  async purgeBefore(scope: BuildingScope, cutoff: Date, timeZone: string): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM analytics.usage_event e
       WHERE e.building_id = ${scope.buildingId}::uuid
         AND e.occurred_at < ${cutoff.toISOString()}::timestamptz
         AND e.occurred_at < ((SELECT max(d.day) FROM analytics.usage_daily d WHERE d.building_id = ${scope.buildingId}::uuid) + 1)::timestamp AT TIME ZONE ${timeZone}`)
    return deleted.count
  }
}
