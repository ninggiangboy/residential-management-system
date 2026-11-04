import type { Log, UnitOfWork } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import {
  type BuildingId,
  type BuildingScope,
  type MetricsPort,
  NO_METRICS,
} from '@rms/shared-types'
import type { ReceiptPdfRepository } from '../../domain/receipt-pdf-repository'
import type { LogoSource } from '../logo-source'
import type { PdfRenderer } from '../pdf-renderer'
import type { NoticeLanguageSource } from '../ports'
import { receiptPdfKey, toReceiptInput } from '../receipt-pdf-input'
import { systemFileActor } from '../system-file-actor'

/**
 * `RenderReceiptPdf` is the use case behind the worker handler `finance.render_receipt_pdf` and the on-demand route the api
 * runs inline (DOC-34 §8.2, DR-295). It follows steps 1–5: read the receipt, skip when the variant is already done, reuse a
 * file a dead attempt left under the logical key, else render and store it, then swap `finance.receipt.pdf_file` in one
 * transaction. The logo read and the render touch the bucket, so they stay outside every transaction (DOC-12 §8.2).
 */

/** What the caller wants rendered (DOC-34 §8.2): the receipt, the variant, and where the call came from. */
export interface RenderReceiptPdfInput {
  readonly buildingId: string
  readonly receiptId: string
  readonly variant: 'issued' | 'void'
  /** `handler` is the worker command; `inline` is the on-demand route (E-84, E-106) that streams the bytes back. */
  readonly origin: 'handler' | 'inline'
}

/** What happened (DOC-34 §8.2), with the file and the bytes when the caller can use them. */
export interface RenderReceiptPdfResult {
  readonly outcome: 'skipped' | 'reused' | 'rendered' | 'raced'
  /** The file the pointer was set to; `null` when the call skipped or lost the race. */
  readonly fileId: string | null
  /** The bytes this call rendered (or read for an inline reuse); `null` for a handler that reused or skipped. */
  readonly bytes: Uint8Array | null
}

/** The files the use case touches (DOC-37 §3): store the PDF, find a cached one, read it, and remove a superseded copy. */
type ReceiptFiles = Pick<FilesApi, 'read' | 'remove' | 'storeGenerated' | 'findByOwnerRef'>

/**
 * The use case of DOC-34 §8.2 (DR-295). One `execute` per receipt and variant; the caller is the worker handler or the inline
 * route. A `PdfRenderFailure` from the renderer is never swallowed: the handler's retry class takes over (DOC-34 §10).
 */
export class RenderReceiptPdf {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly receipts: ReceiptPdfRepository,
    private readonly files: ReceiptFiles,
    private readonly logo: LogoSource,
    private readonly renderer: PdfRenderer,
    private readonly language: NoticeLanguageSource,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute(input: RenderReceiptPdfInput): Promise<RenderReceiptPdfResult> {
    const { buildingId, receiptId, variant, origin } = input
    const scope: BuildingScope = { buildingId: buildingId as BuildingId }

    // Step 1: the receipt of the scope; another building's id is absent.
    const receipt = await this.receipts.findForRender(scope, receiptId)
    if (!receipt) {
      this.logger.warn(
        { event: 'receipt_pdf.skipped', reason: 'missing', buildingId, receiptId, variant },
        'receipt pdf skipped',
      )
      return { outcome: 'skipped', fileId: null, bytes: null }
    }

    // Step 2: an issued copy never replaces anything; a void copy of an issued receipt is impossible by construction.
    if (variant === 'issued' && (receipt.status === 'void' || receipt.pdfFile !== null))
      return { outcome: 'skipped', fileId: receipt.pdfFile, bytes: null }
    if (variant === 'void' && receipt.status === 'issued') {
      this.logger.warn(
        { event: 'receipt_pdf.skipped', reason: 'void_before_issue', buildingId, receiptId },
        'receipt pdf skipped',
      )
      return { outcome: 'skipped', fileId: receipt.pdfFile, bytes: null }
    }

    // Step 3: a file a dead attempt left under the key is reused, never rendered again (PD-20).
    const ownerRef = receiptPdfKey(receiptId, variant)
    const cached = await this.files.findByOwnerRef(buildingId, {
      module: 'finance',
      purpose: 'receipt_pdf',
      ownerRef,
    })
    let fileId: string
    let bytes: Uint8Array | null
    let outcome: 'reused' | 'rendered'
    if (cached) {
      // A cache hit that avoided a render is counted here, and only here (DOC-34 §14).
      this.metrics.inc('pdf_renders_total', { document: 'receipt', outcome: 'cached' })
      fileId = cached.fileId
      bytes =
        origin === 'inline'
          ? await this.files.read(systemFileActor(buildingId), cached.fileId, {
              module: 'finance',
              purpose: 'receipt_pdf',
              ownerRef,
            })
          : null
      outcome = 'reused'
    } else {
      // Step 4: render and store, both outside a transaction (§7.3 for the language, §8.4 for the logo).
      const language = await this.language.language(buildingId)
      const logo = await this.logo.load(buildingId, receipt.snapshot.company.logoKey)
      const rendered = await this.renderer.render(toReceiptInput(receipt, language, logo))
      const stored = await this.files.storeGenerated({
        buildingId,
        module: 'finance',
        purpose: 'receipt_pdf',
        ownerRef,
        mime: 'application/pdf',
        body: rendered,
      })
      fileId = stored.fileId
      bytes = rendered
      outcome = 'rendered'
    }

    // Step 5: one transaction swaps the pointer, conditional on the state the variant expects (DR-295).
    const actor = systemFileActor(buildingId)
    const storedHere = outcome === 'rendered'
    const swapped = await this.uow.run(async () => {
      const row = await this.receipts.swapPdfFile(scope, {
        receiptId,
        newFile: fileId,
        expectedStatus: variant,
      })
      if (!row) {
        // Another path already set a pointer: drop the file this attempt stored; a reused file is not ours to remove.
        if (storedHere) await this.files.remove(actor, fileId)
        return false
      }
      if (row.replaced !== null) await this.files.remove(actor, row.replaced)
      return true
    })
    if (!swapped) return { outcome: 'raced', fileId: null, bytes }
    return { outcome, fileId, bytes }
  }
}
