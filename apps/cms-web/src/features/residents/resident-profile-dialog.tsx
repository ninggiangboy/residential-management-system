import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { ConfirmDialog, Dialog, FieldSkeleton, useExit } from '../../components/ui/dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { Plate } from '../../components/ui/tag'
import { TextAreaField, TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { ChangePhoneDialog } from '../units/change-phone-dialog'
import { residentDetailQuery, useResidentMutations } from './hooks'

const toIsoDay = (text: string): string | null | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined
}
const fromIsoDay = (iso: string | null) => {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

const CODES_MARK = '\u0000'

/** The message with the unit codes in its `{codes}` slot, each code a link to its unit (E-68 `details.unitIds`). */
function OwnerMessage({
  message,
  units,
}: {
  message: string
  units: Array<{ unitId: string; code: string }>
}) {
  const [before = '', after = ''] = message.split(CODES_MARK)
  return (
    <>
      {before}
      {units.map(({ unitId, code }, index) => (
        <span key={unitId}>
          {index > 0 && ', '}
          <Link to="/units/$unitId" params={{ unitId }} search={{}} className="underline">
            {code}
          </Link>
        </span>
      ))}
      {after}
    </>
  )
}

interface Values {
  fullName: string
  email: string
  cccd: string
  dob: string
  note: string
}

/**
 * The profile dialog of `W-Residents` (DOC-65): the one place the full ID number and the date of birth appear. Opening it reads E-65
 * (one `pii.read`), a reopen reads it again, and saving sends only what changed with the profile's `If-Match`.
 */
export function ResidentProfileDialog({
  accountId,
  onClose,
}: {
  accountId: string
  onClose: () => void
}) {
  const { t, formatPhone, formatDate } = useI18n()
  const canWrite = useCanWrite()
  const detail = useQuery(residentDetailQuery(accountId))
  const { update, approveDeletion } = useResidentMutations()
  const [values, setValues] = useState<Values | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [ownedUnits, setOwnedUnits] = useState<string[]>([])
  const profile = detail.data?.profile
  // The search param unmounts the dialog; `useExit` lets it leave with its motion first (DR-304).
  const { open, close } = useExit(onClose)

  useEffect(() => {
    if (profile)
      setValues({
        fullName: profile.fullName ?? '',
        email: profile.email ?? '',
        cccd: profile.cccd ?? '',
        dob: fromIsoDay(profile.dateOfBirth),
        note: profile.note ?? '',
      })
  }, [profile])

  const original: Values | null = profile
    ? {
        fullName: profile.fullName ?? '',
        email: profile.email ?? '',
        cccd: profile.cccd ?? '',
        dob: fromIsoDay(profile.dateOfBirth),
        note: profile.note ?? '',
      }
    : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile || !values || !original) return
    setErrors({})
    setBanner(null)
    const body: Record<string, string | null> = {}
    if (values.fullName.trim() !== original.fullName) body.fullName = values.fullName.trim()
    if (values.email.trim() !== original.email)
      body.email = values.email.trim() === '' ? null : values.email.trim()
    if (values.cccd.trim() !== original.cccd)
      body.cccd = values.cccd.trim() === '' ? null : values.cccd.trim()
    if (values.dob.trim() !== original.dob) {
      const iso = toIsoDay(values.dob)
      if (iso === undefined) return setErrors({ dob: t('error.validation_failed') })
      body.dateOfBirth = iso
    }
    if (values.note.trim() !== original.note)
      body.note = values.note.trim() === '' ? null : values.note.trim()
    if (Object.keys(body).length === 0) return close()
    update.mutate(
      { accountId, version: profile.version, body },
      {
        onSuccess: () => {
          toast.success(t('web.residents.toast.saved'))
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'version_conflict') {
            // A reopen is a new `pii.read`, so the dialog closes and the user opens it again (DOC-65 `W-Residents` §6).
            toast.error(errorText(t, failure))
            close()
            return
          }
          const details = Array.isArray(failure.details)
            ? (failure.details as { path: string; message: string }[])
            : []
          const next: Partial<Record<keyof Values, string>> = {}
          for (const detail of details) {
            if (detail.path === 'cccd') next.cccd = detail.message
            else if (detail.path === 'email') next.email = detail.message
            else if (detail.path === 'fullName') next.fullName = detail.message
            else if (detail.path === 'dateOfBirth') next.dob = detail.message
          }
          if (Object.keys(next).length > 0) setErrors(next)
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  const closeApproval = () => {
    setApproving(false)
    setOwnedUnits([])
  }

  const approve = () =>
    approveDeletion.mutate(accountId, {
      onSuccess: closeApproval,
      onError: (thrown) => {
        const failure = apiErrorOf(thrown)
        const unitIds = (failure.details as { unitIds?: string[] } | undefined)?.unitIds
        if (failure.code === 'owner_must_transfer' && Array.isArray(unitIds)) {
          // The dialog stays open and names the units with a link to each, so the Manager can transfer first (UIWR-22).
          setOwnedUnits(unitIds)
          return
        }
        closeApproval()
        toast.error(errorText(t, failure))
        if (failure.code === 'deletion_not_requested') close()
      },
    })

  const set = (key: keyof Values) => (event: { target: { value: string } }) =>
    setValues((current) => (current ? { ...current, [key]: event.target.value } : current))

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !next && close()}
        title={
          detail.data
            ? t('web.residents.dialog.profile.title', {
                name: profile?.fullName ?? formatPhone(detail.data.phone),
              })
            : t('web.residents.dialog.profile.title.loading')
        }
        width="max-w-2xl"
        dismissible={!update.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={update.isPending}>
              {t('common.action.close')}
            </Button>
            <Button
              type="submit"
              form="resident-profile-form"
              loading={update.isPending}
              disabled={!canWrite || !values}
            >
              {t('web.residents.dialog.profile.confirm')}
            </Button>
          </>
        }
      >
        {detail.isError ? (
          <Banner tone="danger">{errorText(t, apiErrorOf(detail.error))}</Banner>
        ) : !detail.data || !values ? (
          // The shape of the form below, so the dialog does not change size when the profile arrives.
          <div className="flex flex-col gap-4 py-2" aria-hidden="true">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-control-sm w-48 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FieldSkeleton />
              <FieldSkeleton />
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <FieldSkeleton />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <form
            id="resident-profile-form"
            onSubmit={submit}
            className="motion-fade flex flex-col gap-4 py-2"
            noValidate
          >
            {banner && <Banner tone="danger">{banner}</Banner>}
            {detail.data.accountStatus === 'deletion_requested' && (
              <Banner
                tone="warning"
                actions={
                  detail.data.deletion.approvedAt === null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canWrite}
                      onClick={() => setApproving(true)}
                    >
                      {t('web.residents.action.approve-deletion')}
                    </Button>
                  ) : undefined
                }
              >
                {detail.data.deletion.executeAfter
                  ? t('web.residents.banner.deletion-approved', {
                      date: formatDate(detail.data.deletion.executeAfter),
                    })
                  : t('web.residents.banner.deletion', {
                      date: detail.data.deletion.requestedAt
                        ? formatDate(detail.data.deletion.requestedAt)
                        : '',
                    })}
              </Banner>
            )}
            <div className="flex items-center justify-between gap-4">
              <p className="text-body">
                <span className="text-ink-muted">{t('web.unit-detail.col.phone')}: </span>
                {formatPhone(detail.data.phone)}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={!canWrite}
                onClick={() => setPhoneOpen(true)}
              >
                {t('web.residents.dialog.profile.action.phone')}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label={t('web.residents.dialog.profile.field.name.label')}
                required
                placeholder={t('common.field.name.placeholder')}
                value={values.fullName}
                onChange={set('fullName')}
                error={errors.fullName}
              />
              <TextField
                type="email"
                label={t('web.residents.dialog.profile.field.email.label')}
                placeholder={t('common.field.email.placeholder')}
                value={values.email}
                onChange={set('email')}
                error={errors.email}
              />
              <TextField
                label={t('web.residents.dialog.profile.field.cccd.label')}
                placeholder={t('web.residents.dialog.profile.field.cccd.placeholder')}
                inputMode="numeric"
                value={values.cccd}
                onChange={set('cccd')}
                error={errors.cccd}
              />
              <TextField
                label={t('web.residents.dialog.profile.field.dob.label')}
                placeholder="dd/MM/yyyy"
                value={values.dob}
                onChange={set('dob')}
                error={errors.dob}
              />
            </div>
            <TextAreaField
              label={t('web.residents.dialog.profile.field.note.label')}
              rows={3}
              value={values.note}
              onChange={set('note')}
            />
            <div>
              <p className="text-caption text-ink">{t('web.residents.dialog.profile.units')}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                {detail.data.memberships.map((membership) => (
                  <Link
                    key={membership.membershipId}
                    to="/units/$unitId"
                    params={{ unitId: membership.unitId }}
                    search={{}}
                    className="inline-flex items-center gap-2"
                  >
                    <Plate>{membership.unitCode}</Plate>
                    <span className="text-secondary text-ink-muted">
                      {t(`common.member-type.${membership.memberType}`)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <p className="text-caption text-ink-muted">
              {t('web.residents.dialog.profile.audit-note')}
            </p>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={approving}
        onOpenChange={(open) => !open && closeApproval()}
        title={t('web.residents.dialog.approve-deletion.title', {
          name: profile?.fullName ?? detail.data?.phone ?? '',
        })}
        body={t('web.residents.dialog.approve-deletion.body')}
        confirmLabel={t('web.residents.dialog.approve-deletion.confirm')}
        tone="danger"
        loading={approveDeletion.isPending}
        onConfirm={approve}
      >
        {ownedUnits.length > 0 && (
          <Banner tone="danger">
            <OwnerMessage
              message={t('web.residents.dialog.approve-deletion.owner', { codes: CODES_MARK })}
              units={ownedUnits.map((unitId) => ({
                unitId,
                code: detail.data?.memberships.find((m) => m.unitId === unitId)?.unitCode ?? unitId,
              }))}
            />
          </Banner>
        )}
      </ConfirmDialog>
      {detail.data && (
        <ChangePhoneDialog
          open={phoneOpen}
          accountId={accountId}
          name={detail.data.profile.fullName ?? detail.data.phone}
          currentPhone={detail.data.phone}
          onClose={() => setPhoneOpen(false)}
        />
      )}
    </>
  )
}
