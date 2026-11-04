import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { FINANCE_EVENTS, type ReceiptRenderRequestedPayload } from '../../contracts'
import type { RenderReceiptPdf } from '../use-cases/render-receipt-pdf'

/**
 * `finance.render_receipt_pdf` (DOC-34 §8.2, DOC-09 §5): the worker command `finance.receipt_render_requested.v1` renders one
 * receipt's PDF. The inbox is `afterSideEffect` (like `building.delete_file_object`): the render stores a file in the bucket,
 * which cannot be rolled back, so a redelivery runs the handler again and the use case skips or reuses (PD-20). One handler per file.
 */
export class RenderReceiptPdfHandler implements IntegrationEventHandler {
  readonly name = 'finance.render_receipt_pdf'
  readonly eventType = FINANCE_EVENTS.receiptRenderRequested

  constructor(
    private readonly render: RenderReceiptPdf,
    private readonly inbox: InboxGuard,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { buildingId, receiptId, variant } =
      message.payload as unknown as ReceiptRenderRequestedPayload
    // The command is typed by its contract, but a stray envelope must not reach the use case with the wrong shape.
    if (
      typeof buildingId !== 'string' ||
      typeof receiptId !== 'string' ||
      (variant !== 'issued' && variant !== 'void')
    )
      throw new Error(`${this.name}: malformed payload`)
    await this.inbox.afterSideEffect(message.id, this.name, async () => {
      await this.render.execute({ buildingId, receiptId, variant, origin: 'handler' })
    })
  }
}
