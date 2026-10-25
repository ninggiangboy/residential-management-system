import type { StaffRole } from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { apiErrorOf } from '../../api/errors'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { CANCELLED, type StepUpAction, useStepUp, withStepUp } from '../../auth/step-up'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { RadioCards } from '../../components/ui/controls'
import { ConfirmDialog, Dialog } from '../../components/ui/dialog'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Skeleton } from '../../components/ui/skeleton'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { applyServerErrors, formResolver } from '../../lib/forms'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useIntent } from '../../lib/use-intent'
import { type StaffAccount, staffAccountQuery, useStaffMutations } from './hooks'
import { type OpenTicket, OpenTicketsDialog } from './open-tickets-dialog'
import type { StaffSearch } from './staff-page'

const EMAIL = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
const FormSchema = Type.Object({
  fullName: Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' }),
  email: Type.String({ pattern: EMAIL, maxLength: 254 }),
  role: Type.Union([
    Type.Literal('admin'),
    Type.Literal('manager'),
    Type.Literal('technician'),
    Type.Literal('guard'),
  ]),
  language: Type.Union([Type.Literal('vi'), Type.Literal('en')]),
})
interface Values {
  fullName: string
  email: string
  role: StaffRole
  language: 'vi' | 'en'
}
const FIELDS = ['fullName', 'email', 'role', 'language'] as const
const ALL_ROLES: readonly StaffRole[] = ['admin', 'manager', 'technician', 'guard']
const MANAGER_ROLES: readonly StaffRole[] = ['technician', 'guard']

