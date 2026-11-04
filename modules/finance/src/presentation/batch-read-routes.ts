import { describedEnum, IdParams, type RouteSet, routePlugin, staffRoute } from '@core/http'
import { type Guards, type LocalDate, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { FeeBatchQueries } from '../application/queries/fee-batch-queries'
import { FEE_BATCH_READ_ROLES } from '../application/queries/fee-batch-queries'
import {
  FEE_NOTICE_READ_ROLES,
  type FeeNoticeQueries,
} from '../application/queries/fee-notice-queries'
import type { ChargeStatus, FeeBatchStatus } from '../domain/fee-batch'
import type { BatchChargeItem } from '../domain/fee-batch-reader'
import { amountOf, noticeJobBody } from './bodies'
import { decodeCursor, encodeCursor, quoted, wholeParam } from './http'

export interface BatchReadRouteDeps {
  feeBatches: FeeBatchQueries
  feeNotice: FeeNoticeQueries
  guards: Guards
}

const ListQuery = Type.Object({
  status: Type.Optional(
    describedEnum({
      all: 'Every batch (the default)',
      draft: 'Not published yet',
      published: 'Payable',
      closed: 'Closed',
      recalled: 'Recalled',
    }),
  ),
  month: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}$',
      description: 'Only batches of this fee month, `YYYY-MM`',
    }),
  ),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'A part of the code or the name' })),
  limit: Type.Optional(Type.String({ description: 'The page size, 1 to 100, default 20' })),
  cursor: Type.Optional(Type.String({ description: 'The `nextCursor` of the previous page' })),
})
const ChargesQuery = Type.Object({
  view: Type.Optional(
    describedEnum({
      all: 'The charges of the batch (the default)',
      missing: 'The owned units with no charge',
    }),
  ),
  status: Type.Optional(
    describedEnum({
      draft: 'In a draft batch',
      open: 'Payable',
      paid: 'Paid',
      void: 'Void',
    }),
  ),
  voidKind: Type.Optional(
    describedEnum({ recall: 'Void because the batch was recalled', single: 'Voided alone' }),
  ),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'A part of the unit code' })),
  include: Type.Optional(Type.String({ description: '`lines` adds the lines of each charge' })),
  limit: Type.Optional(Type.String({ description: 'The page size, 1 to 200, default 50' })),
  cursor: Type.Optional(Type.String({ description: 'The `nextCursor` of the previous page' })),
})

const chargeItemBody = (item: BatchChargeItem) => ({
  chargeId: item.chargeId,
  unitId: item.unitId,
  unitCode: item.unitCode,
  ownerName: item.ownerName,
  amount: amountOf(item.amount),
  status: item.status,
  voidKind: item.voidKind,
  version: item.version,
  lineCount: item.lineCount,
  ...(item.lines ? { lines: item.lines } : {}),
})

/** E-89, E-91, E-93 and E-177: the batch reads of DOC-21 §3 and DOC-66 §5 (P2-15). */
export function batchReadRoutes(d: BatchReadRouteDeps) {
  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const q = context.query
    const limit = wholeParam('limit', q.limit, 1, 100)
    const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor, ['m', 'i'] as const)
    const page = await d.feeBatches.list(staffOf(context), {
      status:
        q.status === undefined || q.status === 'all' ? undefined : (q.status as FeeBatchStatus),
      month: q.month,
      q: q.q,
      limit,
      after: after === undefined ? undefined : { feeMonth: after.m as LocalDate, id: after.i },
    })
    return {
      items: page.items.map((item) => ({
        ...item,
        total: amountOf(item.total),
        collected: amountOf(item.collected),
      })),
      nextCursor: page.next ? encodeCursor({ m: page.next.feeMonth, i: page.next.id }) : null,
      ...(page.counts ? { counts: page.counts, totalCount: page.totalCount } : {}),
    }
  }

  const get = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    const view = await d.feeBatches.view(staffOf(context), context.params.id)
    context.set.headers.etag = quoted(view.version)
    context.set.headers['cache-control'] = 'private, no-cache'
    return {
      ...view,
      publishedAt: view.publishedAt?.toISOString() ?? null,
      total: amountOf(view.total),
      source: view.source ? { importedAt: view.source.importedAt.toISOString() } : null,
    }
  }

  const charges = async (context: {
    params: Static<typeof IdParams>
    query: Static<typeof ChargesQuery>
  }) => {
    const q = context.query
    const limit = wholeParam('limit', q.limit, 1, 200)
    const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor, ['u', 'i'] as const)
    const page = await d.feeBatches.chargesPage(staffOf(context), context.params.id, {
      view: q.view,
      status: q.status as ChargeStatus | undefined,
      voidKind: q.voidKind,
      q: q.q,
      includeLines: q.include === 'lines',
      limit,
      after: after === undefined ? undefined : { unitCode: after.u, id: after.i },
    })
    return {
      items: page.items.map(chargeItemBody),
      nextCursor: page.next ? encodeCursor({ u: page.next.unitCode, i: page.next.id }) : null,
    }
  }

  const job = async (context: { params: Static<typeof IdParams> }) =>
    noticeJobBody(await d.feeNotice.latestJob(staffOf(context), context.params.id))

  return routePlugin({ prefix: '/staff/fee-batches' })
    .get('/', list, {
      ...staffRoute(d.guards, 'finance', FEE_BATCH_READ_ROLES, {
        endpoint: 'E-89',
        operationId: 'listFeeBatches',
        summary: 'List fee batches',
        description:
          'The batches of the building, newest fee month first, with their totals and collection. The first page also carries the count of each status.',
      }),
      query: ListQuery,
    })
    .get('/:id', get, {
      ...staffRoute(d.guards, 'finance', FEE_BATCH_READ_ROLES, {
        endpoint: 'E-91',
        operationId: 'getFeeBatch',
        summary: 'Get a fee batch',
        description:
          'The batch with its counts, total, provenance (the batch it replaces and the batches that replace it) and import. The `ETag` is the version to send as `If-Match`.',
      }),
      params: IdParams,
    })
    .get('/:id/charges', charges, {
      ...staffRoute(d.guards, 'finance', FEE_BATCH_READ_ROLES, {
        endpoint: 'E-93',
        operationId: 'listBatchCharges',
        summary: 'List the charges of a batch',
        description:
          'The charges of the batch ordered by unit code, with filters and keyset paging; `include=lines` adds the lines.',
      }),
      params: IdParams,
      query: ChargesQuery,
    })
    .get('/:id/pdf', job, {
      ...staffRoute(d.guards, 'finance', FEE_NOTICE_READ_ROLES, {
        endpoint: 'E-177',
        operationId: 'getBatchPdfJob',
        summary: 'Get the state of the bulk fee-notice job',
        description:
          'The latest job of the batch; when it is ready, `zip` carries a signed URL for 15 minutes. A batch with no job is 404.',
      }),
      params: IdParams,
    })
}
