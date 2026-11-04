import { type ReactElement, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type FeeBatchView, useFeeBatchMutations } from './hooks'

interface FieldErrors {
  nameVi?: string
  nameEn?: string
  dueDate?: string
}

/** The field of a `validation_failed` path (`name.vi`, `name.en`, `dueDate`). */
function fieldOf(path: string): keyof FieldErrors | null {
  if (path === 'name.vi' || path === 'name') return 'nameVi'
  if (path === 'name.en') return 'nameEn'
  if (path === 'dueDate') return 'dueDate'
  return null
}

/** The field errors of a `validation_failed` answer (DOC-55 §14). */
function fieldErrorsOf(details: unknown, t: ReturnType<typeof useI18n>['t']): FieldErrors {
  const next: FieldErrors = {}
  for (const detail of (Array.isArray(details) ? details : []) as {
    path?: string
    code?: string
    message?: string
  }[]) {
    const field = fieldOf(detail.path ?? '')
    if (field !== null && detail.code)
      next[field] = errorText(t, { code: detail.code, message: detail.message ?? '' })
  }
  return next
}

/** The header pencil: the name and the due date of a draft through E-92 (DOC-66 §4, §6). */
export function EditBatchDialog({
  open,
  batch,
  onClose,
  onSaved,
  onConflict,
}: {
  open: boolean
  batch: FeeBatchView
  onClose: () => void
  onSaved: () => void
  onConflict: () => void
}): ReactElement {
  const { t } = useI18n()
  const { update } = useFeeBatchMutations(batch.id)
  const [nameVi, setNameVi] = useState(batch.name.vi)
  const [nameEn, setNameEn] = useState(batch.name.en ?? '')
  const [dueDate, setDueDate] = useState<string>(batch.dueDate)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNameVi(batch.name.vi)
    setNameEn(batch.name.en ?? '')
    setDueDate(batch.dueDate)
    setErrors({})
    setBanner(null)
  }, [open, batch.name.vi, batch.name.en, batch.dueDate])

  const submit = () => {
    setErrors({})
    setBanner(null)
    const body = {
      name: { vi: nameVi.trim(), ...(nameEn.trim() !== '' ? { en: nameEn.trim() } : {}) },
      dueDate,
    }
    update.mutate(
      { version: batch.version, body },
      {
        onSuccess: () => {
          toast.success(t('common.feedback.saved'))
          onSaved()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'version_conflict') {
            onConflict()
            setBanner(errorText(t, failure))
            return
          }
          const next = fieldErrorsOf(failure.details, t)
          if (Object.keys(next).length > 0) setErrors(next)
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('web.fee-batch.edit.title')}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            loading={update.isPending}
            disabled={nameVi.trim() === '' || dueDate === ''}
            data-testid="batch-edit-save"
            onClick={submit}
          >
            {t('common.action.save')}
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
          label={t('web.fee-batch.edit.field.name-vi')}
          required
          maxLength={200}
          value={nameVi}
          error={errors.nameVi}
          data-testid="batch-edit-name-vi"
          onChange={(event) => setNameVi(event.target.value)}
        />
        <TextField
          label={t('web.fee-batch.edit.field.name-en')}
          maxLength={200}
          value={nameEn}
          error={errors.nameEn}
          data-testid="batch-edit-name-en"
          onChange={(event) => setNameEn(event.target.value)}
        />
        <TextField
          type="date"
          label={t('web.fee-batch.edit.field.due')}
          required
          value={dueDate}
          error={errors.dueDate}
          data-testid="batch-edit-due"
          onChange={(event) => setDueDate(event.target.value)}
        />
      </form>
    </Dialog>
  )
}
