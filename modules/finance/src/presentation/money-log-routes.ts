import { describedEnum, IdParams, routePlugin, staffRoute, strictObject } from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  MONEY_LOG_READ_ROLES,
  type MoneyLogQueries,
} from '../application/queries/money-log-queries'
import {
  REVIEW_MONEY_LOG_ROW_ROLES,
  type ReviewMoneyLogRow,
} from '../application/use-cases/review-money-log-row'
import type { MoneyLogKind, MoneyLogRow } from '../domain/money-log-repository'
import { amountOf } from './bodies'
import { cursorDate, decodeCursor, encodeCursor, wholeParam } from './http'

export interface MoneyLogRouteDeps {
  moneyLog: MoneyLogQueries
  reviewMoneyLogRow: ReviewMoneyLogRow
  guards: Guards
}

const KINDS = ['gateway_event', 'statement_line'] as const

const ListQuery = Type.Object({
  outcome: Type.Optional(
    Type.String({ maxLength: 40, description: 'Only rows with this outcome or match status' }),
  ),
  unit: Type.Optional(Type.String({ format: 'uuid', description: 'Only rows of this unit' })),
  from: Type.Optional(
    Type.String({ format: 'date-time', description: 'Rows at or after this instant' }),
  ),
  to: Type.Optional(Type.String({ format: 'date-time', description: 'Rows before this instant' })),
  state: Type.Optional(
    describedEnum({
      open: 'Not reviewed yet',
      reviewed: 'Reviewed',
      all: 'Reviewed and not reviewed (the default)',
    }),
  ),
  limit: Type.Optional(Type.String({ description: 'The page size, 1 to 100, default 25' })),
  cursor: Type.Optional(Type.String({ description: 'The `nextCursor` of the previous page' })),
})
const UnitQuery = Type.Object({
  limit: Type.Optional(Type.String({ description: 'The number of rows, 1 to 100, default 50' })),
})
const ReviewParams = strictObject({
  kind: describedEnum({
    gateway_event: 'A gateway event',
    statement_line: 'A statement line',
  }),
  id: Type.String({ format: 'uuid', description: 'The id of the row' }),
})
const ReviewBody = strictObject(
  {
    note: Type.String({ maxLength: 2000, description: 'What was checked, 5 to 1,000 characters' }),
  },
  { description: 'The review note (DOC-22 §9.2)' },
)

const rowBody = (row: MoneyLogRow) => ({
  kind: row.kind,
  id: row.id,
  at: row.at.toISOString(),
  outcome: row.status,
  amount: amountOf(row.amount),
  unitId: row.unitId,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
})

/** E-108, E-109 and E-110: the money log of DOC-22 §9 (P2-15). */
export function moneyLogRoutes(d: MoneyLogRouteDeps) {
  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const q = context.query
    const limit = wholeParam('limit', q.limit, 1, 100) ?? 25
    const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor, ['t', 'i'] as const)
    const page = await d.moneyLog.list(staffOf(context).scope, {
      outcome: q.outcome,
      unitId: q.unit,
      from: q.from === undefined ? undefined : new Date(q.from),
      to: q.to === undefined ? undefined : new Date(q.to),
      openOnly: q.state === 'open' || undefined,
      reviewedOnly: q.state === 'reviewed' || undefined,
      after: after === undefined ? undefined : { at: cursorDate(after.t), id: after.i },
      limit,
    })
    return {
      items: page.rows.map(rowBody),
      nextCursor: page.next
        ? encodeCursor({ t: page.next.at.toISOString(), i: page.next.id })
        : null,
    }
  }

  const review = async (context: {
    params: Static<typeof ReviewParams>
    body: Static<typeof ReviewBody>
  }) => {
    const kind = context.params.kind as MoneyLogKind
    if (!KINDS.includes(kind))
      throw new ValidationError([{ path: 'kind', code: 'enum', message: KINDS.join(', ') }])
    const out = await d.reviewMoneyLogRow.execute(
      staffOf(context),
      kind,
      context.params.id,
      context.body,
    )
    return { kind: out.kind, id: out.id, reviewedAt: out.reviewedAt.toISOString() }
  }

  const byUnit = async (context: {
    params: Static<typeof IdParams>
    query: Static<typeof UnitQuery>
  }) => {
    const limit = wholeParam('limit', context.query.limit, 1, 100) ?? 50
    const rows = await d.moneyLog.byUnit(staffOf(context).scope, context.params.id, limit)
    return { items: rows.map(rowBody) }
  }

  const read = (info: Parameters<typeof staffRoute>[3]) =>
    staffRoute(d.guards, 'finance', MONEY_LOG_READ_ROLES, info)

  return routePlugin({ prefix: '/staff' })
    .get('/money-log', list, {
      ...read({
        endpoint: 'E-108',
        operationId: 'listMoneyLog',
        summary: 'List the money log',
        description:
          'The gateway events and statement lines that are not a posted payment, newest first, with keyset paging. `state=open` is the work list; the other values include the reviewed and the posted rows. The log is independent of the ledger (DR-16).',
      }),
      query: ListQuery,
    })
    .post('/money-log/:kind/:id/review', review, {
      ...staffRoute(d.guards, 'finance', REVIEW_MONEY_LOG_ROW_ROLES, {
        endpoint: 'E-109',
        operationId: 'reviewMoneyLogRow',
        summary: 'Mark a money-log row reviewed',
        description: 'Marks one row reviewed with a note, once. It never changes the ledger.',
      }),
      params: ReviewParams,
      body: ReviewBody,
    })
    .get('/units/:id/money-log', byUnit, {
      ...read({
        endpoint: 'E-110',
        operationId: 'getUnitMoneyLog',
        summary: 'Get the money log of a unit',
        description: 'The gateway events of one unit, newest first, open and reviewed.',
      }),
      params: IdParams,
      query: UnitQuery,
    })
}
