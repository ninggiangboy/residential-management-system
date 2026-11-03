import { Type } from '@sinclair/typebox'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { formResolver } from '../../lib/forms'
import { errorText, useI18n } from '../../lib/i18n'
import { useIntent } from '../../lib/use-intent'
import {
  type UnitTypeItem,
  type UnitTypePatch,
  unitTypesQuery,
  useUnitTypeMutations,
} from './hooks'

interface Values {
  code: string
  nameVi: string
  nameEn: string
  defaultBedrooms: string
  defaultAreaM2: string
  active: boolean
}

const Schema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_]{1,29}$' }),
  nameVi: Type.String({ minLength: 1, maxLength: 60, pattern: '\\S' }),
  nameEn: Type.String({ maxLength: 60 }),
  defaultBedrooms: Type.String({ pattern: '^\\d{0,2}$' }),
  defaultAreaM2: Type.String({ pattern: '^(\\d{1,4}([.,]\\d{1,2})?)?$' }),
  active: Type.Boolean(),
})

const EMPTY: Values = {
  code: '',
  nameVi: '',
  nameEn: '',
  defaultBedrooms: '',
  defaultAreaM2: '',
  active: true,
}

const valuesOf = (item: UnitTypeItem): Values => ({
  code: item.code,
  nameVi: item.name.vi,
  nameEn: item.name.en ?? '',
  defaultBedrooms: item.defaultBedrooms === null ? '' : String(item.defaultBedrooms),
  defaultAreaM2: item.defaultAreaM2 ?? '',
  active: item.status === 'active',
})

/** What differs from the row the form was opened on (or from the fresh row after a conflict): only those fields are sent. */
function patchOf(values: Values, base: UnitTypeItem): UnitTypePatch {
  const before = valuesOf(base)
  const patch: UnitTypePatch = {}
  const name: NonNullable<UnitTypePatch['name']> = {}
  if (values.nameVi.trim() !== before.nameVi) name.vi = values.nameVi.trim()
  if (values.nameEn.trim() !== before.nameEn)
    name.en = values.nameEn.trim() === '' ? null : values.nameEn.trim()
  if (Object.keys(name).length > 0) patch.name = name
  if (values.defaultBedrooms !== before.defaultBedrooms)
    patch.defaultBedrooms = values.defaultBedrooms === '' ? null : Number(values.defaultBedrooms)
  if (values.defaultAreaM2 !== before.defaultAreaM2)
    patch.defaultAreaM2 =
      values.defaultAreaM2 === '' ? null : values.defaultAreaM2.replace(',', '.')
  if (values.active !== before.active) patch.status = values.active ? 'active' : 'archived'
  return patch
}

/** The server's `name.vi` and `name.en` are the form's `nameVi` and `nameEn`. */
const FIELD_OF_PATH: Record<string, keyof Values> = {
  code: 'code',
  'name.vi': 'nameVi',
  'name.en': 'nameEn',
  defaultBedrooms: 'defaultBedrooms',
  defaultAreaM2: 'defaultAreaM2',
}

/**
 * "Thêm loại căn hộ" and "Sửa loại căn hộ" (`?dialog=add|edit` of `W-Unit-Types`, DOC-65): the form of E-181 and E-182. The code is
 * read-only on an edit; an edit sends only what changed with `If-Match`; a conflict loads the fresh row, keeps what was typed and
 * lets the Manager pick the new version or keep their own (UX-02, DR-310).
 */
