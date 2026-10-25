import { Type } from '@sinclair/typebox'
import { useEffect, useMemo, useState } from 'react'
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
import { type UnitDetail, useUnitMutations } from './hooks'

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
const FIELDS = ['code', 'floor', 'bedrooms', 'areaM2', 'occupancy', 'note'] as const

const valuesOf = (unit: UnitDetail): Values => ({
  code: unit.code,
  floor: unit.floor === null ? '' : String(unit.floor),
  bedrooms: unit.bedrooms === null ? '' : String(unit.bedrooms),
  areaM2: unit.areaM2 ?? '',
  occupancy: unit.occupancy,
  note: unit.note ?? '',
})

/** "Sửa thông tin căn" (E-60): sends only what changed with `If-Match`; a conflict keeps the typed values (UX-02). */
export function UnitEditDialog({
  unit,
  open,
  onClose,
}: {
  unit: UnitDetail
  open: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const { update } = useUnitMutations()
  const [banner, setBanner] = useState<string | null>(null)
  const resolver = useMemo(() => formResolver<Values>(Schema, t), [t])
  const form = useForm<Values>({ resolver, defaultValues: valuesOf(unit) })

  useEffect(() => {
    if (open) form.reset(valuesOf(unit))
    // Reopened with the loaded unit; a conflict refetch does not wipe an open form (the effect depends on `open` only).
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [open])

  const submit = form.handleSubmit((values) => {
    setBanner(null)
    const before = valuesOf(unit)
    const body: Record<string, unknown> = {}
    if (values.code.trim() !== before.code) body.code = values.code.trim()
    if (values.floor !== before.floor)
      body.floor = values.floor === '' ? null : Number(values.floor)
    if (values.bedrooms !== before.bedrooms)
      body.bedrooms = values.bedrooms === '' ? null : Number(values.bedrooms)
    if (values.areaM2 !== before.areaM2)
      body.areaM2 = values.areaM2 === '' ? null : values.areaM2.replace(',', '.')
    if (values.occupancy !== before.occupancy) body.occupancy = values.occupancy
    if (values.note.trim() !== before.note)
      body.note = values.note.trim() === '' ? null : values.note.trim()
    if (Object.keys(body).length === 0) return onClose()
    update.mutate(
      { id: unit.unitId, version: unit.version, body },
      {
        onSuccess: () => {
          toast.success(t('web.unit-detail.toast.saved'))
          onClose()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'unit_code_in_use')
            form.setError(
              'code',
              { type: failure.code, message: errorText(t, failure) },
              { shouldFocus: true },
            )
          else {
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
      onOpenChange={(next) => !next && onClose()}
      title={t('web.unit-detail.dialog.edit.title')}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form="unit-edit-form" loading={update.isPending}>
            {t('web.unit-detail.dialog.edit.confirm')}
          </Button>
        </>
      }
    >
      <form id="unit-edit-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextField
          label={`${t('web.units.dialog.add.field.code.label')} *`}
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
