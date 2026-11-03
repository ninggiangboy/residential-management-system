import type { ClaimedPushTicket, NewPushTicket, PushReceiptOutcome } from './push-ticket'

/**
 * `notification.push_ticket` (DOC-17 §6.3, DOC-31 §6.2 step 7, §7). No `building_id`: a ticket belongs to a device of an
 * account that spans buildings (DOC-14 §5.3).
 */
export interface PushTicketRepository {
  /** Records the tickets of one send request, skipping a device already ticketed for the message (DR-301, OPM-S21). */
  recordMany(rows: readonly NewPushTicket[]): Promise<number>
  /** Claims up to `limit` due tickets, leasing them for `leaseMinutes` (DOC-31 §7 step 1, OPM-S22). */
  claimDue(limit: number, leaseMinutes: number): Promise<readonly ClaimedPushTicket[]>
  /** Settles one pending ticket; `false` when a second run changes nothing (DOC-31 §7 step 3, OPM-S22). */
  settle(id: string, outcome: PushReceiptOutcome): Promise<boolean>
  /** Marks a pending ticket with no receipt after `hours` `unknown` (DOC-31 §7 step 3, OPM-S23). */
  markUnknownOlderThan(hours: number): Promise<number>
  /** Deletes up to `batch` tickets older than `days` (DOC-31 §7 step 4, OPM-S24); returns how many. */
  purgeOlderThan(days: number, batch: number): Promise<number>
}
