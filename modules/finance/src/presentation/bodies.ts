import { type Money, moneyToJson } from '@rms/shared-types'
import type { FeeNoticeJobView } from '../application/queries/fee-notice-queries'
import type { ChargeRecord, FeeBatchRecord } from '../domain/fee-batch'
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

/** A batch as the write routes answer it; `E-91` adds the counts and the links (DOC-21 §3.1). */
export function batchBody(batch: FeeBatchRecord, createdByName: string | null) {
  return {
    id: batch.id,
    code: batch.code,
    name: batch.name,
    feeMonth: batch.feeMonth,
    dueDate: batch.dueDate,
    status: batch.status,
    version: batch.version,
    createdBy: { id: batch.createdBy, name: createdByName },
    createdAt: batch.createdAt.toISOString(),
    replacesBatchId: batch.replacesBatchId ?? null,
  }
}

/** A charge as the write routes answer it (DOC-21 §3.2). */
export function chargeBody(charge: ChargeRecord) {
  return {
    id: charge.id,
    batchId: charge.batchId,
    unitId: charge.unitId,
    unitCode: charge.unitCode,
    amount: amountOf(charge.amount),
    status: charge.status,
    version: charge.version,
  }
}

/** The bulk fee-notice job of E-99 and E-177 (DOC-34 §9.1); `zip` is only known to the reader (E-177). */
export function noticeJobBody(job: FeeNoticeJobView) {
  return {
    id: job.id,
    batchId: job.batchId,
    status: job.status,
    language: job.language,
    unitTotal: job.unitTotal,
    unitDone: job.unitDone,
    zip: job.zip,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}
