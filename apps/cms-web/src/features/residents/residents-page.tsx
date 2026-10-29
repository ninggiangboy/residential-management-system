import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Avatar } from '../../components/ui/avatar'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles, IconButton } from '../../components/ui/button'
import { Chip, ChipGroup } from '../../components/ui/controls'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { ListPage, PageHeader } from '../../components/ui/page'
import { SelectField } from '../../components/ui/select-field'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, StatusTag } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { useI18n } from '../../lib/i18n'
import { digitsOf } from '../../lib/phone'
import { useDebounced } from '../../lib/use-debounced'
import { useIdentityKey } from '../../lib/use-identity-key'
import { UnitPicker } from '../units/unit-picker'
import {
  type MemberType,
  type ResidentFilters,
  type ResidentListItem,
  residentsQuery,
} from './hooks'
import { ResidentProfileDialog } from './resident-profile-dialog'

export interface ResidentsSearch extends ResidentFilters {
  dialog?: 'profile'
  accountId?: string
}

type AccountFilter = 'all' | 'active' | 'never' | 'deletion' | 'locked'
const accountFilterOf = (s: ResidentsSearch): AccountFilter =>
  s.deletion
    ? 'deletion'
    : s.neverSignedIn
      ? 'never'
      : s.status === 'locked'
        ? 'locked'
        : s.status === 'active'
          ? 'active'
          : 'all'

const MEMBER_TYPES: readonly MemberType[] = ['owner', 'tenant', 'family', 'helper']

/** The single tag of a row, by priority: deletion requested > a locked membership > never signed in > active (DOC-65 `W-Residents` §4). */
function RowStatus({ resident }: { resident: ResidentListItem }) {
  if (resident.deletion.requestedAt)
    return <StatusTag entity="resident_account" value="deletion_requested" />
  if (resident.memberships.some((m) => m.status === 'locked'))
    return <StatusTag entity="membership" value="locked" />
  if (resident.lastAppOpenAt === null)
    return <StatusTag entity="resident_account" value="active" when="never_signed_in" />
  return <StatusTag entity="resident_account" value="active" when="signed_in" />
}

/** The search is valid from 3 letters of a name or 4 digits of a phone (DOC-65 `W-Residents` §5). */
const searchable = (text: string) =>
  digitsOf(text).length >= 4 || (text.trim().length >= 3 && digitsOf(text).length === 0)

