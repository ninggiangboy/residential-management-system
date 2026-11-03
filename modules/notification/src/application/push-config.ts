/**
 * The configuration of the Expo push delivery (DOC-31 §9, DR-301). The defaults are the document's; the maintainer reads
 * the environment keys into this object at the composition root and passes it to `SendExpoPush` and the two jobs.
 */
export interface PushConfig {
  /** `PUSH_CHUNK_SIZE` (1…100): messages per Expo request and recipients per `push_requested` message. */
  chunkSize: number
  /** `PUSH_REQUEST_TIMEOUT_MS`: one Expo request, spent by the driver (§6.2 step 6). */
  requestTimeoutMs: number
  /** `PUSH_MAX_AGE_MINUTES` (5…1440): a push request older than this is skipped (§6.2 step 1). */
  maxAgeMinutes: number
  /** `PUSH_RECEIPT_DELAY_MINUTES`: age of a ticket before its receipt is read (§6.2 step 7, §7). */
  receiptDelayMinutes: number
  /** `PUSH_TICKET_RETENTION_DAYS`: `push_receipts` deletes older tickets (§7 step 4). */
  ticketRetentionDays: number
  /** `INBOX_RETENTION_DAYS` (30…730): `inbox_purge` (§4.5). */
  inboxRetentionDays: number
}

/** The defaults of DOC-31 §9. */
export const DEFAULT_PUSH_CONFIG: PushConfig = {
  chunkSize: 100,
  requestTimeoutMs: 10_000,
  maxAgeMinutes: 60,
  receiptDelayMinutes: 15,
  ticketRetentionDays: 3,
  inboxRetentionDays: 180,
}
