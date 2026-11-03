import {
  type Clock,
  type IdGenerator,
  InvariantError,
  type Log,
  type UnitOfWork,
} from '@core/kernel'
import {
  type Envelope,
  type InboxGuard,
  type IntegrationEventHandler,
  RetryLaterError,
} from '@core/messaging'
import type { IdentityApi } from '@mod/identity/contracts'
import { renderNotification } from '@rms/i18n-catalog'
import type { Language, MetricsPort } from '@rms/shared-types'
import { NOTIFICATION_EVENTS, type PushRequestedPayload } from '../../contracts'
import type { PushDevice } from '../../domain/device-token'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { AccountKind } from '../../domain/inbox-entry'
import type { NewPushTicket } from '../../domain/push-ticket'
import type { PushTicketRepository } from '../../domain/push-ticket-repository'
import type { PushConfig } from '../push-config'
import type { ExpoMessage, ExpoTicket, PushSender } from '../push-sender'

const MINUTE_MS = 60_000
/** A payload over this many bytes is a catalog defect: it cannot happen with the catalog's params (§6.2 step 5, §6.3). */
const PAYLOAD_MAX_BYTES = 4096
/** A run starts a new chunk only while less than this much of it has passed; a longer run is given back (§6.2). */
const RUN_BUDGET_MS = 20_000

/** One message with the device it belongs to, so each ticket is recorded against the right row. */
interface Outbound {
  readonly kind: AccountKind
  readonly device: PushDevice
  readonly message: ExpoMessage
}

/**
 * `notification.send_expo_push` (DOC-31 §6.2, DR-301): turns `notification.push_requested.v1` into Expo messages. An account
 * that turned push off, the devices of a dead session and a request older than `maxAgeMinutes` are skipped and counted; the
 * tokens of a dead session are deleted. Messages go out in chunks of `chunkSize`, one request at a time, and each chunk's
 * tickets are recorded in a short transaction, so a retry skips the devices already reached (the anti-join of step 3). The
 * inbox is `afterSideEffect`: a push cannot be rolled back. No token, title, body or param value is ever logged (§10).
 */
export class SendExpoPush implements IntegrationEventHandler {
  readonly name = 'notification.send_expo_push'
  readonly eventType = NOTIFICATION_EVENTS.pushRequested

  constructor(
    private readonly devices: DeviceTokenRepository,
    private readonly tickets: PushTicketRepository,
    private readonly identity: Pick<
      IdentityApi,
      'getResidentAccounts' | 'getStaff' | 'liveSessionIds'
    >,
    private readonly sender: PushSender,
    private readonly inbox: InboxGuard,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly metrics: MetricsPort,
    private readonly config: PushConfig,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const command = message.payload as unknown as PushRequestedPayload
    await this.inbox.afterSideEffect(message.id, this.name, () => this.deliver(message, command))
  }

