import { Type } from '@sinclair/typebox'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { SelectField } from '../../components/ui/select-field'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'

/** The form of a unit, shared by "Thêm căn hộ" (E-58) and the edit dialog of `W-Unit-Detail` (DOC-65). */
export interface UnitFormValues {
  code: string
  floor: string
  bedrooms: string
  areaM2: string
  occupancy: 'occupied' | 'rented' | 'vacant'
  note: string
}
export const UnitFormSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }),
  floor: Type.String({ pattern: '^-?\\d{0,3}$' }),
  bedrooms: Type.String({ pattern: '^\\d{0,2}$' }),
  areaM2: Type.String({ pattern: '^(\\d{1,6}([.,]\\d{1,2})?)?$' }),
  occupancy: Type.Union([Type.Literal('occupied'), Type.Literal('rented'), Type.Literal('vacant')]),
  note: Type.String({ maxLength: 2000 }),
})
export const UNIT_FORM_FIELDS = [
  'code',
  'floor',
  'bedrooms',
  'areaM2',
  'occupancy',
  'note',
] as const

/** The fields (DOC-65 §6 dialog, DOC-54 §17.9): code beside the status, then floor, bedrooms and area, then the note. */
export function UnitFormFields({ form }: { form: UseFormReturn<UnitFormValues> }) {
  const { t } = useI18n()
  const errors = form.formState.errors
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('web.units.dialog.add.field.code.label')}
          required
          placeholder={t('web.units.dialog.add.field.code.placeholder')}
          autoComplete="off"
          error={errors.code?.message}
          {...form.register('code')}
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
      </div>
      <div className="grid grid-cols-3 gap-4">
        <TextField
          label={t('web.units.dialog.add.field.floor.label')}
          placeholder={t('web.units.dialog.add.field.floor.placeholder')}
          inputMode="numeric"
          error={errors.floor?.message}
          {...form.register('floor')}
        />
        <TextField
          label={t('web.units.dialog.add.field.bedrooms.label')}
          placeholder={t('web.units.dialog.add.field.bedrooms.placeholder')}
          inputMode="numeric"
          error={errors.bedrooms?.message}
          {...form.register('bedrooms')}
        />
        <TextField
          label={t('web.units.dialog.add.field.area.label')}
          placeholder={t('web.units.dialog.add.field.area.placeholder')}
          suffix={t('web.units.dialog.add.field.area.suffix')}
          inputMode="decimal"
          error={errors.areaM2?.message}
          {...form.register('areaM2')}
        />
      </div>
      <TextAreaField
        label={t('web.units.dialog.add.field.note.label')}
        placeholder={t('web.units.dialog.add.field.note.placeholder')}
        rows={3}
        error={errors.note?.message}
        {...form.register('note')}
      />
    </>
  )
}
