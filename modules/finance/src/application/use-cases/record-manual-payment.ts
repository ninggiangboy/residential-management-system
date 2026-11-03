import {
  type Clock,
  type IdGenerator,
  type Log,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited } from '@mod/audit/contracts'
import {
  type BuildingScope,
  buildingToday,
  type LocalDate,
  type Money,
  money,
  type StaffContext,
  type StaffRole,
} from '@rms/shared-types'
import { FINANCE_EVENTS, type PaymentPostedPayload } from '../../contracts'
import {
  AllocationMismatchError,
  ChargeChangedError,
  InvalidTransitionError,
} from '../../domain/errors'
import type { LedgerRepository } from '../../domain/ledger-repository'
import {
  type CheckedManualPayment,
  checkManualPayment,
  type ManualPaymentInput,
  receivedAtOf,
} from '../../domain/manual-payment'
import type { PayableCharge, PaymentRepository, PaymentView } from '../../domain/payment-repository'
import type { ChargeAllocator } from '../allocation/charge-allocator'
import type { IntentCancellation } from '../intent-cancellation'
import type { BuildingCalendar, ReceiptBuildingSource } from '../ports'
import { type RetryOptions, withSerializationRetry } from '../serialization-retry'

/** The Manager's and the Admin's (DOC-22 §5, FR-05, DR-23): a Technician or a Guard is 403. */
export const RECORD_MANUAL_PAYMENT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * The answer of E-104 (DOC-22 §5.2, §5.3): a posted payment, with `replayed` for the repeat of one `Idempotency-Key`
 * (FR-05.4), or the plan of a dry run, which writes nothing and never reserves a receipt number (DR-267 item 3).
 */
export type ManualPaymentResult =
  | { readonly kind: 'posted'; readonly replayed: boolean; readonly payment: PaymentView }
  | {
      readonly kind: 'dry_run'
      readonly amount: Money
      readonly lines: ReadonlyArray<{
        readonly chargeId: string
        readonly batchCode: string
        readonly amount: Money
      }>
      readonly receiptCount: number
      readonly warnings: ReadonlyArray<{
        readonly chargeId: string
        readonly code: 'active_intent'
        readonly since: Date
      }>
    }

/** Step 3's read of DOC-22 §5.2: the selected charges and their sum. */
interface Planned {
  readonly charges: readonly PayableCharge[]
  readonly sum: Money
}

/**
 * `POST /staff/payments` (E-104, DOC-22 §5, FR-05, DR-23, DR-74, DR-267, DR-283, ADR-0006): the Manager or the Admin
 * records a cash or a bank transfer of whole charges of one unit; the amount is the sum of the selected charges, never a
 * request number (DR-267). One READ COMMITTED transaction holds the payment insert, the charge updates, the all-or-nothing
 * allocation, the receipts, the counter row, the statement link, the outbox rows and the audit row (DOC-22 §11); `40001`/
 * `40P01` re-runs it whole up to 3 times, while a unique-key conflict on `client_key` is an idempotent replay and is never
 * retried (DOC-22 §5.2 step 4). The steps:
 *
 * 1. `requireRole`; the building's zone and `buildingToday`; `checkManualPayment` validates the body (DOC-22 §5.1 400s);
 * 2. an already-stored `client_key` answers with the first response, `replayed: true`, so a same-body repeat is not re-written;
 * 3. the selected charges are read without a lock: another unit's or building's charge is 404 (LG-08), one that is not `open`
 *    is 409 `charge_changed`, and a request `amount` that differs from the sum is 422 `allocation_mismatch` (FR-05.2, FR-05.3);
 * 4. `INSERT payment` (DR-23) then `ChargeAllocator.allocate`; one 0-row charge rolls the whole transaction back and answers
 *    the fresh states as 409 `charge_changed` (DOC-22 §4.3, FR-05.3);
 * 5. `IntentCancellation.cancelHolding(…, 'charge_paid')` cancels the links that held the charges (DR-283);
 * 6. a `statementLineId` must match an `unmatched` line, else 409 `invalid_transition` and nothing saved;
 * 7. the `finance.payment_posted.v1` outbox row and the audit row `finance.payment.post` commit with it (the receipts'
 *    events are the allocator's), and the `payment.posted` line is logged with no amount and no payer name (DOC-22 §14).
 *
 * `dryRun: true` runs steps 1 and 3 only and returns the sum, the lines and the count of receipts, never their numbers: a
 * number is reserved only by the counter increment inside the transaction (DOC-22 §5.3, DR-267 item 3).
 */
