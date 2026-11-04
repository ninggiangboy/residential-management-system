import { type ReactElement, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type FeeBatchView, useFeeBatchMutations } from './hooks'

/** "Gia hạn": E-92 with a later due date; an earlier one never sends (DOC-66 §6, UIWF-21). */
export function ExtendDialog({
  open,
  batch,
  onClose,
  onExtended,
  onConflict,
}: {
  open: boolean
  batch: FeeBatchView
  onClose: () => void
  onExtended: () => void
  onConflict: () => void
}): ReactElement {
  const { t, formatDate } = useI18n()
  const { update } = useFeeBatchMutations(batch.id)
  const [dueDate, setDueDate] = useState<string>(batch.dueDate)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  // The form opens on the current due date, not on the last thing typed (DOC-54 §17.9).
  useEffect(() => {
    if (!open) return
    setDueDate(batch.dueDate)
    setFieldError(null)
    setBanner(null)
  }, [open, batch.dueDate])

  const later = dueDate !== '' && dueDate > batch.dueDate

  const submit = () => {
    setFieldError(null)
    setBanner(null)
    if (!later) {
      setFieldError(t('web.fee-batch.extend.hint', { date: formatDate(batch.dueDate) }))
      return
    }
    update.mutate(
      { version: batch.version, body: { dueDate } },
      {
        onSuccess: () => {
          toast.success(t('web.fee-batch.extend.toast'))
          onExtended()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'due_date_not_later') {
            setFieldError(errorText(t, failure))
            return
          }
          if (failure.code === 'version_conflict') onConflict()
          setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('web.fee-batch.extend.title')}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            loading={update.isPending}
            disabled={!later}
            data-testid="extend-confirm"
            onClick={submit}
          >
            {t('web.fee-batch.action.extend')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 py-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextField
          type="date"
          label={t('web.fee-batch.extend.field')}
          required
          min={batch.dueDate}
          value={dueDate}
          hint={t('web.fee-batch.extend.hint', { date: formatDate(batch.dueDate) })}
          error={fieldError ?? undefined}
          data-testid="extend-date"
          onChange={(event) => {
            setDueDate(event.target.value)
            if (fieldError) setFieldError(null)
          }}
        />
      </form>
    </Dialog>
  )
}
