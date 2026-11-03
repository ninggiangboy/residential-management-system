import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited, SystemActor } from '@mod/audit/contracts'
import type { BuildingId, BuildingScope, Money } from '@rms/shared-types'
import { FINANCE_EVENTS, type MoneyUnpostedPayload, type PaymentPostedPayload } from '../contracts'
import type { IntentRepository } from '../domain/intent-repository'
import type { LedgerRepository } from '../domain/ledger-repository'
import type {
  GatewayEventOutcome,
  SettlementRepository,
  SettlingIntent,
} from '../domain/settlement-repository'
import type { ChargeAllocator } from './allocation/charge-allocator'
import type { IntentCancellation } from './intent-cancellation'
import type { PayerDirectory, ReceiptBuildingSource } from './ports'
import { type RetryOptions, withSerializationRetry } from './serialization-retry'

/** One authenticated confirmation of a transfer (DOC-23 §2.1); its source has checked it already. */
export interface Confirmation {
  readonly buildingId: BuildingId
  readonly gatewayConfigId: string
  /** The driver's word: `stripe`, `fake`; later `payos` (DOC-24 §2). */
  readonly provider: string
  /** Unique per provider transaction (DOC-24 §4.4). */
  readonly reference: string
  readonly orderCode: number | null
  readonly amount: Money
  readonly paidAt: Date
  readonly source: 'webhook' | 'requery' | 'statement'
  readonly payload: Record<string, unknown>
}

export type SettleOutcome =
  | GatewayEventOutcome
  /** `(provider, reference)` existed: nothing written. */
  | 'already_processed'
  /** The order code belongs to another building: nothing written (DR-282). */
  | 'foreign_building'

export interface SettleResult {
  readonly outcome: SettleOutcome
  readonly gatewayEventId: string | null
  readonly paymentId: string | null
  readonly intentId: string | null
}

/** A `CHECK`-shaped transaction: `run` begins or joins, `transaction` inside an open one is a savepoint (DOC-12 §8.1 item 2). */
export interface SavepointUnitOfWork extends UnitOfWork {
  transaction<T>(fn: () => Promise<T>): Promise<T>
}

/** Thrown inside the savepoint to roll back the claim, the payment and the allocations (DOC-23 §6.1 steps 4 and 5). */
class Unposted extends Error {
  constructor(readonly outcome: GatewayEventOutcome) {
    super(outcome)
  }
}

/**
 * `settle(confirmation)`, the one function for the webhook, the re-query, the cancel handler and the statement path (DOC-23 §6,
 * DR-29, ADR-0008). One transaction at READ COMMITTED, retried whole on `40001`/`40P01` up to 3 times (FR-08.8):
 *
 * 1. the intent of `(buildingId, orderCode)`; none, and another building has the order code → `foreign_building`, nothing written;
 * 2. the `gateway_event` row `ON CONFLICT (provider, reference) DO NOTHING`; no row → `already_processed`; no intent → `unknown_order`;
 * 3. classify: intent `paid` → `duplicate_transfer`, `amount <` → `amount_short`, `amount >` → `amount_over`;
 * 4. under a savepoint, claim the intent `… WHERE status <> 'paid'`; 0 rows → `duplicate_transfer`;
 * 5. the payment and the all-or-nothing allocation of every item's charge; one 0-row charge rolls back to the savepoint and
 *    ends `charge_already_paid` (paid) or `charge_recalled` (void), DR-84 item 2;
 * 6. release the items, cancel the other intents holding the charges (`charge_paid`, DR-283), outcome `posted`,
 *    `finance.payment_posted.v1` and the audit row `finance.payment.post` with actor `system`.
 *
 * Every outcome that leaves an open money-log row writes `finance.money_unposted.v1` (DOC-23 §2.3). It never throws for a
 * business outcome (DOC-42 §7.3); a fourth database failure or any other error throws.
 */
export class Settlement {
  private readonly auditedPost: ReturnType<Settlement['buildAudited']>

  constructor(
    private readonly uow: SavepointUnitOfWork,
    private readonly repo: SettlementRepository,
    private readonly intents: IntentRepository,
    private readonly ledger: LedgerRepository,
    private readonly allocator: ChargeAllocator,
    private readonly cancellation: IntentCancellation,
    private readonly receipts: ReceiptBuildingSource,
    private readonly payers: PayerDirectory,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly retry: RetryOptions = {},
  ) {
    this.auditedPost = this.buildAudited(audited)
  }

  async settle(confirmation: Confirmation): Promise<SettleResult> {
    const started = this.clock.now().getTime()
    const result = await withSerializationRetry(() => this.uow.run(() => this.once(confirmation)), {
      ...this.retry,
      onRetry: (sqlstate, attempt) => {
        this.logger.warn({ event: 'settle.retry', sqlstate, attempt }, 'settle retried')
        this.retry.onRetry?.(sqlstate, attempt)
      },
    })
    this.logger.info(
      {
        event: 'settle.done',
        outcome: result.outcome,
        source: confirmation.source,
        intentId: result.intentId,
        ms: this.clock.now().getTime() - started,
      },
      'settle done',
    )
    return result
  }

