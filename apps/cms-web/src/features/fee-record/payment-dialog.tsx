import { useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Checkbox, RadioCards } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { Icon } from '../../components/ui/icon'
import { Skeleton } from '../../components/ui/skeleton'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { downloadFile } from '../../lib/download'
import { errorText, useI18n } from '../../lib/i18n'
import { useDebounced } from '../../lib/use-debounced'
import { useIntent } from '../../lib/use-intent'
import {
  type PaymentInput,
  type PaymentPlan,
  receiptPdfPath,
  type UnitDebt,
  useUnitPaymentMutations,
} from '../debts/hooks'

type OpenCharge = UnitDebt['openCharges'][number]

const pad = (value: number) => String(value).padStart(2, '0')
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const daysAgo = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return isoDay(date)
}

/** The open charges as checkable rows with their amounts and any online intent holding them (DOC-66 §4). */
function ChargeChoices({
  charges,
  checked,
  onToggle,
}: {
  charges: readonly OpenCharge[]
  checked: readonly string[]
  onToggle: (chargeId: string, next: boolean) => void
}) {
  const { t, lang, formatMoney, formatDateTime } = useI18n()
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-label text-ink">{t('web.fee-record.pay.charges')}</legend>
      {charges.map((charge) => (
        <div key={charge.chargeId} className="rounded-control border border-line p-3">
          <Checkbox
            checked={checked.includes(charge.chargeId)}
            onCheckedChange={(next) => onToggle(charge.chargeId, next)}
            label={
              <span className="flex items-center justify-between gap-3">
                <span className="text-body-strong">
                  {lang === 'en'
                    ? (charge.batch.name.en ?? charge.batch.name.vi)
                    : charge.batch.name.vi}
                </span>
                <span className="tabular-nums">{formatMoney(charge.amount)}</span>
              </span>
            }
          />
          {charge.activeIntent && (
            <p
              className="mt-1.5 flex items-center gap-1 text-secondary text-ink-muted"
              data-testid="intent-warning"
            >
              <Icon name="warning" size="sm" weight="fill" className="text-lamp" />
              {t('web.fee-record.intent-warning', {
                time: formatDateTime(charge.activeIntent.since),
              })}
            </p>
          )}
        </div>
      ))}
    </fieldset>
  )
}

