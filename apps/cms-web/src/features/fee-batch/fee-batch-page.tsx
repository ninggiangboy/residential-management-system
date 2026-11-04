import { formatTime } from '@rms/shared-types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { useSetBreadcrumbTail } from '../../components/layout/breadcrumb'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { ConfirmDialog, useLastDefined } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { RowMenu } from '../../components/ui/menu'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, SkeletonRows } from '../../components/ui/table'
import { TabList, Tabs } from '../../components/ui/tabs'
import { Plate, StatusTag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { useI18n } from '../../lib/i18n'
import { useDebounced } from '../../lib/use-debounced'
import { ChargeVoidDialog, type VoidTarget } from '../charge-void/charge-void-dialog'
import { ChargesTable, chargeFilters } from './charges-table'
import { CloseDialog } from './close-dialog'
import { DiscardDialog } from './discard-dialog'
import { EditBatchDialog } from './edit-batch-dialog'
import { ExtendDialog } from './extend-dialog'
import { FeeRecallDialog } from './fee-recall-dialog'
import { FeeReissueDialog } from './fee-reissue-dialog'
import { type BatchChargeItem, batchChargesQuery, type FeeBatchView, feeBatchQuery } from './hooks'
import { PublishDialog } from './publish-dialog'

/** DOC-66 `W-Fee-Batch`: the dialogs are kept in the URL (`dialog`, with `charge` for a single void) and unmounted through `useExit`. */
export interface FeeBatchSearch {
  view: 'all' | 'missing'
  q?: string
  unit?: string
  dialog?: 'recall' | 'void' | 'reissue' | 'extend' | 'publish' | 'discard' | 'close'
  charge?: string
  cursor?: string
}

/** The name in the UI language (DOC-21 §3.1). */
const bilingual = (name: { vi: string; en?: string }, lang: string) =>
  lang === 'en' ? (name.en ?? name.vi) : name.vi

/** The charge a `W-Charge-Void` dialog shows, from the row the table already holds (DOC-66 `W-Charge-Void`). */
function voidTargetOf(
  batch: FeeBatchView,
  charge: BatchChargeItem | undefined,
): VoidTarget | undefined {
  if (!charge) return undefined
  return {
    chargeId: charge.chargeId,
    version: charge.version,
    unitCode: charge.unitCode,
    amount: charge.amount,
    batchCode: batch.code,
    unitId: charge.unitId,
    hasActiveIntent: false,
    ownerName: charge.ownerName ?? undefined,
  }
}

/** `W-Fee-Batch` (DOC-66): the draft editor or the read-only published batch, with the actions of its status. */
export function FeeBatchPage({
  batchId,
  search,
}: {
  batchId: string
  search: FeeBatchSearch
}): ReactElement {
  const { t, lang, formatDate } = useI18n()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()
  const [typed, setTyped] = useState(search.q ?? '')
  const [editing, setEditing] = useState(false)
  // The guard of the open editor: a row with unsaved lines asks before it is left (DOC-66 §7).
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const debounced = useDebounced(typed.trim())

  const batch = useQuery({
    ...feeBatchQuery(batchId),
    placeholderData: keepPreviousData,
    // A published batch refetches while the tab is focused, because payments arrive (DOC-66 §5).
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'draft' ? 30_000 : false,
  })
  const charges = useQuery(batchChargesQuery(batchId, chargeFilters(search)))
  const data = batch.data
  useSetBreadcrumbTail(data?.code ?? null)

  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      void navigate({
        to: '/fees/$batchId',
        params: { batchId },
        search: { ...search, q: debounced || undefined, unit: undefined, cursor: undefined },
        replace: true,
      })
    }
  }, [debounced, navigate, search, batchId])

  const onDirtyChange = useCallback((next: boolean) => setDirty(next), [])

  const go = (patch: Partial<FeeBatchSearch>) =>
    void navigate({
      to: '/fees/$batchId',
      params: { batchId },
      search: { ...search, ...patch },
      replace: true,
      resetScroll: false,
    })
  const openDialog = (patch: Partial<FeeBatchSearch>) =>
    void navigate({
      to: '/fees/$batchId',
      params: { batchId },
      search: { ...search, ...patch },
      state: OPENED_HERE,
      resetScroll: false,
    })
  const closeDialog = (patch: Partial<FeeBatchSearch> = {}) =>
    closeOverlay(() => go({ dialog: undefined, ...patch }))

  const guard = (action: () => void) => {
    if (dirty) setPending(() => action)
    else action()
  }
  const openUnit = (unitCode: string, mode: 'edit' | 'add') =>
    guard(() => go({ unit: unitCode, view: mode === 'add' ? 'missing' : search.view }))
  const closeUnit = () => go({ unit: undefined })
  const requestClose = () => guard(closeUnit)
  const switchView = (view: 'all' | 'missing') =>
    guard(() => go({ view, unit: undefined, cursor: undefined }))

  const lastCharge = useLastDefined(
    charges.data?.items.find((item) => item.chargeId === search.charge),
  )
  const voidTarget = data ? voidTargetOf(data, lastCharge) : undefined

  if (batch.isError && !data) {
    const failure = apiErrorOf(batch.error)
    if (failure.status === 404)
      return (
        <EmptyState
          icon="magnifying-glass"
          title={t('web.fee-batch.gone')}
          actions={
            <Link to="/fees" search={{}} className={buttonStyles({ variant: 'outline' })}>
              {t('web.shell.nav.fees')}
            </Link>
          }
        />
      )
    return <ErrorState requestId={failure.requestId} onRetry={() => void batch.refetch()} />
  }

  if (!data)
    return (
      <div aria-hidden="true">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Skeleton className="h-9 w-24 rounded-plate" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-3.5 w-80" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-control-md w-36" />
            <Skeleton className="h-control-md w-32" />
          </div>
        </div>
        <Skeleton className="mb-4 h-9.5 w-72" />
        <DataTable label={t('web.fee-batch.col.unit')} minWidth="min-w-[880px]">
          <SkeletonRows columns={5} rowClassName="h-[59px]" />
        </DataTable>
      </div>
    )

  const meta =
    t('web.fee-batch.meta', {
      month: Number(data.feeMonth.slice(5, 7)),
      year: data.feeMonth.slice(0, 4),
      date: formatDate(data.dueDate),
    }) +
    (data.source
      ? t('web.fee-batch.meta.imported', {
          time: formatTime(data.source.importedAt),
          date: formatDate(data.source.importedAt),
        })
      : '')

  // The "missing" tab exists only when the API counts the units without a charge (it is null as built, DOC-66 §5).
  const showMissingTab = typeof data.counts.missing === 'number'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Plate size="lg">{data.code}</Plate>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-title-1 text-ink">{bilingual(data.name, lang)}</h1>
              <StatusTag entity="fee_batch" value={data.status} />
            </div>
            <p className="mt-1 text-secondary text-ink-muted" data-testid="batch-meta">
              {meta}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === 'draft' && (
            <IconButton
              icon="pencil-simple"
              label={t('web.fee-batch.action.edit')}
              variant="outline"
              data-testid="batch-edit"
              onClick={() => setEditing(true)}
            />
          )}
          <HeaderActions
            batch={data}
            onPublish={() => openDialog({ dialog: 'publish' })}
            onDiscard={() => openDialog({ dialog: 'discard' })}
            onExtend={() => openDialog({ dialog: 'extend' })}
            onClose={() => openDialog({ dialog: 'close' })}
            onRecall={() => openDialog({ dialog: 'recall' })}
            onReissue={() => openDialog({ dialog: 'reissue' })}
          />
        </div>
      </div>

      <BatchBanner batch={data} onShowMissing={() => switchView('missing')} />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        {data.status === 'draft' && (
          <Tabs
            value={showMissingTab ? search.view : 'all'}
            onValueChange={(value) => switchView(value as 'all' | 'missing')}
          >
            <TabList
              label={t('web.fee-batch.col.unit')}
              tabs={[
                { value: 'all', label: t('web.fee-batch.tab.all') },
                ...(showMissingTab
                  ? [
                      {
                        value: 'missing',
                        label: `${t('web.fee-batch.tab.missing')} ${data.counts.missing}`,
                      },
                    ]
                  : []),
              ]}
            />
          </Tabs>
        )}
        <div className="min-w-64 flex-1">
          <SearchField
            label={t('web.fee-batch.search.label')}
            placeholder={t('web.fee-batch.search')}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ChargesTable
          batchId={batchId}
          batch={data}
          search={search}
          onOpenUnit={openUnit}
          onCloseUnit={closeUnit}
          onRequestClose={requestClose}
          onVoid={(charge) => openDialog({ dialog: 'void', charge: charge.chargeId })}
          onSwitchView={switchView}
          onDirtyChange={onDirtyChange}
        />
      </div>

      <EditBatchDialog
        open={editing}
        batch={data}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          void batch.refetch()
        }}
        onConflict={() => void batch.refetch()}
      />
      <PublishDialog
        open={search.dialog === 'publish'}
        batch={data}
        onClose={() => closeDialog()}
        onPublished={() => closeDialog()}
        onConflict={() => void batch.refetch()}
      />
      <DiscardDialog
        open={search.dialog === 'discard'}
        batch={data}
        onClose={() => closeDialog()}
        onDiscarded={() => void navigate({ to: '/fees', search: {} })}
        onConflict={() => void batch.refetch()}
      />
      <ExtendDialog
        open={search.dialog === 'extend'}
        batch={data}
        onClose={() => closeDialog()}
        onExtended={() => closeDialog()}
        onConflict={() => void batch.refetch()}
      />
      <CloseDialog
        open={search.dialog === 'close'}
        batch={data}
        onClose={() => closeDialog()}
        onClosed={() => closeDialog()}
        onConflict={() => void batch.refetch()}
      />
      <FeeRecallDialog
        open={search.dialog === 'recall'}
        batchId={batchId}
        onClose={() => closeDialog()}
      />
      <FeeReissueDialog
        open={search.dialog === 'reissue'}
        batchId={batchId}
        onClose={() => closeDialog()}
      />
      <ChargeVoidDialog
        open={search.dialog === 'void'}
        target={voidTarget}
        onClose={() => closeDialog({ charge: undefined })}
        onVoided={() => {
          void batch.refetch()
          void charges.refetch()
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => !next && setPending(null)}
        title={t('web.fee-batch.charge.discard-changes', { unit: search.unit ?? '' })}
        confirmLabel={t('web.fee-batch.charge.discard')}
        tone="danger"
        onConfirm={() => {
          const action = pending
          setPending(null)
          setDirty(false)
          action?.()
        }}
      />
    </div>
  )
}

