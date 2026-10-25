import { RESEND_AFTER_SECONDS } from '@rms/client-core'
import type { Language } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { apiErrorOf, unwrap } from '../../api/errors'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { useChangeLanguage, useUpdateProfile } from '../../api/hooks/staff-me-mutations'
import { useBrand } from '../../components/layout/public-layout'
import { Avatar } from '../../components/ui/avatar'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { CardSection } from '../../components/ui/card'
import { SegmentedControl } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/dialog'
import { ErrorState } from '../../components/ui/empty-state'
import { PageHeader } from '../../components/ui/page'
import { Skeleton } from '../../components/ui/skeleton'
import { Tag } from '../../components/ui/tag'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { uploadFile } from '../../lib/uploads'
import { clock, useCountdown } from '../../lib/use-countdown'
import { SessionsCard } from './sessions-card'

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 10 * 1_048_576
const NAME_MAX = 120

/** `W-Profile` (DOC-64): name, photo, language, a reset link and the sessions of the signed-in member. */
export function ProfilePage() {
  const { t, setLang } = useI18n()
  const me = useQuery(staffMeQuery())
  const brand = useBrand()
  const canWrite = useCanWrite()
  const update = useUpdateProfile()
  const language = useChangeLanguage(() => toast.error(t('web.shell.language.failed')))
  const input = useRef<HTMLInputElement>(null)

  const [name, setName] = useState<string | null>(null)
  const [photo, setPhoto] = useState<{ fileId: string | null; preview: string | null } | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const reset = useCountdown(0)
  const [sendingReset, setSendingReset] = useState(false)

  useEffect(
    () => () => void (photo?.preview && URL.revokeObjectURL(photo.preview)),
    [photo?.preview],
  )

  const current = me.data
  const trimmed = (name ?? current?.fullName ?? '').trim()
  const nameChanged = current !== undefined && name !== null && trimmed !== current.fullName
  const dirty = nameChanged || photo !== null

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: () => dirty,
  })

  if (me.isPending)
    return (
      <>
        <PageHeader title={t('web.profile.title')} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </>
    )
  if (me.isError || !current)
    return (
      <ErrorState requestId={apiErrorOf(me.error).requestId} onRetry={() => void me.refetch()} />
    )

  const pickPhoto = (file: File | undefined) => {
    if (!file) return
    setPhotoError(null)
    if (!PHOTO_TYPES.includes(file.type)) return setPhotoError(t('error.file_type_not_allowed'))
    if (file.size > PHOTO_MAX_BYTES) return setPhotoError(t('error.file_too_large', { maxMb: 10 }))
    setUploading(true)
    uploadFile({ purpose: 'avatar', file })
      .then(({ fileId }) => setPhoto({ fileId, preview: URL.createObjectURL(file) }))
      .catch((thrown) => {
        const failure = apiErrorOf(thrown)
        setPhotoError(
          failure.code === 'file_not_verified'
            ? t('error.file_not_verified')
            : errorText(t, failure),
        )
      })
      .finally(() => setUploading(false))
  }

  const save = () => {
    setBanner(null)
    setNameError(null)
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setNameError(t('error.validation_failed'))
      return
    }
    const changes: { fullName?: string; avatarFileId?: string | null } = {}
    if (nameChanged) changes.fullName = trimmed
    if (photo) changes.avatarFileId = photo.fileId
    update.mutate(
      { version: current.version, changes },
      {
        onSuccess: () => {
          toast.success(t('web.profile.toast.saved'))
          setName(null)
          setPhoto(null)
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'file_not_verified') {
            // The pending photo is dropped; the typed name stays (DOC-64 `W-Profile` §6).
            setPhoto(null)
            setBanner(t('error.file_not_verified'))
          } else if (failure.code === 'validation_failed') setNameError(errorText(t, failure))
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  const sendResetLink = async () => {
    setSendingReset(true)
    try {
      unwrap(await api.auth.staff['password-reset'].post({ email: current.email }))
      toast.success(t('web.profile.toast.reset_sent', { email: current.email }))
      reset.start(RESEND_AFTER_SECONDS)
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      toast.error(
        failure.status === 429
          ? `${t('error.rate_limited')} ${t('common.retry-in', { seconds: failure.retryAfter ?? 60 })}`
          : errorText(t, failure),
      )
    } finally {
      setSendingReset(false)
    }
  }

  const avatarSrc = photo ? photo.preview : current.avatarUrl
  const hasAvatar = photo ? photo.fileId !== null : current.avatarUrl !== null

  return (
    <>
      <PageHeader
        title={t('web.profile.title')}
        subtitle={t('web.profile.subtitle')}
        actions={
          <Button
            icon="check"
            loading={update.isPending}
            disabled={!dirty || !canWrite || uploading}
            onClick={save}
          >
            {t('web.profile.cta')}
          </Button>
        }
      />
      {banner && (
        <Banner tone="danger" className="mb-6">
          {banner}
        </Banner>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <CardSection title={t('web.profile.card.info.title')}>
            <div className="flex items-center gap-4">
              <Avatar name={current.fullName} src={avatarSrc} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-title-3 text-ink">{current.fullName}</p>
                <p className="truncate text-secondary text-ink-muted">
                  {t(`common.staff-role.${current.role}`)}, {brand.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon="camera"
                    loading={uploading}
                    disabled={!canWrite}
                    onClick={() => input.current?.click()}
                  >
                    {t('web.profile.action.photo')}
                  </Button>
                  {hasAvatar && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWrite}
                      onClick={() => setPhoto({ fileId: null, preview: null })}
                    >
                      {t('web.profile.action.photo_remove')}
                    </Button>
                  )}
                </div>
                <input
                  ref={input}
                  type="file"
                  accept={PHOTO_TYPES.join(',')}
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t('web.profile.action.photo')}
                  onChange={(event) => {
                    pickPhoto(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {photoError && (
                  <p role="alert" className="mt-1 text-secondary text-danger">
                    {photoError}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-4">
              <TextField
                label={t('web.profile.field.name.label')}
                value={name ?? current.fullName}
                maxLength={NAME_MAX + 20}
                error={nameError}
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                label={t('web.profile.field.email.label')}
                value={current.email}
                readOnly
                disabled
                hint={t('web.profile.field.email.hint')}
              />
              <div>
                <p className="text-caption text-ink">{t('web.profile.field.role.label')}</p>
                <div className="mt-1.5">
                  <Tag tone="info">{t(`common.staff-role.${current.role}`)}</Tag>
                </div>
                <p className="mt-1.5 text-secondary text-ink-muted">
                  {t('web.profile.field.role.hint')}
                </p>
              </div>
            </div>
          </CardSection>
          <CardSection
            title={t('web.profile.card.language.title')}
            description={t('web.profile.card.language.hint')}
          >
            <SegmentedControl<Language>
              label={t('web.profile.card.language.title')}
              value={current.language}
              disabled={!canWrite || language.pending}
              onValueChange={(next) =>
                language.change(current, next, () => {
                  setLang(next)
                  toast.success(t('web.profile.toast.language'))
                })
              }
              options={[
                { value: 'vi', label: 'Tiếng Việt' },
                { value: 'en', label: 'English' },
              ]}
            />
          </CardSection>
        </div>
        <div className="flex flex-col gap-6">
          <CardSection
            title={t('web.profile.card.password.title')}
            description={t('web.profile.card.password.body')}
          >
            <p className="mb-4 text-secondary text-ink-muted">
              {t('web.profile.card.password.warning')}
            </p>
            <Button
              variant="tonal"
              size="sm"
              loading={sendingReset}
              disabled={!canWrite || reset.secondsLeft > 0}
              onClick={sendResetLink}
            >
              {reset.secondsLeft > 0
                ? `${t('web.profile.card.password.cta')} (${clock(reset.secondsLeft)})`
                : t('web.profile.card.password.cta')}
            </Button>
          </CardSection>
          <SessionsCard />
        </div>
      </div>
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t('web.profile.dialog.unsaved.title')}
        confirmLabel={t('web.profile.dialog.unsaved.confirm')}
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  )
}
