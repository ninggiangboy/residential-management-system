/**
 * The receipt snapshot (DOC-15 §7.3, DOC-22 §7, DR-17): the frozen document the PDF renders from, built here as a pure
 * function so the application layer never reaches into the database for the shape. Amounts are the integer đồng of JSON.
 */
import { type MemberType, type Money, moneyToJson } from '@rms/shared-types'

/** A name in the two languages of the product (DOC-15 `platform.is_bilingual`); `en` may be absent. */
export interface BilingualText {
  readonly vi: string
  readonly en?: string | null
}

/** How the money arrived (DOC-15 `ck_payment_source`). */
export type PaymentSource = 'cash' | 'bank_transfer' | 'online'

/** The company block the caller reads from `BuildingApi.getSettings` at issue time (DOC-22 §7, DR-17). */
export interface CompanyProfile {
  readonly name: BilingualText
  readonly address: string
  readonly hotline: string
  readonly logoKey: string | null
}

/** What only the caller knows: the building's zone, its settings and names, and the payer of this receipt. */
export interface ReceiptContext {
  /** The zone the receipt period is read in, so a 23:59 receipt of a month's last day stays in it (DOC-22 §7, DR-10). */
  readonly timeZone: string
  readonly company: CompanyProfile
  readonly building: { readonly name: BilingualText }
  readonly payer: { readonly name: string | null; readonly memberType: MemberType | null }
}

/** One line of the charge, frozen as DOC-15 §7.3 prints it; `quantity` is a decimal string so `12.345` survives JSON. */
export interface ReceiptLine {
  readonly kind: 'fee' | 'adjustment'
  readonly name: BilingualText
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
  readonly note: string | null
}

/** The charge a receipt documents: its unit, its full amount, its batch and its lines in position order (DOC-22 §7). */
export interface ReceiptCharge {
  readonly chargeId: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: Money
  readonly batch: { readonly code: string; readonly name: BilingualText; readonly feeMonth: string }
  readonly lines: readonly ReceiptLine[]
}

/** The payment facts the snapshot prints (DOC-22 §7): the method, the reference and the paid time. */
export interface ReceiptPayment {
  readonly source: PaymentSource
  readonly receivedAt: Date
  readonly gatewayReference: string | null
  readonly bankReference: string | null
}

/** The shape of `finance.receipt.snapshot` (DOC-15 §7.3); instants are RFC 3339 UTC with `Z`. */
export interface ReceiptSnapshot {
  readonly company: CompanyProfile
  readonly building: { readonly name: BilingualText }
  readonly unitCode: string
  readonly payer: { readonly name: string | null; readonly memberType: MemberType | null }
  readonly batch: { readonly code: string; readonly name: BilingualText; readonly feeMonth: string }
  readonly lines: readonly ReceiptLine[]
  readonly amount: number
  readonly method: PaymentSource
  readonly reference: string | null
  readonly paidAt: string
  readonly issuedAt: string
}

/**
 * The frozen document (DOC-22 §7, DR-17), built from rows the allocator already holds plus the context the caller passes.
 * Pure: no clock (the caller passes `issuedAt`) and no I/O. The reference is the gateway's for an online payment, the
 * Manager's bank reference otherwise.
 */
export function buildReceiptSnapshot(
  context: ReceiptContext,
  charge: ReceiptCharge,
  payment: ReceiptPayment,
  issuedAt: Date,
): ReceiptSnapshot {
  return {
    company: context.company,
    building: context.building,
    unitCode: charge.unitCode,
    payer: context.payer,
    batch: charge.batch,
    lines: charge.lines,
    amount: moneyToJson(charge.amount),
    method: payment.source,
    reference: payment.source === 'online' ? payment.gatewayReference : payment.bankReference,
    paidAt: payment.receivedAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
  }
}