export class RecordManualPayment {
  private readonly auditedPost: ReturnType<RecordManualPayment['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly payments: PaymentRepository,
    private readonly ledger: LedgerRepository,
    private readonly allocator: ChargeAllocator,
    private readonly cancellation: IntentCancellation,
    private readonly calendar: BuildingCalendar,
    private readonly receipts: ReceiptBuildingSource,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly retry: RetryOptions = {},
  ) {
    this.auditedPost = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    input: ManualPaymentInput,
    clientKey: string,
  ): Promise<ManualPaymentResult> {
    requireRole(staff, RECORD_MANUAL_PAYMENT_ROLES)
    const scope = staff.scope
    const timeZone = await this.calendar.timeZone(scope.buildingId)
    const today = buildingToday(this.clock.now(), timeZone)
    const checked = checkManualPayment(input, today, staff.role === 'admin')
    if (checked.dryRun) {
      const { charges, sum } = await this.uow.run(() => this.plan(scope, checked))
      return dryRunResult(sum, charges)
    }
    const started = this.clock.now().getTime()
    const result = await this.post(staff, checked, clientKey, timeZone, today)
    // DOC-22 §14: the info line carries no amount and no payer name.
    if (result.kind === 'posted' && !result.replayed)
      this.logger.info(
        {
          event: 'payment.posted',
          buildingId: scope.buildingId,
          paymentId: result.payment.paymentId,
          source: result.payment.source,
          chargeCount: result.payment.receipts.length,
          ms: this.clock.now().getTime() - started,
        },
        'manual payment posted',
      )
    return result
  }

  /** Step 4 (DOC-22 §5.2): the write under the serialization retry, or the stored payment of the same key. */
  private async post(
    staff: StaffContext,
    checked: CheckedManualPayment,
    clientKey: string,
    timeZone: string,
    today: LocalDate,
  ): Promise<ManualPaymentResult> {
    const scope = staff.scope
    try {
      return await withSerializationRetry(
        () => this.once(staff, checked, clientKey, timeZone, today),
        {
          ...this.retry,
          onRetry: (sqlstate, attempt) => {
            this.logger.warn({ event: 'payment.retry', sqlstate, attempt }, 'manual payment retry')
            this.retry.onRetry?.(sqlstate, attempt)
          },
        },
      )
    } catch (error) {
      // A parallel duplicate with the same key lost the insert race (DOC-22 §5.2 step 4):
      // the stored payment answers.
      if (isUniqueViolation(error, 'uq_payment_building_client_key')) {
        const stored = await this.uow.run(() => this.payments.findByClientKey(scope, clientKey))
        if (stored) return { kind: 'posted', replayed: true, payment: stored }
      }
      if (error instanceof ChargeChangedError)
        this.logger.info(
          {
            event: 'payment.conflict',
            buildingId: scope.buildingId,
            chargeIds: checked.chargeIds,
          },
          'manual payment conflicted',
        )
      throw error
    }
  }

  /** Step 2's read inside the transaction: the payer of the same `client_key`, or the one write (DOC-22 §5.2). */
  private once(
    staff: StaffContext,
    checked: CheckedManualPayment,
    clientKey: string,
    timeZone: string,
    today: LocalDate,
  ): Promise<ManualPaymentResult> {
    const scope = staff.scope
    return this.uow.run<ManualPaymentResult>(async () => {
      const stored = await this.payments.findByClientKey(scope, clientKey)
      if (stored) return { kind: 'posted', replayed: true, payment: stored }
      return {
        kind: 'posted',
        replayed: false,
        payment: await this.auditedPost(staff, checked, clientKey, timeZone, today),
      }
    })
  }

