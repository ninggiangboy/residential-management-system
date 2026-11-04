import { formatBytes } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles } from '../../components/ui/button'
import { Card, CardSection } from '../../components/ui/card'
import { ErrorState } from '../../components/ui/empty-state'
import { Icon } from '../../components/ui/icon'
import { PageHeader } from '../../components/ui/page'
import { Skeleton } from '../../components/ui/skeleton'
import { DataTable, TBody, Td, THead, Th, Tr } from '../../components/ui/table'
import { Plate, StatusTag } from '../../components/ui/tag'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { day } from '../../lib/day'
import { saveBlob } from '../../lib/download'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { uploadFile } from '../../lib/uploads'
import { useIntent } from '../../lib/use-intent'
import { settingsQuery } from '../building/hooks'
import { type FeeBatchView, feeBatchQuery } from '../fee-batch/hooks'
import { errorsCsv } from '../import/csv'
import {
  downloadFeeTemplate,
  type FeeImportCounts,
  type FeeImportIssue,
  type FeeImportJob,
  type FeePreviewRow,
  feeImportQuery,
  recentFeeImportsQuery,
  useFeeImportMutations,
} from './hooks'

/** DOC-66 `W-Fee-Import`: `batchId` is the draft the lines go to (its fee month is locked, DR-265); `importId` reopens a preview (E-73). */
export interface FeeImportSearch {
  batchId?: string
  importId?: string
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_BYTES = 5 * 1_048_576

const pad = (value: number) => String(value).padStart(2, '0')
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return isoDay(next)
}
const monthOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
/** `2026-10-01` or `2026-10` as `10/2026`. */
const monthLabel = (value: string | Date) => `${day(value).slice(5, 7)}/${day(value).slice(0, 4)}`

interface Settings {
  nameVi: string
  nameEn: string
  /** `YYYY-MM`. */
  month: string
  /** `YYYY-MM-DD`. */
  due: string
}

type Phase =
  | { name: 'idle' }
  | { name: 'uploading'; file: string }
  | { name: 'checking'; file: string }

