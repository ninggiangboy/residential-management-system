/**
 * The events `finance` writes to its own outbox (DOC-09 §6.1, DOC-21 §2.2, DOC-22 §2.3, DOC-23 §2.3). `receipt_issued` is the
 * e-invoice seam of DR-17; `receipt_render_requested` asks the worker for the PDF from the frozen snapshot (DOC-34 §8). The batch
 * events are chunked at 500 unit ids (DOC-09 §3.4). `intent_cancel_requested` is a command to `finance.cancel_intent_link` (P2-24).
 * `payment_voided` joins with P2-09.
 */
export const FINANCE_EVENTS = {
  receiptIssued: 'finance.receipt_issued.v1',
  receiptRenderRequested: 'finance.receipt_render_requested.v1',
  batchPublished: 'finance.batch_published.v1',
  batchDueExtended: 'finance.batch_due_extended.v1',
  batchRecalled: 'finance.batch_recalled.v1',
  chargeVoided: 'finance.charge_voided.v1',
  paymentPosted: 'finance.payment_posted.v1',
  moneyUnposted: 'finance.money_unposted.v1',
  intentCancelRequested: 'finance.intent_cancel_requested.v1',
} as const

/** The 500-id chunk of a fan-out message (DOC-09 §3.4). */
export const FAN_OUT_CHUNK = 500

/** `part` and `parts` of a chunked message (DOC-09 §3.4). */
interface Chunk {
  part: number
  parts: number
  unitIds: string[]
}

/** `finance.batch_published.v1` (DOC-09 §6.1); `feeMonth` is `YYYY-MM`. */
export interface BatchPublishedPayload extends Chunk {
  buildingId: string
  batchId: string
  code: string
  feeMonth: string
  dueDate: string
}

/** `finance.batch_due_extended.v1` (DOC-09 §6.1): `unitIds` are the units that still have an `open` charge. */
export interface BatchDueExtendedPayload extends Chunk {
  buildingId: string
  batchId: string
  code: string
  previousDueDate: string
  dueDate: string
}

/** `finance.batch_recalled.v1` (DOC-09 §6.1): `unitIds` are the units that had a non-void charge (DR-97). */
export interface BatchRecalledPayload extends Chunk {
  buildingId: string
  batchId: string
  code: string
  feeMonth: string
}

/** `finance.charge_voided.v1` (DOC-09 §6.1). */
export interface ChargeVoidedPayload {
  buildingId: string
  chargeId: string
  batchId: string
  unitId: string
  feeMonth: string
}

/** `finance.payment_posted.v1` (DOC-09 §6.1): no amount, the app fetches it after authentication. */
export interface PaymentPostedPayload {
  buildingId: string
  paymentId: string
  unitId: string
  source: 'online' | 'cash' | 'bank_transfer'
  payerAccountId: string | null
  postedAt: string
}

/** `finance.money_unposted.v1` (DOC-09 §6.1): to staff only, so the amount is in it. */
export interface MoneyUnpostedPayload {
  buildingId: string
  kind: 'gateway_event' | 'statement_line'
  rowId: string
  outcome: string
  amount: number
  receivedAt: string
}

/** The `reason` of `finance.intent_cancel_requested.v1` (DOC-09 §6.1, DOC-23 §2.3): for the log only. */
export type IntentCancelCommandReason =
  | 'expired'
  | 'resident_cancelled'
  | 'replaced'
  | 'batch_recalled'
  | 'charge_voided'
  | 'charge_paid'

/** `finance.intent_cancel_requested.v1` (DOC-09 §6.1). */
export interface IntentCancelRequestedPayload {
  buildingId: string
  intentId: string
  reason: IntentCancelCommandReason
}

/** `finance.receipt_issued.v1` (DOC-09 §6.1, DOC-22 §2.3). */
export interface ReceiptIssuedPayload {
  buildingId: string
  receiptId: string
  receiptNo: string
  paymentId: string
  allocationId: string
  chargeId: string
  unitId: string
  issuedAt: string
}

/** `finance.receipt_render_requested.v1` (DOC-09 §6.1, DOC-22 §2.3). */
export interface ReceiptRenderRequestedPayload {
  buildingId: string
  receiptId: string
  variant: 'issued' | 'void'
}
