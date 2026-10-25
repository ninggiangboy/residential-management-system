import type { StaffRole } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { Avatar } from '../../components/ui/avatar'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { Chip, ChipGroup } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { PageHeader } from '../../components/ui/page'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { StatusTag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useDebounced } from '../../lib/use-debounced'
import { type StaffAccount, staffListQuery, staffSummaryQuery, useStaffMutations } from './hooks'
import { type OpenTicket, OpenTicketsDialog } from './open-tickets-dialog'

export interface StaffSearch {
  role?: StaffRole
  status?: 'invited' | 'active' | 'locked' | 'disabled'
  q?: string
  page: number
  pageSize: number
}

const ROLES: readonly StaffRole[] = ['admin', 'manager', 'technician', 'guard']

/** A temporary lockout (`status = active` with `lockedUntil` ahead, DR-107) is shown as locked (DOC-67 `W-Staff` §4). */
const isLocked = (account: StaffAccount, now: number) =>
  account.status === 'locked' ||
  (account.status === 'active' &&
    account.lockedUntil !== null &&
    Date.parse(account.lockedUntil) > now)

type Pending =
  | { kind: 'lock' | 'disable'; account: StaffAccount }
  | {
      kind: 'tickets'
      action: 'lock' | 'disable'
      account: StaffAccount
      tickets: OpenTicket[]
      error?: string
    }