/** The header actions by status (DOC-66 §4): `draft` publishes, `published` extends, closes and recalls, and so on. */
function HeaderActions({
  batch,
  onPublish,
  onDiscard,
  onExtend,
  onClose,
  onRecall,
  onReissue,
}: {
  batch: FeeBatchView
  onPublish: () => void
  onDiscard: () => void
  onExtend: () => void
  onClose: () => void
  onRecall: () => void
  onReissue: () => void
}): ReactElement {
  const { t } = useI18n()
  const notice = { to: '/fees/$batchId/notice' as const, params: { batchId: batch.id }, search: {} }
  if (batch.status === 'draft')
    return (
      <>
        <Link
          to="/fees/import"
          search={{ batchId: batch.id }}
          className={buttonStyles({ variant: 'outline' })}
        >
          {t('web.fee-batch.action.reimport')}
        </Link>
        <Link {...notice} className={buttonStyles({ variant: 'outline' })}>
          {t('web.fee-batch.action.preview')}
        </Link>
        <Button data-testid="publish" onClick={onPublish}>
          {t('web.fee-batch.action.publish')}
        </Button>
        <RowMenu
          label={t('web.fee-batch.col.actions')}
          items={[
            {
              key: 'discard',
              label: t('web.fee-batch.action.discard'),
              danger: true,
              onSelect: onDiscard,
            },
          ]}
        />
      </>
    )
  if (batch.status === 'published')
    return (
      <>
        <Link to={notice.to} params={notice.params} search={{}} className={buttonStyles({})}>
          {t('web.fee-batch.action.bulk')}
        </Link>
        <Button variant="outline" onClick={onExtend}>
          {t('web.fee-batch.action.extend')}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t('web.fee-batch.action.close')}
        </Button>
        <RowMenu
          label={t('web.fee-batch.col.actions')}
          items={[
            {
              key: 'recall',
              label: t('web.fee-batch.action.recall'),
              danger: true,
              onSelect: onRecall,
            },
          ]}
        />
      </>
    )
  if (batch.status === 'closed')
    return (
      <Link to={notice.to} params={notice.params} search={{}} className={buttonStyles({})}>
        {t('web.fee-batch.action.bulk')}
      </Link>
    )
  return (
    <Button data-testid="reissue" onClick={onReissue}>
      {t('web.fee-batch.action.reissue')}
    </Button>
  )
}

