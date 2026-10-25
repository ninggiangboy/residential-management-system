import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Avatar } from '../../components/ui/avatar'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/controls'
import { Dialog } from '../../components/ui/dialog'
import { SelectField } from '../../components/ui/select-field'
import { Plate } from '../../components/ui/tag'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useIntent } from '../../lib/use-intent'
import { unitQuery } from '../units/hooks'
import { type PickedUnit, UnitPicker } from '../units/unit-picker'
import { type MemberType, usePhoneLookup, useResidentMutations } from './hooks'
import type { ResidentsSearch } from './residents-page'

const ROLES: readonly MemberType[] = ['owner', 'family', 'tenant', 'helper']

/**
 * `W-Resident-Add` (DOC-65): a person for a unit, or an existing account linked to one. A phone with an account shows the name and
 * the masked ID number only, never more (DR-215); the system sends no invitation message.
 */
export function ResidentAddDialog({
  unitId: initialUnit,
  search,
}: {
  unitId?: string
  search: ResidentsSearch
}) {
  const { t, formatPhone } = useI18n()
  const navigate = useNavigate()
  const { create } = useResidentMutations()
  const intent = useIntent()
  const [unit, setUnit] = useState<PickedUnit | null>(
    initialUnit ? { unitId: initialUnit, code: '…' } : null,
  )
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [role, setRole] = useState<MemberType | null>(null)
  const [canPay, setCanPay] = useState(false)
  const [errors, setErrors] = useState<{
    phone?: string
    unit?: string
    role?: string
    name?: string
  }>({})
  const [roleError, setRoleError] = useState<{ text: string; unitId: string } | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const detail = useQuery({ ...unitQuery(unit?.unitId ?? ''), enabled: unit !== null })
  const lookup = usePhoneLookup(phone)
  const existing = lookup.data ?? null
  const hasOwner = detail.data?.owner != null
  const effectiveRole: MemberType =
    role ?? (detail.data ? (hasOwner ? 'family' : 'owner') : 'owner')
  const code = detail.data?.code ?? unit?.code ?? ''

  const close = () => void navigate({ to: '/residents', search })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})
    setRoleError(null)
    setBanner(null)
    if (!unit) return setErrors({ unit: t('error.validation_failed') })
    const fullName = existing?.fullName ?? name.trim()
    const body = {
      unitId: unit.unitId,
      phone: phone.trim(),
      fullName,
      memberType: effectiveRole,
      ...(effectiveRole === 'tenant' ? { canPay } : {}),
      ...(!existing && email.trim() ? { email: email.trim() } : {}),
      ...(!existing && note.trim() ? { note: note.trim() } : {}),
    }
    create.mutate(
      { body, key: intent.keyFor(body) },
      {
        onSuccess: (result) => {
          intent.reset()
          toast.success(
            t(
              result.accountCreated
                ? 'web.resident-add.toast.created'
                : 'web.resident-add.toast.linked',
              { code },
            ),
          )
          void navigate({ to: '/units/$unitId', params: { unitId: unit.unitId }, search: {} })
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'unit_has_owner')
            setRoleError({ text: errorText(t, failure), unitId: unit.unitId })
          else if (failure.code === 'member_exists') setErrors({ phone: errorText(t, failure) })
          else if (failure.code === 'phone_invalid') setErrors({ phone: errorText(t, failure) })
          else if (failure.code === 'idempotency_key_reuse') {
            intent.reset()
            setBanner(errorText(t, failure))
          } else setBanner(errorText(t, failure))
        },
      },
    )
  }

  const ready = unit !== null && phone.trim() !== '' && (existing !== null || name.trim() !== '')

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      variant="side"
      title={unit ? t('web.resident-add.title', { code }) : t('web.resident-add.title.generic')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            {t('web.resident-add.cta.cancel')}
          </Button>
          <Button
            type="submit"
            form="resident-add-form"
            loading={create.isPending}
            disabled={!ready}
          >
            {existing
              ? t('web.resident-add.cta.link', { code })
              : t(
                  effectiveRole === 'owner'
                    ? 'web.resident-add.cta.owner'
                    : 'web.resident-add.cta.member',
                )}
          </Button>
        </>
      }
    >
      <form
        id="resident-add-form"
        onSubmit={submit}
        className="flex flex-col gap-4 py-2"
        noValidate
      >
        {banner && <Banner tone="danger">{banner}</Banner>}
        <TextField
          type="tel"
          autoComplete="off"
          label={`${t('web.resident-add.field.phone.label')} *`}
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value)
            intent.reset()
          }}
          error={errors.phone}
        />
        {existing && (
          <Banner tone="info" title={t('web.resident-add.banner.existing.title')}>
            <div className="mt-2 flex items-center gap-3">
              <Avatar name={existing.fullName ?? existing.phone} size="sm" />
              <div className="min-w-0">
                <p className="text-body-strong">{existing.fullName ?? '—'}</p>
                <p>{t('web.resident-add.existing.line', { phone: formatPhone(existing.phone) })}</p>
                {existing.cccdMasked && (
                  <p>{t('web.resident-add.profile.cccd', { masked: existing.cccdMasked })}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  {existing.memberships.map((membership) => (
                    <span key={membership.membershipId} className="inline-flex items-center gap-1">
                      <Plate>{membership.unitCode}</Plate>{' '}
                      {t(`common.member-type.${membership.memberType}`)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2">
              {t('web.resident-add.banner.existing.body', {
                code: code || '…',
                role: t(`common.member-type.${effectiveRole}`),
              })}
            </p>
          </Banner>
        )}
        <UnitPicker
          label={`${t('web.resident-add.field.unit.label')} *`}
          value={unit}
          error={errors.unit}
          onChange={(next) => {
            setUnit(next)
            setRole(null)
            intent.reset()
          }}
          hint={(item) =>
            t('web.resident-add.field.unit.hint', {
              floor: item.floor ?? '—',
              bedrooms: item.bedrooms ?? '—',
              occupancy: t(`status.unit.${item.occupancy}`),
            })
          }
        />
        <div className="flex flex-col gap-2">
          <SelectField
            label={t('web.resident-add.field.role.label')}
            value={effectiveRole}
            onValueChange={(value) => {
              setRole(value as MemberType)
              setRoleError(null)
              intent.reset()
            }}
            options={ROLES.map((type) => ({
              value: type,
              label: t(`common.member-type.${type}`),
              disabled: type === 'owner' && hasOwner,
            }))}
            hint={
              hasOwner
                ? t('web.resident-add.field.role.owner-taken')
                : effectiveRole === 'owner'
                  ? t('web.resident-add.field.role.hint.owner')
                  : undefined
            }
            error={roleError?.text}
          />
          {roleError && (
            <Link
              to="/units/$unitId"
              params={{ unitId: roleError.unitId }}
              search={{ dialog: 'transfer' }}
              className="text-secondary text-teal underline"
            >
              {t('web.unit-detail.cta.transfer')}
            </Link>
          )}
        </div>
        {effectiveRole === 'tenant' && (
          <Checkbox
            checked={canPay}
            onCheckedChange={setCanPay}
            label={t('web.resident-add.field.can-pay.label')}
          />
        )}
        {!existing && (
          <>
            <TextField
              autoComplete="off"
              label={`${t('web.resident-add.field.name.label')} *`}
              value={name}
              error={errors.name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              type="email"
              autoComplete="off"
              label={t('web.resident-add.field.email.label')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              autoComplete="off"
              label={t('web.resident-add.field.note.label')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        )}
        <p className="text-secondary text-ink-muted">{t('web.resident-add.info')}</p>
      </form>
    </Dialog>
  )
}
