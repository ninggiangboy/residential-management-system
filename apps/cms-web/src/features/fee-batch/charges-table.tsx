import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { RowMenu } from '../../components/ui/menu'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, StatusTag, Tag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { AddChargeRow } from './add-charge-row'
import {
  type BatchChargeFilters,
  type BatchChargeItem,
  batchChargesQuery,
  type FeeBatchView,
  useFeeBatchMutations,
} from './hooks'
import { ChargeEditor } from './line-editor'
import type { FeeBatchSearch } from './search'

/** E-93's page size (DOC-66 §5). */
const LIMIT = 50

type Mode = 'edit' | 'add'

/** The filters both the page (for the void lookup) and this table (for the list) key E-93 by, so they share one cache entry. */
export function chargeFilters(search: FeeBatchSearch): BatchChargeFilters {
  return {
    view: search.view,
    ...(search.q ? { q: search.q } : {}),
    limit: LIMIT,
    ...(search.cursor ? { cursor: search.cursor } : {}),
  }
}

/** The status tag of a charge in a published view: `open`, `paid`, `void` with its `void_kind` (DOC-66 §4). */
function ChargeStatus({ charge }: { charge: BatchChargeItem }): ReactElement {
  const { t } = useI18n()
  if (charge.status === 'void') {
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusTag entity="charge" value="void" />
        {charge.voidKind && (
          <span className="text-caption text-ink-muted">
            {t(
              charge.voidKind === 'recall'
                ? 'web.fee-batch.charge.void.recall'
                : 'web.fee-batch.charge.void.single',
            )}
          </span>
        )}
      </div>
    )
  }
  if (charge.status === 'paid') return <StatusTag entity="charge" value="paid" />
  if (charge.status === 'draft') return <StatusTag entity="charge" value="draft" />
  return <Tag tone="neutral">{t('status.charge-staff.unpaid')}</Tag>
}

/** The lines of the open charge, read with `include=lines` when its row opens (DOC-66 §5); a shaped editor while it loads. */
function ExistingChargeEditor({
  batchId,
  unitCode,
  onSaved,
  onCancel,
  onConflict,
  onDirtyChange,
}: {
  batchId: string
  unitCode: string
  onSaved: () => void
  onCancel: () => void
  onConflict: () => void
  onDirtyChange: (dirty: boolean) => void
}): ReactElement {
  const query = useQuery(
    batchChargesQuery(batchId, { view: 'all', q: unitCode, include: 'lines', limit: 5 }),
  )
  const charge = query.data?.items.find((item) => item.unitCode === unitCode)
  if (!charge?.lines)
    return (
      <div className="py-3" aria-hidden="true">
        <Skeleton className="h-28 w-full" />
      </div>
    )
  return (
    <ChargeEditor
      batchId={batchId}
      charge={charge}
      onSaved={onSaved}
      onCancel={onCancel}
      onConflict={onConflict}
      onDirtyChange={onDirtyChange}
    />
  )
}

