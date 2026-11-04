import type { LocalDate, MemberType } from '@rms/shared-types'

/**
 * The `PdfRenderer` port of DOC-34 §2: the application layer asks it to render one document and gets the PDF
 * bytes back. Plain data only — no React and no `@rms/pdf-assets` (DOC-12 §4) — so a use case may depend on this
 * file without loading the renderer, and a template receives everything it prints.
 */

/** The language a document prints in (DOC-34 §5, FR-36.1): Vietnamese, English, or both, where `both` prints the English line under the Vietnamese one. */
export type PdfLanguage = 'vi' | 'en' | 'both'

/** A name in the two languages of the product (DOC-34 §5, DR-71); `vi` is the fallback and `en` may be absent. */
export interface Bilingual {
  readonly vi: string
  readonly en?: string | null
}

/**
 * One printed charge line of a fee notice or a receipt (DOC-34 §6.1, §7.1): `amount` and `unitPrice` are integer
 * đồng as a JSON number, and `quantity` is the decimal exactly as stored (`12.345`). An `adjustment` (DR-19)
 * prints its `note` in the Basis column and a negative amount with the U+2212 minus sign.
 */
export interface PdfChargeLine {
  readonly position: number
  readonly itemName: Bilingual
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
  readonly kind: 'normal' | 'adjustment'
  readonly note: string | null
}

/** The fee notice of DOC-34 §6: the header and payment facts the caller resolved, one row per charge line in `position` order, and the total. */
export interface FeeNoticeInput {
  readonly kind: 'fee_notice'
  readonly language: PdfLanguage
  readonly draft: boolean
  readonly building: {
    readonly name: Bilingual
    readonly company: { readonly name: Bilingual; readonly address: string | null }
    readonly address: string
    readonly hotline: string | null
    readonly email: string | null
    readonly workingHours: Bilingual | null
    readonly logo: Uint8Array | null
  }
  readonly gatewayActive: boolean
  readonly unit: { readonly code: string; readonly ownerName: string | null }
  readonly batch: {
    readonly code: string
    readonly name: Bilingual
    readonly feeMonth: string
    readonly dueDate: LocalDate
    readonly issueDate: LocalDate
  }
  readonly lines: readonly PdfChargeLine[]
  readonly total: number
}

/** How a receipt's money arrived (DOC-34 §7.1). */
export type PdfPaymentMethod = 'online' | 'cash' | 'bank_transfer'

/**
 * The receipt of DOC-34 §7: everything printed comes from the caller's snapshot (DR-17), so a later change of the
 * company or the payer never alters an old receipt; `items` follows §6.1 and `void` marks the void copy.
 */
export interface ReceiptInput {
  readonly kind: 'receipt'
  readonly language: PdfLanguage
  readonly number: string
  readonly issuedAt: string
  readonly paidAt: string
  readonly payer: { readonly name: string | null; readonly memberType: MemberType | null }
  readonly unit: { readonly code: string }
  readonly batch: {
    readonly code: string
    readonly name: Bilingual
    readonly feeMonth: string
  }
  readonly items: readonly PdfChargeLine[]
  readonly amount: number
  readonly method: PdfPaymentMethod
  readonly reference: string | null
  readonly building: { readonly name: Bilingual }
  readonly company: {
    readonly name: Bilingual
    readonly address: string | null
    readonly hotline: string | null
  }
  readonly logo: Uint8Array | null
  readonly void: { readonly voidedOn: LocalDate; readonly reason: string | null } | null
}

/** The tagged union the port renders (DOC-34 §2): one member per document kind. */
export type PdfInput = FeeNoticeInput | ReceiptInput

/** The port of DOC-34 §2: `render` turns one document's plain JSON into its PDF bytes. */
export interface PdfRenderer {
  render(input: PdfInput): Promise<Uint8Array>
}

/** Why a render failed (DOC-34 §4.4): the pool is busy, the host timed out or exited, or the document itself failed. */
export type PdfRenderFailureCode = 'busy' | 'timeout' | 'host_exited' | 'render_failed'

/** The failure of DOC-34 §4.4, declared here so the application never imports the renderer's own error type. */
export class PdfRenderFailure extends Error {
  readonly code: PdfRenderFailureCode

  constructor(code: PdfRenderFailureCode, message: string) {
    super(message)
    this.name = 'PdfRenderFailure'
    this.code = code
  }
}