/** `W-Residents` (DOC-65): resident accounts with their units, a status filter that writes one param, and the profile dialog. */
export function ResidentsPage({ search }: { search: ResidentsSearch }) {
  const { t, formatPhone } = useI18n()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()
  const [typed, setTyped] = useState(search.q ?? '')
  const debounced = useDebounced(typed.trim())
  const effectiveQ = debounced !== '' && searchable(debounced) ? debounced : undefined
  const { dialog, accountId, ...filters } = search
  const query = useQuery(residentsQuery({ ...filters, q: effectiveQ }))
  const visited = useRef<(string | undefined)[]>([])
  const [unitCode, setUnitCode] = useState<string | null>(null)

  useEffect(() => {
    if ((search.q ?? '') !== (effectiveQ ?? '')) {
      visited.current = []
      void navigate({
        to: '/residents',
        search: { ...search, q: effectiveQ, cursor: undefined },
        replace: true,
      })
    }
  }, [effectiveQ, navigate, search])

  const data = query.data
  const rowsKey = useIdentityKey(query.data)
  const filter = (patch: Partial<ResidentsSearch>) => {
    visited.current = []
    void navigate({
      to: '/residents',
      search: { ...search, ...patch, cursor: undefined },
      replace: true,
    })
  }
  const setAccountFilter = (value: AccountFilter) =>
    filter({
      status: value === 'active' ? 'active' : value === 'locked' ? 'locked' : undefined,
      deletion: value === 'deletion' ? 'requested' : undefined,
      neverSignedIn: value === 'never' ? true : undefined,
    })
  const filtered =
    search.q !== undefined ||
    search.unitId ||
    search.memberType ||
    accountFilterOf(search) !== 'all'
  const page = visited.current.length + 1
  const head = (
    <THead>
      <Tr>
        <Th className="w-[26%]">{t('web.residents.col.name')}</Th>
        <Th className="w-[18%]">{t('web.residents.col.phone')}</Th>
        <Th>{t('web.residents.col.units')}</Th>
        <Th className="w-44">{t('web.residents.col.status')}</Th>
        <Th className="w-21">
          <span className="sr-only">{t('web.unit-detail.col.actions')}</span>
        </Th>
      </Tr>
    </THead>
  )

  return (
    <ListPage>
      <PageHeader
        title={t('web.residents.title')}
        subtitleLoading={!data}
        subtitle={data ? t('web.residents.subtitle', { total: data.summary.total }) : undefined}
        actions={
          <>
            <Link to="/import" search={{}} className={buttonStyles({ variant: 'outline' })}>
              {t('web.residents.cta.import')}
            </Link>
            <Link
              to="/residents/new"
              search={{}}
              state={OPENED_HERE}
              className={buttonStyles({ variant: 'primary' })}
            >
              {t('web.residents.cta')}
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-4">
        <SearchField
          label={t('web.residents.field.search.label')}
          placeholder={t('web.residents.field.search.placeholder')}
          hint={
            typed.trim() !== '' && !searchable(typed)
              ? t('web.residents.field.search.hint')
              : undefined
          }
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <SelectField
          label={t('web.residents.field.status.label')}
          value={accountFilterOf(search)}
          onValueChange={(value) => setAccountFilter(value as AccountFilter)}
          options={[
            { value: 'all', label: t('web.residents.field.status.all') },
            { value: 'active', label: t('status.membership.active') },
            { value: 'never', label: t('status.resident-account.never_signed_in') },
            { value: 'deletion', label: t('status.resident-account.deletion_requested') },
            { value: 'locked', label: t('status.membership.locked') },
          ]}
        />
        <UnitPicker
          label={t('web.residents.field.unit.label')}
          value={search.unitId ? { unitId: search.unitId, code: unitCode ?? '…' } : null}
          onChange={(unit) => {
            setUnitCode(unit?.code ?? null)
            filter({ unitId: unit?.unitId })
          }}
        />
      </div>
      <div className="mb-4">
        <ChipGroup label={t('web.residents.col.units')}>
          <Chip
            selected={search.memberType === undefined}
            onClick={() => filter({ memberType: undefined })}
          >
            {t('web.residents.tab.all')}
          </Chip>
          {MEMBER_TYPES.map((type) => (
            <Chip
              key={type}
              selected={search.memberType === type}
              onClick={() => filter({ memberType: type })}
            >
              {t(`common.member-type.${type}`)}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      {!data && query.isError ? (
        <ErrorState
          requestId={apiErrorOf(query.error).requestId}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <DataTable label={t('web.residents.title')} busy>
          {head}
          <SkeletonRows columns={5} rowClassName="h-[53px]" />
        </DataTable>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="users-three"
          title={t(filtered ? 'web.residents.empty-filter.title' : 'web.residents.empty.title')}
          body={filtered ? undefined : t('web.residents.empty.body')}
          actions={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setTyped('')
                  visited.current = []
                  void navigate({
                    to: '/residents',
                    search: { limit: search.limit },
                    replace: true,
                  })
                }}
              >
                {t('common.action.clear-filters')}
              </Button>
            ) : (
              <Link
                to="/residents/new"
                search={{}}
                state={OPENED_HERE}
                className={buttonStyles({ variant: 'primary' })}
              >
                {t('web.residents.cta')}
              </Link>
            )
          }
        />
      ) : (
        <DataTable
          label={t('web.residents.title')}
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
                      void navigate({
                        to: '/residents',
                        search: { ...search, cursor: previous },
                        replace: true,
                      })
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
                        to: '/residents',
                        search: { ...search, cursor: data.nextCursor ?? undefined },
                        replace: true,
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
            {data.items.map((resident) => (
              <Tr key={resident.accountId}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={resident.fullName ?? resident.phone} size="sm" />
                    <span className="text-body-strong">{resident.fullName ?? '—'}</span>
                  </div>
                </Td>
                <Td>{formatPhone(resident.phone)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {resident.memberships.map((membership) => (
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
                </Td>
                <Td>
                  <RowStatus resident={resident} />
                </Td>
                <Td>
                  <IconButton
                    icon="pencil-simple"
                    size="sm"
                    label={t('web.residents.action.edit', {
                      name: resident.fullName ?? resident.phone,
                    })}
                    onClick={() =>
                      void navigate({
                        to: '/residents',
                        search: { ...search, dialog: 'profile', accountId: resident.accountId },
                        state: OPENED_HERE,
                      })
                    }
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      )}
      <Banner className="mt-6">{t('web.residents.banner.phone-change')}</Banner>
      {dialog === 'profile' && accountId && (
        <ResidentProfileDialog
          accountId={accountId}
          onClose={() =>
            closeOverlay(
              () =>
                void navigate({
                  to: '/residents',
                  search: { ...search, dialog: undefined, accountId: undefined },
                  replace: true,
                }),
            )
          }
        />
      )}
    </ListPage>
  )
}
