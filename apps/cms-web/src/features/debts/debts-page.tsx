import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Checkbox, Switch } from '../../components/ui/controls'
import { ConfirmDialog, useLastDefined } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { ListPage, PageHeader } from '../../components/ui/page'
import { SelectField } from '../../components/ui/select-field'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, Tag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, type T, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useDebounced } from '../../lib/use-debounced'
import { useIdentityKey } from '../../lib/use-identity-key'
import { useIntent } from '../../lib/use-intent'
import { cn } from '../../lib/utils'
import {
  type DebtFilters,
  type DebtItem,
  type DebtsPage as DebtsData,
  debtsQuery,
  type ReminderResult,
  useDebtMutations,
} from './hooks'

/** DOC-66 `W-Debts`: `month` is a fee month YYYY-MM (all when absent), `overdue` the 30-day switch. */
export interface DebtsSearch {
  month?: string
  q?: string
  overdue?: boolean
  cursor?: string
}

type Summary = NonNullable<DebtsData['summary']>

/** E-101's page size (DOC-66 §5); the "select all" walk uses the read's own maximum to spend fewer requests. */
const LIMIT = 25
const COLLECT_LIMIT = 100
/** A reminder carries at most 500 units (DOC-22 §8.5, DR-267). */
const MAX_SELECTION = 500
const NOOP = () => undefined

