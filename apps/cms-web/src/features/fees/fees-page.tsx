import { formatPercent } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { useLastDefined } from '../../components/ui/dialog'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { ListPage, PageHeader } from '../../components/ui/page'
import { SelectField } from '../../components/ui/select-field'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { TabList, Tabs } from '../../components/ui/tabs'
import { Plate, StatusTag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { day } from '../../lib/day'
import { useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useDebounced } from '../../lib/use-debounced'
import { useIdentityKey } from '../../lib/use-identity-key'
import { type FeeBatchListItem, feeBatchesQuery } from '../fee-batch/hooks'
import { downloadFeeBatchTemplate } from './template'

/** DOC-66 `W-Fees`: the search parameters of `/fees` (cursor stack: one page per status, DR-324). */
export interface FeesSearch {
  status: 'all' | 'draft' | 'published' | 'closed' | 'recalled'
  month?: string
  q?: string
  cursor?: string
  limit: number
}

/** The value of the "Mọi tháng" option: a Radix select item rejects an empty string, so the all-choice has its own value. */
const ANY_MONTH = '__any__'

/** The name in the language of the screen, falling back to Vietnamese, which every batch has (DOC-14 §8). */
const batchName = (name: { vi: string; en?: string | null }, lang: string) =>
  lang === 'en' && name.en ? name.en : name.vi

/** The two whole-building counts the tabs read, as E-89 answers them on its first page (DOC-66 §5). */
type Counts = { draft: number; published: number; closed: number; recalled: number }

const monthOf = (feeMonth: string | Date) => Number(day(feeMonth).slice(5, 7))
const yearOf = (feeMonth: string | Date) => day(feeMonth).slice(0, 4)

/** The "Đã thu" cell (DOC-66 §4): a draft is not published and a recalled batch has only void charges, so neither shows a bar. */
function Collected({ item }: { item: FeeBatchListItem }) {
  const { t, lang, formatMoney } = useI18n()
  if (item.status === 'draft')
    return <span className="text-secondary text-ink-muted">{t('web.fees.row.unissued')}</span>
  if (item.status === 'recalled') return <span className="text-ink-muted">—</span>
  const rate = item.collectedRate ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-fill"
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full bg-teal"
            style={{ width: `${Math.max(0, Math.min(100, rate * 100))}%` }}
          />
        </span>
        <span className="text-secondary tabular-nums">{formatPercent(rate, lang)}</span>
      </div>
      <span className="text-secondary tabular-nums">{formatMoney(item.collected)}</span>
    </div>
  )
}

/** One batch row; the code is a plate and the whole row opens `W-Fee-Batch` (DOC-66 §4, §6). */
function FeeRow({ item }: { item: FeeBatchListItem }) {
  const { t, lang, formatMoney, formatDate } = useI18n()
  const navigate = useNavigate()
  return (
    <Tr
      interactive
      data-testid={`fees-row-${item.code}`}
      onClick={() =>
        void navigate({ to: '/fees/$batchId', params: { batchId: item.id }, search: {} })
      }
    >
      <Td>
        <Link
          to="/fees/$batchId"
          params={{ batchId: item.id }}
          search={{}}
          onClick={(event) => event.stopPropagation()}
          className="outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plate>{item.code}</Plate>
        </Link>
      </Td>
      <Td>
        <p className="text-body-strong">{batchName(item.name, lang)}</p>
        <p className="text-secondary text-ink-muted">
          {t('web.fees.row.month', { month: monthOf(item.feeMonth), year: yearOf(item.feeMonth) })}
        </p>
      </Td>
      <Td>
        <StatusTag entity="fee_batch" value={item.status} />
      </Td>
      <Td className="text-right tabular-nums">{item.unitCount}</Td>
      <Td className="text-right font-medium tabular-nums">{formatMoney(item.total)}</Td>
      <Td>
        <Collected item={item} />
      </Td>
      <Td className="text-secondary text-ink-muted">{formatDate(item.dueDate)}</Td>
      {/* The creator's name comes from `IdentityApi.getStaff` (E-89 `createdBy {id, name}`); an unknown account is an empty cell. */}
      <Td className="text-secondary text-ink-muted">
        <span className="block max-w-32 truncate" title={item.createdBy.name ?? undefined}>
          {item.createdBy.name ?? '—'}
        </span>
      </Td>
      <Td>
        <Icon name="caret-right" size="sm" className="text-ink-muted" />
      </Td>
    </Tr>
  )
}

