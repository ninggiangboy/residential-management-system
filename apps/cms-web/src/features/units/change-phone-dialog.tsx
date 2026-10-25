import { useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useUnitMutations } from './hooks'

/** "Đổi SĐT đăng nhập" (E-67): shared by the unit detail and the resident profile (DOC-65). The account and its units stay the same. */
export function ChangePhoneDialog({
  open,
  accountId,
  name,
  currentPhone,
  unitId,
  onClose,
}: {
  open: boolean
  accountId: string
  name: string
  currentPhone: string
  /** The unit page whose detail refetches; the resident profile passes none. */
  unitId?: string
  onClose: () => void
}) {
  const { t, formatPhone } = useI18n()
  const { changePhone } = useUnitMutations()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const close = () => {
    setPhone('')
    setError(null)
    setBanner(null)
    onClose()
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBanner(null)
    changePhone.mutate(
      { accountId, phone: phone.trim(), unitId: unitId ?? '' },
      {
        onSuccess: () => {
          toast.success(t('web.unit-detail.dialog.phone.confirm'))
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (
            failure.code === 'phone_in_use' ||
            failure.code === 'phone_invalid' ||
            failure.code === 'validation_failed'
          )
            setError(errorText(t, failure))
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.unit-detail.dialog.phone.title', { name })}
      dismissible={!changePhone.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={changePhone.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            type="submit"
            form="change-phone-form"
            loading={changePhone.isPending}
            disabled={phone.trim() === ''}
          >
            {t('web.unit-detail.dialog.phone.confirm')}
          </Button>
        </>
      }
    >
      <form
        id="change-phone-form"
        onSubmit={submit}
        className="flex flex-col gap-4 py-2"
        noValidate
      >
        {banner && <Banner tone="danger">{banner}</Banner>}
        <p className="text-body text-ink-muted">
          {t('web.unit-detail.col.phone')}:{' '}
          <span className="text-ink">{formatPhone(currentPhone)}</span>
        </p>
        <TextField
          type="tel"
          autoComplete="off"
          label={t('web.unit-detail.dialog.phone.field.phone.label')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={error}
        />
        <p className="text-secondary text-ink-muted">{t('web.unit-detail.dialog.phone.body')}</p>
      </form>
    </Dialog>
  )
}
