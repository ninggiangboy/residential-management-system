import type { Clock, DomainEvent, IdGenerator } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import {
  type MetricsPort,
  NO_METRICS,
  NOTIFICATION_TEMPLATES,
  type Params,
  type ParamValue,
  PUSH_CHUNK_SIZE_MAX,
  PUSH_SAFE_PARAMS,
  type TemplateDef,
} from '@rms/shared-types'
import {
  type InboxPlan,
  type InboxRule,
  NOTIFICATION_EVENTS,
  type PushRecipient,
  type PushRequestedPayload,
  type StaffInboxCreatedPayload,
} from '../../contracts'
import type { AccountKind, InboxRecipient, NewInboxEntry } from '../../domain/inbox-entry'
import type { InboxEntryRepository, InsertedInboxEntry } from '../../domain/inbox-entry-repository'
import type { NotificationOutbox } from '../ports'
import type { RecipientResolver } from '../recipient-resolver'
import { scopeOf } from '../scope-of'

/** DOC-31 §4.1 step 4: the insert page of OPM-S13 (`ON CONFLICT … DO NOTHING RETURNING`). */
const INBOX_INSERT_PAGE = 500

/** DOC-31 §9: the `PUSH_CHUNK_SIZE` cap is 100 recipients per message (DR-52, DR-301). */
const PUSH_CHUNK_DEFAULT = PUSH_CHUNK_SIZE_MAX

interface ResolvedPlan {
  readonly plan: InboxPlan
  readonly recipients: InboxRecipient[]
}

interface PushAccount {
  readonly accountKind: AccountKind
  readonly accountId: string
  readonly units: Set<string | null>
}

interface PushGroup {
  readonly plan: InboxPlan
  readonly byAccount: Map<string, PushAccount>
}

type PushChannelValue = 'default' | 'urgent'

/**
 * `CreateInboxEntries` (DOC-31 §1, §4.1): one instance per `InboxRule` of a producer's `integrations/notification.ts`, run in
 * the `transactional` inbox mode (DOC-09 §4.3). In ONE transaction it claims the message, plans the entries, resolves the
 * recipients, inserts the entries and writes the follow-up `staff_inbox_created` and `push_requested` messages; nothing
 * leaves the database in this transaction (DOC-31 §8). Steps 1–7 of §4.1, in order.
 */
export class CreateInboxEntries implements IntegrationEventHandler {
  readonly name: string
  readonly eventType: string

  constructor(
    private readonly rule: InboxRule,
    private readonly recipients: RecipientResolver,
    private readonly entries: InboxEntryRepository,
    private readonly outbox: NotificationOutbox,
    private readonly inbox: InboxGuard,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly metrics: MetricsPort = NO_METRICS,
    private readonly chunkSize: number = PUSH_CHUNK_DEFAULT,
  ) {
    this.name = rule.handler
    this.eventType = rule.event
  }

  async handle(message: Envelope): Promise<void> {
    const buildingId = message.payload.buildingId as string
    await this.inbox.transactional(message.id, this.name, async () => {
      // Step 2: an empty plan list returns after the inbox claim (a mail kind other than step_up_notice, an internal note).
      const plans = this.rule.plan(message.payload, { eventId: message.id, buildingId })
      if (plans.length === 0) return

      // Step 3: resolve every plan before any write; a contract failure rolls the whole transaction back (NT-21).
      const { rows, planOfRow } = this.buildRows(
        await this.resolvePlans(plans, buildingId),
        message.id,
      )
      if (rows.length === 0) return

      // Step 4: only the rows the dedupe key did not already hold go on.
      const inserted = await this.entries.insertMany(scopeOf(buildingId), rows, INBOX_INSERT_PAGE)
      // Steps 5–6: one `staff_inbox_created` per staff row, then the push messages of the returned rows.
      await this.outbox.add(this.followUps(inserted, planOfRow, buildingId))
    })
  }

  private async resolvePlans(
    plans: readonly InboxPlan[],
    buildingId: string,
  ): Promise<ResolvedPlan[]> {
    const resolved: ResolvedPlan[] = []
    for (const plan of plans)
      resolved.push({
        plan,
        recipients: await this.recipients.resolve(plan.recipients, buildingId),
      })
    return resolved
  }

  /** `dedupe_id` is the source id for `'source'`, the envelope id for `'event'` (DOC-31 §4.1 step 4, DR-299). */
  private buildRows(
    resolved: readonly ResolvedPlan[],
    eventId: string,
  ): { rows: NewInboxEntry[]; planOfRow: Map<string, InboxPlan> } {
    const rows: NewInboxEntry[] = []
    const planOfRow = new Map<string, InboxPlan>()
    for (const { plan, recipients } of resolved) {
      const dedupeId = plan.dedupe === 'source' ? plan.source.id : eventId
      for (const recipient of recipients) {
        const id = this.ids.next()
        rows.push({
          id,
          accountKind: recipient.accountKind,
          accountId: recipient.accountId,
          unitId: recipient.unitId,
          templateKey: plan.templateKey,
          params: plan.params,
          sourceKind: plan.source.kind,
          sourceId: plan.source.id,
          dedupeId,
        })
        planOfRow.set(id, plan)
      }
    }
    return { rows, planOfRow }
  }

