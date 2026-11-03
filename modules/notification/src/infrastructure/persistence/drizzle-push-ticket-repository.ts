import type { Database } from '@core/db'
import { sql } from 'drizzle-orm'
import type { ClaimedPushTicket, NewPushTicket, PushReceiptOutcome } from '../../domain/push-ticket'
import type { PushTicketRepository } from '../../domain/push-ticket-repository'

/** One claimed row (DOC-31 §7 step 1, OPM-S22). */
type ClaimedRow = {
  readonly id: string
  readonly receipt_id: string
  readonly device_token_id: string
}

/** `notification.push_ticket` (DOC-17 §6.3, DOC-31 §6.2 step 7, §7); no `building_id` (DOC-14 §5.3). */
export class DrizzlePushTicketRepository implements PushTicketRepository {
  constructor(private readonly database: Database) {}

  /** DOC-31 §6.2 step 7: the tickets of one send request, a device already ticketed for the message skipped (DR-301). */
  async recordMany(rows: readonly NewPushTicket[]): Promise<number> {
    if (rows.length === 0) return 0
    const written = await this.database.executor.execute(sql`
      INSERT INTO notification.push_ticket
        (id, message_id, device_token_id, account_kind, account_id, template_key, source_kind, source_id,
         receipt_id, status, error, next_check_at)
      SELECT r.id, r.message_id, r.device_token_id, r.account_kind, r.account_id, r.template_key,
             r.source_kind, r.source_id, r.receipt_id, r.status, r.error, (r.next_check_at)::timestamptz
        FROM unnest(
               ${sql.param(rows.map((row) => row.id))}::uuid[],
               ${sql.param(rows.map((row) => row.messageId))}::uuid[],
               ${sql.param(rows.map((row) => row.deviceTokenId))}::uuid[],
               ${sql.param(rows.map((row) => row.accountKind))}::text[],
               ${sql.param(rows.map((row) => row.accountId))}::uuid[],
               ${sql.param(rows.map((row) => row.templateKey))}::text[],
               ${sql.param(rows.map((row) => row.sourceKind))}::text[],
               ${sql.param(rows.map((row) => row.sourceId))}::uuid[],
               ${sql.param(rows.map((row) => row.receiptId))}::text[],
               ${sql.param(rows.map((row) => row.status))}::text[],
               ${sql.param(rows.map((row) => row.error))}::text[],
               ${sql.param(rows.map((row) => row.nextCheckAt?.toISOString() ?? null))}::text[]
             ) AS r(id, message_id, device_token_id, account_kind, account_id, template_key, source_kind,
                    source_id, receipt_id, status, error, next_check_at)
      ON CONFLICT ON CONSTRAINT uq_push_ticket_message_device DO NOTHING
      RETURNING id`)
    return written.length
  }

  /** DOC-31 §7 step 1 / OPM-S22: claims up to `limit` due tickets and leases them for `leaseMinutes`. */
  async claimDue(limit: number, leaseMinutes: number): Promise<readonly ClaimedPushTicket[]> {
    const rows = await this.database.executor.execute<ClaimedRow>(sql`
      UPDATE notification.push_ticket
         SET next_check_at = now() + (${leaseMinutes} * interval '1 minute')
       WHERE id IN (SELECT id FROM notification.push_ticket
                     WHERE status = 'pending' AND next_check_at <= now()
                     ORDER BY next_check_at
                     LIMIT ${limit}
                     FOR UPDATE SKIP LOCKED)
      RETURNING id, receipt_id, device_token_id`)
    return rows.map((row) => ({
      id: row.id,
      receiptId: row.receipt_id,
      deviceTokenId: row.device_token_id,
    }))
  }

  /** DOC-31 §7 step 3 / OPM-S22: the conditional update of one pending ticket; `false` when nothing changed. */
  async settle(id: string, outcome: PushReceiptOutcome): Promise<boolean> {
    const rows = await this.database.executor.execute<{ id: string }>(sql`
      UPDATE notification.push_ticket
         SET status = ${outcome.status}, error = ${outcome.error}, checked_at = now()
       WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING id`)
    return rows.length > 0
  }

  /** DOC-31 §7 step 3 / OPM-S23: a pending ticket with no receipt after `hours` becomes `unknown`. */
  async markUnknownOlderThan(hours: number): Promise<number> {
    const rows = await this.database.executor.execute<{ id: string }>(sql`
      UPDATE notification.push_ticket
         SET status = 'unknown', checked_at = now()
       WHERE status = 'pending' AND receipt_id IS NOT NULL
         AND created_at < now() - (${hours} * interval '1 hour')
      RETURNING id`)
    return rows.length
  }

  /** DOC-31 §7 step 4 / OPM-S24: deletes up to `batch` tickets older than `days`; returns how many. */
  async purgeOlderThan(days: number, batch: number): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.push_ticket
       WHERE id = ANY(ARRAY(
         SELECT id FROM notification.push_ticket
          WHERE created_at < now() - (${days} * interval '1 day')
          ORDER BY created_at
          LIMIT ${batch}))`)
    return deleted.count
  }
}
