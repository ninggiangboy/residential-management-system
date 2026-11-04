/**
 * The reads and the conditional pointer swap of a receipt PDF (DOC-34 §8.2, DR-295): the stored snapshot the render
 * reads, and the one-statement swap that points `finance.receipt.pdf_file` at a stored file. A port in `domain/`
 * (DOC-12 §4.5); the Drizzle adapter is in `infrastructure/persistence/`. Every method runs in the caller's ambient
 * transaction and carries the building scope.
 */
import type { BuildingScope } from '@rms/shared-types'
import type { ReceiptSnapshot } from './receipt-snapshot'

/** The receipt as the PDF handler reads it (DOC-34 §8.2 step 1): the frozen snapshot and the pointer it renders from. */
export interface ReceiptPdfRow {
  readonly id: string
  readonly number: string
  readonly status: 'issued' | 'void'
  readonly snapshot: ReceiptSnapshot
  /** `finance.receipt.pdf_file`: the issued copy while `issued`, the void copy once `void`. */
  readonly pdfFile: string | null
  readonly issuedAt: Date
  readonly voidedAt: Date | null
  /**
   * The void reason to print on the void copy. `finance.receipt` has no void-reason column (schema.ts), so it is
   * always `null`; the void line then prints without a reason (DOC-34 §7.1).
   */
  readonly voidReason: string | null
}

/**
 * The receipt facts a download route needs before streaming (DOC-34 §8.2; E-84, E-106): the number of the file name, the
 * status that picks the variant, and the payment's `received_at` the resident window of DR-40 compares against.
 */
export interface ReceiptDownloadRow {
  readonly number: string
  readonly status: 'issued' | 'void'
  readonly unitId: string
  /** `finance.payment.received_at` of the receipt's payment (DR-40, DOC-22 §8.4). */
  readonly receivedAt: Date
}

/** The file to swap in and the state the variant expects (DOC-34 §8.2 step 5, DR-295). */
export interface SwapReceiptPdfInput {
  readonly receiptId: string
  readonly newFile: string
  readonly expectedStatus: 'issued' | 'void'
}

export interface ReceiptPdfRepository {
  /** Step 1 of DOC-34 §8.2: the receipt of the scope, or `null` (another building's id is absent). */
  findForRender(scope: BuildingScope, receiptId: string): Promise<ReceiptPdfRow | null>
  /**
   * The download facts of DOC-34 §8.2 for E-84 and E-106: the receipt of the scope with the `received_at` of its
   * payment, or `null` (an unknown id or another building's is absent, DOC-22 §8.4).
   */
  findDownload(scope: BuildingScope, receiptId: string): Promise<ReceiptDownloadRow | null>
  /**
   * Step 5 of DOC-34 §8.2 (DR-295): one conditional statement — `old ... FOR UPDATE`, then an `UPDATE ... WHERE`
   * whose `status`, `pdf_file IS DISTINCT FROM` and issue-only-on-null conditions decide the swap. One row answers
   * `{ replaced }` (the previous pointer; `null` on the first issued swap); zero rows is `null`.
   */
  swapPdfFile(
    scope: BuildingScope,
    input: SwapReceiptPdfInput,
  ): Promise<{ replaced: string | null } | null>
}