  private followUps(
    inserted: readonly InsertedInboxEntry[],
    planOfRow: ReadonlyMap<string, InboxPlan>,
    buildingId: string,
  ): DomainEvent[] {
    const now = this.clock.now()
    const events: DomainEvent[] = []
    for (const row of inserted) {
      const plan = planOfRow.get(row.id)
      if (!plan) continue
      // DOC-31 §10: one count per inserted row, labelled by the template key.
      this.metrics.inc('inbox_entries_created_total', { template_key: plan.templateKey })
      if (row.accountKind !== 'staff') continue
      // Step 5: one `notification.staff_inbox_created.v1` per staff entry, so `realtime` sends `inbox.created`.
      events.push({
        type: NOTIFICATION_EVENTS.staffInboxCreated,
        aggregateId: row.accountId,
        payload: {
          buildingId,
          staffId: row.accountId,
          entryId: row.id,
          templateKey: plan.templateKey,
        } satisfies StaffInboxCreatedPayload,
        occurredAt: now,
      })
    }
    // Step 6: the push messages of the rows that were told.
    for (const event of this.buildPush(inserted, planOfRow, buildingId, now)) events.push(event)
    return events
  }

  /**
   * Step 6: group the returned rows by account, per template and source. An account with rows for several units of one source
   * gets one push with `unitId` null (it opens the target in the unit already selected, DOC-31 §4.1 example, NT-12); otherwise
   * the push carries its unit. A chunked message holds at most `chunkSize` recipients (DR-52, DR-301).
   */
  private buildPush(
    inserted: readonly InsertedInboxEntry[],
    planOfRow: ReadonlyMap<string, InboxPlan>,
    buildingId: string,
    now: Date,
  ): DomainEvent[] {
    const groups = new Map<string, PushGroup>()
    for (const row of inserted) {
      const plan = planOfRow.get(row.id)
      if (!plan) continue
      if (NOTIFICATION_TEMPLATES[plan.templateKey].push === false) continue
      const groupKey = `${plan.templateKey}\u0000${plan.source.kind}\u0000${plan.source.id}`
      let group = groups.get(groupKey)
      if (!group) {
        group = { plan, byAccount: new Map() }
        groups.set(groupKey, group)
      }
      const accountKey = `${row.accountKind}\u0000${row.accountId}`
      let account = group.byAccount.get(accountKey)
      if (!account) {
        account = { accountKind: row.accountKind, accountId: row.accountId, units: new Set() }
        group.byAccount.set(accountKey, account)
      }
      account.units.add(row.unitId)
    }

    const events: DomainEvent[] = []
    for (const group of groups.values()) {
      const { plan } = group
      const def = NOTIFICATION_TEMPLATES[plan.templateKey]
      const recipients: PushRecipient[] = [...group.byAccount.values()].map((account) => ({
        accountKind: account.accountKind,
        accountId: account.accountId,
        unitId: account.units.size === 1 ? ([...account.units][0] ?? null) : null,
      }))
      const chunks = chunk(recipients, Math.max(1, this.chunkSize))
      for (const part of chunks)
        events.push({
          type: NOTIFICATION_EVENTS.pushRequested,
          aggregateId: plan.source.id,
          payload: {
            buildingId,
            templateKey: plan.templateKey,
            sourceKind: plan.source.kind,
            sourceId: plan.source.id,
            params: pushSafeParams(plan.params),
            channel: pushChannel(def, plan.urgent === true),
            route: def.target.route,
            entityId: def.target.entity === 'source' ? plan.source.id : null,
            recipients: part,
          } satisfies PushRequestedPayload,
          occurredAt: now,
        })
    }
    return events
  }
}

/** DR-52, DOC-31 §3.3: only the push-safe params reach a pushed text (`noticeTitle` included, `action`/`actorName` not). */
function pushSafeParams(params: Params): Params {
  const safe: Record<string, ParamValue> = {}
  for (const name of PUSH_SAFE_PARAMS) {
    const value = params[name]
    if (value !== undefined) safe[name] = value
  }
  return safe
}

/** `urgent` for `payment.received` (channel `urgent`) and for an urgent notice (`by_notice` + `plan.urgent`), from the catalog. */
function pushChannel(def: TemplateDef, urgent: boolean): PushChannelValue {
  if (def.push === false) return 'default'
  if (def.push.channel === 'urgent') return 'urgent'
  if (def.push.channel === 'by_notice' && urgent) return 'urgent'
  return 'default'
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size))
  return parts
}
