import { NotFoundError, requireRole, UnavailableError } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { BuildingScope, StaffContext, StaffRole, UnitContext } from '@rms/shared-types'
import type { ReceiptPdfRepository } from '../../domain/receipt-pdf-repository'
import { PdfRenderFailure } from '../pdf-renderer'
import { receiptPdfKey } from '../receipt-pdf-input'
import { systemFileActor } from '../system-file-actor'
import type { RenderReceiptPdf } from '../use-cases/render-receipt-pdf'

/** The Manager's and the Admin's (E-84, E-106; DOC-34 §8.2). */
export const RECEIPT_PDF_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** DOC-34 §10, PD-26: a pool that is out of a free host answers 503 with a `Retry-After: 5` hint. */
const RENDER_RETRY_SECONDS = 5

/** One receipt PDF a route streams (DOC-34 §8.2): the bytes and the `Content-Disposition` name. */
export interface ReceiptPdfDownload {
  readonly bytes: Uint8Array
  readonly fileName: string
}

/**
 * The receipt PDF downloads of DOC-34 §8.2: E-106 for the staff and E-84 for a resident whose membership covers the payment
 * (DR-40, DOC-22 §8.4). Both render or read the variant of the receipt's current status through `RenderReceiptPdf` with
 * `origin: 'inline'` — a stored `pdf_file` is read, a missing one is rendered on demand — and stream the bytes (PD-23,
 * PD-25). A query service (DOC-12 §4.5): no use case file per read.
 */
export class ReceiptPdfQueries {
  constructor(
    private readonly receipts: Pick<ReceiptPdfRepository, 'findDownload'>,
    private readonly files: Pick<FilesApi, 'read'>,
    private readonly render: RenderReceiptPdf,
  ) {}

  /** E-106: the staff download of a receipt of the caller's building (DOC-34 §8.2). */
  async forStaff(staff: StaffContext, receiptId: string): Promise<ReceiptPdfDownload> {
    requireRole(staff, RECEIPT_PDF_READ_ROLES)
    return this.download(staff.scope, receiptId, null)
  }

  /** E-84: the resident download of a receipt of their unit, inside the DR-40 window (DOC-22 §8.4, PD-25). */
  async forUnit(unit: UnitContext, receiptId: string): Promise<ReceiptPdfDownload> {
    return this.download(unit.scope, receiptId, unit)
  }

  private async download(
    scope: BuildingScope,
    receiptId: string,
    unit: UnitContext | null,
  ): Promise<ReceiptPdfDownload> {
    const receipt = await this.receipts.findDownload(scope, receiptId)
    if (!receipt) throw new NotFoundError()
    // DR-40 (DOC-22 §8.4, PD-25): another unit's receipt, or a payment before the membership began, is invisible.
    if (unit && (receipt.unitId !== unit.unitId || receipt.receivedAt < unit.startedAt))
      throw new NotFoundError()
    const variant = receipt.status === 'void' ? 'void' : 'issued'
    return {
      bytes: await this.bytes(scope, receiptId, variant),
      fileName: `${receipt.number}.pdf`,
    }
  }

  /**
   * §8.2 on demand: `RenderReceiptPdf` reads the stored copy of the variant, or renders it inline; a skip that answered the
   * pointer (an issued `pdf_file` already set) is read here. A renderer failure is the 503 of DOC-34 §10.
   */
  private async bytes(
    scope: BuildingScope,
    receiptId: string,
    variant: 'issued' | 'void',
  ): Promise<Uint8Array> {
    let fileId: string | null
    let rendered: Uint8Array | null
    try {
      const result = await this.render.execute({
        buildingId: scope.buildingId,
        receiptId,
        variant,
        origin: 'inline',
      })
      fileId = result.fileId
      rendered = result.bytes
    } catch (error) {
      if (error instanceof PdfRenderFailure)
        throw new UnavailableError(
          'service_unavailable',
          'Service unavailable',
          RENDER_RETRY_SECONDS,
        )
      throw error
    }
    const bytes =
      rendered ??
      (fileId !== null ? await this.readStored(scope, receiptId, variant, fileId) : null)
    if (bytes === null) throw new NotFoundError()
    return bytes
  }

  /** The bytes of a stored pointer; an object that cannot be read answers `null` so the caller renders (§8.2). */
  private async readStored(
    scope: BuildingScope,
    receiptId: string,
    variant: 'issued' | 'void',
    fileId: string,
  ): Promise<Uint8Array | null> {
    try {
      return await this.files.read(systemFileActor(scope.buildingId), fileId, {
        module: 'finance',
        purpose: 'receipt_pdf',
        ownerRef: receiptPdfKey(receiptId, variant),
      })
    } catch {
      // DOC-34 §8.2: `pdf_file` may name an object a restore lost; the caller renders a fresh copy instead.
      return null
    }
  }
}
