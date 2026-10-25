import { Type } from '@sinclair/typebox'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { SelectField } from '../../components/ui/select-field'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { applyServerErrors, formResolver } from '../../lib/forms'
import { errorText, useI18n } from '../../lib/i18n'
import { useIntent } from '../../lib/use-intent'
import { useUnitMutations } from './hooks'

interface Values {
  code: string
  floor: string
  bedrooms: string
  areaM2: string
  occupancy: 'occupied' | 'rented' | 'vacant'
  note: string
}
const Schema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }),
  floor: Type.String({ pattern: '^-?\\d{0,3}$' }),
  bedrooms: Type.String({ pattern: '^\\d{0,2}$' }),
  areaM2: Type.String({ pattern: '^(\\d{1,6}([.,]\\d{1,2})?)?$' }),
  occupancy: Type.Union([Type.Literal('occupied'), Type.Literal('rented'), Type.Literal('vacant')]),
  note: Type.String({ maxLength: 2000 }),
})
const EMPTY: Values = {
  code: '',
  floor: '',
  bedrooms: '',
  areaM2: '',
  occupancy: 'vacant',
  note: '',
}
const FIELDS = ['code', 'floor', 'bedrooms', 'areaM2', 'occupancy', 'note'] as const

/** "Thêm căn hộ" (`?dialog=add` of `W-Units`, DOC-65): the form of E-58. */
export function UnitAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { create } = useUnitMutations()
  const intent = useIntent()
  const [banner, setBanner] = useState<string | null>(null)
  const resolver = useMemo(() => formResolver<Values>(Schema, t), [t])
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
          void navigate({ to: '/units/$unitId', params: { unitId: unit.unitId }, search: {} })
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
            const text = applyServerErrors(form, failure, FIELDS, errorText(t, failure))
            if (text) setBanner(text)
          }
        },
      },
    )
  })

  const errors = form.formState.errors
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
        <TextField
          label={`${t('web.units.dialog.add.field.code.label')} *`}
          autoComplete="off"
          error={errors.code?.message}
          {...form.register('code')}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('web.units.dialog.add.field.floor.label')}
            inputMode="numeric"
            error={errors.floor?.message}
            {...form.register('floor')}
          />
          <TextField
            label={t('web.units.dialog.add.field.bedrooms.label')}
            inputMode="numeric"
            error={errors.bedrooms?.message}
            {...form.register('bedrooms')}
          />
        </div>
        <TextField
          label={t('web.units.dialog.add.field.area.label')}
          inputMode="decimal"
          error={errors.areaM2?.message}
          {...form.register('areaM2')}
        />
        <Controller
          control={form.control}
          name="occupancy"
          render={({ field }) => (
            <SelectField
              label={t('web.units.dialog.add.field.occupancy.label')}
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'occupied', label: t('status.unit.occupied') },
                { value: 'rented', label: t('status.unit.rented') },
                { value: 'vacant', label: t('status.unit.vacant') },
              ]}
            />
          )}
        />
        <TextAreaField
          label={t('web.units.dialog.add.field.note.label')}
          rows={3}
          error={errors.note?.message}
          {...form.register('note')}
        />
      </form>
    </Dialog>
  )
}
