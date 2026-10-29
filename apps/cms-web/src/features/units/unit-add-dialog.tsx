import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { toast } from '../../components/ui/toaster'
import { applyServerErrors, formResolver } from '../../lib/forms'
import { errorText, useI18n } from '../../lib/i18n'
import { useIntent } from '../../lib/use-intent'
import { useUnitMutations } from './hooks'
import {
  UNIT_FORM_FIELDS,
  UnitFormFields,
  UnitFormSchema,
  type UnitFormValues as Values,
} from './unit-form'

const EMPTY: Values = {
  code: '',
  floor: '',
  bedrooms: '',
  areaM2: '',
  occupancy: 'vacant',
  note: '',
}

/** "Thêm căn hộ" (`?dialog=add` of `W-Units`, DOC-65): the form of E-58. */
export function UnitAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { create } = useUnitMutations()
  const intent = useIntent()
  const [banner, setBanner] = useState<string | null>(null)
  const resolver = useMemo(() => formResolver<Values>(UnitFormSchema, t), [t])
  const form = useForm<Values>({ resolver, defaultValues: EMPTY })

  const close = () => {
    form.reset(EMPTY)
    setBanner(null)
    intent.reset()
    onClose()
  }

  const submit = form.handleSubmit((values) => {
    setBanner(null)
    const body = {
      code: values.code.trim(),
      occupancy: values.occupancy,
      ...(values.floor !== '' ? { floor: Number(values.floor) } : {}),
      ...(values.bedrooms !== '' ? { bedrooms: Number(values.bedrooms) } : {}),
      ...(values.areaM2 !== '' ? { areaM2: values.areaM2.replace(',', '.') } : {}),
      ...(values.note.trim() !== '' ? { note: values.note.trim() } : {}),
    }
    create.mutate(
      { body, key: intent.keyFor(body) },
      {
        onSuccess: (unit) => {
          toast.success(t('web.units.toast.created', { code: unit.code }))
          form.reset(EMPTY)
          intent.reset()
          void navigate({
            to: '/units/$unitId',
            params: { unitId: unit.unitId },
            search: {},
            replace: true,
          })
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'unit_code_in_use')
            form.setError(
              'code',
              { type: failure.code, message: errorText(t, failure) },
              { shouldFocus: true },
            )
          else if (failure.code === 'idempotency_key_reuse') {
            intent.reset()
            setBanner(errorText(t, failure))
          } else {
            const text = applyServerErrors(form, failure, UNIT_FORM_FIELDS, errorText(t, failure))
            if (text) setBanner(text)
          }
        },
      },
    )
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.units.dialog.add.title')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form="unit-add-form" loading={create.isPending}>
            {t('web.units.dialog.add.confirm')}
          </Button>
        </>
      }
    >
      <form id="unit-add-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {banner && <Banner tone="danger">{banner}</Banner>}
        <UnitFormFields form={form} />
      </form>
    </Dialog>
  )
}