  private async once(c: Confirmation): Promise<SettleResult> {
    const scope: BuildingScope = { buildingId: c.buildingId }
    const intent =
      c.orderCode === null ? null : await this.repo.findIntentByOrderCode(scope, c.orderCode)
    if (!intent && c.orderCode !== null && (await this.repo.orderCodeExistsAnywhere(c.orderCode)))
      return { outcome: 'foreign_building', gatewayEventId: null, paymentId: null, intentId: null }
    const eventId = this.ids.next()
    const recorded = await this.repo.recordEvent(scope, {
      id: eventId,
      provider: c.provider,
      reference: c.reference,
      orderCode: c.orderCode,
      amount: c.amount,
      paidAt: c.paidAt,
      source: c.source,
      payload: c.payload,
      intentId: intent?.id ?? null,
      unitId: intent?.unitId ?? null,
    })
    if (!recorded)
      return {
        outcome: 'already_processed',
        gatewayEventId: null,
        paymentId: null,
        intentId: intent?.id ?? null,
      }
    if (!intent) return this.unposted(scope, c, eventId, null, 'unknown_order')
    const classified = classify(intent, c.amount)
    if (classified) return this.unposted(scope, c, eventId, intent.id, classified)
    try {
      const paymentId = await this.uow.transaction(() => this.post(scope, c, eventId, intent))
      return { outcome: 'posted', gatewayEventId: eventId, paymentId, intentId: intent.id }
    } catch (error) {
      if (!(error instanceof Unposted)) throw error
      return this.unposted(scope, c, eventId, intent.id, error.outcome)
    }
  }

  /** Steps 4–6 under the savepoint `settle_money`; an `Unposted` throw rolls all of it back. */
  private async post(
    scope: BuildingScope,
    c: Confirmation,
    eventId: string,
    intent: SettlingIntent,
  ): Promise<string> {
    const actor: SystemActor = { kind: 'system', source: c.source, buildingId: c.buildingId }
    return (await this.auditedPost(actor, scope, c, eventId, intent)).paymentId
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.payment.post',
        object: (out: Posted) => ({ type: 'payment', id: out.paymentId }),
        details: (out: Posted) => ({
          source: out.source,
          amount: out.amount,
          chargeCount: out.chargeCount,
          intentCode: out.intentCode,
          reference: out.reference,
        }),
      },
      async (
        _actor: SystemActor,
        scope: BuildingScope,
        c: Confirmation,
        eventId: string,
        intent: SettlingIntent,
      ) => {
        if (!(await this.repo.claimIntent(scope, intent.id, c.paidAt, c.reference)))
          throw new Unposted('duplicate_transfer')
        const items = await this.repo.intentItems(scope, intent.id)
        const payer = await this.payers.payer(intent.createdBy, intent.unitId)
        const building = await this.receipts.forBuilding(scope.buildingId)
        const paymentId = this.ids.next()
        await this.ledger.insertPayment(scope, {
          id: paymentId,
          unitId: intent.unitId,
          source: 'online',
          amount: intent.amount,
          receivedAt: c.paidAt,
          payerName: payer.name,
          provider: c.provider,
          gatewayReference: c.reference,
          intentId: intent.id,
          clientKey: null,
          recordedBy: null,
          bankReference: null,
          statementLineId: null,
          note: null,
        })
        const allocated = await this.allocator.allocate(
          scope,
          {
            paymentId,
            source: 'online',
            receivedAt: c.paidAt,
            gatewayReference: c.reference,
            bankReference: null,
          },
          items.map((item) => ({ chargeId: item.chargeId, expectedAmount: item.amount })),
          { ...building, payer },
        )
        if (!allocated.ok) {
          const state = await this.ledger.readChargeState(scope, allocated.failed.chargeId)
          throw new Unposted(state?.status === 'void' ? 'charge_recalled' : 'charge_already_paid')
        }
        await this.intents.releaseItems(scope, intent.id)
        const chargeIds = items.map((item) => item.chargeId)
        await this.cancellation.cancelHolding(scope, chargeIds, 'charge_paid')
        await this.repo.setEventOutcome(scope, eventId, 'posted', paymentId)
        const now = this.clock.now()
        await this.outbox.add([
          {
            type: FINANCE_EVENTS.paymentPosted,
            aggregateId: paymentId,
            payload: {
              buildingId: scope.buildingId,
              paymentId,
              unitId: intent.unitId,
              source: 'online',
              payerAccountId: intent.createdBy,
              postedAt: now.toISOString(),
            } satisfies PaymentPostedPayload,
            occurredAt: now,
          },
        ])
        return {
          result: {
            paymentId,
            source: c.source,
            amount: Number(intent.amount),
            chargeCount: chargeIds.length,
            intentCode: intent.code,
            reference: c.reference,
          },
          changes: [],
        }
      },
    )
  }

  /** An open money-log row: the outcome on the event and `finance.money_unposted.v1` to staff (DOC-23 §2.3, FR-09.2). */
  private async unposted(
    scope: BuildingScope,
    c: Confirmation,
    eventId: string,
    intentId: string | null,
    outcome: GatewayEventOutcome,
  ): Promise<SettleResult> {
    await this.repo.setEventOutcome(scope, eventId, outcome, null)
    await this.outbox.add([
      {
        type: FINANCE_EVENTS.moneyUnposted,
        aggregateId: eventId,
        payload: {
          buildingId: scope.buildingId,
          kind: 'gateway_event',
          rowId: eventId,
          outcome,
          amount: Number(c.amount),
          receivedAt: c.paidAt.toISOString(),
        } satisfies MoneyUnpostedPayload,
        occurredAt: this.clock.now(),
      },
    ])
    return { outcome, gatewayEventId: eventId, paymentId: null, intentId }
  }
}

interface Posted {
  readonly paymentId: string
  readonly source: Confirmation['source']
  readonly amount: number
  readonly chargeCount: number
  readonly intentCode: string
  readonly reference: string
}

/** Step 3 (DOC-23 §6.1): the outcomes decided without writing money; `null` when the claim may go on. */
function classify(intent: SettlingIntent, amount: Money): GatewayEventOutcome | null {
  if (intent.status === 'paid') return 'duplicate_transfer'
  if (amount < intent.amount) return 'amount_short'
  if (amount > intent.amount) return 'amount_over'
  return null
}