/** The header of the table, drawn while the first page loads and over the rows, so its widths never move (DOC-54 §7.5). */
function FeesHead() {
  const { t } = useI18n()
  return (
    <THead>
      <Tr>
        <Th className="w-[120px]">{t('web.fees.col.code')}</Th>
        <Th>{t('web.fees.col.name')}</Th>
        <Th className="w-36">{t('web.fees.col.status')}</Th>
        <Th className="w-20 text-right">{t('web.fees.col.units')}</Th>
        <Th className="w-32 text-right">{t('web.fees.col.total')}</Th>
        <Th className="w-48">{t('web.fees.col.collected')}</Th>
        <Th className="w-32">{t('web.fees.col.due')}</Th>
        <Th className="w-40">{t('web.fees.col.createdBy')}</Th>
        <Th className="w-12">
          <span className="sr-only">{t('web.fees.col.open')}</span>
        </Th>
      </Tr>
    </THead>
  )
}

/** The five status tabs with their whole-building counts; a count shows a two-digit placeholder until the first page (DOC-66 §7). */
function FeeTabs({
  status,
  counts,
  totalCount,
  onStatus,
}: {
  status: FeesSearch['status']
  counts: Counts | undefined
  totalCount: number | undefined
  onStatus: (status: FeesSearch['status']) => void
}) {
  const { t } = useI18n()
  const tab = (value: FeesSearch['status'], label: string, count: number | undefined) => ({
    value,
    label: (
      <span className="flex items-center gap-1.5" data-testid={`fees-tab-${value}`}>
        {label}
        {count === undefined ? (
          <span
            className="motion-skeleton inline-block h-3.5 w-5 rounded-control bg-fill"
            aria-hidden="true"
          />
        ) : (
          <span className="text-ink-muted tabular-nums" data-testid={`fees-count-${value}`}>
            {count}
          </span>
        )}
      </span>
    ),
  })
  return (
    <Tabs value={status} onValueChange={(value) => onStatus(value as FeesSearch['status'])}>
      <TabList
        label={t('web.fees.tabs.label')}
        tabs={[
          tab('all', t('web.fees.tab.all'), totalCount),
          tab('draft', t('web.fees.tab.draft'), counts?.draft),
          tab('published', t('web.fees.tab.published'), counts?.published),
          tab('closed', t('web.fees.tab.closed'), counts?.closed),
          tab('recalled', t('web.fees.tab.recalled'), counts?.recalled),
        ]}
      />
    </Tabs>
  )
}

