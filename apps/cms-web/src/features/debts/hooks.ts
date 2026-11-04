import { staffKey, unitKey } from '@rms/client-core'
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap } from '../../api/errors'

export interface DebtFilters {
  month?: string
  q?: string
  overdue?: boolean
  cursor?: string
  limit: number
}

/** Query strings are text; `overdue` is the literal `30` of the read, sent only when true (E-101). */
const toQuery = (f: DebtFilters) => ({
  ...(f.month ? { month: f.month } : {}),
  ...(f.q ? { q: f.q } : {}),
  ...(f.overdue ? { overdue: '30' as const } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: String(f.limit),
})

/** E-101, DOC-66 `W-Debts`: no polling; a focus refetch after 60 s keeps the list, and `keepPreviousData` holds a page during a cursor jump (DOC-54 §17, Q1). */
export const debtsQuery = (filters: DebtFilters) =>
  queryOptions({
    queryKey: staffKey('debts', 'list', filters),
    queryFn: async () => unwrap(await api.staff.debts.get({ query: toQuery(filters) })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

export type DebtsPage = NonNullable<Awaited<ReturnType<typeof api.staff.debts.get>>['data']>
export type DebtItem = DebtsPage['items'][number]

/** E-102, CL-15: one unit's debt, keyed by the unit id so a page is never read under another unit. */
export const unitDebtQuery = (unitId: string, paymentsCursor?: string) =>
  queryOptions({
    queryKey: unitKey(unitId, 'debt', paymentsCursor ?? 'first'),
    queryFn: async () =>
      unwrap(
        await api.staff.units({ id: unitId }).debt.get({
          query: paymentsCursor ? { paymentsCursor } : {},
        }),
      ),
    placeholderData: keepPreviousData,
  })

export type UnitDebt = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.staff.units>['debt']['get']>>['data']
>

export type ReminderResult = NonNullable<
  Awaited<ReturnType<typeof api.staff.debts.reminders.post>>['data']
>

/** E-103: the reminders of `W-Debts`; the answer counts the sent, the already-reminded and the no-debt units. */
export function useDebtMutations() {
  const queryClient = useQueryClient()
  const debtsChanged = () => queryClient.invalidateQueries({ queryKey: staffKey('debts') })

  return {
    sendReminders: useMutation({
      mutationFn: async ({ unitIds, key }: { unitIds: string[]; key: string }) =>
        unwrap(
          await api.staff.debts.reminders.post(
            { unitIds },
            { headers: { 'idempotency-key': key } },
          ),
        ),
      onSettled: debtsChanged,
    }),
  }
}

/** DOC-22 §5.1, E-104: the payment the form sends; `amount` is only a check and `dryRun` is added by the caller. */
export interface PaymentInput {
  unitId: string
  chargeIds: string[]
  amount?: number | null
  method: 'cash' | 'bank_transfer'
  payerName: string
  receivedOn: string
  bankReference?: string | null
  note?: string | null
}

type PaymentAnswer = NonNullable<Awaited<ReturnType<typeof api.staff.payments.post>>['data']>
export type PaymentPlan = Extract<PaymentAnswer, { dryRun: true }>
type PaymentBody = Exclude<PaymentAnswer, { dryRun: true }>
type VoidedPayment = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.staff.payments>['void']['post']>>['data']
>

/** E-104 and E-105, DOC-66 `W-Fee-Record`: the payment form and its void, both scoped to one unit's debt. */
export function useUnitPaymentMutations(unitId: string) {
  const queryClient = useQueryClient()
  const settled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: unitKey(unitId, 'debt') }),
      queryClient.invalidateQueries({ queryKey: staffKey('debts') }),
      queryClient.invalidateQueries({ queryKey: staffKey('fee-batches') }),
    ])

  return {
    /** E-104: the plan writes nothing, so nothing is invalidated; `amount` is only a client-side check. */
    planPayment: useMutation({
      mutationFn: async ({ input, key }: { input: PaymentInput; key: string }) =>
        unwrap(
          await api.staff.payments.post(
            { ...input, dryRun: true },
            { headers: { 'idempotency-key': key } },
          ),
        ) as PaymentPlan,
    }),
    /** E-104: a replay carries `idempotent-replayed`. A 409 `charge_changed` is refetched by the screen, never overwritten. */
    recordPayment: useMutation({
      mutationFn: async ({ input, key }: { input: PaymentInput; key: string }) => {
        const answer = await api.staff.payments.post(input, { headers: { 'idempotency-key': key } })
        const payment = unwrap(answer) as PaymentBody
        return { payment, replayed: answer.response.headers.get('idempotent-replayed') === 'true' }
      },
      onSettled: settled,
    }),
    /** E-105: the reason is enough; a void needs no `If-Match` and no idempotency key. */
    voidPayment: useMutation({
      mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
        unwrap(await api.staff.payments({ id }).void.post({ reason })),
      onSettled: settled,
    }),
  }
}

/** E-100, DOC-66 `W-Charge-Void`: one open charge is voided under `If-Match`. */
type VoidedCharge = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.staff.charges>['void']['post']>>['data']
>

/** E-100: shared with the charge-void dialog, whose `unitId` may be unknown; the screens that hold it pass it. */
export function useVoidChargeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      version,
      reason,
    }: {
      id: string
      version: number
      reason: string
      unitId?: string
    }) =>
      unwrap(await api.staff.charges({ id }).void.post({ reason }, { headers: ifMatch(version) })),
    onSettled: (_d, _e, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: staffKey('debts') }),
        queryClient.invalidateQueries({ queryKey: staffKey('fee-batches') }),
        ...(input.unitId
          ? [queryClient.invalidateQueries({ queryKey: unitKey(input.unitId, 'debt') })]
          : []),
      ]),
  })
}

/** E-106: the receipt bytes are saved with `downloadFile` from lib/download.ts; a link would not carry the token. */
export const receiptPdfPath = (receiptId: string) => `/staff/receipts/${receiptId}/pdf`