/** The region of `W-Fee-Batch`: the charges table, the in-place editor of a draft row, its pager and the totals (DOC-66 §4). */
export function ChargesTable({
  batchId,
  batch,
  search,
  onOpenUnit,
  onCloseUnit,
  onRequestClose,
  onVoid,
  onSwitchView,
  onDirtyChange,
}: {
  batchId: string
  batch: FeeBatchView
  search: FeeBatchSearch
  onOpenUnit: (unitCode: string, mode: Mode) => void
  onCloseUnit: () => void
  onRequestClose: () => void
  onVoid: (charge: BatchChargeItem) => void
  onSwitchView: (view: 'all' | 'missing') => void
  onDirtyChange: (dirty: boolean) => void
}): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const { deleteCharge } = useFeeBatchMutations(batchId)
  const visited = useRef<(string | undefined)[]>([])
  const [pendingDelete, setPendingDelete] = useState<BatchChargeItem | null>(null)

  const draft = batch.status === 'draft'
  const missing = batch.counts.missing
  const isMissing = search.view === 'missing'
  const showStatus = !draft
  const columns = 4 + (showStatus ? 1 : 0) + 1

  const query = useQuery({
    ...batchChargesQuery(batchId, chargeFilters(search)),
    // A published batch refetches while the tab is focused, because payments arrive (DOC-66 §5, UIWF-24).
    refetchInterval: draft ? false : 30_000,
  })
  const data = query.data
  const items = data?.items ?? []
  const page = visited.current.length + 1

  const goCursor = (cursor: string | undefined) =>
    void navigate({
      to: '/fees/$batchId',
      params: { batchId },
      search: { ...search, cursor },
      replace: true,
    })

  const confirmDelete = () => {
    if (!pendingDelete) return
    const charge = pendingDelete
    deleteCharge.mutate(
      { chargeId: charge.chargeId, version: charge.version },
      {
        onSuccess: () => {
          toast.success(t('common.feedback.saved'))
          setPendingDelete(null)
        },
        onError: (thrown) => {
          toast.error(errorText(t, apiErrorOf(thrown)))
          setPendingDelete(null)
        },
      },
    )
  }

  if (query.isError && !data)
    return (
      <ErrorState
        requestId={apiErrorOf(query.error).requestId}
        onRetry={() => void query.refetch()}
      />
    )

  if (!data)
    return (
      <DataTable label={t('web.fee-batch.col.unit')} minWidth="min-w-[880px]" busy>
        <TableHead showStatus={showStatus} />
        <SkeletonRows columns={columns} rowClassName="h-[59px]" />
      </DataTable>
    )

  if (items.length === 0)
    return (
      <EmptyCharges
        draft={draft}
        filtered={search.q !== undefined || isMissing}
        batchId={batchId}
        missing={missing}
        onSwitchView={onSwitchView}
        onClear={() =>
          void navigate({
            to: '/fees/$batchId',
            params: { batchId },
            search: { ...search, q: undefined, view: 'all', cursor: undefined },
            replace: true,
          })
        }
      />
    )

  return (
    <>
      <DataTable
        label={t('web.fee-batch.col.unit')}
        minWidth="min-w-[880px]"
        busy={query.isPlaceholderData}
        footer={
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-secondary text-ink-muted">
                {t('common.pagination.range', {
                  from: (page - 1) * LIMIT + 1,
                  to: (page - 1) * LIMIT + items.length,
                  total: batch.counts.charges,
                })}
              </span>
              <div className="flex gap-2">
                <IconButton
                  icon="caret-left"
                  label={t('common.pagination.previous')}
                  variant="outline"
                  disabled={search.cursor === undefined}
                  onClick={() => goCursor(visited.current.pop())}
                />
                <IconButton
                  icon="caret-right"
                  label={t('common.pagination.next')}
                  variant="outline"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    visited.current.push(search.cursor)
                    goCursor(data.nextCursor ?? undefined)
                  }}
                />
              </div>
            </div>
            <TotalsBar batch={batch} />
          </div>
        }
      >
        <TableHead showStatus={showStatus} />
        <TBody>
          {items.map((item) => {
            const open = search.unit === item.unitCode
            return (
              <FragmentRow
                key={item.chargeId ?? item.unitCode}
                batchId={batchId}
                item={item}
                draft={draft}
                missing={isMissing}
                open={open}
                showStatus={showStatus}
                columns={columns}
                canWrite={canWrite}
                onOpenUnit={onOpenUnit}
                onCloseUnit={onCloseUnit}
                onRequestClose={onRequestClose}
                onDelete={() => setPendingDelete(item)}
                onVoid={onVoid}
                onDirtyChange={onDirtyChange}
              />
            )
          })}
        </TBody>
      </DataTable>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && !deleteCharge.isPending && setPendingDelete(null)}
        title={t('web.fee-batch.charge.delete.title', { unit: pendingDelete?.unitCode ?? '' })}
        body={t('web.fee-batch.charge.delete.body', { unit: pendingDelete?.unitCode ?? '' })}
        confirmLabel={t('web.fee-batch.charge.delete')}
        tone="danger"
        loading={deleteCharge.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}

/** One charge row and, when it is open, the editor row that follows it (a draft expands in place, DOC-66 §4). */
function FragmentRow({
  batchId,
  item,
  draft,
  missing,
  open,
  showStatus,
  columns,
  canWrite,
  onOpenUnit,
  onCloseUnit,
  onRequestClose,
  onDelete,
  onVoid,
  onDirtyChange,
}: {
  batchId: string
  item: BatchChargeItem
  draft: boolean
  missing: boolean
  open: boolean
  showStatus: boolean
  columns: number
  canWrite: boolean
  onOpenUnit: (unitCode: string, mode: Mode) => void
  onCloseUnit: () => void
  onRequestClose: () => void
  onDelete: () => void
  onVoid: (charge: BatchChargeItem) => void
  onDirtyChange: (dirty: boolean) => void
}): ReactElement {
  const { t, formatMoney } = useI18n()
  const mode: Mode = missing ? 'add' : 'edit'
  return (
    <>
      <Tr
        interactive={draft}
        data-testid={`charge-row-${item.unitCode}`}
        onClick={
          draft ? () => (open ? onRequestClose() : onOpenUnit(item.unitCode, mode)) : undefined
        }
      >
        <Td>
          <Plate>{item.unitCode}</Plate>
        </Td>
        <Td>{item.ownerName ?? t('common.table.empty-cell')}</Td>
        <Td className="tabular-nums">{missing ? t('common.table.empty-cell') : item.lineCount}</Td>
        <Td className="text-right font-medium tabular-nums">
          {missing ? t('common.table.empty-cell') : formatMoney(item.amount)}
        </Td>
        {showStatus && (
          <Td>{missing ? t('common.table.empty-cell') : <ChargeStatus charge={item} />}</Td>
        )}
        <Td onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-end gap-2">
            {draft && missing && (
              <IconButton
                icon="plus"
                label={t('web.fee-batch.charge.add')}
                size="sm"
                disabled={!canWrite}
                data-testid={`charge-add-${item.unitCode}`}
                onClick={() => (open ? onRequestClose() : onOpenUnit(item.unitCode, mode))}
              />
            )}
            {draft && !missing && (
              <>
                <IconButton
                  icon="pencil-simple"
                  label={t('web.fee-batch.charge.edit', { unit: item.unitCode })}
                  size="sm"
                  disabled={!canWrite}
                  data-testid={`charge-edit-${item.unitCode}`}
                  onClick={() => (open ? onRequestClose() : onOpenUnit(item.unitCode, mode))}
                />
                <IconButton
                  icon="trash"
                  label={t('web.fee-batch.charge.delete.unit', { unit: item.unitCode })}
                  size="sm"
                  disabled={!canWrite}
                  data-testid={`charge-delete-${item.unitCode}`}
                  onClick={onDelete}
                />
              </>
            )}
            {!draft && item.status === 'open' && canWrite && (
              <RowMenu
                label={t('web.fee-batch.col.actions')}
                items={[
                  {
                    key: 'void',
                    label: t('web.fee-batch.charge.void'),
                    danger: true,
                    onSelect: () => onVoid(item),
                  },
                ]}
              />
            )}
          </div>
        </Td>
      </Tr>
      {open && draft && (
        <Tr>
          <Td colSpan={columns} className="bg-surface-muted/40">
            {mode === 'add' ? (
              <AddChargeRow
                key={`add-${item.unitCode}`}
                batchId={batchId}
                unitCode={item.unitCode}
                onAdded={onCloseUnit}
                onCancel={onRequestClose}
                onDirtyChange={onDirtyChange}
              />
            ) : (
              <ExistingChargeEditor
                key={`edit-${item.unitCode}`}
                batchId={batchId}
                unitCode={item.unitCode}
                onSaved={onCloseUnit}
                onCancel={onRequestClose}
                onConflict={() => undefined}
                onDirtyChange={onDirtyChange}
              />
            )}
          </Td>
        </Tr>
      )}
    </>
  )
}

