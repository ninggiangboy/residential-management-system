import type { JobContext, JobDefinition } from '@core/runtime'
import { type CounterLabels, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import type { PushConfig } from '../../application/push-config'
import type { ExpoReceipt, PushSender } from '../../application/push-sender'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { ClaimedPushTicket } from '../../domain/push-ticket'
import type { PushTicketRepository } from '../../domain/push-ticket-repository'

/** Expo's own limits (DOC-31 §9): a receipt request of at most 1,000 ids, a 24-hour receipt life, a purge batch of 1,000. */
const CLAIM_LIMIT = 1000
const PURGE_BATCH = 1000
const RECEIPT_LIFE_HOURS = 24
/** The 5-minute claim lease: a crash returns the rows to the next run (DOC-31 §7 step 1, DOC-38 §3.2). */
const LEASE_MINUTES = 5

type FailedReason = CounterLabels['delivery_failed_total']['reason']

/** The `details.error` of an Expo receipt to the reason word of DOC-31 §10 / DOC-42 §8.5 (`other` for anything else). */
const FAILED_REASONS: Record<string, FailedReason> = {
  DeviceNotRegistered: 'device_not_registered',
  MessageTooBig: 'message_too_big',
  MessageRateExceeded: 'message_rate_exceeded',
  MismatchSenderId: 'mismatch_sender_id',
  InvalidCredentials: 'invalid_credentials',
}

/**
 * Writes one receipt with `settle` and its side effect (DOC-31 §7 step 3): `ok`; a failure counted and logged; a
 * `DeviceNotRegistered` token deleted (FR-29.6); `InvalidCredentials`/`MismatchSenderId` raise the provider alert. Returns
 * the number of tokens deleted.
 */
async function applyReceipt(
  ctx: JobContext,
  tickets: PushTicketRepository,
  devices: DeviceTokenRepository,
  metrics: MetricsPort,
  ticket: ClaimedPushTicket,
  receipt: ExpoReceipt,
): Promise<number> {
  if (receipt.status === 'ok') {
    await tickets.settle(ticket.id, { status: 'ok', error: null })
    metrics.inc('push_receipts_total', { outcome: 'ok' })
    return 0
  }
  const error = receipt.details?.error ?? receipt.message ?? 'unknown'
  const reason = FAILED_REASONS[error] ?? 'other'
  await tickets.settle(ticket.id, { status: 'failed', error })
  metrics.inc('push_receipts_total', { outcome: 'failed' })
  metrics.inc('delivery_failed_total', { channel: 'push', reason })
  if (reason === 'device_not_registered') {
    const deleted = await devices.deleteByIds([ticket.deviceTokenId])
    ctx.logger.info({ deviceTokenId: ticket.deviceTokenId, reason }, 'device_token_deleted')
    return deleted
  }
  if (reason === 'invalid_credentials' || reason === 'mismatch_sender_id') {
    // The FCM or APNs credentials of the EAS project are wrong (DOC-31 §7, DOC-73).
    metrics.inc('provider_auth_failed_total', { provider: 'push' })
    ctx.logger.error({ provider: 'push', receiptError: error }, 'provider_auth_failed')
    return 0
  }
  ctx.logger.warn({ ticketId: ticket.id, receiptError: error }, 'push_receipt_failed')
  return 0
}

/**
 * `push_receipts`, every 5 minutes in `claim` mode (DOC-31 §7, DOC-38 §4.1; DR-52, DR-301, DR-62). It claims at most 1,000 due
 * tickets with a 5-minute lease, asks Expo for their receipts in one request outside any transaction, writes each outcome
 * (`settle`, a token delete on `DeviceNotRegistered`, `unknown` after 24 h), then purges tickets older than
 * `PUSH_TICKET_RETENTION_DAYS` in batches of 1,000. A failed request ends the run; the lease returns the rows.
 */
export function pushReceiptsJob(
  tickets: PushTicketRepository,
  devices: DeviceTokenRepository,
  sender: PushSender,
  config: PushConfig,
  metrics: MetricsPort = NO_METRICS,
): JobDefinition {
  return {
    name: 'push_receipts',
    schedule: { kind: 'every', seconds: 300 },
    mode: 'claim',
    graceMinutes: 0,
    run: async (ctx) => {
      const counts = { receipts: 0, tokensDeleted: 0, unknown: 0, purged: 0 }
      const claimed = await tickets.claimDue(CLAIM_LIMIT, LEASE_MINUTES)
      if (claimed.length > 0) {
        // One request of at most 1,000 ids, outside any transaction (DOC-31 §7 step 2, DOC-38 §3.4).
        const receipts = await sender.getReceipts(claimed.map((ticket) => ticket.receiptId))
        for (const ticket of claimed) {
          const receipt = receipts[ticket.receiptId]
          // Absent: it stays pending and the lease brings it back (DOC-31 §7 step 3).
          if (!receipt) continue
          counts.receipts += 1
          const deleted = await applyReceipt(ctx, tickets, devices, metrics, ticket, receipt)
          counts.tokensDeleted += deleted
        }
        counts.unknown = await tickets.markUnknownOlderThan(RECEIPT_LIFE_HOURS)
        if (counts.unknown > 0)
          metrics.add('push_receipts_total', counts.unknown, { outcome: 'unknown' })
      }
      for (;;) {
        if (ctx.signal.aborted || ctx.paused()) break
        const purged = await tickets.purgeOlderThan(config.ticketRetentionDays, PURGE_BATCH)
        counts.purged += purged
        if (purged < PURGE_BATCH) break
      }
      const did = counts.receipts + counts.tokensDeleted + counts.unknown + counts.purged
      return { did, details: did > 0 ? counts : {} }
    },
  }
}
