import { formatTime } from '@rms/shared-types'
import { type FormEvent, type ReactElement, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog, useExit } from '../../components/ui/dialog'
import { TextAreaField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useVoidChargeMutation } from '../debts/hooks'

/** The reason bounds of E-100 (DOC-51 §11A, the recall dialog's too). */
const REASON_MIN = 5
const REASON_MAX = 500

/** The 409s that mean the charge moved under the dialog. A money action shows the fresh row and never offers an overwrite (DR-310). */
const LOST_CODES = new Set(['charge_not_voidable', 'version_conflict', 'invalid_transition'])

/** The charge a `W-Charge-Void` dialog shows: the row the host screen already holds (E-93 or E-102), no extra read (DOC-66). */
export interface VoidTarget {
  chargeId: string
  version: number
  unitCode: string
  amount: number
  batchCode?: string
  /** The unit of the charge, when the host knows it: its debt query is refreshed after the void. */
  unitId?: string
  hasActiveIntent: boolean
  /** The owner's name for the summary line, when the host's row carries it (E-93 `ownerName`, or E-102 `owner.name`). */
  ownerName?: string
  /** When the active payment intent started (E-102 `activeIntent.since`); the warning names it. */
  intentSince?: string
}

/** DOC-66 `W-Charge-Void`. `open` is true while the host's `dialog=void` is set; the host clears it in `onClose`. `target` is undefined until the row is found. */
export function ChargeVoidDialog({
  open,
  target,
  onClose,
  onVoided,
}: {
  open: boolean
  target: VoidTarget | undefined
  onClose: () => void
  onVoided: () => void
}): ReactElement | null {
  // The row comes from the host's table; until it is found there is nothing to name, so the panel waits for it.
  if (!open || !target) return null
  // The panel mounts with the dialog, so `useExit` plays its leave motion before the host clears `dialog=void` (DR-304).
  return <ChargeVoidForm target={target} onClose={onClose} onVoided={onVoided} />
}

/** The form itself, mounted while the search param is set: it animates out through `useExit` rather than vanishing (DOC-54 §17). */
function ChargeVoidForm({
  target,
  onClose,
  onVoided,
}: {
  target: VoidTarget
  onClose: () => void
  onVoided: () => void
}) {
  const { t, formatMoney } = useI18n()
  const voidCharge = useVoidChargeMutation()
  const { open, close } = useExit(onClose)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  // The charge was paid, changed or already void: the answer is the "lost" view, never a form to retry (DR-310).
  const [lost, setLost] = useState(false)
  const trimmed = reason.trim()
  const pending = voidCharge.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBanner(null)
    if (trimmed.length < REASON_MIN) {
      setError(t('error.reason_too_short', { min: REASON_MIN }))
      return
    }
    if (trimmed.length > REASON_MAX) {
      setError(t('error.reason_too_long', { max: REASON_MAX }))
      return
    }
    voidCharge.mutate(
      { id: target.chargeId, version: target.version, reason: trimmed, unitId: target.unitId },
      {
        onSuccess: () => {
          toast.success(t('web.charge-void.done', { unit: target.unitCode }))
          onVoided()
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (LOST_CODES.has(failure.code)) setLost(true)
          else if (failure.code === 'reason_too_short' || failure.code === 'reason_too_long')
            setError(errorText(t, failure))
          // Another failure (403, network, 5xx) stays a form with the reason to fix.
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.charge-void.title', { unit: target.unitCode })}
      dismissible={!pending}
      footer={
        lost ? (
          // The charge changed under the dialog: the only way out is to close and look at the fresh row.
          <Button variant="ghost" onClick={close} data-testid="charge-void-close">
            {t('common.action.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              {t('common.action.close')}
            </Button>
            {/* Disabled at once while it sends (`loading`); an out-of-range reason is answered under the field, so it stays pressable. */}
            <Button
              type="submit"
              form="charge-void-form"
              loading={pending}
              data-testid="charge-void-submit"
            >
              {t('web.charge-void.submit')}
            </Button>
          </>
        )
      }
    >
      {lost ? (
        <div className="py-2" data-testid="charge-void-lost">
          <Banner tone="warning">{t('web.charge-void.lost')}</Banner>
        </div>
      ) : (
        <form
          id="charge-void-form"
          onSubmit={submit}
          className="flex flex-col gap-4 py-2"
          noValidate
        >
          {banner && <Banner tone="danger">{banner}</Banner>}
          <p className="text-secondary text-ink-muted" data-testid="charge-void-summary">
            {t('web.charge-void.summary', {
              batch: target.batchCode ?? '—',
              owner: target.ownerName ?? target.unitCode,
              amount: formatMoney(target.amount),
            })}
          </p>
          {target.hasActiveIntent && (
            <div data-testid="charge-void-intent">
              <Banner tone="warning">
                {t('web.charge-void.intent', {
                  time: target.intentSince ? formatTime(target.intentSince) : '',
                })}
              </Banner>
            </div>
          )}
          <p className="text-secondary text-ink-muted">{t('web.charge-void.body')}</p>
          <TextAreaField
            label={t('web.charge-void.reason')}
            required
            rows={3}
            maxLength={REASON_MAX}
            placeholder={t('web.charge-void.reason.placeholder')}
            hint={t('web.charge-void.reason.counter', { count: reason.length, max: REASON_MAX })}
            error={error ?? undefined}
            value={reason}
            data-testid="charge-void-reason"
            onChange={(event) => {
              setReason(event.target.value)
              if (error) setError(null)
            }}
          />
        </form>
      )}
    </Dialog>
  )
}