export function UnitTypeDialog({
  mode,
  item,
  onClose,
}: {
  mode: 'add' | 'edit' | null
  item: UnitTypeItem | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { create, update } = useUnitTypeMutations()
  const intent = useIntent()
  const [banner, setBanner] = useState<string | null>(null)
  const [conflict, setConflict] = useState<UnitTypeItem | null>(null)
  const resolver = useMemo(() => formResolver<Values>(Schema, t), [t])
  const form = useForm<Values>({ resolver, defaultValues: EMPTY })
  const open = mode === 'add' || (mode === 'edit' && item !== undefined)
  const pending = create.isPending || update.isPending
  const errors = form.formState.errors

  useEffect(() => {
    if (!open) return
    form.reset(mode === 'edit' && item ? valuesOf(item) : EMPTY)
    setBanner(null)
    setConflict(null)
    intent.reset()
    // Reopened with the loaded row; a refetch while the form is open does not wipe what was typed.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [open, mode, item?.unitTypeId])

  const close = () => {
    setBanner(null)
    setConflict(null)
    onClose()
  }

  const showFailure = (thrown: unknown) => {
    const failure = apiErrorOf(thrown)
    if (failure.code === 'unit_type_code_in_use')
      form.setError(
        'code',
        { type: failure.code, message: errorText(t, failure) },
        { shouldFocus: true },
      )
    else if (failure.code === 'unit_type_name_in_use')
      form.setError(
        'nameVi',
        { type: failure.code, message: errorText(t, failure) },
        { shouldFocus: true },
      )
    else if (failure.code === 'unit_type_limit')
      setBanner(t('web.unit-types.limit.banner', { max: 50 }))
    else if (failure.code === 'idempotency_key_reuse') {
      intent.reset()
      setBanner(errorText(t, failure))
    } else if (failure.code === 'validation_failed' && Array.isArray(failure.details)) {
      let first = true
      let other = false
      for (const detail of failure.details as { path: string; code: string; message: string }[]) {
        const name = FIELD_OF_PATH[detail.path]
        if (name) {
          form.setError(
            name,
            { type: detail.code, message: detail.message },
            { shouldFocus: first },
          )
          first = false
        } else other = true
      }
      if (other || first) setBanner(errorText(t, failure))
    } else setBanner(errorText(t, failure))
  }

  const saveEdit = (values: Values, base: UnitTypeItem) => {
    const body = patchOf(values, base)
    if (Object.keys(body).length === 0) return close()
    update.mutate(
      { id: base.unitTypeId, version: base.version, body },
      {
        onSuccess: (saved) => {
          toast.success(t('web.unit-types.toast.saved', { name: saved.name.vi }))
          close()
        },
        onError: async (thrown) => {
          if (apiErrorOf(thrown).code === 'version_conflict') {
            const fresh = await queryClient.fetchQuery({ ...unitTypesQuery(), staleTime: 0 })
            const row = fresh.items.find((candidate) => candidate.unitTypeId === base.unitTypeId)
            if (row) return setConflict(row)
          }
          showFailure(thrown)
        },
      },
    )
  }

  const submit = form.handleSubmit((values) => {
    setBanner(null)
    if (mode === 'edit' && item) return saveEdit(values, conflict ?? item)
    const body = {
      code: values.code.trim(),
      name: {
        vi: values.nameVi.trim(),
        ...(values.nameEn.trim() !== '' ? { en: values.nameEn.trim() } : {}),
      },
      ...(values.defaultBedrooms !== '' ? { defaultBedrooms: Number(values.defaultBedrooms) } : {}),
      ...(values.defaultAreaM2 !== ''
        ? { defaultAreaM2: values.defaultAreaM2.replace(',', '.') }
        : {}),
    }
    create.mutate(
      { body, key: intent.keyFor(body) },
      {
        onSuccess: (saved) => {
          toast.success(t('web.unit-types.toast.created', { name: saved.name.vi }))
          intent.reset()
          close()
        },
        onError: showFailure,
      },
    )
  })

  const applyTheirs = () => {
    if (conflict) form.reset(valuesOf(conflict))
    setConflict(null)
  }
  const editing = mode === 'edit' && item !== undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t(editing ? 'web.unit-types.dialog.edit.title' : 'web.unit-types.dialog.add.title')}
      dismissible={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form="unit-type-form" loading={pending}>
            {t(
              editing ? 'web.unit-types.dialog.edit.confirm' : 'web.unit-types.dialog.add.confirm',
            )}
          </Button>
        </>
      }
    >
      <form id="unit-type-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {conflict && (
          <Banner
            tone="warning"
            actions={
              <>
                <Button size="sm" variant="outline" disabled={pending} onClick={applyTheirs}>
                  {t('web.unit-types.action.use-theirs')}
                </Button>
                <Button size="sm" loading={pending} onClick={() => void submit()}>
                  {t('web.unit-types.action.keep-mine')}
                </Button>
              </>
            }
          >
            {t('web.unit-types.banner.conflict')}
          </Banner>
        )}
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextField
          label={t('web.unit-types.dialog.field.code.label')}
          required
          placeholder={t('web.unit-types.dialog.field.code.placeholder')}
          hint={t('web.unit-types.dialog.field.code.hint')}
          autoComplete="off"
          readOnly={editing}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('web.unit-types.dialog.field.name-vi.label')}
            required
            placeholder={t('web.unit-types.dialog.field.name-vi.placeholder')}
            autoComplete="off"
            error={errors.nameVi?.message}
            {...form.register('nameVi')}
          />
          <TextField
            label={t('web.unit-types.dialog.field.name-en.label')}
            placeholder={t('web.unit-types.dialog.field.name-en.placeholder')}
            autoComplete="off"
            error={errors.nameEn?.message}
            {...form.register('nameEn')}
          />
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-label text-ink">
            {t('web.unit-types.dialog.defaults.title')}
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('web.unit-types.dialog.field.bedrooms.label')}
              placeholder={t('web.unit-types.dialog.field.bedrooms.placeholder')}
              inputMode="numeric"
              error={errors.defaultBedrooms?.message}
              {...form.register('defaultBedrooms')}
            />
            <TextField
              label={t('web.unit-types.dialog.field.area.label')}
              placeholder={t('web.unit-types.dialog.field.area.placeholder')}
              suffix={t('web.unit-types.dialog.field.area.suffix')}
              inputMode="decimal"
              error={errors.defaultAreaM2?.message}
              {...form.register('defaultAreaM2')}
            />
          </div>
          <p className="text-secondary text-ink-muted">
            {t('web.unit-types.dialog.defaults.hint')}
          </p>
        </fieldset>
        {editing && item && (
          <div className="flex items-start gap-3">
            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <Switch
                  id="unit-type-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  label={t('web.unit-types.dialog.field.active.label')}
                />
              )}
            />
            <div>
              <label htmlFor="unit-type-active" className="text-label text-ink">
                {t('web.unit-types.dialog.field.active.label')}
              </label>
              {!form.watch('active') && (
                <p className="text-secondary text-ink-muted">
                  {t('web.unit-types.dialog.field.active.hint', { count: item.unitCount })}
                </p>
              )}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  )
}
