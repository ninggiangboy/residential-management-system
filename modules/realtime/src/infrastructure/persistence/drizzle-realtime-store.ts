import type { Database } from '@core/db'
import type { StaffRole } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import type { EventRow, RealtimeStore, ReplayRow } from '../../application/ports'
import type { RealtimeEventType } from '../../contracts'

type ReplayRaw = {
  id: string
  type: string
  data: Record<string, unknown>
  created_at: Date | string
}

/** `realtime.events` for DOC-52 §8 and §9.1. */
export class DrizzleRealtimeStore implements RealtimeStore {
  constructor(private readonly database: Database) {}

  /** The statement of DOC-52 §9.1: the insert and the `pg_notify` in one statement, delivered at commit. */
  // scope-ok: the row carries its own building and the statement only inserts (DOC-52 §9.1)
  async publish(row: EventRow): Promise<boolean> {
    const roles = row.targetRoles === null ? null : `{${row.targetRoles.join(',')}}`
    const rows = await this.database.executor.execute(sql`
      WITH ins AS (
        INSERT INTO realtime.events (id, building_id, source_message_id, type,
                                     target_account_id, target_roles, close_session_id, data)
        VALUES (${row.id}::uuid, ${row.buildingId}::uuid, ${row.sourceMessageId}::uuid, ${row.type},
                ${row.targetAccountId}::uuid, ${roles}::text[], ${row.closeSessionId}::uuid,
                ${JSON.stringify(row.data)}::jsonb)
        ON CONFLICT (source_message_id) DO NOTHING
        RETURNING id, building_id, type, target_account_id, target_roles, close_session_id, data, created_at)
      SELECT pg_notify('realtime', json_build_object(
               'b', building_id, 'a', target_account_id, 'r', target_roles, 'c', close_session_id,
               'm', json_build_object('id', id, 'type', type, 'data', data,
                                      'at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text)
        FROM ins`)
    return rows.length > 0
  }

  async replay(
    scope: { buildingId: string; accountId: string; role: StaffRole },
    lastEventId: string,
    limit: number,
  ): Promise<ReplayRow[]> {
    const rows = await this.database.executor.execute<ReplayRaw>(sql`
      SELECT id, type, data, created_at
        FROM realtime.events
       WHERE building_id = ${scope.buildingId}::uuid
         AND created_at >= uuid_extract_timestamp(${lastEventId}::uuid) - interval '5 seconds'
         AND (target_account_id = ${scope.accountId}::uuid OR ${scope.role} = ANY (target_roles))
       ORDER BY created_at, id
       LIMIT ${limit}`)
    return rows.map((row) => ({
      id: row.id,
      type: row.type as RealtimeEventType,
      data: row.data,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }))
  }

  /** The job `realtime_purge`: a sweep across buildings (DOC-17 §9.1, DR-115). */
  // scope-ok: a retention sweep across buildings, not a read of one building (DOC-20)
  async purgeOlderThan(cutoff: Date, batch: number): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM realtime.events
       WHERE id = ANY(ARRAY(
         SELECT id FROM realtime.events WHERE created_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY created_at LIMIT ${batch}))`)
    return deleted.count
  }
}