/** `W-Staff` (DOC-67): staff accounts, their status and the actions the signed-in role may take. */
export function StaffPage({ search }: { search: StaffSearch }) {
  const { t, formatDateTime } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const me = useQuery(staffMeQuery()).data
  const [typed, setTyped] = useState(search.q ?? '')
  const debounced = useDebounced(typed.trim())
  const list = useQuery(staffListQuery(search))
  const summary = useQuery(staffSummaryQuery())
  const mutations = useStaffMutations()
  const [pending, setPending] = useState<Pending | null>(null)
  const [now] = useState(() => Date.now())

  // A changed search resets the page (DOC-67 §2).
  useEffect(() => {
    if ((search.q ?? '') !== debounced)
      void navigate({
        to: '/staff',
        search: { ...search, q: debounced === '' ? undefined : debounced, page: 1 },
        replace: true,
      })
  }, [debounced, navigate, search])

  const isAdmin = me?.role === 'admin'
  const items = list.data?.items ?? []
  const counts = summary.data
    ? ROLES.map(
        (role) => [role, summary.data.items.filter((item) => item.role === role).length] as const,
      )
    : null
  const invited = summary.data?.items.filter((item) => item.status === 'invited').length ?? 0
  const lockedCount = summary.data?.items.filter((item) => isLocked(item, now)).length ?? 0

  const setFilter = (role: StaffRole | undefined) =>
    void navigate({ to: '/staff', search: { ...search, role, page: 1 } })

  const act = (promise: Promise<unknown>, success: string) =>
    promise.then(
      () => toast.success(success),
      (thrown) => toast.error(errorText(t, apiErrorOf(thrown))),
    )

  const lockOrDisable = (
    kind: 'lock' | 'disable',
    account: StaffAccount,
    reassign?: { reassignTo: string; reason: string },
  ) => {
    const mutation = kind === 'lock' ? mutations.lock : mutations.disable
    mutation.mutate(
      { id: account.id, ...reassign },
      {
        onSuccess: () => {
          setPending(null)
          toast.success(
            t(kind === 'lock' ? 'web.staff.toast.locked' : 'web.staff.toast.disabled', {
              name: account.fullName,
            }),
          )
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'staff_has_open_tickets') {
            const tickets =
              (failure.details as { tickets?: OpenTicket[] } | undefined)?.tickets ?? []
            setPending({ kind: 'tickets', action: kind, account, tickets })
          } else {
            setPending(null)
            toast.error(errorText(t, failure))
          }
        },
      },
    )
  }

  const rowAction = (account: StaffAccount) => {
    if (me?.id === account.id)
      return <span className="text-secondary text-ink-muted">{t('web.staff.row.self')}</span>
    const manages = isAdmin || account.role === 'technician' || account.role === 'guard'
    if (!manages)
      return <span className="text-secondary text-ink-muted">{t('web.staff.row.admin-only')}</span>
    const locked = isLocked(account, now)
    return (
      <div className="flex items-center gap-2">
        {account.status === 'invited' && (
          <Button
            size="sm"
            variant="tonal"
            disabled={!canWrite}
            onClick={() =>
              void act(
                mutations.resendInvite.mutateAsync(account.id),
                t('web.staff.toast.invite-resent', { name: account.fullName }),
              )
            }
          >
            {t('web.staff.action.resend-invite')}
          </Button>
        )}
        {account.status === 'active' && !locked && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite}
            onClick={() => setPending({ kind: 'lock', account })}
          >
            {t('web.staff.action.lock')}
          </Button>
        )}
        {locked && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite}
            onClick={() =>
              void act(
                mutations.unlock.mutateAsync(account.id),
                t('web.staff.toast.unlocked', { name: account.fullName }),
              )
            }
          >
            {t('web.staff.action.unlock')}
          </Button>
        )}
        {account.status === 'disabled' && isAdmin && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite}
            onClick={() =>
              void act(
                mutations.enable.mutateAsync(account.id),
                t('web.staff.toast.enabled', { name: account.fullName }),
              )
            }
          >
            {t('web.staff.action.enable')}
          </Button>
        )}
        <Link
          to="/staff/$staffId/edit"
          params={{ staffId: account.id }}
          search={search}
          aria-label={t('web.staff.action.edit.label', { name: account.fullName })}
          className={buttonStyles({ variant: 'ghost', size: 'sm' }) + ' w-control-sm px-0'}
        >
          <Icon name="pencil-simple" />
        </Link>
      </div>
    )
  }

  const total = list.data?.total ?? 0
  const from = total === 0 ? 0 : (search.page - 1) * search.pageSize + 1
  const to = Math.min(total, search.page * search.pageSize)
  const filtered =
    search.role !== undefined || search.status !== undefined || (search.q ?? '') !== ''

  return (
    <>
      <PageHeader
        title={t('web.staff.title')}
        subtitle={
          summary.data
            ? t('web.staff.subtitle', { total: summary.data.total, invited, locked: lockedCount })
            : undefined
        }
        actions={
          <Link
            to="/staff/new"
            search={search}
            className={buttonStyles({ variant: 'primary' })}
            aria-disabled={!canWrite}
          >
            {t('web.staff.cta')}
          </Link>
        }
      />
      <Banner className="mb-6">{t('web.staff.banner.roles')}</Banner>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <ChipGroup label={t('web.staff.col.role')}>
          <Chip selected={search.role === undefined} onClick={() => setFilter(undefined)}>
            {t('web.staff.chip.all', { count: counts ? (summary.data?.total ?? 0) : '' })}
          </Chip>
          {ROLES.map((role) => (
            <Chip key={role} selected={search.role === role} onClick={() => setFilter(role)}>
              {t('web.staff.chip.role', {
                role: t(`common.staff-role.${role}`),
                count: counts?.find(([name]) => name === role)?.[1] ?? '',
              })}
            </Chip>
          ))}
        </ChipGroup>
        <SearchField
          label={t('web.staff.field.search.label')}
          placeholder={t('web.staff.field.search.placeholder')}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="w-80"
        />
      </div>
      {list.isError && !list.data ? (
        <ErrorState
          requestId={apiErrorOf(list.error).requestId}
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <DataTable label={t('web.staff.title')}>
          <TBody>
            {Array.from({ length: 5 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <Tr key={index}>
                <Td colSpan={5}>
                  <Skeleton className="h-8" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      ) : items.length === 0 ? (
        <EmptyState
          icon="users-three"
          title={t('web.staff.empty.title')}
          body={t('web.staff.empty.body')}
          actions={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setTyped('')
                  void navigate({ to: '/staff', search: { page: 1, pageSize: search.pageSize } })
                }}
              >
                {t('common.action.clear-filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          label={t('web.staff.title')}
          footer={
            <>
              <span className="text-secondary text-ink-muted">
                {t('web.staff.pager.range', { from, to, total })}
              </span>
              <div className="flex gap-2">
                <IconButton
                  icon="caret-left"
                  label={t('web.staff.pager.prev')}
                  variant="outline"
                  disabled={search.page <= 1}
                  onClick={() =>
                    void navigate({ to: '/staff', search: { ...search, page: search.page - 1 } })
                  }
                />
                <IconButton
                  icon="caret-right"
                  label={t('web.staff.pager.next')}
                  variant="outline"
                  disabled={to >= total}
                  onClick={() =>
                    void navigate({ to: '/staff', search: { ...search, page: search.page + 1 } })
                  }
                />
              </div>
            </>
          }
        >
          <THead>
            <Tr>
              <Th>{t('web.staff.col.name')}</Th>
              <Th>{t('web.staff.col.role')}</Th>
              <Th>{t('web.staff.col.status')}</Th>
              <Th>{t('web.staff.col.last-login')}</Th>
              <Th>{t('web.staff.col.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((account) => (
              <Tr key={account.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={account.fullName} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-body-strong">{account.fullName}</p>
                      <p className="truncate text-secondary text-ink-muted">{account.email}</p>
                    </div>
                  </div>
                </Td>
                <Td>{t(`common.staff-role.${account.role}`)}</Td>
                <Td>
                  <StatusTag
                    entity="staff_account"
                    value={
                      isLocked(account, now) && account.status === 'active'
                        ? 'locked'
                        : account.status
                    }
                  />
                </Td>
                <Td className="text-secondary text-ink-muted">
                  {account.lastLoginAt
                    ? formatDateTime(account.lastLoginAt)
                    : t('web.staff.row.never')}
                </Td>
                <Td>{rowAction(account)}</Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      )}

      <ConfirmDialog
        open={pending?.kind === 'lock' || pending?.kind === 'disable'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t(
          pending?.kind === 'disable'
            ? 'web.staff.dialog.disable.title'
            : 'web.staff.dialog.lock.title',
          {
            name: pending?.account.fullName ?? '',
          },
        )}
        body={t(
          pending?.kind === 'disable'
            ? 'web.staff.dialog.disable.body'
            : 'web.staff.dialog.lock.body',
          {
            name: pending?.account.fullName ?? '',
          },
        )}
        confirmLabel={t(
          pending?.kind === 'disable'
            ? 'web.staff.dialog.disable.confirm'
            : 'web.staff.dialog.lock.confirm',
        )}
        tone="danger"
        loading={mutations.lock.isPending || mutations.disable.isPending}
        onConfirm={() =>
          pending && pending.kind !== 'tickets' && lockOrDisable(pending.kind, pending.account)
        }
      />
      <OpenTicketsDialog
        open={pending?.kind === 'tickets'}
        name={pending?.account.fullName ?? ''}
        tickets={pending?.kind === 'tickets' ? pending.tickets : []}
        canReassign={isAdmin}
        pending={mutations.lock.isPending || mutations.disable.isPending}
        error={pending?.kind === 'tickets' ? pending.error : null}
        onClose={() => setPending(null)}
        onSubmit={(reassign) =>
          pending?.kind === 'tickets' && lockOrDisable(pending.action, pending.account, reassign)
        }
      />
    </>
  )
}
