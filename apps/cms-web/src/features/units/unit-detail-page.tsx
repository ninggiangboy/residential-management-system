import { formatArea } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { useSetBreadcrumbTail } from '../../components/layout/breadcrumb'
import { Avatar } from '../../components/ui/avatar'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles } from '../../components/ui/button'
import { Switch } from '../../components/ui/controls'
import { ConfirmDialog, useLastDefined } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { RowMenu } from '../../components/ui/menu'
import { PageHeader } from '../../components/ui/page'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { TabList, TabPanel, Tabs } from '../../components/ui/tabs'
import { Plate, StatusTag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { ChangePhoneDialog } from './change-phone-dialog'
import {
  type HistoryItem,
  historyPageQuery,
  type UnitMember,
  unitQuery,
  useUnitMutations,
} from './hooks'
import { TransferDialog } from './transfer-dialog'
import { UnitEditDialog } from './unit-edit-dialog'

export interface UnitDetailSearch {
  tab: 'members' | 'history'
  dialog?: 'edit' | 'transfer' | 'phone' | 'member'
  membershipId?: string
}

type Row = UnitMember

type Confirm = { kind: 'lock' | 'unlock' | 'remove'; member: Row }

const permissionKey = (member: Row) => `web.unit-detail.permission.${member.memberType}` as const

/** `W-Unit-Detail` (DOC-65): the members of one unit and the actions on them, the owner transfer, and the unit's history. */
export function UnitDetailPage({ unitId, search }: { unitId: string; search: UnitDetailSearch }) {
  const { t, lang, formatPhone } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const unit = useQuery(unitQuery(unitId))
  const { membership } = useUnitMutations()
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useSetBreadcrumbTail(unit.data?.code ?? null)
  // The member of the phone dialog stays named while the dialog leaves (the param is cleared on close).
  const phoneMember = useLastDefined(
    [...(unit.data?.owner ? [unit.data.owner] : []), ...(unit.data?.members ?? [])].find(
      (row) => row.membershipId === search.membershipId,
    ),
  )

  const closeOverlay = useCloseOverlay()
  // A tab refines the page and replaces its entry; a dialog is an entry of its own, so Back closes it (`lib/history.ts`).
  const go = (patch: Partial<UnitDetailSearch>) =>
    void navigate({
      to: '/units/$unitId',
      params: { unitId },
      search: { ...search, ...patch },
      replace: true,
    })
  const openDialog = (patch: Partial<UnitDetailSearch>) =>
    void navigate({
      to: '/units/$unitId',
      params: { unitId },
      search: { ...search, ...patch },
      state: OPENED_HERE,
    })
  const closeDialog = (patch: Partial<UnitDetailSearch> = {}) =>
    closeOverlay(() => go({ dialog: undefined, ...patch }))

  if (unit.isPending) return <DetailSkeleton />
  if (unit.isError || !unit.data) {
    const failure = apiErrorOf(unit.error)
    if (failure.status === 404)
      return (
        <EmptyState
          icon="magnifying-glass"
          title={t('common.not-found.title')}
          body={t('common.not-found.body')}
          actions={
            <Link to="/units" search={{}} className={buttonStyles({ variant: 'outline' })}>
              {t('web.shell.nav.units')}
            </Link>
          }
        />
      )
    return <ErrorState requestId={failure.requestId} onRetry={() => void unit.refetch()} />
  }

  const detail = unit.data
  const rows: Row[] = [
    ...(detail.owner
      ? [
          {
            ...detail.owner,
            memberType: 'owner' as const,
            canPay: true,
            startedAt: '',
          },
        ]
      : []),
    ...detail.members,
  ]
  /** The value of the switch while its call runs: the one being saved, so the thumb moves at once and returns if the call fails. */
  const savingCanPay = (member: Row) => {
    const sent = membership.variables
    return membership.isPending && sent?.id === member.membershipId && 'canPay' in sent.change
      ? sent.change.canPay
      : member.canPay
  }
  const dialogMember = rows.find((row) => row.membershipId === search.membershipId)

  const change = (
    member: Row,
    body:
      | { status: 'locked' | 'active' | 'removed' }
      | { memberType: 'family' | 'tenant' }
      | { canPay: boolean },
    success?: string,
  ) => {
    setBusy(member.membershipId)
    membership.mutate(
      { id: member.membershipId, unitId, change: body },
      {
        onSuccess: () => {
          setConfirm(null)
          if (success) toast.success(success)
        },
        onError: (thrown) => {
          setConfirm(null)
          const failure = apiErrorOf(thrown)
          toast.error(errorText(t, failure))
        },
        onSettled: () => setBusy(null),
      },
    )
  }

  const title =
    detail.floor !== null && detail.bedrooms !== null && detail.areaM2 !== null
      ? t('web.unit-detail.title', {
          floor: detail.floor,
          bedrooms: detail.bedrooms,
          area: formatArea(Number(detail.areaM2), lang).replace(/\s*m²$/, ''),
        })
      : t('web.unit-detail.title.fallback', { code: detail.code })

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Plate size="lg">{detail.code}</Plate>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-title-1 text-ink">{title}</h1>
              <StatusTag entity="unit" value={detail.occupancy} />
            </div>
            <p className="mt-1 text-secondary text-ink-muted">
              {detail.owner
                ? t('web.unit-detail.subtitle.owner', {
                    name: detail.owner.fullName ?? '—',
                    phone: formatPhone(detail.owner.phone),
                  })
                : t('web.unit-detail.subtitle.no-owner')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!canWrite}
            onClick={() => openDialog({ dialog: 'edit' })}
          >
            {t('web.unit-detail.cta.edit')}
          </Button>
          {detail.owner ? (
            <Button
              variant="outline"
              disabled={!canWrite}
              onClick={() => openDialog({ dialog: 'transfer' })}
            >
              {t('web.unit-detail.cta.transfer')}
            </Button>
          ) : (
            <Link
              to="/residents/new"
              search={{ unitId }}
              state={OPENED_HERE}
              className={buttonStyles({ variant: 'primary' })}
            >
              {t('web.unit-detail.cta.assign')}
            </Link>
          )}
        </div>
      </div>

      <Tabs
        value={search.tab}
        onValueChange={(tab) => go({ tab: tab as UnitDetailSearch['tab'], dialog: undefined })}
      >
        <TabList
          label={t('web.unit-detail.title.fallback', { code: detail.code })}
          tabs={[
            { value: 'members', label: `${t('web.unit-detail.tab.members')} ${rows.length}` },
            { value: 'history', label: t('web.unit-detail.tab.history') },
          ]}
        />
        <TabPanel value="members" className="mt-6">
          <Banner className="mb-4">{t('web.unit-detail.banner.members')}</Banner>
          {rows.length === 0 ? (
            <EmptyState icon="users-three" title={t('web.unit-detail.empty.title')} />
          ) : (
            <DataTable label={t('web.unit-detail.tab.members')} minWidth="min-w-[960px]">
              <THead>
                <Tr>
                  <Th>{t('web.unit-detail.col.member')}</Th>
                  <Th>{t('web.unit-detail.col.phone')}</Th>
                  <Th>{t('web.unit-detail.col.permission')}</Th>
                  <Th>{t('web.unit-detail.col.status')}</Th>
                  <Th>{t('web.unit-detail.col.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((member) => {
                  const owner = member.memberType === 'owner'
                  const locked = member.status === 'locked'
                  const working = busy === member.membershipId
                  return (
                    <Tr key={member.membershipId}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={member.fullName ?? member.phone} size="sm" />
                          <div className="min-w-0">
                            <Link
                              to="/residents"
                              search={{ dialog: 'profile', accountId: member.accountId }}
                              className="block truncate text-body-strong text-ink hover:underline"
                            >
                              {member.fullName ?? '—'}
                            </Link>
                            <p className="text-secondary text-ink-muted">
                              {t(`common.member-type.${member.memberType}`)}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td>{formatPhone(member.phone)}</Td>
                      <Td className="max-w-72">
                        <p className="text-secondary text-ink-muted">{t(permissionKey(member))}</p>
                        {member.memberType === 'tenant' && (
                          <div className="mt-2 flex w-fit items-center gap-2">
                            <Switch
                              id={`can-pay-${member.membershipId}`}
                              checked={savingCanPay(member)}
                              disabled={!canWrite || working}
                              label={t('web.unit-detail.permission.can-pay')}
                              onCheckedChange={(canPay) => change(member, { canPay })}
                            />
                            <label
                              htmlFor={`can-pay-${member.membershipId}`}
                              className="cursor-pointer text-secondary text-ink"
                            >
                              {t('web.unit-detail.permission.can-pay')}
                            </label>
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusTag entity="membership" value={member.status} />
                          {locked && member.lockedBy && (
                            <span className="text-caption text-ink-muted">
                              {t(
                                member.lockedBy === 'owner'
                                  ? 'web.unit-detail.locked-by.owner'
                                  : 'web.unit-detail.locked-by.manager',
                              )}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite}
                            onClick={() =>
                              openDialog({ dialog: 'phone', membershipId: member.membershipId })
                            }
                          >
                            {t('web.unit-detail.action.change-phone')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite || working}
                            onClick={() => setConfirm({ kind: locked ? 'unlock' : 'lock', member })}
                          >
                            {t(
                              locked
                                ? 'web.unit-detail.action.unlock'
                                : 'web.unit-detail.action.lock',
                            )}
                          </Button>
                          {!owner && (
                            <Button
                              size="sm"
                              variant="danger-ghost"
                              disabled={!canWrite || working}
                              onClick={() => setConfirm({ kind: 'remove', member })}
                            >
                              {t('web.unit-detail.action.remove')}
                            </Button>
                          )}
                          {(member.memberType === 'family' || member.memberType === 'tenant') && (
                            <RowMenu
                              label={t('web.unit-detail.col.actions')}
                              items={[
                                member.memberType === 'family'
                                  ? {
                                      key: 'retype-tenant',
                                      label: t('web.unit-detail.action.retype-tenant'),
                                      disabled: !canWrite,
                                      onSelect: () => change(member, { memberType: 'tenant' }),
                                    }
                                  : {
                                      key: 'retype-family',
                                      label: t('web.unit-detail.action.retype-family'),
                                      disabled: !canWrite,
                                      onSelect: () => change(member, { memberType: 'family' }),
                                    },
                              ]}
                            />
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </DataTable>
          )}
        </TabPanel>
        <TabPanel value="history" className="mt-6">
          <HistoryList unitId={unitId} />
        </TabPanel>
      </Tabs>

      <UnitEditDialog unit={detail} open={search.dialog === 'edit'} onClose={() => closeDialog()} />
      <TransferDialog
        unit={detail}
        open={search.dialog === 'transfer'}
        onClose={() => closeDialog()}
      />
      {phoneMember && (
        <ChangePhoneDialog
          open={search.dialog === 'phone' && dialogMember !== undefined}
          accountId={phoneMember.accountId}
          name={phoneMember.fullName ?? phoneMember.phone}
          currentPhone={phoneMember.phone}
          unitId={unitId}
          onClose={() => closeDialog({ membershipId: undefined })}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm
            ? t(
                `web.unit-detail.dialog.${confirm.kind}.title` as 'web.unit-detail.dialog.lock.title',
                {
                  name: confirm.member.fullName ?? confirm.member.phone,
                  code: detail.code,
                },
              )
            : ''
        }
        body={
          confirm && confirm.kind !== 'unlock'
            ? t(
                `web.unit-detail.dialog.${confirm.kind}.body` as 'web.unit-detail.dialog.lock.body',
                { code: detail.code },
              )
            : undefined
        }
        confirmLabel={
          confirm
            ? t(
                `web.unit-detail.dialog.${confirm.kind}.confirm` as 'web.unit-detail.dialog.lock.confirm',
              )
            : ''
        }
        tone={confirm?.kind === 'unlock' ? 'primary' : 'danger'}
        loading={membership.isPending}
        onConfirm={() => {
          if (!confirm) return
          const status =
            confirm.kind === 'lock' ? 'locked' : confirm.kind === 'unlock' ? 'active' : 'removed'
          change(confirm.member, { status })
        }}
      />
    </>
  )
}

function HistoryList({ unitId }: { unitId: string }) {
  const { t, formatDateTime } = useI18n()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const pages = cursors.map((cursor) => cursor)
  return (
    <div className="flex flex-col gap-3">
      {pages.map((cursor, index) => (
        <HistoryPage
          key={cursor ?? 'first'}
          unitId={unitId}
          cursor={cursor}
          last={index === pages.length - 1}
          onMore={(next) => setCursors((current) => [...current, next])}
          label={{ t, formatDateTime }}
        />
      ))}
    </div>
  )
}

function HistoryPage({
  unitId,
  cursor,
  last,
  onMore,
  label,
}: {
  unitId: string
  cursor: string | undefined
  last: boolean
  onMore: (cursor: string) => void
  label: { t: ReturnType<typeof useI18n>['t']; formatDateTime: (value: string) => string }
}) {
  const { t, formatDateTime } = label
  const page = useQuery(historyPageQuery(unitId, cursor))
  if (page.isPending)
    return (
      <ul
        className="divide-y divide-line rounded-card border border-line bg-surface shadow-raised"
        aria-hidden="true"
      >
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3.5 w-72" />
            </div>
            <Skeleton className="h-3.5 w-28" />
          </li>
        ))}
      </ul>
    )
  if (page.isError || !page.data)
    return (
      <ErrorState
        requestId={apiErrorOf(page.error).requestId}
        onRetry={() => void page.refetch()}
      />
    )
  const { items, nextCursor } = page.data
  if (items.length === 0 && cursor === undefined)
    return <EmptyState icon="clock" title={t('web.unit-detail.history.empty')} />
  return (
    <>
      <ul className="motion-fade divide-y divide-line rounded-card border border-line bg-surface shadow-raised">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
              <Icon name="clock" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-strong">{t(`web.unit-detail.history.kind.${item.kind}`)}</p>
              <p className="text-secondary text-ink-muted">
                {item.actor.kind === 'system' || !item.actor.name
                  ? t('web.unit-detail.history.actor.system')
                  : t('web.unit-detail.history.actor', { name: item.actor.name })}
                {detailText(item) ? ` · ${detailText(item)}` : ''}
              </p>
            </div>
            <time className="text-secondary text-ink-muted" dateTime={item.at}>
              {formatDateTime(item.at)}
            </time>
          </li>
        ))}
      </ul>
      {last && nextCursor && (
        <div>
          <Button variant="outline" onClick={() => onMore(nextCursor)}>
            {t('web.unit-detail.history.more')}
          </Button>
        </div>
      )}
    </>
  )
}

/** A one-line detail: never a phone or a name of a member, only the member type and the counts (DOC-65 `W-Unit-Detail` §6). */
function detailText(item: HistoryItem): string {
  const details = item.details
  if (item.kind === 'owner_changed' && typeof details.removedMembers === 'number')
    return `${details.removedMembers} ↩`
  if (typeof details.memberType === 'string') return details.memberType
  return ''
}

/** The shape of the page while the unit loads: plate, title, tabs, the info line and the members table. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-9 w-24 rounded-plate" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-96" />
            <Skeleton className="h-3.5 w-64" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-control-md w-36" />
          <Skeleton className="h-control-md w-32" />
        </div>
      </div>
      <div className="flex h-control-lg items-center gap-6 border-b border-line px-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-6 mb-4 h-9.5" />
      <DataTable label="" minWidth="min-w-[960px]">
        <SkeletonRows columns={5} rows={3} rowClassName="h-[59px]" />
      </DataTable>
    </div>
  )
}