/** The table header, drawn while loading and over the rows so its columns never move (DOC-54 §17). */
function TableHead({ showStatus }: { showStatus: boolean }): ReactElement {
  const { t } = useI18n()
  return (
    <THead>
      <Tr>
        <Th className="w-28">{t('web.fee-batch.col.unit')}</Th>
        <Th>{t('web.fee-batch.col.owner')}</Th>
        <Th className="w-24">{t('web.fee-batch.col.lines')}</Th>
        <Th className="w-32 text-right">{t('web.fee-batch.col.total')}</Th>
        {showStatus && <Th className="w-40">{t('web.fee-batch.col.status')}</Th>}
        <Th className="w-28">
          <span className="sr-only">{t('web.fee-batch.col.actions')}</span>
        </Th>
      </Tr>
    </THead>
  )
}

/** The totals bar inside the table card: the `Tổng đợt` label, the unit and line counts and the batch total (DOC-66 §4). */
function TotalsBar({ batch }: { batch: FeeBatchView }): ReactElement {
  const { t, formatMoney } = useI18n()
  const missing = batch.counts.missing
  return (
    <div
      data-testid="totals-bar"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-control bg-surface-muted px-4 py-2.5 text-body"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-ink">{t('web.fee-batch.totals.label')}</span>
        <span className="text-ink-muted" data-testid="totals-units">
          {typeof missing === 'number'
            ? t('web.fee-batch.totals', { units: batch.counts.charges, missing })
            : t('web.fee-batch.totals.units', { units: batch.counts.charges })}
        </span>
      </div>
      <span className="tabular-nums text-ink-muted" data-testid="totals-lines">
        {t('web.fee-batch.totals.lines', {
          lines: batch.counts.lines,
          total: formatMoney(batch.total),
        })}
      </span>
    </div>
  )
}

/** The empty table region: a draft with no charge offers the import again; a filter that matches nothing offers a clear. */
function EmptyCharges({
  draft,
  filtered,
  batchId,
  missing,
  onSwitchView,
  onClear,
}: {
  draft: boolean
  filtered: boolean
  batchId: string
  missing: number | null
  onSwitchView: (view: 'all' | 'missing') => void
  onClear: () => void
}): ReactElement {
  const { t } = useI18n()
  if (draft && !filtered)
    return (
      <EmptyState
        icon="receipt"
        title={t('web.fee-batch.empty.title')}
        actions={
          <>
            <Link
              to="/fees/import"
              search={{ batchId }}
              className={buttonStyles({ variant: 'outline' })}
            >
              {t('web.fee-batch.action.reimport')}
            </Link>
            {typeof missing === 'number' && (
              <Button onClick={() => onSwitchView('missing')}>
                {t('web.fee-batch.charge.add')}
              </Button>
            )}
          </>
        }
      />
    )
  return (
    <EmptyState
      icon="magnifying-glass"
      title={t('common.empty.filtered.title')}
      body={t('common.empty.filtered.body')}
      actions={
        <Button variant="outline" onClick={onClear}>
          {t('common.action.clear-filters')}
        </Button>
      }
    />
  )
}