  /**
   * Step 3 (DOC-22 §5.2): the selected charges of the unit in the building, read without a lock. A missing row is another
   * unit's or another building's charge (404, LG-08); one that is not `open` is refused now with 409 `charge_changed`; a
   * request `amount` that differs from the sum of whole charges is 422 `allocation_mismatch` (FR-05.2, FR-05.3).
   */
  private async plan(scope: BuildingScope, checked: CheckedManualPayment): Promise<Planned> {
    const charges = await this.payments.readCharges(scope, checked.unitId, checked.chargeIds)
    if (charges.length < checked.chargeIds.length) throw new NotFoundError()
    const notOpen = charges.filter((charge) => charge.status !== 'open')
    if (notOpen.length > 0)
      throw new ChargeChangedError(
        notOpen.map((charge) => ({
          chargeId: charge.id,
          status: charge.status,
          version: charge.version,
        })),
      )
    const sum = charges.reduce((total, charge) => money(total + charge.amount), money(0))
    if (checked.amount !== null && checked.amount !== Number(sum))
      throw new AllocationMismatchError(Number(sum), checked.amount)
    return { charges, sum }
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.payment.post',
        object: (payment: PaymentView) => ({ type: 'payment', id: payment.paymentId }),
        details: (payment: PaymentView) => ({
          source: payment.source,
          amount: Number(payment.amount),
          chargeCount: payment.receipts.length,
        }),
      },
      async (
        staff: StaffContext,
        checked: CheckedManualPayment,
        clientKey: string,
        timeZone: string,
        today: LocalDate,
      ) => {
        const scope = staff.scope
        const { charges, sum } = await this.plan(scope, checked)
        const now = this.clock.now()
        const receivedAt = receivedAtOf(checked.receivedOn, today, now, timeZone)
        const paymentId = this.ids.next()
        await this.ledger.insertPayment(scope, {
          id: paymentId,
          unitId: checked.unitId,
          source: checked.method,
          amount: sum,
          receivedAt,
          payerName: checked.payerName,
          provider: null,
          gatewayReference: null,
          intentId: null,
          clientKey,
          recordedBy: staff.staffId,
          bankReference: checked.bankReference,
          statementLineId: checked.statementLineId,
          note: checked.note,
        })
        const building = await this.receipts.forBuilding(scope.buildingId)
        const allocated = await this.allocator.allocate(
          scope,
          {
            paymentId,
            source: checked.method,
            receivedAt,
            gatewayReference: null,
            bankReference: checked.bankReference,
          },
          charges.map((charge) => ({ chargeId: charge.id, expectedAmount: charge.amount })),
          { ...building, payer: { name: checked.payerName, memberType: null } },
        )
        // DOC-22 §4.3: one 0-row charge rolls the whole transaction back (payment, allocations, receipts, counter);
        // the fresh states answer 409 `charge_changed`.
        if (!allocated.ok) {
          const states = await this.payments.chargeStates(scope, checked.chargeIds)
          throw new ChargeChangedError(
            states.filter(
              (state) => state.status !== 'open' || state.chargeId === allocated.failed.chargeId,
            ),
          )
        }
        await this.cancellation.cancelHolding(
          scope,
          charges.map((charge) => charge.id),
          'charge_paid',
        )
        if (checked.statementLineId) {
          const matched = await this.payments.matchStatementLine(
            scope,
            checked.statementLineId,
            paymentId,
          )
          if (!matched) throw new InvalidTransitionError('statement_line', 'not_unmatched', 'match')
        }
        await this.outbox.add([
          {
            type: FINANCE_EVENTS.paymentPosted,
            aggregateId: paymentId,
            payload: {
              buildingId: scope.buildingId,
              paymentId,
              unitId: checked.unitId,
              source: checked.method,
              payerAccountId: null,
              postedAt: now.toISOString(),
            } satisfies PaymentPostedPayload,
            occurredAt: now,
          },
        ])
        const receipts = [...allocated.allocations]
          .sort((a, b) => compareId(a.chargeId, b.chargeId))
          .map((outcome) => ({
            receiptId: outcome.receiptId,
            number: outcome.receiptNo,
            chargeId: outcome.chargeId,
            amount: outcome.amount,
          }))
        const payment: PaymentView = {
          paymentId,
          unitId: checked.unitId,
          source: checked.method,
          status: 'posted',
          amount: sum,
          receivedAt,
          payerName: checked.payerName,
          receipts,
        }
        return { result: payment, changes: [] }
      },
    )
  }
}

/** Step 3's answer (DOC-22 §5.3): the lines ascending by charge id, the receipt count (never a number) and the warnings. */
function dryRunResult(sum: Money, charges: readonly PayableCharge[]): ManualPaymentResult {
  const ordered = [...charges].sort((a, b) => compareId(a.id, b.id))
  return {
    kind: 'dry_run',
    amount: sum,
    lines: ordered.map((charge) => ({
      chargeId: charge.id,
      batchCode: charge.batchCode,
      amount: charge.amount,
    })),
    receiptCount: charges.length,
    // FR-05.6: a charge held by an active intent is a warning, not a block.
    warnings: ordered.flatMap((charge) => {
      if (charge.activeIntentSince === null) return []
      return [
        {
          chargeId: charge.id,
          code: 'active_intent' as const,
          since: charge.activeIntentSince,
        },
      ]
    }),
  }
}

/** Ascending `charge.id`, so the response and the warnings are deterministic. */
const compareId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The unique violation of one constraint, read through `cause` up to three levels like `retryableSqlState` (DOC-22 §5.2
 * step 4, `uq_payment_building_client_key`): a concurrent manual payment with the same `client_key` won the race.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown }
    const constraints = [candidate.constraint_name, candidate.constraint]
    if (candidate.code === '23505' && constraints.includes(constraint)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
