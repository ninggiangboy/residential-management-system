import { type Clock, type IdGenerator, InvariantError } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import { type BuildingScope, buildingToday, type Money } from '@rms/shared-types'
import {
  FINANCE_EVENTS,
  type ReceiptIssuedPayload,
  type ReceiptRenderRequestedPayload,
} from '../../contracts'
import { monthPeriod, receiptNumber } from '../../domain/document-codes'
import type { LedgerRepository } from '../../domain/ledger-repository'
import type { ReceiptCounter } from '../../domain/receipt-counter'
import {
  buildReceiptSnapshot,
  type PaymentSource,
  type ReceiptContext,
  type ReceiptPayment,
} from '../../domain/receipt-snapshot'

/** What the caller saw of one charge to pay (DOC-22 §2.1). */
export interface ChargeToPay {
  readonly chargeId: string
  readonly expectedAmount: Money
}

/** Why the first 0-row update failed, read from the fresh row (DOC-22 §4.3). */
export type AllocationFailureReason = 'not_open' | 'amount_changed'

/** One allocation the allocator inserted, with the receipt it issued (DOC-22 §2.1). */
export interface AllocationOutcome {
  readonly allocationId: string
  readonly chargeId: string
  readonly amount: Money
  readonly receiptId: string
  readonly receiptNo: string
}

/** All charges paid, or the first charge that gave 0 rows (DOC-22 §2.1). */
export type AllocationResult =
  | { readonly ok: true; readonly allocations: readonly AllocationOutcome[] }
  | {
      readonly ok: false
      readonly failed: { readonly chargeId: string; readonly reason: AllocationFailureReason }
    }

/** The payment facts the allocator needs; the caller holds the whole row (DOC-22 §2.1). */
export interface AllocatedPayment {
  readonly paymentId: string
  readonly source: PaymentSource
  readonly receivedAt: Date
  readonly gatewayReference: string | null
  readonly bankReference: string | null
}

/**
 * The all-or-nothing allocation (DOC-22 §4, ADR-0006): one conditional update per charge, in ascending `charge.id` order,
 * each followed by the allocation, a receipt number and the receipt. It runs in the caller's ambient transaction and never
 * catches a database error (`40001`/`40P01` are the transaction wrapper's, DOC-12 §8.1); the time comes from `Clock` and the
 * ids from `IdGenerator`. A 0-row update stops it and the caller decides what to roll back (DOC-22 §4.3).
 */
export class ChargeAllocator {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly counter: ReceiptCounter,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async allocate(
    scope: BuildingScope,
    payment: AllocatedPayment,
    charges: readonly ChargeToPay[],
    receiptContext: ReceiptContext,
  ): Promise<AllocationResult> {
    const ordered = this.ordered(charges)
    const allocations: AllocationOutcome[] = []
    for (const { chargeId, expectedAmount } of ordered) {
      const paid = await this.ledger.payOpenCharge(scope, chargeId, expectedAmount)
      if (!paid)
        return { ok: false, failed: { chargeId, reason: await this.reasonFor(scope, chargeId) } }
      const charge = await this.ledger.readChargeForReceipt(scope, chargeId)
      if (!charge) throw new InvariantError(`charge ${chargeId} is paid yet has no row to snapshot`)
      const allocationId = this.ids.next()
      await this.ledger.insertAllocation(scope, {
        id: allocationId,
        paymentId: payment.paymentId,
        chargeId,
        amount: expectedAmount,
      })
      const now = this.clock.now()
      const period = monthPeriod(buildingToday(now, receiptContext.timeZone))
      const n = await this.counter.next(scope, 'receipt', period)
      const receiptNo = receiptNumber(period, n)
      const receiptId = this.ids.next()
      await this.ledger.insertReceipt(scope, {
        id: receiptId,
        number: receiptNo,
        allocationId,
        paymentId: payment.paymentId,
        chargeId,
        unitId: charge.unitId,
        amount: expectedAmount,
        snapshot: buildReceiptSnapshot(receiptContext, charge, paymentFacts(payment), now),
        issuedAt: now,
      })
      await this.outbox.add([
        {
          type: FINANCE_EVENTS.receiptIssued,
          aggregateId: receiptId,
          payload: {
            buildingId: scope.buildingId,
            receiptId,
            receiptNo,
            paymentId: payment.paymentId,
            allocationId,
            chargeId,
            unitId: charge.unitId,
            issuedAt: now.toISOString(),
          } satisfies ReceiptIssuedPayload,
          occurredAt: now,
        },
        {
          type: FINANCE_EVENTS.receiptRenderRequested,
          aggregateId: receiptId,
          payload: {
            buildingId: scope.buildingId,
            receiptId,
            variant: 'issued',
          } satisfies ReceiptRenderRequestedPayload,
          occurredAt: now,
        },
      ])
      allocations.push({ allocationId, chargeId, amount: expectedAmount, receiptId, receiptNo })
    }
    return { ok: true, allocations }
  }

  /** Ascending `charge.id` and no duplicate, so A,B and B,A lock the same row first (DOC-22 §4.1). */
  private ordered(charges: readonly ChargeToPay[]): ChargeToPay[] {
    const seen = new Set<string>()
    for (const { chargeId } of charges) {
      if (seen.has(chargeId))
        throw new InvariantError(`charge ${chargeId} appears twice in one allocation`)
      seen.add(chargeId)
    }
    return [...charges].sort((a, b) => compareId(a.chargeId, b.chargeId))
  }

  private async reasonFor(
    scope: BuildingScope,
    chargeId: string,
  ): Promise<AllocationFailureReason> {
    const state = await this.ledger.readChargeState(scope, chargeId)
    return state?.status === 'open' ? 'amount_changed' : 'not_open'
  }
}

const compareId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const paymentFacts = (payment: AllocatedPayment): ReceiptPayment => ({
  source: payment.source,
  receivedAt: payment.receivedAt,
  gatewayReference: payment.gatewayReference,
  bankReference: payment.bankReference,
})
