/**
 * The events `finance` writes to its own outbox (DOC-09 §6.1, DOC-22 §2.3). `receipt_issued` is the e-invoice seam of DR-17;
 * `receipt_render_requested` asks the worker for the PDF from the frozen snapshot (DOC-34 §8). The `payment_posted` and
 * `payment_voided` events join with P2-08 and P2-09.
 */
export const FINANCE_EVENTS = {
  receiptIssued: 'finance.receipt_issued.v1',
  receiptRenderRequested: 'finance.receipt_render_requested.v1',
} as const

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