/** The three-step bar: Cài đặt và chọn file, Kiểm tra, Lưu (DOC-66 §4). */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useI18n()
  const items = [
    ['web.fee-import.step.settings', 1],
    ['web.fee-import.step.check', 2],
    ['web.fee-import.step.save', 3],
  ] as const
  return (
    <ol className="mb-6 flex items-center gap-4" aria-label={t('web.fee-import.title')}>
      {items.map(([key, n]) => (
        <li
          key={key}
          className="flex items-center gap-2"
          aria-current={n === step ? 'step' : undefined}
        >
          <span
            className={`flex size-8 items-center justify-center rounded-full text-label ${n < step ? 'bg-teal text-on-teal' : n === step ? 'bg-teal-soft text-on-teal-soft' : 'bg-fill text-ink-muted'}`}
          >
            {n < step ? <Icon name="check" size="sm" weight="bold" /> : n}
          </span>
          <span className={n === step ? 'text-label text-ink' : 'text-label text-ink-muted'}>
            {t(key)}
          </span>
          {n < 3 && <span className="mx-2 h-px w-10 bg-line" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

/** `W-Fee-Import` (DOC-66): the draft, the Excel file and its preview, then the commit that replaces the draft's charges. */
export function FeeImportPage({ search }: { search: FeeImportSearch }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const { createBatch, validate, commit } = useFeeImportMutations()
  const batchIntent = useIntent()
  const importIntent = useIntent()

  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [fileError, setFileError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [picked, setPicked] = useState<{ file: File; fileId: string } | null>(null)
  const [size, setSize] = useState<number | null>(null)
  const [settings, setSettings] = useState<Settings>(() => {
    const now = new Date()
    const month = monthOf(now)
    // The batch name opens on the default of DOC-66 §4 ("Phí tháng {m}/{y}"), so "Kiểm tra" is ready at once.
    return {
      nameVi: t('web.fee-import.field.name.default', {
        month: month.slice(5, 7),
        year: month.slice(0, 4),
      }),
      nameEn: '',
      month,
      due: addDays(now, 10),
    }
  })
  const seeded = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)

  const job = useQuery({
    ...feeImportQuery(search.importId ?? ''),
    enabled: search.importId !== undefined,
  })
  // The draft: from the URL or from the reopened job's `params` (E-73, DOC-21 §4.1).
  const batchId = search.batchId ?? job.data?.params?.batchId
  const batch = useQuery({ ...feeBatchQuery(batchId ?? ''), enabled: batchId !== undefined })
  const building = useQuery(settingsQuery())

  // §7: a check that runs long says so after 10 s, then offers a retry with the same key after 30 s (the keys replay, DR-21).
  useEffect(() => {
    if (phase.name !== 'checking') {
      setSlow(false)
      setStuck(false)
      return
    }
    const slowTimer = setTimeout(() => setSlow(true), 10_000)
    const stuckTimer = setTimeout(() => setStuck(true), 30_000)
    return () => {
      clearTimeout(slowTimer)
      clearTimeout(stuckTimer)
    }
  }, [phase.name])

  // The settings keep the entered values; a draft fills them once, and a new batch takes the building's default term.
  useEffect(() => {
    if (seeded.current) return
    if (search.batchId !== undefined) {
      if (!batch.data) return
      setSettings({
        nameVi: batch.data.name.vi,
        nameEn: batch.data.name.en ?? '',
        month: day(batch.data.feeMonth).slice(0, 7),
        due: day(batch.data.dueDate),
      })
      seeded.current = true
      return
    }
    if (building.isPending) return
    const days = Number(building.data?.document.settings.defaultDueDays ?? 10)
    const today = new Date()
    setSettings((current) => ({
      ...current,
      due: addDays(today, Number.isFinite(days) ? days : 10),
    }))
    seeded.current = true
  }, [search.batchId, batch.data, building.isPending, building.data])

  const go = (next: FeeImportSearch) =>
    void navigate({ to: '/fees/import', search: next, replace: true })

  const pick = async (file: File | undefined) => {
    if (!file) return
    setFileError(null)
    setPicked(null)
    setSize(null)
    if (!file.name.toLowerCase().endsWith('.xlsx'))
      return setFileError(t('web.import.error.extension'))
    if (file.size > MAX_BYTES) return setFileError(t('web.import.error.size'))
    abort.current = new AbortController()
    try {
      setPhase({ name: 'uploading', file: file.name })
      const { fileId } = await uploadFile({
        purpose: 'import',
        module: 'finance',
        file,
        mime: XLSX,
        signal: abort.current.signal,
      })
      setPicked({ file, fileId })
      setSize(file.size)
      setPhase({ name: 'idle' })
    } catch (thrown) {
      setPhase({ name: 'idle' })
      if (thrown instanceof DOMException && thrown.name === 'AbortError') return
      setFileError(t('web.import.error.unreadable'))
    }
  }

  const check = async () => {
    if (!picked || !canWrite) return
    setFileError(null)
    setPhase({ name: 'checking', file: picked.file.name })
    try {
      let target = batchId
      if (target === undefined) {
        const body = {
          name: {
            vi: settings.nameVi.trim(),
            ...(settings.nameEn.trim() ? { en: settings.nameEn.trim() } : {}),
          },
          feeMonth: `${settings.month}-01`,
          dueDate: settings.due,
        }
        const created = (await createBatch.mutateAsync({
          body,
          key: batchIntent.keyFor(body),
        })) as { id: string }
        target = created.id
      }
      const importBody = {
        fileId: picked.fileId,
        fileName: picked.file.name,
        batchId: target,
      }
      const created = await validate.mutateAsync({
        ...importBody,
        key: importIntent.keyFor(importBody),
      })
      setPhase({ name: 'idle' })
      go({ batchId: target, importId: created.importId })
    } catch (thrown) {
      setPhase({ name: 'idle' })
      if (thrown instanceof DOMException && thrown.name === 'AbortError') return
      const failure = apiErrorOf(thrown)
      const rule = (failure.details as { code?: string }[] | undefined)?.[0]?.code
      if (failure.code === 'validation_failed' && rule === 'too_many_rows')
        setFileError(t('web.import.error.too-many-rows'))
      else if (failure.code === 'file_not_verified') setFileError(t('web.import.error.unreadable'))
      else setFileError(errorText(t, failure))
    }
  }

  const step: 1 | 2 | 3 =
    search.importId === undefined || phase.name !== 'idle'
      ? phase.name === 'checking'
        ? 2
        : 1
      : job.data?.status === 'committed'
        ? 3
        : 2

  return (
    <>
      <PageHeader title={t('web.fee-import.title')} subtitle={t('web.fee-import.subtitle')} />
      <Steps step={step} />
      {search.importId === undefined || phase.name !== 'idle' ? (
        <StepOne
          phase={phase}
          slow={slow}
          stuck={stuck}
          error={fileError}
          canWrite={canWrite}
          settings={settings}
          onSettings={setSettings}
          monthLocked={search.batchId !== undefined}
          batch={batch.data}
          picked={picked}
          onPick={() => input.current?.click()}
          onFile={pick}
          onAbort={() => abort.current?.abort()}
          onCheck={() => void check()}
          onOpen={(importId) => go({ ...(batchId ? { batchId } : {}), importId })}
        />
      ) : job.isPending ? (
        <Skeleton className="h-64" />
      ) : job.isError || !job.data ? (
        <ErrorState
          requestId={apiErrorOf(job.error).requestId}
          onRetry={() => void job.refetch()}
        />
      ) : (
        <Preview
          job={job.data}
          batch={batch.data}
          committing={commit.isPending}
          canWrite={canWrite}
          onOther={() => go(batchId ? { batchId } : {})}
          onCommit={() => {
            commit.mutate(job.data.importId, {
              onError: (thrown) => {
                const failure = apiErrorOf(thrown)
                if (failure.code === 'import_not_ready') void job.refetch()
                else if (failure.code !== 'import_stale' && failure.code !== 'import_expired')
                  toast.error(errorText(t, failure))
              },
            })
          }}
          commitError={commit.error ? apiErrorOf(commit.error).code : null}
          fileSize={size}
        />
      )}
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('web.import.cta.choose')}
        onChange={(event) => {
          void pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </>
  )
}

/** Step 1: the batch settings (a new draft) or their locked read (a draft of the URL), then the file. */
function StepOne({
  phase,
  slow,
  stuck,
  error,
  canWrite,
  settings,
  onSettings,
  monthLocked,
  batch,
  picked,
  onPick,
  onFile,
  onAbort,
  onCheck,
  onOpen,
}: {
  phase: Phase
  slow: boolean
  stuck: boolean
  error: string | null
  canWrite: boolean
  settings: Settings
  onSettings: (next: Settings) => void
  monthLocked: boolean
  batch: FeeBatchView | undefined
  picked: { file: File; fileId: string } | null
  onPick: () => void
  onFile: (file: File | undefined) => void
  onAbort: () => void
  onCheck: () => void
  onOpen: (importId: string) => void
}) {
  const { t } = useI18n()
  const [over, setOver] = useState(false)
  const notDraft = batch !== undefined && batch.status !== 'draft'
  const canCheck =
    canWrite &&
    picked !== null &&
    settings.nameVi.trim().length > 0 &&
    settings.month.length === 7 &&
    settings.due.length === 10 &&
    !notDraft

  const onMonth = (value: string) => {
    const previousDefault = t('web.fee-import.field.name.default', {
      month: settings.month.slice(5, 7),
      year: settings.month.slice(0, 4),
    })
    const keepsDefault = settings.nameVi === previousDefault
    onSettings({
      ...settings,
      month: value,
      ...(keepsDefault
        ? {
            nameVi: t('web.fee-import.field.name.default', {
              month: value.slice(5, 7),
              year: value.slice(0, 4),
            }),
          }
        : {}),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="danger">{error}</Banner>}
      {notDraft && (
        <Banner
          tone="danger"
          actions={
            <Link to="/fees/$batchId" params={{ batchId: batch!.id }} className={buttonStyles()}>
              {t('web.fee-import.action.open-batch')}
            </Link>
          }
        >
          {t('web.fee-import.not-draft')}
        </Banner>
      )}
      <CardSection title={t('web.fee-import.settings.title')}>
        <form
          data-testid="fee-import-settings"
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (canCheck) onCheck()
          }}
        >
          <TextField
            data-testid="fee-import-name"
            label={t('web.fee-import.field.name')}
            required
            placeholder={t('web.fee-import.field.name.placeholder')}
            value={settings.nameVi}
            onChange={(event) => onSettings({ ...settings, nameVi: event.target.value })}
          />
          <TextField
            label={t('web.fee-import.field.name-en')}
            placeholder={t('web.fee-import.field.name.placeholder')}
            value={settings.nameEn}
            onChange={(event) => onSettings({ ...settings, nameEn: event.target.value })}
          />
          <TextField
            data-testid="fee-import-month"
            type="month"
            label={t('web.fee-import.field.month')}
            required
            disabled={monthLocked}
            hint={monthLocked ? t('web.fee-import.field.month.locked') : undefined}
            value={settings.month}
            onChange={(event) => onMonth(event.target.value)}
          />
          <TextField
            data-testid="fee-import-due"
            type="date"
            label={t('web.fee-import.field.due')}
            required
            value={settings.due}
            onChange={(event) => onSettings({ ...settings, due: event.target.value })}
          />
        </form>
      </CardSection>
      <Card className="flex flex-col gap-4 p-4">
        {phase.name === 'idle' && !picked ? (
          <Card
            className={`flex flex-col items-center gap-3 border border-dashed p-8 text-center ${over ? 'border-teal bg-teal-soft' : 'border-line-control'}`}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setOver(false)
              onFile(event.dataTransfer.files[0])
            }}
          >
            <span className="flex size-14 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
              <Icon name="upload-simple" size="lg" />
            </span>
            <h2 className="text-title-3">{t('web.import.dropzone.title')}</h2>
            <p className="max-w-md text-secondary text-ink-muted">
              {t('web.fee-import.dropzone.rules')}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button disabled={!canWrite} onClick={onPick}>
                {t('web.import.cta.choose')}
              </Button>
              <Button
                variant="ghost"
                icon="download-simple"
                onClick={() =>
                  void downloadFeeTemplate().catch(() => toast.error(t('common.error.page.body')))
                }
              >
                {t('web.import.action.template')}
              </Button>
            </div>
          </Card>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
                <Icon name="file-text" />
              </span>
              <div>
                <p className="text-body-strong">
                  {phase.name === 'uploading'
                    ? t('web.fee-import.uploading', { fileName: phase.file })
                    : phase.name === 'checking'
                      ? t('web.import.validating', { fileName: phase.file })
                      : (picked?.file.name ?? '')}
                </p>
                {phase.name !== 'idle' && (
                  <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-fill">
                    <div className="motion-progress h-full w-1/3 rounded-full bg-teal" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {phase.name === 'uploading' && (
                <Button size="sm" variant="ghost" onClick={onAbort}>
                  {t('common.action.cancel')}
                </Button>
              )}
              {phase.name === 'idle' && (
                <Button variant="outline" size="sm" onClick={onPick}>
                  {t('web.import.cta.choose')}
                </Button>
              )}
            </div>
          </div>
        )}
        <ValidatingHint
          checking={phase.name === 'checking'}
          slow={slow}
          stuck={stuck}
          onCheck={onCheck}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            icon="download-simple"
            onClick={() =>
              void downloadFeeTemplate().catch(() => toast.error(t('common.error.page.body')))
            }
          >
            {t('web.import.action.template')}
          </Button>
          <Button
            icon="check"
            data-testid="fee-import-check"
            loading={phase.name === 'checking'}
            disabled={!canCheck}
            onClick={onCheck}
          >
            {t('web.fee-import.cta.check')}
          </Button>
        </div>
      </Card>
      <RecentImports onOpen={onOpen} />
    </div>
  )
}

/** §7: a check that runs long says so after 10 s, then offers a retry with the same key after 30 s (the keys replay, DR-21). */
function ValidatingHint({
  checking,
  slow,
  stuck,
  onCheck,
}: {
  checking: boolean
  slow: boolean
  stuck: boolean
  onCheck: () => void
}) {
  const { t } = useI18n()
  if (!checking || (!slow && !stuck)) return null
  return (
    <div className="flex flex-wrap items-center gap-3">
      {slow && <p className="text-secondary text-ink-muted">{t('web.import.validating.slow')}</p>}
      {stuck && (
        <Button variant="outline" size="sm" data-testid="fee-import-retry" onClick={onCheck}>
          {t('common.action.retry')}
        </Button>
      )}
    </div>
  )
}

/** The fee jobs of the last 30 days (E-169); "Mở" reopens a preview through E-73 (DR-226). */
function RecentImports({ onOpen }: { onOpen: (importId: string) => void }) {
  const { t, formatDateTime } = useI18n()
  const recent = useQuery(recentFeeImportsQuery())
  const items = recent.data?.items ?? []
  return (
    <CardSection title={t('web.fee-import.history.title')}>
      {recent.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : recent.isError ? (
        <Banner
          tone="warning"
          actions={
            <Button size="sm" variant="outline" onClick={() => void recent.refetch()}>
              {t('common.action.retry')}
            </Button>
          }
        >
          {t('common.error.page.body')}
        </Banner>
      ) : items.length === 0 ? (
        <p className="py-4 text-secondary text-ink-muted">{t('web.import.history.empty')}</p>
      ) : (
        <DataTable label={t('web.fee-import.history.title')} minWidth="min-w-[720px]">
          <THead>
            <Tr>
              <Th>{t('web.import.history.col.file')}</Th>
              <Th>{t('web.import.history.col.by')}</Th>
              <Th>{t('web.import.history.col.when')}</Th>
              <Th>{t('web.fee-import.history.col.code')}</Th>
              <Th>{t('web.import.history.col.result')}</Th>
              <Th>
                <span className="sr-only">{t('web.import.history.open')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((item) => {
              // E-169 does not carry the batch code today (see the slice report): the plate shows only when the API adds it.
              const code = (item as { code?: string | null }).code
              return (
                <Tr key={item.importId} data-testid="history-row">
                  <Td className="max-w-56 truncate">{item.fileName ?? '—'}</Td>
                  <Td className="text-secondary">{item.createdBy.name ?? '—'}</Td>
                  <Td className="text-secondary text-ink-muted">
                    {formatDateTime(item.createdAt)}
                  </Td>
                  <Td>{code ? <Plate>{code}</Plate> : null}</Td>
                  <Td className="text-secondary">
                    <span className="flex flex-wrap items-center gap-2">
                      {t('web.import.history.result', {
                        valid: item.counts.valid,
                        rows: item.counts.rows,
                        errors: item.counts.errors,
                      })}
                      <StatusTag entity="import_job" value={item.status} />
                    </span>
                  </Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => onOpen(item.importId)}>
                      {t('web.import.history.open')}
                    </Button>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </DataTable>
      )}
    </CardSection>
  )
}

/** The result of a commit (step 3): the counts and the two ways on (DOC-66 §4). */
function ResultCard({ job, onOther }: { job: FeeImportJob; onOther: () => void }) {
  const { t } = useI18n()
  const committed = job.committed
  return (
    <Card className="flex flex-col items-start gap-4 p-8">
      <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-on-success-soft">
        <Icon name="check-circle" size="lg" weight="fill" />
      </span>
      <p className="text-title-3 text-ink" data-testid="import-done">
        {t('web.fee-import.done', {
          charges: job.preview.counts.valid,
          units: committed?.created ?? 0,
        })}
      </p>
      {committed !== null && committed.replaced > 0 && (
        <p className="text-body text-ink-muted">
          {t('web.fee-import.done.replaced', { replaced: committed.replaced })}
        </p>
      )}
      <div className="flex gap-3">
        <Link
          to="/fees/$batchId"
          params={{ batchId: job.params.batchId }}
          className={buttonStyles()}
          data-testid="result-open-batch"
        >
          {t('web.fee-import.action.open-batch')}
        </Link>
        <Button variant="outline" data-testid="result-again" onClick={onOther}>
          {t('web.fee-import.action.other-file')}
        </Button>
      </div>
    </Card>
  )
}

/** A file-level `fail` rule made the whole job fail; nothing can be committed (DQ-62, DQ-63). */
function FailedCard({ message, onOther }: { message: string | undefined; onOther: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="danger">{message ?? t('web.fee-import.banner.failed')}</Banner>
      <div>
        <Button variant="outline" icon="upload-simple" onClick={onOther}>
          {t('web.fee-import.action.reimport')}
        </Button>
      </div>
    </div>
  )
}

/** The uploaded file and the two actions over it: the template again, or another file. */
function FileCard({
  job,
  fileSize,
  onOther,
}: {
  job: FeeImportJob
  fileSize: number | null
  onOther: () => void
}) {
  const { t, lang, formatDate, formatDateTime } = useI18n()
  const time = formatDateTime(job.createdAt).slice(-5)
  const date = formatDate(job.createdAt)
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
          <Icon name="file-text" />
        </span>
        <div>
          <p className="text-body-strong">{job.fileName ?? '—'}</p>
          <p className="text-secondary text-ink-muted">
            {fileSize === null
              ? t('web.fee-import.file.meta.rows', { rows: job.preview.counts.rows, time, date })
              : t('web.fee-import.file.meta', {
                  rows: job.preview.counts.rows,
                  size: formatBytes(fileSize, lang),
                  time,
                  date,
                })}
          </p>
          <p className="text-caption text-ink-muted">{t('web.fee-import.file.note')}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          variant="ghost"
          icon="download-simple"
          onClick={() =>
            void downloadFeeTemplate().catch(() => toast.error(t('common.error.page.body')))
          }
        >
          {t('web.import.action.template')}
        </Button>
        <Button
          variant="outline"
          icon="upload-simple"
          data-testid="fee-import-reimport"
          onClick={onOther}
        >
          {t('web.fee-import.action.reimport')}
        </Button>
      </div>
    </Card>
  )
}

/** The four tiles of a preview: rows, valid, errors and the total of the valid rows (DOC-66 §4). */
function CountTiles({ counts }: { counts: FeeImportCounts }) {
  const { t, formatMoney } = useI18n()
  const tiles = [
    ['rows', String(counts.rows), t('web.fee-import.count.rows'), false],
    ['valid', String(counts.valid), t('web.fee-import.count.valid'), false],
    ['errors', String(counts.errors), t('web.fee-import.count.errors'), counts.errors > 0],
    ['total', formatMoney(counts.totalAmount), t('web.fee-import.count.total'), false],
  ] as const
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(([key, value, label, danger]) => (
        <Card key={key} className="p-5">
          <p
            className={`text-display tabular-nums ${danger ? 'text-danger' : 'text-ink'}`}
            data-testid={`count-${key}`}
          >
            {value}
          </p>
          <p className="text-secondary text-ink-muted">{label}</p>
        </Card>
      ))}
    </div>
  )
}

/** The first 50 valid rows, collapsed (DOC-66 §4, DR-21). */
function ValidRows({ rows, month }: { rows: FeePreviewRow[]; month: string }) {
  const { t, formatMoney } = useI18n()
  if (rows.length === 0) return null
  return (
    <details
      className="rounded-card border border-line bg-surface p-4 shadow-panel"
      data-testid="valid-rows"
    >
      <summary className="text-body-strong">
        {t('web.import.valid.title', { count: rows.length })}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-secondary">
          <thead>
            <tr className="text-ink-muted">
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.row')}</th>
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.unit')}</th>
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.item')}</th>
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.month')}</th>
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.quantity')}</th>
              <th className="py-2 pr-4 font-medium">{t('web.fee-import.col.unit-price')}</th>
              <th className="py-2 font-medium">{t('web.fee-import.col.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row) => (
              <tr key={row.row} className="border-t border-line">
                <td className="py-2 pr-4">{row.row}</td>
                <td className="py-2 pr-4">{row.unitCode}</td>
                <td className="py-2 pr-4">
                  <span className="text-ink">{row.itemName}</span>
                  {row.itemNameEn && (
                    <span className="block text-caption text-ink-muted">{row.itemNameEn}</span>
                  )}
                </td>
                <td className="py-2 pr-4">{month}</td>
                <td className="py-2 pr-4 tabular-nums">{row.quantity}</td>
                <td className="py-2 pr-4 tabular-nums">{formatMoney(row.unitPrice)}</td>
                <td className="py-2 tabular-nums">{formatMoney(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Up to 500 error rows, errors first, each naming its row, unit, column and the text of DOC-18 §2.2. */
function ErrorTable({ errors, truncated }: { errors: FeeImportIssue[]; truncated: boolean }) {
  const { t } = useI18n()
  return (
    <section aria-labelledby="fee-import-errors">
      <h2 id="fee-import-errors" className="mb-3 text-title-3 text-ink">
        {t('web.fee-import.errors.title')}
      </h2>
      <DataTable label={t('web.fee-import.errors.title')} minWidth="min-w-[720px]">
        <THead>
          <Tr>
            <Th className="w-48">{t('web.fee-import.errors.col.where')}</Th>
            <Th className="w-40">{t('web.fee-import.col.column')}</Th>
            <Th>{t('web.fee-import.col.message')}</Th>
          </Tr>
        </THead>
        <TBody>
          {errors.slice(0, 500).map((issue, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an issue has no id; the list never reorders
            <Tr key={`${issue.row}-${issue.code}-${index}`} data-testid="error-row">
              <Td>
                {t('web.fee-import.errors.where', { row: issue.row, unit: issue.unitCode ?? '—' })}
              </Td>
              <Td>{issue.column ?? '—'}</Td>
              <Td>{issue.message}</Td>
            </Tr>
          ))}
        </TBody>
      </DataTable>
      {truncated && (
        <p className="mt-2 text-secondary text-ink-muted">{t('web.import.truncated')}</p>
      )}
    </section>
  )
}

/** The warning issues of the preview, collapsed (DOC-66 §4). */
function WarningList({ warnings }: { warnings: FeeImportIssue[] }) {
  const { t } = useI18n()
  if (warnings.length === 0) return null
  return (
    <details className="rounded-card border border-line bg-surface p-4 shadow-panel">
      <summary className="text-body-strong">
        {t('web.import.warnings.title', { count: warnings.length })}
      </summary>
      <ul className="mt-3 flex flex-col gap-1 text-secondary">
        {warnings.slice(0, 50).map((issue, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={`${issue.row}-${index}`}>
            {issue.row}: {issue.message}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The action bar of a validated preview: cancel, the error CSV, then the save (DOC-66 §4). */
function ActionBar({
  importId,
  count,
  errors,
  committing,
  canWrite,
  disabled,
  onOther,
  onCommit,
}: {
  importId: string
  count: number
  errors: FeeImportIssue[]
  committing: boolean
  canWrite: boolean
  disabled: boolean
  onOther: () => void
  onCommit: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Button variant="ghost" onClick={onOther}>
        {t('common.action.cancel')}
      </Button>
      {errors.length > 0 && (
        <Button
          variant="outline"
          icon="download-simple"
          onClick={() =>
            saveBlob(
              new Blob([errorsCsv(errors.slice(0, 500), (column) => column ?? '')], {
                type: 'text/csv;charset=utf-8',
              }),
              `fee-import-errors-${importId}.csv`,
            )
          }
        >
          {t('web.import.action.download-errors')}
        </Button>
      )}
      <Button
        icon="check"
        data-testid="save-batch"
        loading={committing}
        disabled={!canWrite || disabled}
        onClick={onCommit}
      >
        {t('web.fee-import.cta.save', { count })}
      </Button>
    </div>
  )
}

/** Steps 2 and 3: the preview of a fee job, its commit, and the result card. */
function Preview({
  job,
  batch,
  committing,
  canWrite,
  onOther,
  onCommit,
  commitError,
  fileSize,
}: {
  job: FeeImportJob
  batch: FeeBatchView | undefined
  committing: boolean
  canWrite: boolean
  onOther: () => void
  onCommit: () => void
  commitError: string | null
  fileSize: number | null
}) {
  const { t } = useI18n()
  const { counts, validRows, issues, issuesTruncated } = job.preview
  const errors = issues.filter((issue) => issue.severity !== 'warning')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const fail = issues.find((issue) => issue.severity === 'fail')

  if (job.status === 'committed') return <ResultCard job={job} onOther={onOther} />
  if (job.status === 'failed') return <FailedCard message={fail?.message} onOther={onOther} />

  const expired = job.status === 'expired' || commitError === 'import_expired'
  const stale = commitError === 'import_stale'
  const notDraft = commitError === 'invalid_transition'

  return (
    <div
      className="flex flex-col gap-6"
      aria-busy={committing || undefined}
      data-testid="fee-import-preview"
    >
      <FileCard job={job} fileSize={fileSize} onOther={onOther} />
      {expired && <Banner tone="danger">{t('web.fee-import.banner.expired')}</Banner>}
      {stale && <Banner tone="danger">{t('web.fee-import.banner.stale')}</Banner>}
      {notDraft && (
        <Banner
          tone="danger"
          actions={
            batch && (
              <Link to="/fees/$batchId" params={{ batchId: batch.id }} className={buttonStyles()}>
                {t('web.fee-import.action.open-batch')}
              </Link>
            )
          }
        >
          {t('web.fee-import.not-draft')}
        </Banner>
      )}
      <CountTiles counts={counts} />
      <ValidRows rows={validRows} month={batch ? monthLabel(batch.feeMonth) : '—'} />
      {errors.length === 0 ? (
        <Banner tone="success">{t('web.import.no-errors')}</Banner>
      ) : (
        <ErrorTable errors={errors} truncated={issuesTruncated} />
      )}
      <WarningList warnings={warnings} />
      {errors.length > 0 && <Banner tone="warning">{t('web.fee-import.errors.hint')}</Banner>}
      {(batch?.counts.charges ?? 0) > 0 && (
        <Banner tone="warning">
          {t('web.fee-import.replace-warning', { count: batch?.counts.charges ?? 0 })}
        </Banner>
      )}
      <ActionBar
        importId={job.importId}
        count={counts.valid}
        errors={errors}
        committing={committing}
        canWrite={canWrite}
        disabled={counts.valid === 0 || expired || stale || notDraft}
        onOther={onOther}
        onCommit={onCommit}
      />
    </div>
  )
}
