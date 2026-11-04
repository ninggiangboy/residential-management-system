import { IdParams, type RouteInfo, routePlugin, strictObject, unitRoute } from '@core/http'
import { type Guards, unitOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { ReceiptPdfQueries } from '../application/queries/receipt-pdf-queries'
import type { ResidentFeeQueries } from '../application/queries/resident-fee-queries'
import type {
  ResidentChargeLine,
  ResidentFeeBatch,
  ResidentHistoryRow,
  ResidentReceiptRow,
} from '../domain/resident-fee-reader'
import { amountOf } from './bodies'
import { cursorDate, decodeCursor, encodeCursor, wholeParam } from './http'
import { pdfResponse } from './pdf-routes'

export interface ResidentRouteDeps {
  residentFees: ResidentFeeQueries
  receiptPdf: ReceiptPdfQueries
  guards: Guards
}

const ChargeParams = strictObject({
  chargeId: Type.String({ format: 'uuid', description: 'The id of the charge' }),
})
const PageQuery = Type.Object({
  limit: Type.Optional(Type.String({ description: 'The page size, 1 to 50, default 20' })),
  cursor: Type.Optional(Type.String({ description: 'The `nextCursor` of the previous page' })),
})

const lineBody = (line: ResidentChargeLine) => ({ ...line })
const batchBody = (batch: ResidentFeeBatch) => ({ ...batch })
const paymentBody = (payment: { receivedAt: Date; method: string }) => ({
  receivedAt: payment.receivedAt.toISOString(),
  method: payment.method,
})
const historyBody = (row: ResidentHistoryRow) => ({
  chargeId: row.chargeId,
  batch: batchBody(row.batch),
  amount: amountOf(row.amount),
  payment: paymentBody(row.payment),
  receipt: row.receipt,
})
const receiptBody = (row: ResidentReceiptRow) => ({
  receiptId: row.receiptId,
  number: row.number,
  chargeId: row.chargeId,
  amount: amountOf(row.amount),
  issuedAt: row.issuedAt.toISOString(),
  receivedAt: row.receivedAt.toISOString(),
  method: row.method,
  status: row.status,
})

/**
 * `/me/fees` and `/me/receipts` (E-80…E-83; DOC-22 §8.4, DOC-58, DR-40): the unit's open charges always, the paid history
 * and the receipts from the start of the caller's membership. Every route is `unit(view_fees)`: a helper never reaches it.
 */
export function residentRoutes(d: ResidentRouteDeps) {
  const read = (info: RouteInfo) => unitRoute(d.guards, 'finance', 'view_fees', info)

  const open = async (context: object) => {
    const out = await d.residentFees.open(unitOf(context))
    return {
      items: out.items.map((charge) => ({
        chargeId: charge.chargeId,
        batch: batchBody(charge.batch),
        amount: amountOf(charge.amount),
        dueDate: charge.dueDate,
        daysPastDue: charge.daysPastDue,
        overdue: charge.overdue,
        lines: charge.lines.map(lineBody),
      })),
      total: amountOf(out.total),
      count: out.count,
      // Online payment arrives with P3 (DOC-23): until then the app shows the charges and no pay button.
      payment: { enabled: false as const },
    }
  }

  const detail = async (context: { params: Static<typeof ChargeParams> }) => {
    const charge = await d.residentFees.detail(unitOf(context), context.params.chargeId)
    return {
      chargeId: charge.chargeId,
      status: charge.status,
      batch: {
        ...batchBody(charge.batch),
        dueDate: charge.batch.dueDate,
        publishedAt: charge.batch.publishedAt?.toISOString() ?? null,
      },
      amount: amountOf(charge.amount),
      dueDate: charge.dueDate,
      daysPastDue: charge.daysPastDue,
      lines: charge.lines.map(lineBody),
      payment: charge.payment ? paymentBody(charge.payment) : null,
      receipt: charge.receipt,
    }
  }

  const history = async (context: { query: Static<typeof PageQuery> }) => {
    const { cursor } = context.query
    const limit = wholeParam('limit', context.query.limit, 1, 50)
    const after = cursor === undefined ? undefined : decodeCursor(cursor, ['t', 'i'] as const)
    const page = await d.residentFees.history(unitOf(context), {
      limit,
      after:
        after === undefined ? undefined : { receivedAt: cursorDate(after.t), chargeId: after.i },
    })
    return {
      items: page.items.map(historyBody),
      nextCursor: page.next
        ? encodeCursor({ t: page.next.receivedAt.toISOString(), i: page.next.chargeId })
        : null,
      summary: page.summary
        ? {
            outstanding: amountOf(page.summary.outstanding),
            paidThisYear: amountOf(page.summary.paidThisYear),
          }
        : null,
    }
  }

  const receipts = async (context: { query: Static<typeof PageQuery> }) => {
    const { cursor } = context.query
    const limit = wholeParam('limit', context.query.limit, 1, 50)
    const after = cursor === undefined ? undefined : decodeCursor(cursor, ['t', 'i'] as const)
    const page = await d.residentFees.receipts(unitOf(context), {
      limit,
      after:
        after === undefined ? undefined : { issuedAt: cursorDate(after.t), receiptId: after.i },
    })
    return {
      items: page.items.map(receiptBody),
      nextCursor: page.next
        ? encodeCursor({ t: page.next.issuedAt.toISOString(), i: page.next.receiptId })
        : null,
    }
  }

  const receiptPdf = async (context: { params: Static<typeof IdParams> }) => {
    const out = await d.receiptPdf.forUnit(unitOf(context), context.params.id)
    return pdfResponse(out.bytes, out.fileName)
  }

  return routePlugin({ prefix: '/me' })
    .get('/fees', open, {
      ...read({
        endpoint: 'E-80',
        operationId: 'listMyFees',
        summary: "List the unit's open charges",
        description:
          'Every open charge of the unit, oldest due first, with its lines, the total and the count. Open charges are visible to every member with `view_fees`, whenever the membership began.',
      }),
    })
    .get('/fees/history', history, {
      ...read({
        endpoint: 'E-82',
        operationId: 'listMyFeeHistory',
        summary: "List the unit's paid charges",
        description:
          "Paid charges, newest first, from the start of the caller's membership (DR-40). The first page also carries the summary of the open total and the total paid this year.",
      }),
      query: PageQuery,
    })
    .get('/fees/:chargeId', detail, {
      ...read({
        endpoint: 'E-81',
        operationId: 'getMyFee',
        summary: 'Get one charge of the unit',
        description:
          "An open charge, or a paid or void one from the start of the caller's membership; any other is 404.",
      }),
      params: ChargeParams,
    })
    .get('/receipts', receipts, {
      ...read({
        endpoint: 'E-83',
        operationId: 'listMyReceipts',
        summary: "List the unit's receipts",
        description:
          "Receipts, newest first, from the start of the caller's membership (DR-40). A voided receipt is listed with `status: void`.",
      }),
      query: PageQuery,
    })
    .get('/receipts/:id/pdf', receiptPdf, {
      ...read({
        endpoint: 'E-84',
        operationId: 'downloadMyReceipt',
        summary: 'Download a receipt as a PDF',
        description:
          "A receipt of the unit, from the start of the caller's membership (DR-40); any other is 404. Rendered on demand when no stored copy exists; a busy renderer answers 503 with `Retry-After`.",
      }),
      params: IdParams,
    })
}
