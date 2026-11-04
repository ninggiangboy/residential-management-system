import { type Money, moneyToJson } from '@rms/shared-types'
import type { PaymentView } from '../domain/payment-repository'

/** Money is a JSON integer (DOC-50 §6). */
export const amountOf = (value: Money): number => moneyToJson(value)

/** The payment of E-104's answer and of E-105's (DOC-22 §5.2, §6): built the same way on the first call and on a replay. */
export function paymentBody(payment: PaymentView) {
  return {
    paymentId: payment.paymentId,
    unitId: payment.unitId,
    source: payment.source,
    status: payment.status,
    amount: amountOf(payment.amount),
    receivedAt: payment.receivedAt.toISOString(),
    payerName: payment.payerName,
    receipts: payment.receipts.map((receipt) => ({
      receiptId: receipt.receiptId,
      number: receipt.number,
      chargeId: receipt.chargeId,
      amount: amountOf(receipt.amount),
    })),
  }
}
