import {
  describedEnum,
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  RECORD_MANUAL_PAYMENT_ROLES,
  type RecordManualPayment,
} from '../application/use-cases/record-manual-payment'
import { VOID_PAYMENT_ROLES, type VoidPayment } from '../application/use-cases/void-payment'
import type { ManualPaymentInput } from '../domain/manual-payment'
import { amountOf, paymentBody } from './bodies'
import { staffAccount } from './http'

export interface PaymentRouteDeps {
  recordManualPayment: RecordManualPayment
  voidPayment: VoidPayment
  guards: Guards
  idempotent: Idempotent
}

const RecordBody = strictObject(
  {
    unitId: Type.String({ format: 'uuid', description: 'The unit that paid' }),
    chargeIds: Type.Array(
      Type.String({ format: 'uuid', description: 'An open charge of the unit' }),
      {
        description:
          'The whole charges the payment covers, 1 to 50, all of the unit. The payment is the sum of the charges (DR-267)',
      },
    ),
    amount: Type.Optional(
      Type.Union([
        Type.Integer({
          description:
            'Only a check: it must equal the sum of the charges, else 422 `allocation_mismatch`',
        }),
        Type.Null(),
      ]),
    ),
    method: describedEnum(
      {
        cash: 'Cash handed over at the office',
        bank_transfer: 'A bank transfer checked by the staff',
      },
      'How the money was paid',
    ),
    payerName: Type.String({
      maxLength: 200,
      description: 'Who handed over the money, 1 to 120 characters',
    }),
    receivedOn: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description:
        "The day the money was received, `YYYY-MM-DD` in the building's time zone; not in the future, and for a Manager not more than 90 days back",
    }),
    bankReference: Type.Optional(
      Type.Union([
        Type.String({ maxLength: 100, description: 'The reference of the transfer' }),
        Type.Null(),
      ]),
    ),
    statementLineId: Type.Optional(
      Type.Union([
        Type.String({ format: 'uuid', description: 'An unmatched statement line to link' }),
        Type.Null(),
      ]),
    ),
    note: Type.Optional(
      Type.Union([
        Type.String({ maxLength: 500, description: 'A note kept with the payment' }),
        Type.Null(),
      ]),
    ),
    dryRun: Type.Optional(
      Type.Boolean({
        description: 'Only plan: answers the sum, the lines and the warnings and writes nothing',
      }),
    ),
  },
  { description: 'The payment to record (DOC-22 §5.1)' },
)

const VoidBody = strictObject(
  {
    reason: Type.String({
      maxLength: 1000,
      description: 'Why the payment is voided, 5 to 500 characters',
    }),
  },
  { description: 'The reason of the void (DOC-22 §6)' },
)

/** E-104 and E-105: a manual payment and its void (DOC-22 §5, §6, P2-15). */
export function paymentRoutes(d: PaymentRouteDeps) {
  const record = async (context: {
    body: Static<typeof RecordBody>
    request: Request
    set: RouteSet
  }) => {
    // The wrapper has already refused a missing or malformed key (400); the use case keeps it as `payment.client_key`.
    const key = context.request.headers.get('idempotency-key') as string
    const result = await d.recordManualPayment.execute(
      staffOf(context),
      context.body as ManualPaymentInput,
      key,
    )
    if (result.kind === 'dry_run') {
      return {
        dryRun: true as const,
        amount: amountOf(result.amount),
        lines: result.lines.map((line) => ({ ...line, amount: amountOf(line.amount) })),
        receiptCount: result.receiptCount,
        warnings: result.warnings.map((warning) => ({
          chargeId: warning.chargeId,
          code: warning.code,
          since: warning.since.toISOString(),
        })),
      }
    }
    context.set.status = result.replayed ? 200 : 201
    if (result.replayed) context.set.headers['idempotent-replayed'] = 'true'
    return paymentBody(result.payment)
  }

  const voidIt = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof VoidBody>
  }) => {
    const out = await d.voidPayment.execute(staffOf(context), context.params.id, context.body)
    return { ...paymentBody(out.payment), chargeIds: out.chargeIds }
  }

  return routePlugin({ prefix: '/staff/payments' })
    .post('/', d.idempotent({ account: staffAccount }, record), {
      ...staffRoute(d.guards, 'finance', RECORD_MANUAL_PAYMENT_ROLES, {
        endpoint: 'E-104',
        operationId: 'recordManualPayment',
        summary: 'Record a cash or bank-transfer payment',
        description:
          'Records the payment of whole open charges of one unit; the amount is their sum and is never sent. 201 with the receipts (one per charge), or 200 with `Idempotent-Replayed: true` when the same `Idempotency-Key` is sent again. `dryRun: true` answers the plan and writes nothing. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: RecordBody,
    })
    .post('/:id/void', voidIt, {
      ...staffRoute(d.guards, 'finance', VOID_PAYMENT_ROLES, {
        endpoint: 'E-105',
        operationId: 'voidPayment',
        summary: 'Void a cash or bank-transfer payment',
        description:
          'Voids the payment, keeps the numbers of its receipts, and reopens its charges. An online payment is not voidable here (409 `payment_not_voidable`).',
      }),
      params: IdParams,
      body: VoidBody,
    })
}