/** The success panel: the amount recorded and one "View receipt" per receipt created (DOC-66 §6). */
function PaymentResult({
  amount,
  receipts,
  onView,
}: {
  amount: number
  receipts: readonly { receiptId: string; number: string }[]
  onView: (receiptId: string, number: string) => void
}) {
  const { t, formatMoney } = useI18n()
  return (
    <div className="flex flex-col gap-4 py-2">
      <Banner tone="success">
        {t('web.fee-record.pay.done', {
          amount: formatMoney(amount),
          numbers: receipts.map((receipt) => receipt.number).join(', '),
        })}
      </Banner>
      <ul className="flex flex-col gap-2">
        {receipts.map((receipt) => (
          <li key={receipt.receiptId} className="flex items-center justify-between gap-3">
            <span className="tabular-nums text-ink">{receipt.number}</span>
            <Button
              size="sm"
              variant="ghost"
              icon="download-simple"
              onClick={() => onView(receipt.receiptId, receipt.number)}
            >
              {t('web.fee-record.receipt.view')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * DOC-66 `W-Fee-Record`: the manual payment of whole open charges (E-104). The dialog computes the sum of the charges ticked, plans
 * it with a `dryRun` (debounced 300 ms) and records it under one `Idempotency-Key` per open; a charge paid elsewhere (409
 * `charge_changed`) refreshes the list rather than overwriting it.
 */
export function PaymentDialog({
  open,
  openCharges,
  unitId,
  unitCode,
  ownerName,
  selectedChargeIds,
  isAdmin,
  onClose,
  onPaid,
  onConflict,
}: {
  open: boolean
  openCharges: readonly OpenCharge[]
  unitId: string
  unitCode: string
  ownerName: string | null
  selectedChargeIds: readonly string[]
  /** An Admin may back-date a payment more than 90 days (FR-05.5); a Manager may not. */
  isAdmin: boolean
  onClose: () => void
  onPaid: () => void
  /** A `charge_changed` conflict refetches the debt behind the dialog (the dialog never overwrites a paid charge). */
  onConflict: () => void
}) {
  const { t, formatMoney } = useI18n()
  const { planPayment, recordPayment } = useUnitPaymentMutations(unitId)
  const intent = useIntent()
  const [checked, setChecked] = useState<string[]>([])
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [payerName, setPayerName] = useState('')
  const [receivedOn, setReceivedOn] = useState(isoDay(new Date()))
  const [bankReference, setBankReference] = useState('')
  const [note, setNote] = useState('')
  const [plan, setPlan] = useState<PaymentPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [changed, setChanged] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [done, setDone] = useState<{
    amount: number
    receipts: readonly { receiptId: string; number: string }[]
  } | null>(null)

  // The dialog opens on the charges the page ticked, or all of them when the page ticked none (DOC-66 §4, UIWF-32).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the form is seeded once per open, not on every debt refetch
  useEffect(() => {
    if (!open) return
    const ids = openCharges.map((charge) => charge.chargeId)
    const seed =
      selectedChargeIds.length > 0 ? selectedChargeIds.filter((id) => ids.includes(id)) : ids
    setChecked(seed)
    setMethod('cash')
    setPayerName(ownerName ?? '')
    setReceivedOn(isoDay(new Date()))
    setBankReference('')
    setNote('')
    setPlan(null)
    setPlanning(false)
    setChanged(false)
    setDateError(null)
    setBanner(null)
    setDone(null)
    intent.reset()
  }, [open])

  // A charge paid or voided elsewhere leaves the selection, so the sum never covers a charge that is gone.
  useEffect(() => {
    if (!changed) return
    const openIds = new Set(openCharges.map((charge) => charge.chargeId))
    setChecked((current) => current.filter((id) => openIds.has(id)))
  }, [changed, openCharges])

  const selected = openCharges.filter((charge) => checked.includes(charge.chargeId))
  const sum = selected.reduce((total, charge) => total + charge.amount, 0)
  const input: PaymentInput = {
    unitId,
    chargeIds: selected.map((charge) => charge.chargeId),
    amount: sum,
    method,
    payerName: payerName.trim(),
    receivedOn,
    bankReference:
      method === 'bank_transfer' && bankReference.trim() !== '' ? bankReference.trim() : null,
    note: note.trim() === '' ? null : note.trim(),
  }
  const debounced = useDebounced(JSON.stringify(input), 300)
  const ready = input.chargeIds.length > 0 && input.payerName !== ''

  // The plan writes nothing: it answers the sum and the number of receipts, and a 409 refreshes the list (DOC-66 §6).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the debounced input, not on every render
  useEffect(() => {
    if (!open || done) return
    if (!ready) {
      setPlan(null)
      setPlanning(false)
      return
    }
    setPlanning(true)
    setPlan(null)
    planPayment.mutate(
      { input, key: intent.keyFor({ ...input, dryRun: true }) },
      {
        onSuccess: (answer) => {
          setPlan(answer)
          setPlanning(false)
        },
        onError: (thrown) => {
          setPlanning(false)
          if (apiErrorOf(thrown).code === 'charge_changed') {
            setChanged(true)
            onConflict()
          }
        },
      },
    )
  }, [debounced, open, done])

  const close = () => {
    intent.reset()
    onClose()
  }

  const viewReceipt = (receiptId: string, number: string) =>
    void downloadFile(receiptPdfPath(receiptId), `${number}.pdf`).catch(() =>
      toast.error(t('common.error.page.body')),
    )

  const toggle = (chargeId: string, next: boolean) =>
    setChecked((current) =>
      next ? [...current, chargeId] : current.filter((id) => id !== chargeId),
    )

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready || recordPayment.isPending) return
    setBanner(null)
    setDateError(null)
    recordPayment.mutate(
      { input, key: intent.keyFor(input) },
      {
        onSuccess: ({ payment }) => {
          setDone({
            amount: payment.amount,
            receipts: payment.receipts.map((receipt) => ({
              receiptId: receipt.receiptId,
              number: receipt.number,
            })),
          })
          onPaid()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'charge_changed') {
            setChanged(true)
            onConflict()
          } else if (
            failure.code === 'received_on_future' ||
            failure.code === 'received_on_too_old'
          ) {
            setDateError(errorText(t, failure))
          } else {
            if (failure.code === 'idempotency_key_reuse') intent.reset()
            setBanner(errorText(t, failure))
          }
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.fee-record.pay.title', { unit: unitCode })}
      description={t('web.fee-record.pay.subtitle', {
        owner: ownerName ?? unitCode,
        amount: formatMoney(sum),
      })}
      dismissible={!recordPayment.isPending}
      footer={
        done ? (
          <Button variant="outline" onClick={close}>
            {t('common.action.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={recordPayment.isPending}>
              {t('common.action.cancel')}
            </Button>
            <Button
              type="submit"
              form="fee-payment-form"
              data-testid="payment-submit"
              loading={recordPayment.isPending}
              disabled={!ready}
            >
              {t('web.fee-record.pay.submit')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <PaymentResult amount={done.amount} receipts={done.receipts} onView={viewReceipt} />
      ) : (
        <PaymentForm
          openCharges={openCharges}
          checked={checked}
          onToggle={toggle}
          sum={sum}
          plan={plan}
          planning={planning}
          changed={changed}
          banner={banner}
          dateError={dateError}
          isAdmin={isAdmin}
          method={method}
          setMethod={setMethod}
          payerName={payerName}
          setPayerName={setPayerName}
          receivedOn={receivedOn}
          setReceivedOn={setReceivedOn}
          bankReference={bankReference}
          setBankReference={setBankReference}
          note={note}
          setNote={setNote}
          onSubmit={submit}
        />
      )}
    </Dialog>
  )
}

type Method = 'cash' | 'bank_transfer'

/** The payment form of the dialog (§17.9): a field per fact, the plan line, and the hint that a wrong entry is voided. */
function PaymentForm({
  openCharges,
  checked,
  onToggle,
  sum,
  plan,
  planning,
  changed,
  banner,
  dateError,
  isAdmin,
  method,
  setMethod,
  payerName,
  setPayerName,
  receivedOn,
  setReceivedOn,
  bankReference,
  setBankReference,
  note,
  setNote,
  onSubmit,
}: {
  openCharges: readonly OpenCharge[]
  checked: readonly string[]
  onToggle: (chargeId: string, next: boolean) => void
  sum: number
  plan: PaymentPlan | null
  planning: boolean
  changed: boolean
  banner: string | null
  dateError: string | null
  isAdmin: boolean
  method: Method
  setMethod: (method: Method) => void
  payerName: string
  setPayerName: (name: string) => void
  receivedOn: string
  setReceivedOn: (day: string) => void
  bankReference: string
  setBankReference: (value: string) => void
  note: string
  setNote: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const { t, formatMoney } = useI18n()
  return (
    <form id="fee-payment-form" onSubmit={onSubmit} className="flex flex-col gap-4 py-2" noValidate>
      {changed && <Banner tone="warning">{t('web.fee-record.pay.changed')}</Banner>}
      {banner && <Banner tone="danger">{banner}</Banner>}

      <ChargeChoices charges={openCharges} checked={checked} onToggle={onToggle} />

      <TextField
        readOnly
        label={t('web.fee-record.pay.sum')}
        hint={t('web.fee-record.pay.sum.hint')}
        value={formatMoney(sum)}
        data-testid="payment-sum"
      />

      <RadioCards<Method>
        label={t('web.fee-record.pay.method')}
        value={method}
        onValueChange={setMethod}
        options={[
          { value: 'cash', label: t('web.fee-record.pay.method.cash') },
          { value: 'bank_transfer', label: t('web.fee-record.pay.method.bank_transfer') },
        ]}
      />

      <TextField
        label={t('web.fee-record.pay.payer')}
        required
        value={payerName}
        onChange={(event) => setPayerName(event.target.value)}
      />

      <TextField
        type="date"
        label={t('web.fee-record.pay.date')}
        required
        max={isoDay(new Date())}
        min={isAdmin ? undefined : daysAgo(90)}
        value={receivedOn}
        error={dateError}
        onChange={(event) => setReceivedOn(event.target.value)}
      />

      {method === 'bank_transfer' && (
        <TextField
          label={t('web.fee-record.pay.bank-ref')}
          value={bankReference}
          onChange={(event) => setBankReference(event.target.value)}
        />
      )}

      <TextAreaField
        label={t('web.fee-record.pay.note')}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <div
        className="flex h-5 items-center text-secondary text-ink-muted"
        data-testid="payment-receipts"
      >
        {planning ? (
          <Skeleton className="h-3.5 w-40" />
        ) : (
          plan && t('web.fee-record.pay.receipts', { count: plan.receiptCount })
        )}
      </div>

      <p className="text-secondary text-ink-muted">{t('web.fee-record.pay.hint')}</p>
    </form>
  )
}
