import { useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { TextAreaField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type UnitDebt, useUnitPaymentMutations } from '../debts/hooks'

type Payment = UnitDebt['payments'][number]

const MIN_REASON = 5
const MAX_REASON = 500

/**
 * DOC-66 `W-Fee-Record`: a wrong entry is voided with a reason and entered again, never edited (DOC-22 §6, E-105). Only a cash or
 * bank-transfer payment can be voided here; an online one (409 `payment_not_voidable`) is refunded at the gateway.
 */
export function VoidPaymentDialog({
  open,
  unitId,
  payment,
  onClose,
  onVoided,
}: {
  open: boolean
  unitId: string
  payment: Payment | undefined
  onClose: () => void
  onVoided: () => void
}) {
  const { t } = useI18n()
  const { voidPayment } = useUnitPaymentMutations(unitId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReason('')
    setError(null)
    setBanner(null)
  }, [open])

  const close = () => {
    setReason('')
    setError(null)
    setBanner(null)
    onClose()
  }

  const numbers = payment?.receipts.map((receipt) => receipt.number).join(', ') ?? ''
  const count = payment?.receipts.length ?? 0

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!payment) return
    setError(null)
    setBanner(null)
    if (reason.trim().length < MIN_REASON) {
      setError(t('error.reason_too_short', { min: MIN_REASON }))
      return
    }
    voidPayment.mutate(
      { id: payment.paymentId, reason: reason.trim() },
      {
        onSuccess: (out) => {
          toast.success(t('web.fee-record.void.done', { count: out.chargeIds.length }))
          onVoided()
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'payment_not_voidable') setBanner(t('web.fee-record.void.online'))
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.fee-record.void.title')}
      description={t('web.fee-record.void.body', { count, numbers })}
      dismissible={!voidPayment.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={voidPayment.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            type="submit"
            form="void-payment-form"
            variant="danger"
            data-testid="void-payment-submit"
            loading={voidPayment.isPending}
            disabled={reason.trim().length < MIN_REASON}
          >
            {t('web.fee-record.receipt.void')}
          </Button>
        </>
      }
    >
      <form
        id="void-payment-form"
        onSubmit={submit}
        className="flex flex-col gap-4 py-2"
        noValidate
      >
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextAreaField
          label={t('web.fee-record.void.reason')}
          required
          rows={3}
          maxLength={MAX_REASON}
          value={reason}
          error={error}
          onChange={(event) => setReason(event.target.value)}
        />
      </form>
    </Dialog>
  )
}
