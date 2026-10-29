import { formatArea } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { ListPage, PageHeader } from '../../components/ui/page'
import { SelectField } from '../../components/ui/select-field'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, StatusTag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useDebounced } from '../../lib/use-debounced'
import { useIdentityKey } from '../../lib/use-identity-key'
import { type UnitFilters, unitsQuery } from './hooks'
import { UnitAddDialog } from './unit-add-dialog'

export interface UnitsSearch extends UnitFilters {
  dialog?: 'add'
}

const ALL = '__all__'

/** `W-Units` (DOC-65): the unit list with filters in the URL, a cursor pager that remembers the pages it has seen, and "Thêm căn". */
export function UnitsPage({ search }: { search: UnitsSearch }) {
  const { t, lang, formatPhone } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const [typed, setTyped] = useState(search.q ?? '')
  const debounced = useDebounced(typed.trim())
  // A search of one character sends nothing and shows the hint (UIWR-03).
  const effectiveQ = debounced.length >= 2 ? debounced : undefined
  const { dialog, ...filters } = search
  const query = useQuery({
    ...unitsQuery({
      ...filters,
      q: effectiveQ ?? (typed.trim().length >= 2 ? search.q : undefined),
    }),
  })
  // The cursors visited, so "Trang trước" works without the client building a cursor (DOC-55 §4, DR-212).
  const visited = useRef<(string | undefined)[]>([])
  const page = visited.current.length + 1

  useEffect(() => {
    if ((search.q ?? '') !== (effectiveQ ?? '')) {
      visited.current = []
      void navigate({
        to: '/units',
        search: { ...search, q: effectiveQ, cursor: undefined },
        replace: true,
      })
    }
  }, [effectiveQ, navigate, search])

  const data = query.data
  const rowsKey = useIdentityKey(query.data)
  const floors = useMemo(() => {
    const seen = new Set<number>()
    for (const item of data?.items ?? []) if (item.floor !== null) seen.add(item.floor)
    if (search.floor !== undefined) seen.add(search.floor)
    return [...seen].sort((a, b) => a - b)
  }, [data, search.floor])

  const filter = (patch: Partial<UnitsSearch>) => {
    visited.current = []
    void navigate({ to: '/units', search: { ...search, ...patch, cursor: undefined } })
  }
  const head = (
    <THead>
      <Tr>
        <Th className="w-[120px]">{t('web.units.col.code')}</Th>
        <Th className="w-20">{t('web.units.col.floor')}</Th>
        <Th className="w-24">{t('web.units.col.type')}</Th>
        <Th className="w-28">{t('web.units.col.area')}</Th>
        <Th className="w-40">{t('web.units.col.status')}</Th>
        <Th>{t('web.units.col.owner')}</Th>
        <Th className="w-28">{t('web.units.col.members')}</Th>
        <Th className="w-17">
          <span className="sr-only">{t('web.unit-detail.col.actions')}</span>
        </Th>
      </Tr>
    </THead>
  )
  const filtered =
    search.q !== undefined ||
    search.occupancy !== undefined ||
    search.floor !== undefined ||
    search.bedrooms !== undefined

  return (
    <ListPage>
      <PageHeader
        title={t('web.units.title')}
        subtitleLoading={!data}
        subtitle={
          data
            ? t('web.units.subtitle', {
                total: data.summary.total,
                occupied: data.summary.occupied,
                rented: data.summary.rented,
                vacant: data.summary.vacant,
              })
            : undefined
        }
        actions={
          <>
            <Link to="/import" search={{}} className={buttonStyles({ variant: 'outline' })}>
              {t('web.units.cta.import')}
            </Link>
            <Button
              icon="plus"
              disabled={!canWrite}
              onClick={() => void navigate({ to: '/units', search: { ...search, dialog: 'add' } })}
            >
              {t('web.units.cta')}
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] items-start gap-4">
        <SearchField
          label={t('web.units.field.search.label')}
          placeholder={t('web.units.field.search.placeholder')}
          hint={typed.trim().length === 1 ? t('web.units.field.search.hint') : undefined}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <SelectField
          label={t('web.units.field.floor.label')}
          value={search.floor === undefined ? ALL : String(search.floor)}
          onValueChange={(value) => filter({ floor: value === ALL ? undefined : Number(value) })}
          options={[
            { value: ALL, label: t('web.units.field.floor.all') },
            ...floors.map((floor) => ({ value: String(floor), label: String(floor) })),
          ]}
        />
        <SelectField
          label={t('web.units.field.bedrooms.label')}
          value={search.bedrooms === undefined ? ALL : String(search.bedrooms)}
          onValueChange={(value) => filter({ bedrooms: value === ALL ? undefined : Number(value) })}
          options={[
            { value: ALL, label: t('web.units.field.bedrooms.all') },
            ...[0, 1, 2, 3, 4, 5].map((count) => ({
              value: String(count),
              label: t('web.units.field.bedrooms.option', { count }),
            })),
          ]}
        />
        <SelectField
          label={t('web.units.field.occupancy.label')}
          value={search.occupancy ?? ALL}
          onValueChange={(value) =>
            filter({ occupancy: value === ALL ? undefined : (value as UnitFilters['occupancy']) })
          }
          options={[
            { value: ALL, label: t('web.units.field.occupancy.all') },
            { value: 'occupied', label: t('status.unit.occupied') },
            { value: 'rented', label: t('status.unit.rented') },
            { value: 'vacant', label: t('status.unit.vacant') },
          ]}
        />
      </div>
      {!data && query.isError ? (
        <ErrorState
          requestId={apiErrorOf(query.error).requestId}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <DataTable label={t('web.units.title')} minWidth="min-w-[960px]" busy>
          {head}
          <SkeletonRows columns={8} rowClassName="h-[69px]" />
        </DataTable>
      ) : data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon="magnifying-glass"
            title={t('web.units.empty-filter.title')}
            body={t('web.units.empty-filter.body')}
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setTyped('')
                  visited.current = []
                  void navigate({ to: '/units', search: { limit: search.limit } })
                }}
              >
                {t('web.units.action.clear-filters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="buildings"
            title={t('web.units.empty.title')}
            body={t('web.units.empty.body')}
            actions={
              <>
                <Link to="/import" search={{}} className={buttonStyles({ variant: 'outline' })}>
                  {t('web.units.cta.import')}
                </Link>
                <Button
                  icon="plus"
                  onClick={() =>
                    void navigate({ to: '/units', search: { ...search, dialog: 'add' } })
                  }
                >
                  {t('web.units.cta')}
                </Button>
              </>
            }
          />
        )
      ) : (
        <DataTable
          label={t('web.units.title')}
          minWidth="min-w-[960px]"
          busy={query.isPlaceholderData}
          footer={
            search.q === undefined ? (
              <>
                <span className="text-secondary text-ink-muted">
                  {t('web.units.pager.page', { page })}
                </span>
                <div className="flex gap-2">
                  <IconButton
                    icon="caret-left"
                    label={t('web.units.pager.previous')}
                    variant="outline"
                    disabled={search.cursor === undefined}
                    onClick={() => {
                      const previous = visited.current.pop()
                      void navigate({ to: '/units', search: { ...search, cursor: previous } })
                    }}
                  />
                  <IconButton
                    icon="caret-right"
                    label={t('web.units.pager.next')}
                    variant="outline"
                    disabled={!data.nextCursor}
                    onClick={() => {
                      visited.current.push(search.cursor)
                      void navigate({
                        to: '/units',
                        search: { ...search, cursor: data.nextCursor ?? undefined },
                      })
                    }}
                  />
                </div>
              </>
            ) : undefined
          }
        >
          {head}
          {/* Keyed by the answer: new rows (a filter, a page) fade in where the dimmed ones were (DR-306). */}
          <TBody key={rowsKey} className="motion-fade">
            {data.items.map((unit) => (
              <Tr
                key={unit.unitId}
                interactive
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: '/units/$unitId',
                    params: { unitId: unit.unitId },
                    search: {},
                  })
                }
              >
                <Td>
                  <Link
                    to="/units/$unitId"
                    params={{ unitId: unit.unitId }}
                    search={{}}
                    onClick={(event) => event.stopPropagation()}
                    className="outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Plate>{unit.code}</Plate>
                  </Link>
                </Td>
                <Td>{unit.floor ?? '—'}</Td>
                <Td>
                  {unit.bedrooms === null
                    ? '—'
                    : t('web.units.field.bedrooms.option', { count: unit.bedrooms })}
                </Td>
                <Td>{unit.areaM2 === null ? '—' : formatArea(Number(unit.areaM2), lang)}</Td>
                <Td>
                  <StatusTag entity="unit" value={unit.occupancy} />
                </Td>
                <Td>
                  {unit.owner ? (
                    <div>
                      <p className="text-body-strong">{unit.owner.fullName ?? '—'}</p>
                      <p className="text-secondary text-ink-muted">
                        {formatPhone(unit.owner.phone)}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-secondary text-ink-muted">{t('web.units.owner.none')}</p>
                      <Link
                        to="/residents/new"
                        search={{ unitId: unit.unitId }}
                        onClick={(event) => event.stopPropagation()}
                        className="text-secondary text-teal underline"
                      >
                        {t('web.units.action.assign-owner')}
                      </Link>
                    </div>
                  )}
                </Td>
                <Td>{unit.memberCount}</Td>
                <Td>
                  <Icon name="caret-right" size="sm" className="text-ink-muted" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      )}
      <UnitAddDialog
        open={dialog === 'add'}
        onClose={() => void navigate({ to: '/units', search: { ...search, dialog: undefined } })}
      />
    </ListPage>
  )
}