/** The fee months a filter offers: the anchor month and the eleven before it, newest first. */
function recentMonths(anchor: string | undefined, count = 12): string[] {
  if (!anchor || !/^\d{4}-\d{2}$/.test(anchor)) return []
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7))
  return Array.from({ length: count }, (_, back) => {
    const date = new Date(Date.UTC(year, month - 1 - back, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** The month the select ends at: the filter, else the building day, else the latest published fee month. */
const anchorMonth = (search: DebtsSearch, asOf: string | undefined, summary: Summary | undefined) =>
  search.month ?? asOf?.slice(0, 7) ?? summary?.collected?.feeMonth?.slice(0, 7)

/** The months of the select: the anchor's own twelve, plus the one in the URL when it is older than them. */
const monthChoices = (anchor: string | undefined, month: string | undefined): string[] => {
  const months = recentMonths(anchor)
  return month && !months.includes(month) ? [month, ...months] : months
}

/** Walks the filtered list with the cursors until it holds up to 500 ids, for a reminder of the whole filtered set. */
async function collectIds(queryClient: QueryClient, filters: DebtFilters): Promise<string[]> {
  const ids: string[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  while (ids.length < MAX_SELECTION) {
    const answer = await queryClient.fetchQuery(
      debtsQuery({ ...filters, cursor, limit: COLLECT_LIMIT }),
    )
    for (const item of answer.items)
      if (!seen.has(item.unitId)) {
        seen.add(item.unitId)
        ids.push(item.unitId)
      }
    if (!answer.nextCursor) break
    cursor = answer.nextCursor
  }
  return ids.slice(0, MAX_SELECTION)
}

/** The ids the reminder sends: the ticked ones, or the ids of the filtered set when "select all" is on. */
const reminderIds = (
  queryClient: QueryClient,
  filters: DebtFilters,
  selected: ReadonlyMap<string, number>,
  allFiltered: boolean,
): Promise<string[]> =>
  allFiltered ? collectIds(queryClient, filters) : Promise.resolve([...selected.keys()])

/** The result of E-103 as a toast: the sent count, plus the already-reminded and the no-debt counts when there are any. */
function reminderCallbacks(
  t: T,
  intent: { reset: () => void },
  clearSelection: () => void,
  close: () => void,
): { onSuccess: (result: ReminderResult) => void; onError: (thrown: unknown) => void } {
  return {
    onSuccess: (result) => {
      const extra =
        result.alreadyRemindedToday > 0 || result.noDebt > 0
          ? ` ${t('web.debts.remind.done.extra', {
              already: result.alreadyRemindedToday,
              none: result.noDebt,
            })}`
          : ''
      toast.success(t('web.debts.remind.done', { sent: result.sent }) + extra)
      intent.reset()
      clearSelection()
      close()
    },
    onError: (thrown) => {
      const failure = apiErrorOf(thrown)
      if (failure.status === 429 && failure.retryAfter !== undefined)
        toast.error(
          t('web.debts.remind.rate-limited', {
            minutes: Math.max(1, Math.ceil(failure.retryAfter / 60)),
          }),
        )
      else if (failure.code === 'too_many_units')
        toast.error(errorText(t, failure, { max: MAX_SELECTION }))
      else toast.error(errorText(t, failure))
    },
  }
}

/**
 * The selection of `W-Debts` (DOC-66 §4): the ticked units with their outstanding, the page checkbox and "select all" of the
 * filtered set. The sum comes from the loaded rows, or from the first page's summary for "select all".
 */
function useDebtsSelection(items: readonly DebtItem[], summary: Summary | undefined) {
  const [selected, setSelected] = useState<ReadonlyMap<string, number>>(new Map())
  const [allFiltered, setAllFiltered] = useState(false)

  const clear = () => {
    setSelected(new Map())
    setAllFiltered(false)
  }
  const selectAll = () => {
    setSelected(new Map())
    setAllFiltered(true)
  }
  const allPageSelected = items.length > 0 && items.every((item) => selected.has(item.unitId))
  const pageSelection = () => {
    if (allFiltered) return clear()
    const next = new Map(selected)
    for (const item of items)
      if (allPageSelected) next.delete(item.unitId)
      else next.set(item.unitId, item.outstanding)
    setSelected(next)
  }
  const toggle = (item: DebtItem) => {
    // Over a "select all" it starts from the loaded page, so the checkboxes match what is on screen.
    const next = allFiltered
      ? new Map(items.map((row) => [row.unitId, row.outstanding] as const))
      : new Map(selected)
    if (next.has(item.unitId)) next.delete(item.unitId)
    else next.set(item.unitId, item.outstanding)
    setSelected(next)
  }

  return {
    allFiltered,
    selected,
    count: allFiltered ? (summary?.units ?? 0) : selected.size,
    amount: allFiltered
      ? (summary?.outstanding ?? 0)
      : [...selected.values()].reduce((total, value) => total + value, 0),
    canSelectAll:
      allPageSelected && !allFiltered && summary !== undefined && summary.units > items.length,
    checked: (unitId: string) => allFiltered || selected.has(unitId),
    checkedAll: allFiltered || allPageSelected,
    clear,
    selectAll,
    pageSelection,
    toggle,
  }
}

/** One stat tile of the first page's summary; `danger` marks the overdue one (DOC-66 §4). */
function Tile({
  testId,
  value,
  label,
  tone,
}: {
  testId: string
  value: ReactNode
  label?: ReactNode
  tone?: 'danger'
}) {
  return (
    <Card className="p-5" data-testid={testId}>
      <p
        className={cn('text-title-2 tabular-nums', tone === 'danger' ? 'text-danger' : 'text-ink')}
      >
        {value}
      </p>
      {label && <p className="mt-1 text-secondary text-ink-muted">{label}</p>}
    </Card>
  )
}

/** The tiles until the first page arrives: their shape, so nothing moves when the figures come (DOC-54 §17). */
function DebtTiles({ summary }: { summary: Summary | undefined }) {
  const { t, formatMoney } = useI18n()
  if (!summary)
    return (
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['tile-outstanding', 'tile-units', 'tile-overdue', 'tile-collected'].map((testId) => (
          <Card key={testId} className="p-5" data-testid={testId}>
            <Skeleton className="h-7 w-32" />
            <Skeleton className="mt-2 h-4 w-40" />
          </Card>
        ))}
      </div>
    )
  const collected = summary.collected
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        testId="tile-outstanding"
        value={formatMoney(summary.outstanding)}
        label={t('web.debts.tile.total')}
      />
      <Tile
        testId="tile-units"
        value={t('web.debts.tile.units', { count: summary.units })}
        label={
          summary.ownedUnits === null
            ? undefined
            : t('web.debts.tile.units.label', { total: summary.ownedUnits })
        }
      />
      <Tile
        testId="tile-overdue"
        tone="danger"
        value={formatMoney(summary.overdue30.amount)}
        label={t('web.debts.tile.overdue', { count: summary.overdue30.units })}
      />
      {collected && (
        <Tile
          testId="tile-collected"
          value={formatMoney(collected.amount)}
          label={t('web.debts.tile.collected', {
            month: Number(collected.feeMonth.slice(5, 7)),
            year: collected.feeMonth.slice(0, 4),
          })}
        />
      )}
    </div>
  )
}

/** The search, the fee-month select and the overdue switch; a change resets the cursor and the selection (DOC-66 §4). */
function DebtsFilters({
  search,
  typed,
  onTyped,
  monthOptions,
  onFilter,
}: {
  search: DebtsSearch
  typed: string
  onTyped: (value: string) => void
  monthOptions: string[]
  onFilter: (patch: Partial<DebtsSearch>) => void
}) {
  const { t, formatDate } = useI18n()
  return (
    <div className="mb-4 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] items-end gap-4">
      <SearchField
        label={t('web.debts.search.label')}
        placeholder={t('web.debts.search')}
        value={typed}
        onChange={(event) => onTyped(event.target.value)}
      />
      <SelectField
        label={t('web.debts.month')}
        value={search.month ?? ''}
        onValueChange={(value) => onFilter({ month: value || undefined })}
        options={[
          { value: '', label: t('web.debts.month.all') },
          ...monthOptions.map((month) => ({ value: month, label: formatDate(`${month}-01`) })),
        ]}
      />
      <div className="flex h-control-md items-center gap-2">
        <Switch
          id="debts-overdue"
          label={t('web.debts.switch.overdue')}
          checked={search.overdue ?? false}
          onCheckedChange={(checked) => onFilter({ overdue: checked || undefined })}
        />
        <label htmlFor="debts-overdue" className="cursor-pointer text-body text-ink">
          {t('web.debts.switch.overdue')}
        </label>
      </div>
    </div>
  )
}

/** The bar over the table while units are ticked: the sum of the selection and the reminder action (DOC-66 §4). */
function SelectionBar({
  count,
  amount,
  allCount,
  canSelectAll,
  loading,
  disabled,
  onSelectAll,
  onClear,
  onRemind,
}: {
  count: number
  amount: number
  allCount: number
  canSelectAll: boolean
  loading: boolean
  disabled: boolean
  onSelectAll: () => void
  onClear: () => void
  onRemind: () => void
}) {
  const { t, formatMoney } = useI18n()
  return (
    <div
      data-testid="selection-bar"
      className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-control bg-teal-soft px-4 py-3"
    >
      <span className="text-body-strong text-on-teal-soft">
        {t('web.debts.selection', { count, amount: formatMoney(amount) })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {canSelectAll && (
          <Button variant="ghost" onClick={onSelectAll} data-testid="select-all">
            {t('web.debts.selection.all', { count: allCount })}
          </Button>
        )}
        <Button variant="ghost" onClick={onClear}>
          {t('web.debts.selection.clear')}
        </Button>
        <Button
          icon="bell"
          loading={loading}
          disabled={disabled}
          onClick={onRemind}
          data-testid="remind"
        >
          {t('web.debts.action.remind')}
        </Button>
      </div>
    </div>
  )
}

/** One debt row: the unit, its owner, its charges and the two ways into `W-Fee-Record` (DOC-66 §4). */
function DebtRow({
  item,
  checked,
  onToggle,
}: {
  item: DebtItem
  checked: boolean
  onToggle: (item: DebtItem) => void
}) {
  const { t, formatMoney, formatDate, formatPhone } = useI18n()
  const navigate = useNavigate()
  return (
    <Tr
      interactive
      data-testid={`debt-row-${item.unitCode}`}
      onClick={() =>
        void navigate({ to: '/debts/$unitId', params: { unitId: item.unitId }, search: {} })
      }
    >
      <Td onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          onCheckedChange={() => onToggle(item)}
          label={
            <span className="sr-only">{t('web.debts.select.row', { code: item.unitCode })}</span>
          }
        />
      </Td>
      <Td>
        <Link
          to="/debts/$unitId"
          params={{ unitId: item.unitId }}
          search={{}}
          onClick={(event) => event.stopPropagation()}
          className="outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plate>{item.unitCode}</Plate>
        </Link>
      </Td>
      <Td>
        <p className="text-body-strong">{item.ownerName ?? '—'}</p>
        {item.ownerPhone && (
          <p className="text-secondary text-ink-muted">{formatPhone(item.ownerPhone)}</p>
        )}
      </Td>
      <Td className="tabular-nums">{item.openCharges}</Td>
      <Td className="text-right font-medium tabular-nums">{formatMoney(item.outstanding)}</Td>
      <Td>
        <div className="flex flex-col gap-1">
          <span>{formatDate(item.oldestDue)}</span>
          {item.maxDaysPastDue > 0 && (
            <Tag tone="danger">{t('web.debts.overdue', { days: item.maxDaysPastDue })}</Tag>
          )}
        </div>
      </Td>
      <Td className="text-secondary text-ink-muted">
        {item.lastReminderAt ? formatDate(item.lastReminderAt) : t('web.debts.reminded.never')}
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-2">
          <Link
            to="/debts/$unitId"
            params={{ unitId: item.unitId }}
            search={{ dialog: 'payment' }}
            onClick={(event) => event.stopPropagation()}
            className={buttonStyles({ variant: 'outline', size: 'sm' })}
            data-testid={`pay-${item.unitCode}`}
          >
            {t('web.debts.col.pay')}
          </Link>
          <Icon name="caret-right" size="sm" className="text-ink-muted" />
        </div>
      </Td>
    </Tr>
  )
}

/** The table header, drawn both while the first page loads and over the rows, so its widths never move. */
function DebtsHead({
  checked,
  disabled,
  onSelectPage,
}: {
  checked: boolean
  disabled: boolean
  onSelectPage: () => void
}) {
  const { t } = useI18n()
  return (
    <THead>
      <Tr>
        <Th className="w-12">
          <Checkbox
            checked={checked}
            onCheckedChange={onSelectPage}
            disabled={disabled}
            label={<span className="sr-only">{t('web.debts.select.page')}</span>}
          />
        </Th>
        <Th className="w-28">{t('web.debts.col.unit')}</Th>
        <Th>{t('web.debts.col.owner')}</Th>
        <Th className="w-24">{t('web.debts.col.batches')}</Th>
        <Th className="w-32 text-right">{t('web.debts.col.outstanding')}</Th>
        <Th className="w-44">{t('web.debts.col.oldest')}</Th>
        <Th className="w-36">{t('web.debts.col.reminded')}</Th>
        <Th className="w-40">
          <span className="sr-only">{t('web.unit-detail.col.actions')}</span>
        </Th>
      </Tr>
    </THead>
  )
}

/** The table and its pager: a new page keeps the previous rows dimmed under the bar (DOC-54 §17, Q1). */
function DebtsTable({
  items,
  nextCursor,
  total,
  page,
  busy,
  rowsKey,
  checked,
  checkedAll,
  canGoBack,
  onSelectPage,
  onToggle,
  onBack,
  onNext,
}: {
  items: readonly DebtItem[]
  nextCursor: string | null
  total: number
  page: number
  busy: boolean
  rowsKey: number
  checked: (unitId: string) => boolean
  checkedAll: boolean
  canGoBack: boolean
  onSelectPage: () => void
  onToggle: (item: DebtItem) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  const from = (page - 1) * LIMIT + 1
  return (
    <DataTable
      label={t('web.debts.title')}
      minWidth="min-w-[960px]"
      busy={busy}
      footer={
        <>
          <span className="text-secondary text-ink-muted">
            {t('web.debts.footer', { from, to: from + items.length - 1, total })}
          </span>
          <div className="flex gap-2">
            <IconButton
              icon="caret-left"
              label={t('common.pagination.previous')}
              variant="outline"
              disabled={!canGoBack}
              onClick={onBack}
            />
            <IconButton
              icon="caret-right"
              label={t('common.pagination.next')}
              variant="outline"
              disabled={!nextCursor}
              onClick={onNext}
            />
          </div>
        </>
      }
    >
      <DebtsHead checked={checkedAll} disabled={items.length === 0} onSelectPage={onSelectPage} />
      {/* Keyed by the answer: new rows (a filter, a page) fade in where the dimmed ones were (DR-306). */}
      <TBody key={rowsKey} className="motion-fade">
        {items.map((item) => (
          <DebtRow
            key={item.unitId}
            item={item}
            checked={checked(item.unitId)}
            onToggle={onToggle}
          />
        ))}
      </TBody>
    </DataTable>
  )
}

/** The two empty states: nothing owing at all, or a filter that matches no unit (DOC-66 §7). */
function EmptyDebts({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const { t } = useI18n()
  if (!filtered) return <EmptyState icon="receipt" title={t('web.debts.empty.title')} />
  return (
    <EmptyState
      icon="magnifying-glass"
      title={t('web.debts.empty.filtered')}
      actions={
        <Button variant="outline" onClick={onClear}>
          {t('common.action.clear-filters')}
        </Button>
      }
    />
  )
}

/** The table region: the error, the shaped skeleton, the two empty states, or the rows with their pager. */
function DebtsBody({
  data,
  error,
  failed,
  summary,
  filtered,
  page,
  rowsKey,
  busy,
  checked,
  checkedAll,
  canGoBack,
  onRetry,
  onClearFilters,
  onSelectPage,
  onToggle,
  onBack,
  onNext,
}: {
  data: DebtsData | undefined
  error: unknown
  failed: boolean
  summary: Summary | undefined
  filtered: boolean
  page: number
  rowsKey: number
  busy: boolean
  checked: (unitId: string) => boolean
  checkedAll: boolean
  canGoBack: boolean
  onRetry: () => void
  onClearFilters: () => void
  onSelectPage: () => void
  onToggle: (item: DebtItem) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  if (failed) return <ErrorState requestId={apiErrorOf(error).requestId} onRetry={onRetry} />
  if (!data)
    return (
      <DataTable label={t('web.debts.title')} minWidth="min-w-[960px]" busy>
        <DebtsHead checked={false} disabled onSelectPage={NOOP} />
        <SkeletonRows columns={8} rowClassName="h-[59px]" />
      </DataTable>
    )
  if (data.items.length === 0) return <EmptyDebts filtered={filtered} onClear={onClearFilters} />
  return (
    <DebtsTable
      items={data.items}
      nextCursor={data.nextCursor}
      total={summary?.units ?? data.items.length}
      page={page}
      busy={busy}
      rowsKey={rowsKey}
      checked={checked}
      checkedAll={checkedAll}
      canGoBack={canGoBack}
      onSelectPage={onSelectPage}
      onToggle={onToggle}
      onBack={onBack}
      onNext={onNext}
    />
  )
}

/** The reminder confirmation; the dialog stays open until the call answers (DOC-66 §6, UX-14). */
function RemindDialog({
  unitIds,
  loading,
  onConfirm,
  onClose,
}: {
  unitIds: readonly string[] | null
  loading: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <ConfirmDialog
      open={unitIds !== null}
      onOpenChange={(next) => {
        if (!next && !loading) onClose()
      }}
      title={t('web.debts.remind.confirm.title', { count: unitIds?.length ?? 0 })}
      body={t('web.debts.remind.confirm.body')}
      confirmLabel={t('web.debts.action.remind')}
      loading={loading}
      onConfirm={onConfirm}
    />
  )
}

/**
 * `W-Debts` (DOC-66): one row per unit that owes, ordered by outstanding with the tiles of the first page, the filters in the
 * URL, a cursor pager and the reminder of a selection. No Excel export and no per-month tab in P2 (UIWF-65).
 */
export function DebtsPage({ search }: { search: DebtsSearch }): ReactElement {
  const { t, formatDate } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canWrite = useCanWrite()
  const { sendReminders } = useDebtMutations()
  const intent = useIntent()

  const [typed, setTyped] = useState(search.q ?? '')
  const debounced = useDebounced(typed.trim())
  // The cursors visited, so "Trang trước" works without the client building a cursor (DOC-55 §4, DR-212).
  const visited = useRef<(string | undefined)[]>([])
  const [confirm, setConfirm] = useState<readonly string[] | null>(null)
  const [resolving, setResolving] = useState(false)

  const query = useQuery(
    debtsQuery({
      month: search.month,
      q: search.q,
      overdue: search.overdue,
      cursor: search.cursor,
      limit: LIMIT,
    }),
  )
  const data = query.data
  const rowsKey = useIdentityKey(query.data)
  // The tiles and the building day ride on the first page only: keep the last ones seen so a page jump does not blank them.
  const summary = useLastDefined(data?.summary)
  const asOf = useLastDefined(data?.asOf ?? undefined)
  const items = data?.items ?? []
  const selection = useDebtsSelection(items, summary)
  const monthOptions = useMemo(
    () => monthChoices(anchorMonth(search, asOf, summary), search.month),
    [search, asOf, summary],
  )

  const resetCursor = () => {
    visited.current = []
  }
  const filter = (patch: Partial<DebtsSearch>) => {
    resetCursor()
    selection.clear()
    void navigate({
      to: '/debts',
      search: { ...search, ...patch, cursor: undefined },
      replace: true,
    })
  }

  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      visited.current = []
      void navigate({
        to: '/debts',
        search: { ...search, q: debounced || undefined, cursor: undefined },
        replace: true,
      })
    }
  }, [debounced, navigate, search])

  const onRemind = async () => {
    if (selection.count > MAX_SELECTION) {
      toast.error(t('error.too_many_units', { max: MAX_SELECTION }))
      return
    }
    setResolving(true)
    try {
      setConfirm(
        await reminderIds(
          queryClient,
          { month: search.month, q: search.q, overdue: search.overdue, limit: COLLECT_LIMIT },
          selection.selected,
          selection.allFiltered,
        ),
      )
    } catch (thrown) {
      toast.error(errorText(t, apiErrorOf(thrown)))
    } finally {
      setResolving(false)
    }
  }

  const send = () => {
    if (!confirm) return
    sendReminders.mutate(
      { unitIds: [...confirm], key: intent.keyFor(confirm) },
      reminderCallbacks(t, intent, selection.clear, () => setConfirm(null)),
    )
  }

  return (
    <ListPage>
      <PageHeader
        title={t('web.debts.title')}
        subtitleLoading={!asOf && !query.isError}
        subtitle={asOf ? t('web.debts.asof.date', { date: formatDate(asOf) }) : undefined}
      />
      <DebtTiles summary={summary} />
      <DebtsFilters
        search={search}
        typed={typed}
        onTyped={setTyped}
        monthOptions={monthOptions}
        onFilter={filter}
      />
      {selection.count > 0 && (
        <SelectionBar
          count={selection.count}
          amount={selection.amount}
          allCount={summary?.units ?? 0}
          canSelectAll={selection.canSelectAll}
          loading={resolving || sendReminders.isPending}
          disabled={!canWrite}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onRemind={() => void onRemind()}
        />
      )}
      <DebtsBody
        data={data}
        error={query.error}
        failed={query.isError && !data}
        summary={summary}
        filtered={search.q !== undefined || search.month !== undefined || search.overdue === true}
        page={visited.current.length + 1}
        rowsKey={rowsKey}
        busy={query.isPlaceholderData}
        checked={selection.checked}
        checkedAll={selection.checkedAll}
        canGoBack={search.cursor !== undefined}
        onRetry={() => void query.refetch()}
        onClearFilters={() => {
          setTyped('')
          resetCursor()
          selection.clear()
          void navigate({ to: '/debts', search: {}, replace: true })
        }}
        onSelectPage={selection.pageSelection}
        onToggle={selection.toggle}
        onBack={() =>
          void navigate({
            to: '/debts',
            search: { ...search, cursor: visited.current.pop() },
            replace: true,
          })
        }
        onNext={() => {
          visited.current.push(search.cursor)
          void navigate({
            to: '/debts',
            search: { ...search, cursor: data?.nextCursor ?? undefined },
            replace: true,
          })
        }}
      />
      <RemindDialog
        unitIds={confirm}
        loading={sendReminders.isPending}
        onConfirm={send}
        onClose={() => {
          setConfirm(null)
          intent.reset()
        }}
      />
    </ListPage>
  )
}
