import type { Language } from '@rms/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Card, CardSection } from '../../components/ui/card'
import { ConfirmDialog, Dialog, FieldSkeleton } from '../../components/ui/dialog'
import { ErrorState } from '../../components/ui/empty-state'
import { PageHeader } from '../../components/ui/page'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Skeleton } from '../../components/ui/skeleton'
import { Tag } from '../../components/ui/tag'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { uploadFile } from '../../lib/uploads'
import { trackTap } from '../../lib/usage'
import { settingsQuery, type TermsKind, termsQuery, useSaveSettings } from './hooks'
import {
  type BuildingDocument,
  type BuildingFormValues,
  buildPatch,
  fieldOfPath,
  isEmptyPatch,
  outOfRange,
  valuesOf,
} from './model'
import { TermsPanel } from './terms-panel'

const LOGO_TYPES = ['image/png', 'image/jpeg']
const LOGO_MAX_BYTES = 1_048_576

interface Detail {
  path: string
  code: string
  message: string
}

/** `W-Building` (DOC-67): the building and company, the general settings, the logo and the terms, with one save. */
export function BuildingPage({ dialog, kind }: { dialog?: 'terms'; kind: TermsKind }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()
  const queryClient = useQueryClient()
  const canWrite = useCanWrite()
  const settings = useQuery(settingsQuery())
  const save = useSaveSettings()
  const form = useForm<BuildingFormValues>()
  const [logo, setLogo] = useState<{ fileId: string | null; preview: string | null } | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [versionsOf, setVersionsOf] = useState<TermsKind | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const document = settings.data?.document
  const original = document ? valuesOf(document) : null

  useEffect(() => {
    if (original) form.reset(original)
    // The form follows the loaded document; an unsaved edit is laid over a fresh one by the conflict handler below.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `original` is derived from `settings.data`
  }, [settings.data?.etag])

  useEffect(() => () => void (logo?.preview && URL.revokeObjectURL(logo.preview)), [logo?.preview])

  const dirty = form.formState.isDirty || logo !== null
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: () => dirty,
  })

  if (settings.isPending)
    return (
      <>
        <PageHeader title={t('web.building.title')} subtitle={t('web.building.subtitle')} />
        {/* The two columns of the page with cards of their size: the form fills in without moving. */}
        <div
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          aria-hidden="true"
        >
          <Card className="p-5">
            <Skeleton className="mb-4 h-5.5 w-64" />
            {/* The building's fields, then the company's under their heading; `true` is a field across both columns. */}
            <div className="grid grid-cols-2 gap-4">
              {[false, false, true, false, false, false, false].map((wide, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                <FieldSkeleton key={index} className={wide ? 'col-span-2' : undefined} />
              ))}
            </div>
            <div className="mt-6 mb-4 border-t border-line pt-5">
              <Skeleton className="h-5.5 w-40" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[false, false, false, false, true, false, false].map((wide, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                <FieldSkeleton key={index} className={wide ? 'col-span-2' : undefined} />
              ))}
            </div>
          </Card>
          <div className="flex flex-col gap-6">
            <Skeleton className="h-[268px] rounded-card" />
            <Skeleton className="h-[254px] rounded-card" />
            <Skeleton className="h-[254px] rounded-card" />
          </div>
        </div>
      </>
    )
  if (settings.isError || !document || !original)
    return (
      <ErrorState
        requestId={apiErrorOf(settings.error).requestId}
        onRetry={() => void settings.refetch()}
      />
    )

  const isDefault = (key: string) => !document.saved.includes(key)
  const label = (text: string, key?: string): ReactNode =>
    key && isDefault(key) ? (
      <span className="inline-flex items-center gap-2">
        {text}
        <Tag icon={false}>{t('web.building.default-tag')}</Tag>
      </span>
    ) : (
      text
    )

  const showErrors = (details: Detail[]) => {
    let first = true
    for (const detail of details) {
      const field = fieldOfPath(detail.path)
      if (field) {
        form.setError(
          field,
          {
            type: detail.code,
            message:
              detail.code === 'setting_invalid' ? t('error.setting_invalid') : detail.message,
          },
          { shouldFocus: first },
        )
        first = false
      }
    }
  }

  const submit = form.handleSubmit((values) => {
    setBanner(null)
    setConflict(false)
    const patch = buildPatch(values, original, logo ? { fileId: logo.fileId } : null)
    if (isEmptyPatch(patch)) return
    const invalid = outOfRange(values)
    if (invalid.length > 0) {
      for (const [index, name] of invalid.entries())
        form.setError(
          name,
          { type: 'setting_invalid', message: t('error.setting_invalid') },
          { shouldFocus: index === 0 },
        )
      return
    }
    trackTap('W-Building.save')
    save.mutate(
      { etag: settings.data?.etag ?? '', patch },
      {
        onSuccess: (saved) => {
          form.reset(valuesOf(saved.document))
          setLogo(null)
          toast.success(t('web.building.toast.saved'))
        },
        onError: async (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'version_conflict') {
            // The fresh document loads and the Admin's edits are laid over it; nothing is saved by itself (UX-02, UIWS-19).
            const edits = values
            const fresh = await queryClient.fetchQuery({ ...settingsQuery(), staleTime: 0 })
            const freshValues = valuesOf(fresh.document)
            form.reset(freshValues)
            for (const key of Object.keys(edits) as (keyof BuildingFormValues)[])
              if (edits[key] !== original[key])
                form.setValue(key, edits[key] as never, { shouldDirty: true })
            setConflict(true)
            return
          }
          if (Array.isArray(failure.details) && failure.details.length > 0)
            showErrors(failure.details as Detail[])
          else setBanner(errorText(t, failure))
        },
      },
    )
  })

  const pickLogo = (file: File | undefined) => {
    if (!file) return
    setLogoError(null)
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      setLogoError(t('web.building.logo.format'))
      return
    }
    setUploading(true)
    uploadFile({ purpose: 'logo', file })
      .then(({ fileId }) => setLogo({ fileId, preview: URL.createObjectURL(file) }))
      .catch((thrown) => setLogoError(errorText(t, apiErrorOf(thrown))))
      .finally(() => setUploading(false))
  }

  const logoSrc = logo ? logo.preview : document.building.logoUrl
  const field = (name: keyof BuildingFormValues) => form.register(name)
  const err = (name: keyof BuildingFormValues) =>
    form.formState.errors[name]?.message as string | undefined

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={t('web.building.title')}
        subtitle={t('web.building.subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => {
                form.reset(original)
                setLogo(null)
                setConflict(false)
              }}
            >
              {t('web.building.action.undo')}
            </Button>
            <Button
              type="submit"
              icon="check"
              loading={save.isPending}
              disabled={!dirty || !canWrite || uploading}
            >
              {t('web.building.cta')}
            </Button>
          </>
        }
      />
      {conflict && (
        <Banner tone="warning" className="mb-6">
          {t('web.building.banner.conflict')}
        </Banner>
      )}
      {banner && (
        <Banner tone="danger" className="mb-6">
          {banner}
        </Banner>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <CardSection title={t('web.building.card.info.title')}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label={t('web.building.field.name.label')}
                required
                error={err('nameVi')}
                {...field('nameVi')}
              />
              <TextField
                label={t('web.building.field.name-en.label')}
                hint={t('web.building.field.name-en.hint')}
                error={err('nameEn')}
                {...field('nameEn')}
              />
              <TextField
                className="md:col-span-2"
                label={t('web.building.field.address.label')}
                required
                error={err('address')}
                {...field('address')}
              />
              <TextField
                label={t('web.building.field.hotline.label')}
                placeholder={t('common.field.phone.placeholder')}
                error={err('hotline')}
                {...field('hotline')}
              />
              <TextField
                type="email"
                label={t('web.building.field.email.label')}
                error={err('email')}
                {...field('email')}
              />
              <TextField
                label={`${t('web.building.field.hours.label')} (VI)`}
                error={err('hoursVi')}
                {...field('hoursVi')}
              />
              <TextField
                label={`${t('web.building.field.hours.label')} (EN)`}
                error={err('hoursEn')}
                {...field('hoursEn')}
              />
            </div>
            {/* The company's fields under their own heading, apart from the building's (DOC-67 W-Building §4). */}
            <h3 className="mt-6 mb-4 border-t border-line pt-5 text-title-3 text-ink">
              {t('web.building.card.info.company')}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label={t('web.building.field.company.label')}
                required
                error={err('companyNameVi')}
                {...field('companyNameVi')}
              />
              <TextField
                label={t('web.building.field.company-en.label')}
                error={err('companyNameEn')}
                {...field('companyNameEn')}
              />
              <TextField
                label={t('web.building.field.tax-code.label')}
                placeholder={t('web.building.field.tax-code.placeholder')}
                inputMode="numeric"
                error={err('taxCode')}
                {...field('taxCode')}
              />
              <TextField
                label={t('web.building.field.representative.label')}
                error={err('representative')}
                {...field('representative')}
              />
              <TextField
                className="md:col-span-2"
                label={t('web.building.field.company-address.label')}
                error={err('companyAddress')}
                {...field('companyAddress')}
              />
              <TextField
                label={t('web.building.field.company-phone.label')}
                placeholder={t('common.field.phone.placeholder')}
                error={err('companyPhone')}
                {...field('companyPhone')}
              />
              <TextField
                type="email"
                label={t('web.building.field.company-email.label')}
                error={err('companyEmail')}
                {...field('companyEmail')}
              />
            </div>
          </CardSection>
          <CardSection title={t('web.building.card.settings.title')}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                inputMode="numeric"
                label={label(t('web.building.field.due-days.label'), 'defaultDueDays')}
                suffix={t('web.building.field.due-days.suffix')}
                hint={t('web.building.field.due-days.hint')}
                error={err('defaultDueDays')}
                {...field('defaultDueDays')}
              />
              <Controller
                control={form.control}
                name="defaultLanguage"
                render={({ field: language }) => (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-ink">
                      {label(t('web.building.field.language.label'), 'defaultLanguage')}
                    </span>
                    <SegmentedControl<Language>
                      label={t('web.building.field.language.label')}
                      value={language.value}
                      onValueChange={(next) => language.onChange(next)}
                      options={[
                        { value: 'vi', label: 'Tiếng Việt' },
                        { value: 'en', label: 'English' },
                      ]}
                    />
                    <p className="text-secondary text-ink-muted">
                      {t('web.building.field.language.hint')}
                    </p>
                  </div>
                )}
              />
              <TextField
                inputMode="numeric"
                label={label(t('web.building.field.max-tries.label'), 'lockout')}
                suffix={t('web.building.field.max-tries.suffix')}
                hint={t('web.building.field.max-tries.hint')}
                error={err('maxAttempts')}
                {...field('maxAttempts')}
              />
              <TextField
                inputMode="numeric"
                label={label(t('web.building.field.lock-minutes.label'), 'lockout')}
                suffix={t('web.building.field.lock-minutes.suffix')}
                hint={t('web.building.field.lock-minutes.hint')}
                error={err('lockMinutes')}
                {...field('lockMinutes')}
              />
              <TextField
                inputMode="numeric"
                label={label(t('web.building.field.deletion-days.label'), 'accountDeletionDays')}
                hint={t('web.building.field.deletion-days.hint')}
                error={err('accountDeletionDays')}
                {...field('accountDeletionDays')}
              />
              <TextField
                inputMode="numeric"
                label={label(t('web.building.field.max-cars.label'), 'maxCarsPerUnit')}
                hint={t('web.building.field.max-cars.hint')}
                error={err('maxCarsPerUnit')}
                {...field('maxCarsPerUnit')}
              />
              <TextField
                inputMode="decimal"
                label={label(t('web.building.field.quota.label'), 'storageQuotaBytes')}
                suffix={t('web.building.field.quota.suffix')}
                error={err('quotaGb')}
                {...field('quotaGb')}
              />
              <Controller
                control={form.control}
                name="feeNoticeLanguage"
                render={({ field: language }) => (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-ink">
                      {label(t('web.building.field.fee-lang.label'), 'feeNoticeLanguage')}
                    </span>
                    <SegmentedControl<'vi' | 'en' | 'both'>
                      label={t('web.building.field.fee-lang.label')}
                      value={language.value}
                      onValueChange={(next) => language.onChange(next)}
                      options={[
                        { value: 'vi', label: 'VI' },
                        { value: 'en', label: 'EN' },
                        { value: 'both', label: 'VI + EN' },
                      ]}
                    />
                  </div>
                )}
              />
            </div>
          </CardSection>
        </div>
        <div className="flex flex-col gap-6">
          <CardSection
            title={t('web.building.card.logo.title')}
            description={t('web.building.card.logo.hint')}
          >
            <div className="flex flex-col items-start gap-3">
              <div className="flex h-24 w-full items-center justify-center rounded-control bg-fill">
                {logoSrc ? (
                  <img src={logoSrc} alt="" className="max-h-20 max-w-full object-contain" />
                ) : (
                  <span className="text-secondary text-ink-muted">—</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  icon="camera"
                  loading={uploading}
                  disabled={!canWrite}
                  onClick={() => input.current?.click()}
                >
                  {t('web.building.logo.change')}
                </Button>
                {logoSrc && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => setLogo({ fileId: null, preview: null })}
                  >
                    {t('web.building.logo.remove')}
                  </Button>
                )}
              </div>
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                aria-label={t('web.building.logo.change')}
                onChange={(event) => {
                  pickLogo(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <p
                className={
                  logoError ? 'text-secondary text-danger' : 'text-secondary text-ink-muted'
                }
                role={logoError ? 'alert' : undefined}
              >
                {logoError ?? t('web.building.logo.format')}
              </p>
            </div>
          </CardSection>
          {(['terms', 'privacy'] as const).map((which) => (
            <TermsCard
              key={which}
              kind={which}
              lang={lang}
              onPublish={() =>
                void navigate({
                  to: '/building',
                  search: { dialog: 'terms', kind: which },
                  state: OPENED_HERE,
                  resetScroll: false,
                })
              }
              onVersions={() => setVersionsOf(which)}
            />
          ))}
        </div>
      </div>
      {dialog === 'terms' && (
        <TermsPanel
          kind={kind}
          onClose={() =>
            closeOverlay(
              () =>
                void navigate({ to: '/building', search: {}, replace: true, resetScroll: false }),
            )
          }
        />
      )}
      <VersionsDialog kind={versionsOf} onClose={() => setVersionsOf(null)} />
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t('web.building.dialog.discard.title')}
        confirmLabel={t('web.building.dialog.discard.confirm')}
        onConfirm={() => blocker.proceed?.()}
      />
    </form>
  )
}

function TermsCard({
  kind,
  lang,
  onPublish,
  onVersions,
}: {
  kind: TermsKind
  lang: Language
  onPublish: () => void
  onVersions: () => void
}) {
  const { t, formatDate } = useI18n()
  const versions = useQuery(termsQuery(kind))
  const latest = versions.data?.[0]
  void lang
  return (
    <CardSection
      title={t(
        kind === 'terms' ? 'web.building.card.terms.title' : 'web.building.card.privacy.title',
      )}
    >
      {versions.isPending ? (
        <Skeleton className="h-12" />
      ) : latest ? (
        <div className="flex flex-col gap-1">
          <p className="text-body-strong">
            {t('web.building.terms.version', {
              version: latest.version,
              date: formatDate(latest.publishedAt),
            })}
          </p>
          <p className="text-secondary text-ink-muted">
            {t('web.building.terms.accepted', { count: latest.acceptedCount })}
          </p>
        </div>
      ) : null}
      <p className="mt-2 text-secondary text-ink-muted">{t('web.building.terms.note')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onPublish}>
          {t('web.building.terms.publish')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onVersions}>
          {t('web.building.terms.versions')}
        </Button>
      </div>
    </CardSection>
  )
}

function VersionsDialog({ kind, onClose }: { kind: TermsKind | null; onClose: () => void }) {
  const { t, formatDateTime } = useI18n()
  const versions = useQuery({ ...termsQuery(kind ?? 'terms'), enabled: kind !== null })
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('web.building.terms.versions')}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.action.close')}
        </Button>
      }
    >
      {versions.isPending && (
        <ul className="divide-y divide-line py-2" aria-hidden="true">
          {[0, 1].map((row) => (
            <li key={row} className="flex items-center justify-between gap-4 py-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3.5 w-32" />
              </div>
              <Skeleton className="h-3.5 w-24" />
            </li>
          ))}
        </ul>
      )}
      <ul className="motion-fade divide-y divide-line py-2">
        {versions.data?.map((version) => (
          <li key={version.versionId} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-body-strong">
                {t('web.building.terms.version', {
                  version: version.version,
                  date: formatDateTime(version.publishedAt),
                })}
              </p>
              <p className="text-secondary text-ink-muted">{version.publishedBy.name ?? ''}</p>
            </div>
            <span className="text-secondary text-ink-muted">
              {t('web.building.terms.accepted', { count: version.acceptedCount })}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
