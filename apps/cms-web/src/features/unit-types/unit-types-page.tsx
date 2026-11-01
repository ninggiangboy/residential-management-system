import { formatArea } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { apiErrorOf } from '../../api/errors'
import { Button } from '../../components/ui/button'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { ListPage, PageHeader } from '../../components/ui/page'
import { DataTable, SkeletonRows, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { StatusTag } from '../../components/ui/tag'
import { OPENED_HERE, useCloseOverlay } from '../../lib/history'
import { useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useIdentityKey } from '../../lib/use-identity-key'
import { unitTypesQuery } from './hooks'
import { UnitTypeDialog } from './unit-type-dialog'

export interface UnitTypesSearch {
  dialog?: 'add' | 'edit'
  unitTypeId?: string
}

/** `W-Unit-Types` (DOC-65, DR-314): the building's kinds of unit with their defaults and unit counts; add, edit, archive in one dialog. */
export function UnitTypesPage({ search }: { search: UnitTypesSearch }) {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()
  const canWrite = useCanWrite()
  const query = useQuery(unitTypesQuery())
  const data = query.data
  const rowsKey = useIdentityKey(data)
  const open = (patch: UnitTypesSearch) =>
    void navigate({
      to: '/units/types',
      search: patch,
      state: OPENED_HERE,
      resetScroll: false,
    })
  const head = (
    <THead>
      <Tr>
        <Th className="w-40">{t('web.unit-types.col.code')}</Th>
        <Th>{t('web.unit-types.col.name')}</Th>
        <Th className="w-44">{t('web.unit-types.col.bedrooms')}</Th>
        <Th className="w-44">{t('web.unit-types.col.area')}</Th>
        <Th className="w-28">{t('web.unit-types.col.units')}</Th>
        <Th className="w-36">{t('web.unit-types.col.status')}</Th>
        <Th className="w-17">
          <span className="sr-only">{t('web.unit-detail.col.actions')}</span>
        </Th>
      </Tr>
    </THead>
  )
  const subtitle = data
    ? [
        t('web.unit-types.subtitle', { total: data.summary.total, active: data.summary.active }),
        data.summary.withoutType > 0
          ? t('web.unit-types.subtitle.without-type', { count: data.summary.withoutType })
          : null,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined
  const none = t('web.unit-types.default.none')

  return (
    <ListPage>
      <PageHeader
        title={t('web.unit-types.title')}
        subtitleLoading={!data}
        subtitle={subtitle}
        actions={
          <Button icon="plus" disabled={!canWrite} onClick={() => open({ dialog: 'add' })}>
            {t('web.unit-types.cta')}
          </Button>
        }
      />
      {!data && query.isError ? (
        <ErrorState
          requestId={apiErrorOf(query.error).requestId}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <DataTable label={t('web.unit-types.title')} minWidth="min-w-[960px]" busy>
          {head}
          <SkeletonRows columns={7} rowClassName="h-[59px]" />
        </DataTable>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="buildings"
          title={t('web.unit-types.empty.title')}
          body={t('web.unit-types.empty.body')}
          actions={
            <Button icon="plus" disabled={!canWrite} onClick={() => open({ dialog: 'add' })}>
              {t('web.unit-types.cta')}
            </Button>
          }
        />
      ) : (
        <DataTable label={t('web.unit-types.title')} minWidth="min-w-[960px]">
          {head}
          <TBody key={rowsKey} className="motion-fade">
            {data.items.map((type) => (
              <Tr
                key={type.unitTypeId}
                interactive
                onClick={() => open({ dialog: 'edit', unitTypeId: type.unitTypeId })}
              >
                <Td>
                  <code className="font-mono text-secondary text-ink">{type.code}</code>
                </Td>
                <Td>
                  <p className="text-body-strong">{type.name.vi}</p>
                  {type.name.en && <p className="text-secondary text-ink-muted">{type.name.en}</p>}
                </Td>
                <Td>
                  {type.defaultBedrooms === null
                    ? none
                    : t('web.units.field.bedrooms.option', { count: type.defaultBedrooms })}
                </Td>
                <Td>
                  {type.defaultAreaM2 === null
                    ? none
                    : formatArea(Number(type.defaultAreaM2), lang)}
                </Td>
                <Td>{type.unitCount}</Td>
                <Td>
                  <StatusTag entity="unit_type" value={type.status} />
                </Td>
                <Td>
                  <Icon name="caret-right" size="sm" className="text-ink-muted" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      )}
      <UnitTypeDialog
        mode={search.dialog ?? null}
        item={data?.items.find((type) => type.unitTypeId === search.unitTypeId)}
        onClose={() =>
          closeOverlay(
            () =>
              void navigate({
                to: '/units/types',
                search: { dialog: undefined, unitTypeId: undefined },
                replace: true,
                resetScroll: false,
              }),
          )
        }
      />
    </ListPage>
  )
}
