import { staffKey } from '@rms/client-core'
import { formatBytes } from '@rms/shared-types'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactElement, useState } from 'react'
import { api } from '../../api/client'
import { apiErrorOf, unwrap } from '../../api/errors'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { useSetBreadcrumbTail } from '../../components/layout/breadcrumb'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState } from '../../components/ui/empty-state'
import { PageHeader } from '../../components/ui/page'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { SelectField } from '../../components/ui/select-field'
import { Tag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { downloadFile, FileDownloadError } from '../../lib/download'
import { errorText, type T, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { settingsQuery } from '../building/hooks'
import {
  type BatchChargeItem,
  batchChargesQuery,
  type FeeBatchView,
  type FeeNoticeJob,
  type FeeNoticeLanguage,
  feeBatchQuery,
  feeNoticeJobQuery,
  useFeeBatchMutations,
} from '../fee-batch/hooks'
import { FeeNoticePreview } from './fee-notice-preview'

/** DOC-66 `W-Fee-Notice`: `unit` is the unit code shown (default the first), `lang` the notice language (default the building's `feeNoticeLanguage`). */
export interface FeeNoticeSearch {
  unit?: string
  lang?: 'vi' | 'en' | 'both'
}

/** E-49, the gateway configuration (Admin only, DOC-36 §7.1): whether online payment is offered, so the app line of "How to pay" shows. */
const gatewayQuery = () =>
  queryOptions({
    queryKey: staffKey('gateway'),
    queryFn: async () => unwrap(await api.staff.gateway.get()),
    staleTime: 60_000,
  })

const LANG_KEY = {
  vi: 'web.fee-notice.lang.vi',
  en: 'web.fee-notice.lang.en',
  both: 'web.fee-notice.lang.both',
} as const

/** The name in the UI language (DOC-21 §3.1). */
const bilingual = (name: { vi: string; en?: string | null }, lang: string) =>
  lang === 'en' ? (name.en ?? name.vi) : name.vi

/** The notice language: the URL's choice, else the building's setting, else Vietnamese (DOC-66 §2). */
const resolveNoticeLang = (
  chosen: FeeNoticeLanguage | undefined,
  building: FeeNoticeLanguage | undefined,
): FeeNoticeLanguage => chosen ?? building ?? 'vi'

/** The statuses E-99 accepts (DOC-34 §6.3): a draft and a recalled batch have no bulk export. */
const canExport = (status: FeeBatchView['status']) => status === 'published' || status === 'closed'

/** The subtitle of §3: the batch name, the issue date and the unit count; a draft says so instead of a date. */
function subtitleOf(
  t: T,
  batch: FeeBatchView,
  lang: string,
  formatDate: (value: string | Date) => string,
): string {
  const units = batch.counts.charges
  if (batch.status === 'draft')
    return t('web.fee-notice.subtitle.draft', { batch: bilingual(batch.name, lang), units })
  return t('web.fee-notice.subtitle', {
    batch: bilingual(batch.name, lang),
    date: formatDate(batch.publishedAt ?? new Date()),
    units,
  })
}

/** The message of a failed download: a void charge is 409, a busy renderer 503 with a retry hint (DOC-34 §6.3, §10). */
function downloadFailure(t: T, error: unknown): { message: string; description?: string } {
  if (error instanceof FileDownloadError) {
    if (error.status === 409) return { message: t('web.fee-notice.void') }
    if (error.status === 503 && error.retryAfterSeconds)
      return {
        message: t('error.service_unavailable'),
        description: t('common.retry-in', { seconds: error.retryAfterSeconds }),
      }
    if (error.status === 403) return { message: t('error.forbidden') }
    if (error.status === 404) return { message: t('error.not_found') }
  }
  return { message: t('common.error.page.body') }
}

/** The message of a failed bulk job: the two codes of DOC-34 §9.2, else the generic server sentence. */
function bulkError(t: T, error: unknown): string {
  const code = (error as { code?: string } | null | undefined)?.code
  if (code === 'all_units_failed') return t('web.fee-notice.bulk.error.all_units_failed')
  if (code === 'attempts_exhausted') return t('web.fee-notice.bulk.error.attempts_exhausted')
  return errorText(t, { code: code ?? 'internal_error', message: '' })
}

/** The unit picker's options: `{unitCode}, {ownerName}` per charge of the batch (DOC-66 §4). */
function unitOptionsOf(items: readonly BatchChargeItem[]): { value: string; label: string }[] {
  return items.map((item) => ({
    value: item.unitCode,
    label: item.ownerName ? `${item.unitCode}, ${item.ownerName}` : item.unitCode,
  }))
}

/** The unit the picker shows: the chosen one in the URL, else the batch's first charge (DOC-66 §2). */
function selectedUnitOf(chosen: string | undefined, first: BatchChargeItem | undefined): string {
  return chosen ?? first?.unitCode ?? ''
}

/** `W-Fee-Notice` (DOC-66): the A4 preview of one unit's notice and the bulk PDF export of the batch. */
export function FeeNoticePage({
  batchId,
  search,
}: {
  batchId: string
  search: FeeNoticeSearch
}): ReactElement | null {
  const { t, lang, formatDate } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const me = useQuery(staffMeQuery())
  const isAdmin = me.data?.role === 'admin'

  const batch = useQuery(feeBatchQuery(batchId))
  const settings = useQuery({ ...settingsQuery(), enabled: isAdmin })
  const data = batch.data
  useSetBreadcrumbTail(data?.code ?? null)

  // The unit picker: the batch's charges (E-93, one page of up to 200), labelled `{unitCode}, {ownerName}` (DOC-66 §4).
  const unitList = useQuery(batchChargesQuery(batchId, { view: 'all', limit: 200 }))
  const unitOptions = unitOptionsOf(unitList.data?.items ?? [])

  const noticeLang = resolveNoticeLang(
    search.lang,
    settings.data?.document.settings.feeNoticeLanguage,
  )

  // The charge shown: the first of the batch, or the one whose unit code is chosen (E-93 `include=lines`, limit 1).
  const charge = useQuery({
    ...batchChargesQuery(batchId, {
      view: 'all',
      ...(search.unit ? { q: search.unit } : {}),
      include: 'lines',
      limit: 1,
    }),
    placeholderData: undefined,
  })
  const one = charge.data?.items[0]
  // The picker shows the chosen unit, else the one the preview defaults to (the batch's first charge, DOC-66 §2).
  const selectedUnit = selectedUnitOf(search.unit, one)

  const { requestNoticeZip } = useFeeBatchMutations(batchId)
  const job = useQuery({
    ...feeNoticeJobQuery(batchId),
    enabled: data !== undefined && data.status !== 'draft',
  })
  const gateway = useQuery({ ...gatewayQuery(), enabled: isAdmin })
  const gatewayActive = gateway.data?.configs.some((config) => config.status === 'active') ?? false
  const [downloading, setDownloading] = useState(false)

  const go = (patch: Partial<FeeNoticeSearch>) =>
    void navigate({
      to: '/fees/$batchId/notice',
      params: { batchId },
      search: { ...search, ...patch },
      replace: true,
      resetScroll: false,
    })

  /** E-176 (DOC-34 §6.3, §8.1): the PDF of the shown charge, saved by the browser; a 503 offers a retry-after toast. */
  const downloadOne = () => {
    if (!data || !one) return
    setDownloading(true)
    downloadFile(
      `/staff/charges/${one.chargeId}/pdf?language=${noticeLang}`,
      `${data.code}-${one.unitCode}.pdf`,
    )
      .catch((error: unknown) => {
        const failure = downloadFailure(t, error)
        toast.error(
          failure.message,
          failure.description ? { description: failure.description } : undefined,
        )
      })
      .finally(() => setDownloading(false))
  }

  /** E-99 (DOC-34 §9.1): one job per batch; a repeat returns the active job, so the button stays enabled. */
  const requestBulk = () =>
    requestNoticeZip.mutate(
      { language: noticeLang },
      { onError: (thrown) => toast.error(errorText(t, apiErrorOf(thrown))) },
    )

  if (batch.isError && !data)
    return <BatchFailure error={batch.error} onRetry={() => void batch.refetch()} />

  const units = data?.counts.charges ?? 0
  const bulkBlocked = data === undefined || !canExport(data.status)

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={t('web.fee-notice.title')}
        subtitle={data ? subtitleOf(t, data, lang, formatDate) : undefined}
        subtitleLoading={!data}
        actions={
          <NoticeActions
            one={one}
            units={units}
            downloading={downloading}
            canBulk={!bulkBlocked && canWrite}
            onDownload={downloadOne}
            onBulk={requestBulk}
          />
        }
      />

      {/* Two columns (DOC-66 §4): the view options on the left, the A4 preview on the right; they stack when narrow. */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="w-full lg:w-[360px] lg:shrink-0">
          <OptionsCard
            noticeLang={noticeLang}
            onLangChange={(value) => go({ lang: value })}
            unitOptions={unitOptions}
            selectedUnit={selectedUnit}
            onUnitChange={(value) => go({ unit: value || undefined })}
            isAdmin={isAdmin}
          />
        </div>

        <div className="w-full min-w-0 lg:flex-1">
          {data && (
            <FeeNoticePreview
              batch={data}
              charge={one}
              loading={charge.isLoading || settings.isLoading}
              lang={noticeLang}
              settings={settings.data?.document}
              gatewayActive={gatewayActive}
            />
          )}
        </div>
      </div>

      {data && (
        <BulkPanel
          job={job.data}
          canRequest={!bulkBlocked && canWrite}
          requesting={requestNoticeZip.isPending}
          onRequest={requestBulk}
        />
      )}
    </div>
  )
}

/** The two header actions of §4: one unit's PDF, and the bulk ZIP of the batch (disabled for a draft or a recalled batch). */
function NoticeActions({
  one,
  units,
  downloading,
  canBulk,
  onDownload,
  onBulk,
}: {
  one: BatchChargeItem | undefined
  units: number
  downloading: boolean
  canBulk: boolean
  onDownload: () => void
  onBulk: () => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <>
      <Button
        variant="outline"
        icon="download-simple"
        data-testid="notice-one"
        disabled={!one || downloading}
        loading={downloading}
        onClick={onDownload}
      >
        {t('web.fee-notice.action.one')}
      </Button>
      <Button data-testid="notice-bulk" disabled={!canBulk} onClick={onBulk}>
        {t('web.fee-notice.action.bulk', { count: units })}
      </Button>
    </>
  )
}

/** The "View options" card of §4: the language, the searchable unit picker over the batch's charges, and the note. */
function OptionsCard({
  noticeLang,
  onLangChange,
  unitOptions,
  selectedUnit,
  onUnitChange,
  isAdmin,
}: {
  noticeLang: FeeNoticeLanguage
  onLangChange: (value: FeeNoticeLanguage) => void
  unitOptions: readonly { value: string; label: string }[]
  selectedUnit: string
  onUnitChange: (value: string) => void
  isAdmin: boolean
}): ReactElement {
  const { t } = useI18n()
  return (
    <Card className="flex flex-col gap-5 p-5">
      <h2 className="text-title-3 text-ink">{t('web.fee-notice.options.title')}</h2>
      <div className="flex flex-col gap-2">
        <span className="text-label text-ink-muted">{t('web.fee-notice.lang.label')}</span>
        <SegmentedControl
          value={noticeLang}
          onValueChange={onLangChange}
          label={t('web.fee-notice.lang.label')}
          options={[
            { value: 'vi', label: t('web.fee-notice.lang.vi') },
            { value: 'en', label: t('web.fee-notice.lang.en') },
            { value: 'both', label: t('web.fee-notice.lang.both') },
          ]}
        />
      </div>
      <SelectField
        label={t('web.fee-notice.unit')}
        value={selectedUnit}
        onValueChange={onUnitChange}
        options={unitOptions}
        placeholder={t('web.fee-notice.unit')}
      />
      <p className="text-secondary text-ink-muted">
        {t('web.fee-notice.note')}
        {isAdmin && (
          <>
            {' '}
            <Link to="/building" search={{}} className="underline">
              {t('web.shell.nav.building')}
            </Link>
          </>
        )}
      </p>
    </Card>
  )
}

/** A batch that cannot be read: a discarded one is a not-found state, anything else the generic error with a retry. */
function BatchFailure({ error, onRetry }: { error: unknown; onRetry: () => void }): ReactElement {
  const { t } = useI18n()
  const failure = apiErrorOf(error)
  if (failure.status !== 404) return <ErrorState requestId={failure.requestId} onRetry={onRetry} />
  return (
    <EmptyState
      icon="magnifying-glass"
      title={t('common.not-found.title')}
      body={t('common.not-found.body')}
      actions={
        <Link to="/fees" search={{}} className={buttonStyles({ variant: 'outline' })}>
          {t('web.shell.nav.fees')}
        </Link>
      }
    />
  )
}

/** The bulk panel of §4: one job at a time, its state from E-177, and the ZIP link once it is ready (DOC-34 §9.1). */
function BulkPanel({
  job,
  canRequest,
  requesting,
  onRequest,
}: {
  job: FeeNoticeJob | null | undefined
  canRequest: boolean
  requesting: boolean
  onRequest: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  const zip =
    job?.status === 'ready' && job.zip && !('expired' in job.zip) && job.zip.url ? job.zip : null
  const expired = job?.status === 'ready' && zip === null

  return (
    <Card className="p-5" data-testid="bulk-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-title-3 text-ink">{t('web.fee-notice.bulk.title')}</h2>
        {job && <Tag tone="neutral">{t(LANG_KEY[job.language])}</Tag>}
      </div>

      {!job && <p className="text-secondary text-ink-muted">{t('web.fee-notice.bulk.none')}</p>}

      {job?.status === 'queued' && (
        <StatusProgress
          done={job.unitDone}
          total={job.unitTotal}
          label={t('web.fee-notice.bulk.queued')}
        />
      )}
      {job?.status === 'running' && (
        <StatusProgress
          done={job.unitDone}
          total={job.unitTotal}
          label={t('web.fee-notice.bulk.running', {
            done: job.unitDone,
            total: job.unitTotal,
          })}
        />
      )}

      {zip && (
        <div className="flex flex-col gap-2" data-testid="bulk-ready">
          <p className="text-body text-ink">
            {t('web.fee-notice.bulk.ready', {
              fileName: zip.fileName,
              size: formatBytes(zip.size, lang),
            })}
          </p>
          <p className="text-secondary text-ink-muted">{t('web.fee-notice.bulk.link')}</p>
          <div>
            <Button
              variant="outline"
              icon="download-simple"
              data-testid="bulk-download"
              onClick={() => window.open(zip.url, '_blank', 'noopener')}
            >
              {t('common.action.download')}
            </Button>
          </div>
        </div>
      )}

      {expired && (
        <div className="flex flex-col gap-3" data-testid="bulk-expired">
          <p className="text-secondary text-ink-muted">{t('web.fee-notice.bulk.expired')}</p>
          <div>
            <Button
              variant="outline"
              data-testid="bulk-export-again"
              disabled={!canRequest}
              loading={requesting}
              onClick={onRequest}
            >
              {t('web.fee-notice.bulk.export-again')}
            </Button>
          </div>
        </div>
      )}

      {job?.status === 'failed' && (
        <div className="flex flex-col gap-3" data-testid="bulk-failed">
          <Banner tone="danger">{bulkError(t, job.error)}</Banner>
          <div>
            <Button
              variant="outline"
              data-testid="bulk-retry"
              disabled={!canRequest}
              loading={requesting}
              onClick={onRequest}
            >
              {t('web.fee-notice.bulk.retry')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function StatusProgress({
  done,
  total,
  label,
}: {
  done: number
  total: number
  label: string
}): ReactElement {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-ink" data-testid="bulk-status">
        {label}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill">
        <div
          className="h-full rounded-full bg-teal transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
