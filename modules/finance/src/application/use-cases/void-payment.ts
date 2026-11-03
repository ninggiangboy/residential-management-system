import { type Clock, type Log, NotFoundError, requireRole, type UnitOfWork } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import {
  FINANCE_EVENTS,
  type PaymentVoidedPayload,
  type ReceiptRenderRequestedPayload,
} from '../../contracts'
import { checkedReason, InvalidTransitionError, PaymentNotVoidableError } from '../../domain/errors'
import type { PaymentRepository, PaymentView } from '../../domain/payment-repository'
import { withSerializationRetry } from '../serialization-retry'

/** The Manager's and the Admin's (DOC-22 §6, FR-06, DOC-35 §4.1). */
export const VOID_PAYMENT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface PaymentVoided {
  readonly payment: PaymentView
  readonly chargeIds: readonly string[]
  readonly receipts: ReadonlyArray<{ readonly receiptId: string; readonly number: string }>
}

/**
 * `POST /staff/payments/{id}/void { reason }` (DOC-22 §6, FR-06, DR-17, DR-24): only a `cash` or `bank_transfer` payment is
 * voided (409 `payment_not_voidable`); an already void one is 409 `invalid_transition`, and there is no time limit. One
 * transaction sets the payment `posted → void`, its live allocations and issued receipts `void`, every paid charge of the
 * payment back to `open` (payable at once), and a linked statement line back to `unmatched`. Then `finance.payment_voided.v1`
 * and one `receipt_render_requested` with `variant: void` per receipt commit with the audit row. The void and the money log
 * are independent (DR-16). An `InvariantError` from `voidPosted` rolls the transaction back and is a 500 (DOC-22 §6).
 */
export class VoidPayment {
  private readonly auditedVoid: ReturnType<VoidPayment['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly payments: PaymentRepository,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {
    this.auditedVoid = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    paymentId: string,
    input: { readonly reason: string },
  ): Promise<PaymentVoided> {
    requireRole(staff, VOID_PAYMENT_ROLES)
    const reason = checkedReason(input.reason)
    const out = await withSerializationRetry(() =>
      this.uow.run(() => this.auditedVoid(staff, paymentId, reason)),
    )
    this.logger.info(
      {
        event: 'payment.void',
        buildingId: staff.scope.buildingId,
        paymentId,
        actor: staff.staffId,
        charges: out.chargeIds.length,
      },
      'payment voided',
    )
    return out
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.payment.void',
        object: (out: PaymentVoided) => ({ type: 'payment', id: out.payment.paymentId }),
        reason: (_staff: StaffContext, _paymentId: string, reason: string) => reason,
        details: (out: PaymentVoided) => ({
          chargeIds: [...out.chargeIds],
          receiptNumbers: out.receipts.map((receipt) => receipt.number),
        }),
      },
      async (staff: StaffContext, paymentId: string, reason: string) => {
        const scope = staff.scope
        const before = await this.payments.find(scope, paymentId)
        if (!before) throw new NotFoundError()
        this.assertVoidable(before)
        const parts = await this.payments.voidPosted(scope, paymentId, reason, staff.staffId)
        if (!parts) {
          // Voided or online between the read and the statement (DOC-22 §6): answer from the fresh row.
          const fresh = await this.payments.find(scope, paymentId)
          if (!fresh) throw new NotFoundError()
          this.assertVoidable(fresh)
          throw new InvalidTransitionError('payment', fresh.status, 'void')
        }
        const after = await this.payments.find(scope, paymentId)
        if (!after) throw new NotFoundError()
        const now = this.clock.now()
        await this.outbox.add([
          {
            type: FINANCE_EVENTS.paymentVoided,
            aggregateId: paymentId,
            payload: {
              buildingId: scope.buildingId,
              paymentId,
              unitId: before.unitId,
              source: before.source as 'cash' | 'bank_transfer',
              voidedAt: now.toISOString(),
            } satisfies PaymentVoidedPayload,
            occurredAt: now,
          },
          ...parts.receipts.map((receipt) => ({
            type: FINANCE_EVENTS.receiptRenderRequested,
            aggregateId: receipt.receiptId,
            payload: {
              buildingId: scope.buildingId,
              receiptId: receipt.receiptId,
              variant: 'void',
            } satisfies ReceiptRenderRequestedPayload,
            occurredAt: now,
          })),
        ])
        return {
          result: { payment: after, chargeIds: parts.chargeIds, receipts: parts.receipts },
          changes: [{ field: 'status', before: 'posted', after: 'void' }],
        }
      },
    )
  }

  /** The order of DOC-22 §6: an online payment → `payment_not_voidable`; an already void one → `invalid_transition`. */
  private assertVoidable(payment: PaymentView): void {
    if (payment.source === 'online') throw new PaymentNotVoidableError(payment.source)
    if (payment.status === 'void') throw new InvalidTransitionError('payment', 'void', 'void')
  }
}