/** The banner of the batch status: a draft's missing units, a recalled batch, a closed batch (DOC-66 §4). */
function BatchBanner({
  batch,
  onShowMissing,
}: {
  batch: FeeBatchView
  onShowMissing: () => void
}): ReactElement | null {
  const { t } = useI18n()
  const missing = batch.counts.missing
  if (batch.status === 'draft' && typeof missing === 'number' && missing > 0)
    return (
      <div className="mb-4" data-testid="banner-missing">
        <Banner
          tone="warning"
          actions={
            <Button variant="outline" size="sm" onClick={onShowMissing}>
              {t('web.fee-batch.banner.missing.filter', { count: missing })}
            </Button>
          }
        >
          {t('web.fee-batch.banner.missing', { count: missing })}
        </Banner>
      </div>
    )
  if (batch.status === 'recalled') {
    const replaced = batch.replacedBy[0]
    return (
      <div className="mb-4" data-testid="banner-recalled">
        <Banner tone="warning">
          <span>{t('web.fee-batch.banner.recalled', { count: batch.counts.void })}</span>{' '}
          {replaced && (
            <Link
              to="/fees/$batchId"
              params={{ batchId: replaced.id }}
              search={{ view: 'all' }}
              className="underline"
            >
              {t('web.fee-batch.banner.recalled.replaced', { code: replaced.code })}
            </Link>
          )}
          {batch.replaces && (
            <>
              {' '}
              <Link
                to="/fees/$batchId"
                params={{ batchId: batch.replaces.id }}
                search={{ view: 'all' }}
                className="underline"
              >
                {t('web.fee-batch.banner.recalled.replaces', { code: batch.replaces.code })}
              </Link>
            </>
          )}
        </Banner>
      </div>
    )
  }
  if (batch.status === 'closed')
    return (
      <div className="mb-4" data-testid="banner-closed">
        <Banner tone="info">{t('web.fee-batch.banner.closed')}</Banner>
      </div>
    )
  return null
}
