import { Type } from '@sinclair/typebox'
import { Controller, type UseFormReturn } from 'react-hook-form'
import { SelectField } from '../../components/ui/select-field'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'
import { type UnitTypeItem, unitTypeName } from '../unit-types/hooks'

/** The form of a unit, shared by "Thêm căn hộ" (E-58) and the edit dialog of `W-Unit-Detail` (DOC-65). */
export interface UnitFormValues {
  code: string
  floor: string
  unitTypeId: string
  bedrooms: string
  areaM2: string
  occupancy: 'occupied' | 'rented' | 'vacant'
  note: string
}
export const UnitFormSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64, pattern: '\\S' }),
  floor: Type.String({ pattern: '^-?\\d{0,3}$' }),
  unitTypeId: Type.String({ maxLength: 64 }),
  bedrooms: Type.String({ pattern: '^\\d{0,2}$' }),
  areaM2: Type.String({ pattern: '^(\\d{1,6}([.,]\\d{1,2})?)?$' }),
  occupancy: Type.Union([Type.Literal('occupied'), Type.Literal('rented'), Type.Literal('vacant')]),
  note: Type.String({ maxLength: 2000 }),
})
export const UNIT_FORM_FIELDS = [
  'code',
  'floor',
  'unitTypeId',
  'bedrooms',
  'areaM2',
  'occupancy',
  'note',
] as const

/** The select cannot hold an empty value: the "no type" option has this one. */
const NO_TYPE = '__none__'

/** What the form needs to offer a type: the active ones, plus the unit's own when it was archived since (DOC-65 `W-Units` §6). */
export interface TypeOption {
  unitTypeId: string
  name: string
  archived: boolean
}

export const typeOptionsOf = (
  active: readonly UnitTypeItem[],
  lang: string,
  own?: { unitTypeId: string; name: { vi: string; en: string | null } } | null,
): TypeOption[] => {
  const options = active.map((type) => ({
    unitTypeId: type.unitTypeId,
    name: unitTypeName(type.name, lang),
    archived: false,
  }))
  return own && !options.some((option) => option.unitTypeId === own.unitTypeId)
    ? [
        ...options,
        { unitTypeId: own.unitTypeId, name: unitTypeName(own.name, lang), archived: true },
      ]
    : options
}

/**
 * The fields (DOC-65 §6 dialog, DOC-54 §17.9): code beside the status, the type, then floor, bedrooms and area, then the note.
 * `onTypeChange` lets the add dialog fill the fields the Manager has not touched (DR-315); `takenFrom` names the type they came from.
 */
export function UnitFormFields({
  form,
  types,
  onTypeChange,
  takenFrom,
}: {
  form: UseFormReturn<UnitFormValues>
  types: readonly TypeOption[]
  onTypeChange?: (unitTypeId: string) => void
  takenFrom?: string | null
}) {
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
      <Controller
        control={form.control}
        name="unitTypeId"
        render={({ field }) => (
          <SelectField
            label={t('web.units.dialog.add.field.type.label')}
            value={field.value === '' ? NO_TYPE : field.value}
            error={errors.unitTypeId?.message}
            onValueChange={(value) => {
              const id = value === NO_TYPE ? '' : value
              field.onChange(id)
              onTypeChange?.(id)
            }}
            options={[
              { value: NO_TYPE, label: t('web.units.dialog.add.field.type.none') },
              ...types.map((type) => ({
                value: type.unitTypeId,
                label: type.archived
                  ? t('web.units.field.type.archived', { name: type.name })
                  : type.name,
              })),
            ]}
          />
        )}
      />
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
      {takenFrom && (
        <p className="-mt-2 text-secondary text-ink-muted">
          {t('web.units.dialog.add.field.type.defaults', { type: takenFrom })}
        </p>
      )}
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