  private async deliver(message: Envelope, command: PushRequestedPayload): Promise<void> {
    const now = this.clock.now()
    const startedAt = now.getTime()
    // Step 1: the inbox keeps the entry; a push an hour late is only noise.
    const ageMinutes = (now.getTime() - Date.parse(message.occurredAt)) / MINUTE_MS
    if (ageMinutes > this.config.maxAgeMinutes) {
      this.metrics.inc('push_sent_total', { outcome: 'skipped_expired' })
      this.logger.info(
        { event: 'skipped_expired', messageId: message.id, ageMinutes: Math.round(ageMinutes) },
        'skipped_expired',
      )
      return
    }

    // Step 2: the unit each recipient carries, and the resident/staff split for the two contract calls.
    const unitOf = new Map<string, string | null>()
    const residentIds: string[] = []
    const staffIds: string[] = []
    for (const recipient of command.recipients) {
      unitOf.set(`${recipient.accountKind}:${recipient.accountId}`, recipient.unitId)
      if (recipient.accountKind === 'resident') residentIds.push(recipient.accountId)
      else staffIds.push(recipient.accountId)
    }

    const language = new Map<string, Language>()
    const eligible: Record<AccountKind, string[]> = { resident: [], staff: [] }
    if (residentIds.length) {
      for (const account of await this.identity.getResidentAccounts([...new Set(residentIds)])) {
        // Keep an `active` account and a resident in `deletion_requested`; a `deleted` one has no phone to reach.
        if (account.status === 'deleted') continue
        if (!account.pushEnabled) {
          this.metrics.inc('push_sent_total', { outcome: 'skipped_off' })
          continue
        }
        eligible.resident.push(account.accountId)
        language.set(`resident:${account.accountId}`, account.language)
      }
    }
    if (staffIds.length) {
      for (const account of await this.identity.getStaff([...new Set(staffIds)])) {
        if (account.status !== 'active') continue
        if (!account.pushEnabled) {
          this.metrics.inc('push_sent_total', { outcome: 'skipped_off' })
          continue
        }
        eligible.staff.push(account.staffId)
        language.set(`staff:${account.staffId}`, account.language)
      }
    }

    // Step 3: the devices of those accounts with no ticket for this message (the anti-join of OPM-S21).
    const found: Array<{ kind: AccountKind; device: PushDevice }> = []
    for (const kind of ['resident', 'staff'] as const) {
      if (!eligible[kind].length) continue
      for (const device of await this.devices.findForPush(kind, eligible[kind], message.id))
        found.push({ kind, device })
    }

    // Step 4: a device whose session is dead is deleted and skipped (a session that ended with no event).
    const sessionIds = [...new Set(found.map((entry) => entry.device.sessionId))]
    const liveSessions = new Set(
      sessionIds.length ? await this.identity.liveSessionIds(sessionIds) : [],
    )
    const dead = found.filter((entry) => !liveSessions.has(entry.device.sessionId))
    if (dead.length) {
      await this.devices.deleteByIds(dead.map((entry) => entry.device.id))
      for (const entry of dead) {
        this.metrics.inc('push_sent_total', { outcome: 'skipped_session_dead' })
        this.logger.info(
          { event: 'device_token_deleted', deviceTokenId: entry.device.id, reason: 'session_dead' },
          'device_token_deleted',
        )
      }
    }
    const live = found.filter((entry) => liveSessions.has(entry.device.sessionId))

    // An eligible account that ends with no device at all.
    const reached = new Set(live.map((entry) => `${entry.kind}:${entry.device.accountId}`))
    for (const kind of ['resident', 'staff'] as const)
      for (const accountId of eligible[kind])
        if (!reached.has(`${kind}:${accountId}`))
          this.metrics.inc('push_sent_total', { outcome: 'skipped_no_device' })

    // Step 5: one message per device, in the recipient's language, with the three `data` keys (NT-59).
    const outbound: Outbound[] = []
    for (const entry of live) {
      const key = `${entry.kind}:${entry.device.accountId}`
      const { title, body } = renderNotification(
        command.templateKey,
        command.params,
        language.get(key) ?? 'vi',
      )
      const message: ExpoMessage = {
        to: entry.device.expoPushToken,
        title,
        body,
        data: {
          route: command.route,
          unitId: unitOf.get(key) ?? null,
          entityId: command.entityId,
        },
        channelId: command.channel,
        priority: command.channel === 'urgent' ? 'high' : 'default',
        sound: 'default',
      }
      if (encoder.encode(JSON.stringify(message)).length > PAYLOAD_MAX_BYTES)
        throw new InvariantError('a push payload exceeds 4096 bytes')
      outbound.push({ kind: entry.kind, device: entry.device, message })
    }

    // Steps 6 to 8: one request at a time; a new chunk only while the run is young, else give the message back.
    for (let index = 0; index < outbound.length; index += this.config.chunkSize) {
      if (this.clock.now().getTime() - startedAt >= RUN_BUDGET_MS)
        throw new RetryLaterError('the push run exceeded the 20 s budget', 0)
      const chunk = outbound.slice(index, index + this.config.chunkSize)
      const tickets = await this.sender.send(chunk.map((entry) => entry.message))
      await this.record(message, command, chunk, tickets)
    }
  }

  private async record(
    message: Envelope,
    command: PushRequestedPayload,
    chunk: readonly Outbound[],
    tickets: readonly ExpoTicket[],
  ): Promise<void> {
    const nextCheckAt = new Date(
      this.clock.now().getTime() + this.config.receiptDelayMinutes * MINUTE_MS,
    )
    const rows: NewPushTicket[] = []
    const deadTokens: string[] = []
    let accepted = 0
    let errors = 0
    tickets.forEach((ticket, index) => {
      const entry = chunk[index]
      if (!entry) return
      if (ticket.status === 'ok') {
        rows.push({
          id: this.ids.next(),
          messageId: message.id,
          deviceTokenId: entry.device.id,
          accountKind: entry.kind,
          accountId: entry.device.accountId,
          templateKey: command.templateKey,
          sourceKind: command.sourceKind,
          sourceId: command.sourceId,
          receiptId: ticket.id,
          status: 'pending',
          error: null,
          nextCheckAt,
        })
        accepted += 1
        this.metrics.inc('push_sent_total', { outcome: 'accepted' })
        return
      }
      // `ck_push_ticket_shape` wants an error word on a failed ticket, so an answer without `details.error` is `Unknown`.
      const error = ticket.details?.error ?? 'Unknown'
      rows.push({
        id: this.ids.next(),
        messageId: message.id,
        deviceTokenId: entry.device.id,
        accountKind: entry.kind,
        accountId: entry.device.accountId,
        templateKey: command.templateKey,
        sourceKind: command.sourceKind,
        sourceId: command.sourceId,
        receiptId: null,
        status: 'failed',
        error,
        nextCheckAt: null,
      })
      errors += 1
      this.metrics.inc('push_sent_total', { outcome: 'ticket_error' })
      // A token Expo no longer knows: delete it so the next push does not try it again (ER-34, FR-29.6).
      if (error === 'DeviceNotRegistered') {
        deadTokens.push(entry.device.id)
        this.metrics.inc('delivery_failed_total', {
          channel: 'push',
          reason: 'device_not_registered',
        })
      }
    })

    // The tickets and the token deletes of one chunk commit together, with no network call inside (DOC-31 §8).
    await this.uow.run(async () => {
      if (rows.length) await this.tickets.recordMany(rows)
      if (deadTokens.length) await this.devices.deleteByIds(deadTokens)
    })

    this.logger.info(
      {
        event: 'push_sent',
        messageId: message.id,
        templateKey: command.templateKey,
        devices: chunk.length,
        accepted,
        errors,
      },
      'push_sent',
    )
  }
}

const encoder = new TextEncoder()
