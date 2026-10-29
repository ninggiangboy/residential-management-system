import { useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { usePhoneLookup } from '../residents/hooks'
import { type UnitDetail, useUnitMutations } from './hooks'

/** "Chuyển chủ hộ" (E-61): the form keeps what was typed when a 409 refetches the unit (UIWR-09). */
export function TransferDialog({
  unit,
  open,
  onClose,
}: {
  unit: UnitDetail
  open: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { transfer } = useUnitMutations()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [keep, setKeep] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; reason?: string }>({})
  const [banner, setBanner] = useState<string | null>(null)
  const lookup = usePhoneLookup(phone)
  const existing = lookup.data ?? null
  const fullName = existing?.fullName ?? name
  const others = unit.members.length

  const close = () => {
    setPhone('')
    setName('')
    setKeep(false)
    setReason('')
    setFieldErrors({})
    setBanner(null)
    onClose()
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setBanner(null)
    setFieldErrors({})
    if (reason.trim().length < 5) {
      setFieldErrors({ reason: t('error.validation_failed') })
      return
    }
    transfer.mutate(
      {
        id: unit.unitId,
        version: unit.version,
        phone: phone.trim(),
        fullName: fullName.trim(),
        keepMembers: keep,
        reason: reason.trim(),
      },
      {
        onSuccess: (result) => {
          toast.success(t('web.unit-detail.toast.transferred', { count: result.removedMembers }))
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          // The page refetches the unit; the typed values stay in this dialog and nothing is replayed (UX-02).
          if (failure.code === 'member_exists' || failure.code === 'phone_invalid')
            setFieldErrors({ phone: errorText(t, failure) })
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.unit-detail.dialog.transfer.title', { code: unit.code })}
      dismissible={!transfer.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={transfer.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            type="submit"
            form="transfer-form"
            loading={transfer.isPending}
            disabled={phone.trim() === '' || fullName.trim() === '' || reason.trim().length < 5}
          >
            {t('web.unit-detail.dialog.transfer.confirm')}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextField
          type="tel"
          autoComplete="off"
          label={t('web.unit-detail.dialog.transfer.field.phone.label')}
          required
          placeholder={t('common.field.phone.placeholder')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={fieldErrors.phone}
        />
        {existing && (
          <Banner tone="info">
            {t('web.unit-detail.dialog.transfer.existing', {
              name: existing.fullName ?? existing.phone,
            })}
          </Banner>
        )}
        <TextField
          autoComplete="off"
          label={t('web.unit-detail.dialog.transfer.field.name.label')}
          required
          placeholder={t('common.field.name.placeholder')}
          value={fullName}
          disabled={existing !== null}
          onChange={(event) => setName(event.target.value)}
        />
        {others > 0 && (
          <Checkbox
            checked={keep}
            onCheckedChange={setKeep}
            label={t('web.unit-detail.dialog.transfer.field.keep.label', { count: others })}
          />
        )}
        <TextAreaField
          label={t('web.unit-detail.dialog.transfer.field.reason.label')}
          required
          placeholder={t('web.unit-detail.dialog.transfer.field.reason.placeholder')}
          rows={3}
          value={reason}
          error={fieldErrors.reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {unit.owner && (
          <p className="text-secondary text-ink-muted">
            {t('web.unit-detail.dialog.transfer.body', {
              name: unit.owner.fullName ?? unit.owner.phone,
            })}
          </p>
        )}
      </form>
    </Dialog>
  )
}
