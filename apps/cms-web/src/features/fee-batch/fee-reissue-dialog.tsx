import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactElement, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog, FieldSkeleton, useExit } from '../../components/ui/dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { TextField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { day } from '../../lib/day'
import { errorText, useI18n } from '../../lib/i18n'
import { batchChargesQuery, feeBatchQuery, useFeeBatchMutations } from './hooks'

/** E-93's page size for the single-voided list; the dialog names the first 5 and counts the rest (DOC-66 §4). */
const SINGLE_LIMIT = 200
const SHOW_MAX = 5

/** The rule sentence of a `validation_failed` on the due date (DOC-42 §5.1). */
function dueDateRuleOf(details: unknown, t: ReturnType<typeof useI18n>['t']): string | undefined {
  if (!Array.isArray(details)) return undefined
  const rule = (details as { path?: string; code?: string; message?: string }[]).find(
    (detail) => detail.path === 'dueDate',
  )
  if (!rule?.code) return undefined
  return errorText(t, { code: rule.code, message: rule.message ?? '' })
}

/** DOC-66 `W-Fee-Reissue`; opened with `dialog=reissue` on `/fees/$batchId`. It navigates to the new draft itself. */
export function FeeReissueDialog({
  open,
  batchId,
  onClose,
}: {
  open: boolean
  batchId: string
  onClose: () => void
}): ReactElement | null {
  if (!open) return null
  // The panel mounts with the dialog, so `useExit` plays its leave motion before the host clears `dialog=reissue` (DR-304).
  return <FeeReissueForm batchId={batchId} onClose={onClose} />
}

/** The preview of the copy, the due date and E-98 (DOC-66 §4, §6). The dialog never edits lines (DR-20). */
function FeeReissueForm({
  batchId,
  onClose,
}: {
  batchId: string
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const batch = useQuery(feeBatchQuery(batchId))
  const singles = useQuery(
    batchChargesQuery(batchId, {
      view: 'all',
      status: 'void',
      voidKind: 'single',
      limit: SINGLE_LIMIT,
    }),
  )
  const { reissue } = useFeeBatchMutations(batchId)
  const { open, close } = useExit(onClose)
  const data = batch.data
  const [dueDate, setDueDate] = useState(data ? day(data.dueDate) : '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  // The due date opens on the recalled batch's, not on the last thing typed (DOC-54 §17.9).
  const batchDueDate = data?.dueDate
  useEffect(() => {
    if (batchDueDate === undefined) return
    setDueDate(day(batchDueDate))
    setFieldError(null)
    setBanner(null)
  }, [batchDueDate])

  const singleItems = singles.data?.items ?? []
  const singleCount = singleItems.length
  // The single-voided charges are not copied, so what is copied is the rest of the batch's void charges (DOC-66 §4).
  const copied = Math.max(0, (data?.counts.void ?? 0) - singleCount)
  const ready = data !== undefined && singles.data !== undefined
  const shown = singleItems.slice(0, SHOW_MAX).map((item) => item.unitCode)
  const more = singleCount - shown.length
  const unitsText =
    more > 0
      ? `${shown.join(', ')} ${t('web.fee-reissue.skipped.more', { count: more })}`
      : shown.join(', ')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!data) return
    setFieldError(null)
    setBanner(null)
    if (dueDate === '') {
      setFieldError(t('error.required'))
      return
    }
    reissue.mutate(
      { dueDate },
      {
        onSuccess: (result) => {
          toast.success(t('web.fee-reissue.done', { code: result.code, oldCode: data.code }))
          void navigate({
            to: '/fees/$batchId',
            params: { batchId: result.batchId },
            search: { view: 'all' },
          })
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          // The batch is not recalled any more: refetch so the page re-lays, and name the state (DOC-66 §6).
          if (failure.code === 'invalid_transition') {
            void batch.refetch()
            setBanner(errorText(t, failure))
            return
          }
          const rule = dueDateRuleOf(failure.details, t)
          if (rule) setFieldError(rule)
          else setBanner(errorText(t, failure))
        },
      },
    )
  }

  if (!data)
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => !next && close()}
        title={t('web.fee-reissue.title', { code: '' })}
        dismissible={false}
      >
        <div className="flex flex-col gap-4 py-2" aria-hidden="true">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-5 w-56" />
          <FieldSkeleton />
        </div>
      </Dialog>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.fee-reissue.title', { code: data.code })}
      dismissible={!reissue.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={reissue.isPending}>
            {t('common.action.close')}
          </Button>
          <Button
            type="submit"
            form="fee-reissue-form"
            loading={reissue.isPending}
            data-testid="fee-reissue-submit"
          >
            {t('web.fee-reissue.submit')}
          </Button>
        </>
      }
    >
      <form id="fee-reissue-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {banner && <Banner tone="danger">{banner}</Banner>}
        <div className="flex flex-col gap-2" data-testid="fee-reissue-preview">
          <p className="text-body text-ink">{t('web.fee-reissue.intro')}</p>
          {ready ? (
            <ul className="list-disc pl-5 text-secondary text-ink">
              <li data-testid="fee-reissue-copied">
                {t('web.fee-reissue.copied', { count: copied })}
              </li>
              {singleCount > 0 && (
                <li data-testid="fee-reissue-skipped">
                  {t('web.fee-reissue.skipped', { count: singleCount, units: unitsText })}
                </li>
              )}
              <li>{t('web.fee-reissue.code')}</li>
            </ul>
          ) : (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-5 w-72" />
              <Skeleton className="h-5 w-56" />
            </div>
          )}
        </div>
        <TextField
          type="date"
          label={t('web.fee-reissue.due')}
          required
          value={dueDate}
          error={fieldError ?? undefined}
          data-testid="fee-reissue-due"
          onChange={(event) => {
            setDueDate(event.target.value)
            if (fieldError) setFieldError(null)
          }}
        />
        <p className="text-secondary text-ink-muted" data-testid="fee-reissue-month">
          {t('web.fee-reissue.month', {
            month: Number(day(data.feeMonth).slice(5, 7)),
            year: day(data.feeMonth).slice(0, 4),
          })}
        </p>
        <p className="text-secondary text-ink-muted">{t('web.fee-reissue.note')}</p>
      </form>
    </Dialog>
  )
}
