import { describedEnum, IdParams, routePlugin, staffRoute } from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  FEE_NOTICE_READ_ROLES,
  type FeeNoticeQueries,
} from '../application/queries/fee-notice-queries'
import {
  RECEIPT_PDF_READ_ROLES,
  type ReceiptPdfQueries,
} from '../application/queries/receipt-pdf-queries'

export interface PdfRouteDeps {
  feeNotice: FeeNoticeQueries
  receiptPdf: ReceiptPdfQueries
  guards: Guards
}

const NoticeQuery = Type.Object({
  language: Type.Optional(
    describedEnum(
      { vi: 'Vietnamese', en: 'English', both: 'Both languages on one notice' },
      "The language of the notice; the building's default when absent",
    ),
  ),
})

/** The PDF a route streams (DOC-34 §8): never cached by a shared store, named for its document. */
export const pdfResponse = (bytes: Uint8Array, fileName: string): Response =>
  new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, no-store',
    },
  })

/** E-106 and E-176: the staff downloads of one receipt and one fee notice (DOC-34 §8.1, §8.2; P2-15). */
export function pdfRoutes(d: PdfRouteDeps) {
  const receipt = async (context: { params: Static<typeof IdParams> }) => {
    const out = await d.receiptPdf.forStaff(staffOf(context), context.params.id)
    return pdfResponse(out.bytes, out.fileName)
  }

  const notice = async (context: {
    params: Static<typeof IdParams>
    query: Static<typeof NoticeQuery>
  }) => {
    const out = await d.feeNotice.chargeNotice(staffOf(context), context.params.id, {
      language: context.query.language,
    })
    return pdfResponse(out.bytes, out.fileName)
  }

  return routePlugin({ prefix: '/staff' })
    .get('/receipts/:id/pdf', receipt, {
      ...staffRoute(d.guards, 'finance', RECEIPT_PDF_READ_ROLES, {
        endpoint: 'E-106',
        operationId: 'downloadStaffReceipt',
        summary: 'Download a receipt as a PDF',
        description:
          'The receipt of the building; a voided receipt is the copy with the VOID mark. Rendered on demand when no stored copy exists; a busy renderer answers 503 with `Retry-After`.',
      }),
      params: IdParams,
    })
    .get('/charges/:id/pdf', notice, {
      ...staffRoute(d.guards, 'finance', FEE_NOTICE_READ_ROLES, {
        endpoint: 'E-176',
        operationId: 'downloadChargeFeeNotice',
        summary: 'Download the fee notice of one charge',
        description:
          'The notice of one unit. A draft charge renders with the draft mark and is never cached; a voided charge or a recalled batch is 409.',
      }),
      params: IdParams,
      query: NoticeQuery,
    })
}
