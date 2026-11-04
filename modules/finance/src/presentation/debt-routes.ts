import {
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, type Money, money, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  DEBT_READ_ROLES,
  type DebtQueries,
  type DebtRowView,
  type DebtSummary,
  type UnitDebtDetail,
} from '../application/queries/debt-queries'
import {
  SEND_DEBT_REMINDERS_ROLES,
  type SendDebtReminders,
} from '../application/use-cases/send-debt-reminders'
import { amountOf } from './bodies'
import { cursorDate, decodeCursor, encodeCursor, staffAccount, wholeParam } from './http'

export interface DebtRouteDeps {
  debts: DebtQueries
  sendDebtReminders: SendDebtReminders
  guards: Guards
  idempotent: Idempotent
}

const ListQuery = Type.Object({
  month: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}$',
      description: 'Only the charges of the batches of this fee month, `YYYY-MM`',
    }),
  ),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'A part of the unit code' })),
  overdue: Type.Optional(
    Type.Literal('30', {
      description: '`30`: only the units with a charge more than 30 days past due',
    }),
  ),
  limit: Type.Optional(Type.String({ description: 'The page size, 1 to 100, default 25' })),
  cursor: Type.Optional(Type.String({ description: 'The `nextCursor` of the previous page' })),
})
const UnitQuery = Type.Object({
  paymentsCursor: Type.Optional(
    Type.String({ description: 'The `nextCursor` of the previous page of payments' }),
  ),
})
const ReminderBody = strictObject(
  {
    unitIds: Type.Array(Type.String({ format: 'uuid', description: 'A unit that owes' }), {
      description: 'The units to remind, 1 to 500',
    }),
  },
  { description: 'The units to send a payment reminder to (DOC-22 §8.5)' },
)

/** The money of a cursor; text that is not a whole number is a 400 `invalid_cursor`. */
function outstandingOf(text: string): Money {
  try {
    return money(BigInt(text))
  } catch {
    throw new ValidationError([], 'invalid_cursor', 'The cursor is not valid')
  }
}

const rowBody = (row: DebtRowView) => ({
  unitId: row.unitId,
  unitCode: row.unitCode,
  ownerName: row.ownerName,
  ownerPhone: row.ownerPhone,
  outstanding: amountOf(row.outstanding),
  openCharges: row.openCharges,
  oldestDue: row.oldestDue,
  maxDaysPastDue: row.maxDaysPastDue,
  overdue30: amountOf(row.overdue30),
  lastReminderAt: row.lastReminderAt?.toISOString() ?? null,
})

const summaryBody = (summary: DebtSummary) => ({
  outstanding: amountOf(summary.outstanding),
  units: summary.units,
  ownedUnits: summary.ownedUnits,
  overdue30: { amount: amountOf(summary.overdue30.amount), units: summary.overdue30.units },
  collected: summary.collected
    ? {
        feeMonth: summary.collected.feeMonth,
        amount: amountOf(summary.collected.amount),
        rate: summary.collected.rate,
      }
    : null,
})

const unitBody = (detail: UnitDebtDetail) => ({
  unit: detail.unit,
  owner: detail.owner,
  summary: {
    outstanding: amountOf(detail.summary.outstanding),
    openCharges: detail.summary.openCharges,
    nearestDue: detail.summary.nearestDue,
    overdueAmount: amountOf(detail.summary.overdueAmount),
  },
  openCharges: detail.openCharges.map((charge) => ({
    ...charge,
    amount: amountOf(charge.amount),
    activeIntent: charge.activeIntent ? { since: charge.activeIntent.since.toISOString() } : null,
  })),
  payments: detail.payments.map((payment) => ({
    ...payment,
    amount: amountOf(payment.amount),
    receivedAt: payment.receivedAt.toISOString(),
  })),
  nextCursor: detail.nextCursor
    ? encodeCursor({
        t: detail.nextCursor.receivedAt.toISOString(),
        i: detail.nextCursor.paymentId,
      })
    : null,
})

/** E-101, E-102 and E-103: the debt of the building, of one unit, and the reminders (DOC-22 §8, DOC-66 §5; P2-15). */
export function debtRoutes(d: DebtRouteDeps) {
  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const q = context.query
    const limit = wholeParam('limit', q.limit, 1, 100) ?? 25
    const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor, ['o', 'i'] as const)
    const page = await d.debts.list(staffOf(context).scope, {
      limit,
      summary: after === undefined,
      filter: { month: q.month, q: q.q, overdue30: q.overdue === '30' ? true : undefined },
      after:
        after === undefined ? undefined : { outstanding: outstandingOf(after.o), unitId: after.i },
    })
    return {
      items: page.rows.map(rowBody),
      nextCursor: page.next
        ? encodeCursor({ o: String(page.next.outstanding), i: page.next.unitId })
        : null,
      ...(page.summary ? { summary: summaryBody(page.summary), asOf: page.asOf } : {}),
    }
  }

  const unit = async (context: {
    params: Static<typeof IdParams>
    query: Static<typeof UnitQuery>
  }) => {
    const cursor = context.query.paymentsCursor
    const after = cursor === undefined ? undefined : decodeCursor(cursor, ['t', 'i'] as const)
    return unitBody(
      await d.debts.unitView(staffOf(context).scope, context.params.id, {
        paymentsAfter:
          after === undefined ? undefined : { receivedAt: cursorDate(after.t), paymentId: after.i },
      }),
    )
  }

  const remind = async (context: {
    body: Static<typeof ReminderBody>
    request: Request
    set: RouteSet
  }) => d.sendDebtReminders.execute(staffOf(context), context.body)

  const read = (info: Parameters<typeof staffRoute>[3]) =>
    staffRoute(d.guards, 'finance', DEBT_READ_ROLES, info)

  return routePlugin({ prefix: '/staff' })
    .get('/debts', list, {
      ...read({
        endpoint: 'E-101',
        operationId: 'listDebts',
        summary: 'List the units that owe',
        description:
          'One row per unit with an open charge, the largest debt first, with filters and keyset paging. The first page also carries the tiles of the screen and the building day (`asOf`).',
      }),
      query: ListQuery,
    })
    .get('/units/:id/debt', unit, {
      ...read({
        endpoint: 'E-102',
        operationId: 'getUnitDebt',
        summary: 'Get the debt of a unit',
        description:
          'The unit, its owner, its open charges and a page of its payments with their receipts, for the payment form and the unit panel.',
      }),
      params: IdParams,
      query: UnitQuery,
    })
    .post('/debts/reminders', d.idempotent({ account: staffAccount }, remind), {
      ...staffRoute(d.guards, 'finance', SEND_DEBT_REMINDERS_ROLES, {
        endpoint: 'E-103',
        operationId: 'sendDebtReminders',
        summary: 'Send payment reminders',
        description:
          'Reminds the members of 1 to 500 units that owe, once per unit per building day. At most 10 requests per hour per account (429 beyond). Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: ReminderBody,
    })
}