/** `W-Staff-New`: the right-hand dialog that is the route itself, create at `/staff/new`, edit at `/staff/$staffId/edit` (DOC-67). */
export function StaffFormDialog({ staffId, search }: { staffId?: string; search: StaffSearch }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const stepUp = useStepUp()
  const mutations = useStaffMutations()
  const me = useQuery(staffMeQuery()).data
  const edit = staffId !== undefined
  const account = useQuery({ ...staffAccountQuery(staffId ?? ''), enabled: edit })
  const intent = useIntent()
  const [banner, setBanner] = useState<string | null>(null)
  const [discard, setDiscard] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [tickets, setTickets] = useState<{
    open: OpenTicket[]
    action: 'update' | 'disable'
    values?: Values
  } | null>(null)

  const isAdmin = me?.role === 'admin'
  const roles = isAdmin ? ALL_ROLES : MANAGER_ROLES
  // A Manager opening an Admin or a Manager gets the read-only dialog (DOC-67 `W-Staff-New` §7).
  const readOnly =
    edit && !isAdmin && account.data !== undefined && !MANAGER_ROLES.includes(account.data.role)
  const resolver = useMemo(() => formResolver<Values>(FormSchema, t), [t])
  const form = useForm<Values>({
    resolver,
    defaultValues: { fullName: '', email: '', role: roles[0] ?? 'technician', language: 'vi' },
  })

  useEffect(() => {
    if (account.data)
      form.reset({
        fullName: account.data.fullName,
        email: account.data.email,
        role: account.data.role,
        language: account.data.language,
      })
  }, [account.data, form])

  const close = () => void navigate({ to: '/staff', search })
  const requestClose = () => (form.formState.isDirty ? setDiscard(true) : close())

  const changed = (values: Values, original: StaffAccount) => ({
    ...(values.fullName.trim() !== original.fullName ? { fullName: values.fullName.trim() } : {}),
    ...(values.language !== original.language ? { language: values.language } : {}),
    ...(values.role !== original.role ? { role: values.role } : {}),
    ...(values.email.trim().toLowerCase() !== original.email.toLowerCase()
      ? { email: values.email.trim() }
      : {}),
  })

  const fail = (thrown: unknown) => {
    const failure = apiErrorOf(thrown)
    if (failure.code === 'email_in_use') {
      form.setError(
        'email',
        { type: failure.code, message: errorText(t, failure) },
        { shouldFocus: true },
      )
    } else if (failure.code === 'staff_has_open_tickets') {
      setTickets({
        open: (failure.details as { tickets?: OpenTicket[] } | undefined)?.tickets ?? [],
        action: 'update',
        values: form.getValues(),
      })
    } else {
      const text = applyServerErrors(form, failure, FIELDS, errorText(t, failure))
      if (text) setBanner(text)
    }
  }

  const submit = form.handleSubmit(async (values) => {
    setBanner(null)
    if (readOnly || !canWrite) return
    try {
      if (!edit) {
        const body = {
          fullName: values.fullName.trim(),
          email: values.email.trim(),
          role: values.role,
          language: values.language,
        }
        const action: StepUpAction | null = values.role === 'admin' ? 'admin_change' : null
        const result = await withStepUp(stepUp, action, (proof) =>
          mutations.create.mutateAsync({
            body,
            proof,
            key: proof ? crypto.randomUUID() : intent.keyFor(body),
          }),
        )
        if (result === CANCELLED) return
        intent.reset()
        toast.success(t('web.staff-new.toast.created', { email: body.email }), {
          description: t('web.staff-new.toast.created.hint'),
        })
        close()
        return
      }
      const original = account.data
      if (!original) return
      const body = changed(values, original)
      if (Object.keys(body).length === 0) return close()
      if (body.role === 'admin' && body.email !== undefined) {
        form.setError('email', {
          type: 'one_step_up_action',
          message: t('error.validation_failed'),
        })
        return
      }
      const action: StepUpAction | null =
        body.role === 'admin' ? 'admin_change' : body.email !== undefined ? 'staff_email' : null
      const result = await withStepUp(stepUp, action, (proof) =>
        mutations.update.mutateAsync({ id: original.id, version: original.version, body, proof }),
      )
      if (result === CANCELLED) return
      toast.success(t('web.staff.toast.updated'))
      close()
    } catch (thrown) {
      fail(thrown)
    }
  })

  const reassignAndSave = async (reassign: { reassignTo: string; reason: string }) => {
    const original = account.data
    const values = tickets?.values
    if (!original || !values) return
    try {
      const body = { ...changed(values, original), ...reassign }
      const action: StepUpAction | null = body.role === 'admin' ? 'admin_change' : null
      const result = await withStepUp(stepUp, action, (proof) =>
        mutations.update.mutateAsync({ id: original.id, version: original.version, body, proof }),
      )
      if (result === CANCELLED) return
      setTickets(null)
      toast.success(t('web.staff.toast.updated'))
      close()
    } catch (thrown) {
      setTickets(null)
      fail(thrown)
    }
  }

  const disable = (reassign?: { reassignTo: string; reason: string }) => {
    if (!account.data) return
    mutations.disable.mutate(
      { id: account.data.id, ...reassign },
      {
        onSuccess: () => {
          toast.success(t('web.staff.toast.disabled', { name: account.data?.fullName ?? '' }))
          setDisabling(false)
          setTickets(null)
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          setDisabling(false)
          if (failure.code === 'staff_has_open_tickets')
            setTickets({
              open: (failure.details as { tickets?: OpenTicket[] } | undefined)?.tickets ?? [],
              action: 'disable',
            })
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  const pending = mutations.create.isPending || mutations.update.isPending
  const canDisable =
    edit &&
    isAdmin &&
    account.data !== undefined &&
    me?.id !== account.data.id &&
    account.data.status !== 'disabled'
  const loading = edit && account.isPending

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => !open && requestClose()}
        variant="side"
        title={t(edit ? 'web.staff-new.title.edit' : 'web.staff-new.title')}
        dismissible={!pending}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div>
              {canDisable && (
                <Button
                  variant="danger-ghost"
                  onClick={() => setDisabling(true)}
                  disabled={!canWrite}
                >
                  {t('web.staff-new.action.disable')}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={requestClose} disabled={pending}>
                {t('web.staff-new.cta.cancel')}
              </Button>
              {!readOnly && (
                <Button
                  type="submit"
                  form="staff-form"
                  loading={pending}
                  disabled={!canWrite || loading}
                >
                  {t(edit ? 'web.staff-new.cta.save' : 'web.staff-new.cta')}
                </Button>
              )}
            </div>
          </div>
        }
      >
        {account.isError ? (
          <Banner tone="danger">{errorText(t, apiErrorOf(account.error))}</Banner>
        ) : loading ? (
          <div className="flex flex-col gap-4 py-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : (
          <form id="staff-form" onSubmit={submit} className="flex flex-col gap-5 py-2" noValidate>
            {banner && <Banner tone="danger">{banner}</Banner>}
            <TextField
              label={t('web.staff-new.field.name.label')}
              autoComplete="off"
              disabled={readOnly}
              error={form.formState.errors.fullName?.message}
              {...form.register('fullName')}
            />
            {(!edit || isAdmin) && (
              <TextField
                type="email"
                label={t('web.staff-new.field.email.label')}
                hint={t('web.staff-new.field.email.hint')}
                autoComplete="off"
                disabled={readOnly}
                error={form.formState.errors.email?.message}
                {...form.register('email')}
              />
            )}
            {edit && (
              <Controller
                control={form.control}
                name="language"
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-caption text-ink">
                      {t('web.staff-new.field.language.label')}
                    </span>
                    <SegmentedControl<'vi' | 'en'>
                      label={t('web.staff-new.field.language.label')}
                      value={field.value}
                      disabled={readOnly}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'vi', label: 'Tiếng Việt' },
                        { value: 'en', label: 'English' },
                      ]}
                    />
                  </div>
                )}
              />
            )}
            {(!edit || isAdmin) && (
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <div className="flex flex-col gap-2">
                    <span className="text-caption text-ink">
                      {t('web.staff-new.field.role.label')}
                    </span>
                    <RadioCards<StaffRole>
                      label={t('web.staff-new.field.role.label')}
                      value={field.value}
                      disabled={readOnly || (edit && me?.id === account.data?.id)}
                      onValueChange={field.onChange}
                      options={roles.map((role) => ({
                        value: role,
                        label: t(`common.staff-role.${role}`),
                        description: t(`web.staff-new.role.${role}.desc`),
                      }))}
                    />
                    {form.watch('role') === 'admin' && (
                      <p className="text-secondary text-ink-muted">
                        {t('web.staff-new.hint.admin-step-up')}
                      </p>
                    )}
                  </div>
                )}
              />
            )}
            {!edit && (
              <p className="text-secondary text-ink-muted">{t('web.staff-new.note.invite')}</p>
            )}
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t('web.staff-new.dialog.discard.title')}
        confirmLabel={t('web.staff-new.dialog.discard.confirm')}
        onConfirm={close}
      />
      <ConfirmDialog
        open={disabling}
        onOpenChange={setDisabling}
        title={t('web.staff.dialog.disable.title', { name: account.data?.fullName ?? '' })}
        body={t('web.staff.dialog.disable.body', { name: account.data?.fullName ?? '' })}
        confirmLabel={t('web.staff.dialog.disable.confirm')}
        tone="danger"
        loading={mutations.disable.isPending}
        onConfirm={() => disable()}
      />
      <OpenTicketsDialog
        open={tickets !== null}
        name={account.data?.fullName ?? ''}
        tickets={tickets?.open ?? []}
        canReassign={isAdmin}
        pending={mutations.update.isPending || mutations.disable.isPending}
        onClose={() => setTickets(null)}
        onSubmit={(reassign) =>
          tickets?.action === 'disable' ? disable(reassign) : void reassignAndSave(reassign)
        }
      />
    </>
  )
}
