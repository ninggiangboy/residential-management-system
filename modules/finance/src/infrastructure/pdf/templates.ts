import type { RenderTemplates } from '@rms/pdf-assets'
import type { FeeNoticeInput, ReceiptInput } from '../../application/pdf-renderer'
import { FeeNoticeDocument } from './fee-notice'
import { ReceiptDocument } from './receipt'

/**
 * The `finance` templates module the render host loads (DOC-34 §2, §4.1, DR-291): one factory per document
 * kind, keyed by `PdfInput['kind']`, each a pure `input` → `<Document>` function (DOC-34 §2).
 */
const templates: RenderTemplates = {
  fee_notice: (input) => FeeNoticeDocument({ input: input as FeeNoticeInput }),
  receipt: (input) => ReceiptDocument({ input: input as ReceiptInput }),
}

export default templates
