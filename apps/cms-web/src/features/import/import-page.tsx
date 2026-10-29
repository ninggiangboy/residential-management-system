import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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
import { StatusTag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { uploadFile } from '../../lib/uploads'
import { trackTap } from '../../lib/usage'
import { errorsCsv } from './csv'
import {
  downloadTemplate,
  type ImportJob,
  importQuery,
  recentImportsQuery,
  saveBlob,
  useImportMutations,
} from './hooks'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_BYTES = 5 * 1_048_576

type Phase =
  | { name: 'idle' }
  | { name: 'uploading'; file: string }
  | { name: 'validating'; file: string }

/** The three-step bar: Chọn file, Kiểm tra, Lưu (DOC-65 `W-Import` §4). */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useI18n()
  const items = [
    ['web.import.step.file', 1],
    ['web.import.step.check', 2],
    ['web.import.step.save', 3],
  ] as const
  return (
    <ol className="mb-6 flex items-center gap-4" aria-label={t('web.import.title')}>
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

/** `W-Import` (DOC-65): pick an Excel file, check every row, then save the valid rows; the job in the URL survives a reload. */
export function ImportPage({ importId }: { importId?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const { create, commit } = useImportMutations()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [fileError, setFileError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const job = useQuery({ ...importQuery(importId ?? ''), enabled: importId !== undefined })

  useEffect(() => {
    if (phase.name !== 'validating') return setSlow(false)
    const timer = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(timer)
  }, [phase.name])

  const setImportId = (next: string | undefined, replace = false) =>
    void navigate({ to: '/import', search: next ? { importId: next } : {}, replace })

  const pick = async (file: File | undefined) => {
    if (!file) return
    setFileError(null)
    if (!file.name.toLowerCase().endsWith('.xlsx'))
      return setFileError(t('web.import.error.extension'))
    if (file.size > MAX_BYTES) return setFileError(t('web.import.error.size'))
    abort.current = new AbortController()
    try {
      setPhase({ name: 'uploading', file: file.name })
      const { fileId } = await uploadFile({
        purpose: 'import',
        module: 'residency',
        file,
        mime: XLSX,
        signal: abort.current.signal,
      })
      setPhase({ name: 'validating', file: file.name })
      const created = await create.mutateAsync({
        fileId,
        fileName: file.name,
        key: crypto.randomUUID(),
      })
      setPhase({ name: 'idle' })
      setImportId(created.importId)
    } catch (thrown) {
      setPhase({ name: 'idle' })
      if (thrown instanceof DOMException && thrown.name === 'AbortError') return
      const failure = apiErrorOf(thrown)
      const rule = (failure.details as { code?: string; path?: string }[] | undefined)?.[0]?.code
      if (failure.code === 'validation_failed' && rule === 'too_many_rows')
        setFileError(t('web.import.error.too-many-rows'))
      else if (failure.code === 'file_not_verified') setFileError(t('web.import.error.unreadable'))
      else setFileError(errorText(t, failure))
    }
  }

  const step: 1 | 2 | 3 =
    importId === undefined || phase.name !== 'idle'
      ? phase.name === 'validating'
        ? 2
        : 1
      : job.data?.status === 'committed'
        ? 3
        : 2

  return (
    <>
      <PageHeader title={t('web.import.title')} subtitle={t('web.import.subtitle')} />
      <Steps step={step} />
      {importId === undefined || phase.name !== 'idle' ? (
        <StepOne
          phase={phase}
          slow={slow}
          error={fileError}
          canWrite={canWrite}
          onPick={() => input.current?.click()}
          onFile={pick}
          onAbort={() => abort.current?.abort()}
          onOpen={(id) => setImportId(id)}
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
          committing={commit.isPending}
          canWrite={canWrite}
          onOther={() => setImportId(undefined)}
          onCommit={() => {
            trackTap('W-Import.save')
            commit.mutate(job.data.importId, {
              onError: (thrown) => {
                const failure = apiErrorOf(thrown)
                if (failure.code === 'import_not_ready') void job.refetch()
                else toast.error(errorText(t, failure))
              },
            })
          }}
          commitError={commit.error ? apiErrorOf(commit.error).code : null}
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

function StepOne({
  phase,
  slow,
  error,
  canWrite,
  onPick,
  onFile,
  onAbort,
  onOpen,
}: {
  phase: Phase
  slow: boolean
  error: string | null
  canWrite: boolean
  onPick: () => void
  onFile: (file: File | undefined) => void
  onAbort: () => void
  onOpen: (importId: string) => void
}) {
  const { t } = useI18n()
  const [over, setOver] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="danger">{error}</Banner>}
      {phase.name === 'idle' ? (
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
          <p className="max-w-md text-secondary text-ink-muted">{t('web.import.dropzone.rules')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button disabled={!canWrite} onClick={onPick}>
              {t('web.import.cta.choose')}
            </Button>
            <Button
              variant="ghost"
              icon="download-simple"
              onClick={() =>
                void downloadTemplate().catch(() => toast.error(t('common.error.page.body')))
              }
            >
              {t('web.import.action.template')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4 p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-body-strong">
              {phase.name === 'validating'
                ? t('web.import.validating', { fileName: phase.file })
                : phase.file}
            </p>
            {phase.name === 'uploading' && (
              <Button size="sm" variant="ghost" onClick={onAbort}>
                {t('web.import.cta.cancel')}
              </Button>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-teal" />
          </div>
          {slow && (
            <p className="text-secondary text-ink-muted">{t('web.import.validating.slow')}</p>
          )}
        </Card>
      )}
      <RecentImports onOpen={onOpen} />
    </div>
  )
}

function RecentImports({ onOpen }: { onOpen: (importId: string) => void }) {
  const { t, formatDateTime } = useI18n()
  const recent = useInfiniteQuery(recentImportsQuery())
  const items = recent.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <CardSection title={t('web.import.history.title')} description={t('web.import.history.note')}>
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
        <>
          <DataTable label={t('web.import.history.title')} minWidth="min-w-[720px]">
            <THead>
              <Tr>
                <Th>{t('web.import.history.col.file')}</Th>
                <Th>{t('web.import.history.col.when')}</Th>
                <Th>{t('web.import.history.col.by')}</Th>
                <Th>{t('web.import.history.col.result')}</Th>
                <Th>{t('web.units.col.status')}</Th>
                <Th>
                  <span className="sr-only">{t('web.import.history.open')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((item) => (
                <Tr key={item.importId}>
                  <Td className="max-w-56 truncate">{item.fileName ?? '—'}</Td>
                  <Td className="text-secondary text-ink-muted">
                    {formatDateTime(item.createdAt)}
                  </Td>
                  <Td className="text-secondary">{item.createdBy.name ?? '—'}</Td>
                  <Td className="text-secondary">
                    {t('web.import.history.result', {
                      valid: item.counts.valid,
                      rows: item.counts.rows,
                      errors: item.counts.errors,
                    })}
                  </Td>
                  <Td>
                    <StatusTag entity="import_job" value={item.status} />
                  </Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => onOpen(item.importId)}>
                      {t('web.import.history.open')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
          {recent.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="outline"
                loading={recent.isFetchingNextPage}
                onClick={() => void recent.fetchNextPage()}
              >
                {t('web.import.more')}
              </Button>
            </div>
          )}
        </>
      )}
    </CardSection>
  )
}

function Preview({
  job,
  committing,
  canWrite,
  onOther,
  onCommit,
  commitError,
}: {
  job: ImportJob
  committing: boolean
  canWrite: boolean
  onOther: () => void
  onCommit: () => void
  commitError: string | null
}) {
  const { t, formatDate, formatDateTime, formatPhone } = useI18n()
  const { counts, issues, validRows, issuesTruncated } = job.preview
  const errors = issues.filter((issue) => issue.severity !== 'warning')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const fail = issues.find((issue) => issue.severity === 'fail')
  const [showAll, setShowAll] = useState(false)
  const columnLabel = (column: string | null) =>
    column ? t(`web.import.column.${column}` as 'web.import.column.unit_code') : ''

  if (job.status === 'committed') {
    const c = job.committed
    return (
      <Card className="flex flex-col items-start gap-4 p-8">
        <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-on-success-soft">
          <Icon name="check-circle" size="lg" weight="fill" />
        </span>
        <h2 className="text-title-2">{t('web.import.result.title')}</h2>
        {c && (
          <p className="text-body text-ink-muted">
            {t('web.import.result.body', {
              unitsCreated: c.unitsCreated,
              unitsUpdated: c.unitsUpdated,
              accountsCreated: c.accountsCreated,
              accountsLinked: c.accountsLinked,
              ownersAdded: c.ownersAdded,
            })}
          </p>
        )}
        <div className="flex gap-3">
          <Link to="/units" search={{}} className={buttonStyles({ variant: 'primary' })}>
            {t('web.import.result.cta.units')}
          </Link>
          <Button variant="outline" onClick={onOther}>
            {t('web.import.result.cta.again')}
          </Button>
        </div>
      </Card>
    )
  }

  if (job.status === 'failed' || job.status === 'expired')
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="danger">
          {job.status === 'expired'
            ? t('web.import.banner.expired')
            : (fail?.message ?? t('web.import.banner.failed'))}
        </Banner>
        <div>
          <Button variant="outline" onClick={onOther}>
            {t('web.import.action.other-file')}
          </Button>
        </div>
      </div>
    )

  const stale = commitError === 'import_stale'
  const expired = commitError === 'import_expired'
  const shown = showAll ? errors : errors.slice(0, 50)

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
            <Icon name="file-text" />
          </span>
          <div>
            <p className="text-body-strong">{job.fileName ?? '—'}</p>
            <p className="text-secondary text-ink-muted">
              {t('web.import.file.meta', {
                rows: counts.rows,
                time: formatDateTime(job.createdAt).slice(-5),
                date: formatDate(job.createdAt),
              })}
            </p>
            <p className="text-caption text-ink-muted">
              {t('web.import.expires', {
                time: formatDateTime(job.expiresAt).slice(-5),
                date: formatDate(job.expiresAt),
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" icon="download-simple" onClick={() => void downloadTemplate()}>
            {t('web.import.action.template')}
          </Button>
          <Button variant="outline" onClick={onOther}>
            {t('web.import.action.other-file')}
          </Button>
        </div>
      </Card>
      {expired && <Banner tone="danger">{t('web.import.banner.expired')}</Banner>}
      {stale && <Banner tone="danger">{t('web.import.banner.stale')}</Banner>}
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            ['valid', counts.valid, 'web.import.count.valid'],
            ['errors', counts.errors, 'web.import.count.errors'],
            ['update', counts.unitsToUpdate, 'web.import.count.update'],
          ] as const
        ).map(([key, value, label]) => (
          <Card key={key} className="p-5">
            <p className="text-display text-ink tabular-nums" data-testid={`count-${key}`}>
              {value}
            </p>
            <p className="text-secondary text-ink-muted">{t(label)}</p>
          </Card>
        ))}
      </div>
      <p className="text-secondary text-ink-muted">
        {t('web.import.count.detail', {
          created: counts.unitsToCreate,
          accountsNew: counts.accountsToCreate,
          accountsLinked: counts.accountsLinked,
          owners: counts.ownersToAdd,
          warnings: counts.warnings,
        })}
      </p>
      {errors.length === 0 ? (
        <Banner tone="success">{t('web.import.no-errors')}</Banner>
      ) : (
        <section aria-labelledby="import-errors">
          <h2 id="import-errors" className="mb-3 text-title-3">
            {t('web.import.errors.title')}
          </h2>
          <DataTable label={t('web.import.errors.title')} minWidth="min-w-[720px]">
            <THead>
              <Tr>
                <Th>{t('web.import.col.row')}</Th>
                <Th>{t('web.import.col.unit')}</Th>
                <Th>{t('web.import.col.column')}</Th>
                <Th>{t('web.import.col.message')}</Th>
              </Tr>
            </THead>
            <TBody>
              {shown.map((issue, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an issue has no id; the list never reorders
                <Tr key={`${issue.row}-${issue.code}-${index}`}>
                  <Td>{issue.row}</Td>
                  <Td>{issue.unitCode ?? '—'}</Td>
                  <Td>{columnLabel(issue.column) || '—'}</Td>
                  <Td>{issue.message}</Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
          {errors.length > shown.length && (
            <Button className="mt-3" variant="outline" onClick={() => setShowAll(true)}>
              {t('web.import.more')}
            </Button>
          )}
          {issuesTruncated && (
            <p className="mt-2 text-secondary text-ink-muted">{t('web.import.truncated')}</p>
          )}
        </section>
      )}
      {warnings.length > 0 && (
        <details className="rounded-card border border-line bg-surface p-4 shadow-raised">
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
      )}
      {validRows.length > 0 && (
        <details className="rounded-card border border-line bg-surface p-4 shadow-raised">
          <summary className="text-body-strong">
            {t('web.import.valid.title', { count: validRows.length })}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-secondary">
              <thead>
                <tr className="text-ink-muted">
                  <th className="py-2 pr-4 font-medium">{t('web.import.col.row')}</th>
                  <th className="py-2 pr-4 font-medium">{t('web.import.col.unit')}</th>
                  <th className="py-2 pr-4 font-medium">{t('web.import.col.owner')}</th>
                  <th className="py-2 pr-4 font-medium">{t('web.unit-detail.col.phone')}</th>
                  <th className="py-2 pr-4 font-medium">
                    {t('web.residents.dialog.profile.field.cccd.label')}
                  </th>
                  <th className="py-2 font-medium">{t('web.import.col.note')}</th>
                </tr>
              </thead>
              <tbody>
                {validRows.slice(0, 20).map((row) => (
                  <tr key={row.row} className="border-t border-line">
                    <td className="py-2 pr-4">{row.row}</td>
                    <td className="py-2 pr-4">{row.unitCode ?? '—'}</td>
                    <td className="py-2 pr-4">{row.ownerName ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {row.ownerPhone ? formatPhone(row.ownerPhone) : '—'}
                    </td>
                    <td className="py-2 pr-4">{row.ownerIdNumber ?? '—'}</td>
                    <td className="py-2">{row.notes.map((note) => note.message).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {errors.length > 0 && (
        <Banner tone="warning" title={t('web.import.banner.errors.title')}>
          {t('web.import.banner.errors.body', { errors: counts.errors, valid: counts.valid })}
        </Banner>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="ghost" onClick={onOther}>
          {t('web.import.cta.cancel')}
        </Button>
        {errors.length > 0 && (
          <Button
            variant="outline"
            icon="download-simple"
            onClick={() =>
              saveBlob(
                new Blob([errorsCsv(errors.slice(0, 500), columnLabel)], {
                  type: 'text/csv;charset=utf-8',
                }),
                `import-errors-${job.importId}.csv`,
              )
            }
          >
            {t('web.import.action.download-errors')}
          </Button>
        )}
        <Button
          icon="check"
          loading={committing}
          disabled={!canWrite || counts.valid === 0 || stale || expired}
          onClick={onCommit}
        >
          {t('web.import.cta', { count: counts.valid })}
        </Button>
      </div>
    </div>
  )
}