/** The two empty states (DOC-66 §7): the building has no batch, or the filters match none. */
function EmptyFees({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const { t } = useI18n()
  if (!filtered)
    return (
      <EmptyState
        icon="receipt"
        title={t('web.fees.empty.title')}
        actions={
          <Link
            to="/fees/import"
            search={{}}
            className={buttonStyles({ variant: 'primary' })}
            data-testid="fees-empty-import"
          >
            <Icon name="plus" size="sm" />
            {t('web.fees.action.import')}
          </Link>
        }
      />
    )
  return (
    <EmptyState
      icon="magnifying-glass"
      title={t('web.fees.empty.filtered')}
      actions={
        <Button variant="outline" onClick={onClear} data-testid="fees-clear">
          {t('web.fees.filter.clear')}
        </Button>
      }
    />
  )
}

/**
 * `W-Fees` (DOC-66): the batches with the five status tabs, the search and the fee-month filter in the URL, and a cursor
 * pager. Row click opens `W-Fee-Batch`, "Nhập đợt phí" opens the Excel import.
 */
export function FeesPage({ search }: { search: FeesSearch }): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const [typed, setTyped] = useState(search.q ?? '')
  const [downloading, setDownloading] = useState(false)
  const debounced = useDebounced(typed.trim())
  // The cursors visited, so "Trang trước" works without the client building a cursor (DOC-55 §4, DR-212).
  const visited = useRef<(string | undefined)[]>([])
  const page = visited.current.length + 1

  const query = useQuery(
    feeBatchesQuery({
      status: search.status,
      month: search.month,
      q: search.q,
      limit: search.limit,
      cursor: search.cursor,
    }),
  )
  const data = query.data
  const rowsKey = useIdentityKey(query.data)
  // The counts ride on the first page only: keep the last ones seen, so a page jump or a filter does not blank the tabs.
  const counts = useLastDefined(data?.counts)
  const totalCount = useLastDefined(data?.totalCount)
  const items = data?.items ?? []
  const filtered = search.status !== 'all' || search.month !== undefined || search.q !== undefined
  const total = search.status === 'all' ? totalCount : counts?.[search.status]
  const from = (page - 1) * search.limit + 1
  // No months endpoint in P2: the select offers the fee months of the rows seen, newest first, plus the one in the URL.
  const months = useMemo(() => {
    const seen = new Set<string>()
    for (const item of data?.items ?? []) seen.add(day(item.feeMonth).slice(0, 7))
    if (search.month) seen.add(search.month)
    return [...seen].sort().reverse()
  }, [data, search.month])

  useEffect(() => {
    if ((search.q ?? '') !== debounced) {
      visited.current = []
      void navigate({
        to: '/fees',
        search: { ...search, q: debounced || undefined, cursor: undefined },
        replace: true,
      })
    }
  }, [debounced, navigate, search])

  const filter = (patch: Partial<FeesSearch>) => {
    visited.current = []
    void navigate({
      to: '/fees',
      search: { ...search, ...patch, cursor: undefined },
      replace: true,
    })
  }
  const onTemplate = () => {
    setDownloading(true)
    void downloadFeeBatchTemplate(t).finally(() => setDownloading(false))
  }

  return (
    <ListPage>
      <PageHeader
        title={t('web.fees.title')}
        subtitle={t('web.fees.subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              icon="download-simple"
              loading={downloading}
              disabled={!canWrite}
              onClick={onTemplate}
              data-testid="fees-template"
            >
              {t('web.fees.action.template')}
            </Button>
            <Link
              to="/fees/import"
              search={{}}
              className={buttonStyles({ variant: 'primary' })}
              data-testid="fees-import"
            >
              <Icon name="plus" size="sm" />
              {t('web.fees.action.import')}
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <FeeTabs
          status={search.status}
          counts={counts}
          totalCount={totalCount}
          onStatus={(status) => filter({ status })}
        />
        <div className="flex flex-wrap items-end gap-4">
          <SearchField
            className="w-64"
            label={t('web.fees.search.label')}
            placeholder={t('web.fees.search')}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="fees-search"
          />
          <SelectField
            className="w-44"
            label={t('web.fees.month.label')}
            value={search.month ?? ANY_MONTH}
            onValueChange={(value) => filter({ month: value === ANY_MONTH ? undefined : value })}
            options={[
              { value: ANY_MONTH, label: t('web.fees.month.all') },
              ...months.map((month) => ({
                value: month,
                label: t('web.fees.row.month', {
                  month: Number(month.slice(5, 7)),
                  year: month.slice(0, 4),
                }),
              })),
            ]}
          />
        </div>
      </div>
      {query.isError && data && (
        <Banner
          tone="warning"
          className="mb-4"
          actions={
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t('common.action.retry')}
            </Button>
          }
        >
          {t('common.error.page.body')}
        </Banner>
      )}
      {!data ? (
        query.isError ? (
          <ErrorState
            requestId={apiErrorOf(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <DataTable label={t('web.fees.title')} minWidth="min-w-[1040px]" busy>
            <FeesHead />
            <SkeletonRows columns={9} rowClassName="h-[59px]" />
          </DataTable>
        )
      ) : items.length === 0 ? (
        <EmptyFees
          filtered={filtered}
          onClear={() => {
            setTyped('')
            visited.current = []
            void navigate({ to: '/fees', search: { limit: search.limit }, replace: true })
          }}
        />
      ) : (
        <DataTable
          label={t('web.fees.title')}
          minWidth="min-w-[1040px]"
          busy={query.isPlaceholderData}
          footer={
            <>
              <span className="text-secondary text-ink-muted">
                {t('web.fees.footer', {
                  from,
                  to: from + items.length - 1,
                  total: total ?? items.length,
                })}
              </span>
              <div className="flex gap-2">
                <IconButton
                  icon="caret-left"
                  label={t('common.pagination.previous')}
                  variant="outline"
                  disabled={search.cursor === undefined}
                  onClick={() => {
                    const previous = visited.current.pop()
                    void navigate({
                      to: '/fees',
                      search: { ...search, cursor: previous },
                      replace: true,
                    })
                  }}
                />
                <IconButton
                  icon="caret-right"
                  label={t('common.pagination.next')}
                  variant="outline"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    visited.current.push(search.cursor)
                    void navigate({
                      to: '/fees',
                      search: { ...search, cursor: data.nextCursor ?? undefined },
                      replace: true,
                    })
                  }}
                />
              </div>
            </>
          }
        >
          <FeesHead />
          {/* Keyed by the answer: new rows (a filter, a page) fade in where the dimmed ones were (DR-306). */}
          <TBody key={rowsKey} className="motion-fade">
            {items.map((item) => (
              <FeeRow key={item.id} item={item} />
            ))}
          </TBody>
        </DataTable>
      )}
    </ListPage>
  )
}
