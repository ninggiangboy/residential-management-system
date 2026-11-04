import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, type ReactElement, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles } from '../../components/ui/button'
import { Dialog, FieldSkeleton, useExit } from '../../components/ui/dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { TextAreaField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { feeBatchQuery, useFeeBatchMutations } from './hooks'

/** The reason bounds of E-96 (DOC-21 §3.5). */
const REASON_MIN = 5
const REASON_MAX = 500

/** The rule sentence of a `validation_failed` on the reason (`reason_too_short` / `reason_too_long`, DOC-42 §5.1). */
function reasonRuleOf(
  details: unknown,
  t: ReturnType<typeof useI18n>['t'],
  path: string,
): string | undefined {
  if (!Array.isArray(details)) return undefined
  const rule = (details as { path?: string; code?: string; message?: string }[]).find(
    (detail) => detail.path === path && detail.code?.startsWith('reason_'),
  )
  if (!rule?.code) return undefined
  return errorText(
    t,
    { code: rule.code, message: rule.message ?? '' },
    { min: REASON_MIN, max: REASON_MAX },
  )
}

/** DOC-66 `W-Fee-Recall`; opened with `dialog=recall` on `/fees/$batchId`. The host clears `dialog` in `onClose`. */
export function FeeRecallDialog({
  open,
  batchId,
  onClose,
}: {
  open: boolean
  batchId: string
  onClose: () => void
}): ReactElement | null {
  if (!open) return null
  // The panel mounts with the dialog, so `useExit` plays its leave motion before the host clears `dialog=recall` (DR-304).
  return <FeeRecallForm batchId={batchId} onClose={onClose} />
}

/** The form itself: the reason, the early warning (E-91 `counts.paid`) and the 409 result panel (DOC-66 §4, §6). */
function FeeRecallForm({
  batchId,
  onClose,
}: {
  batchId: string
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const batch = useQuery(feeBatchQuery(batchId))
  const { recall } = useFeeBatchMutations(batchId)
  const { open, close } = useExit(onClose)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  // The `paidCount` of a 409 `batch_has_payments`; the early warning uses E-91 `counts.paid` until then (DOC-66 §4).
  const [blockedCount, setBlockedCount] = useState<number | null>(null)
  const data = batch.data
  const paidCount = blockedCount ?? (data && data.counts.paid > 0 ? data.counts.paid : null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!data) return
    setFieldError(null)
    setBanner(null)
    const trimmed = reason.trim()
    if (trimmed.length < REASON_MIN) {
      setFieldError(t('error.reason_too_short', { min: REASON_MIN }))
      return
    }
    if (trimmed.length > REASON_MAX) {
      setFieldError(t('error.reason_too_long', { max: REASON_MAX }))
      return
    }
    recall.mutate(
      { version: data.version, reason: trimmed },
      {
        onSuccess: (result) => {
          toast.success(t('web.fee-recall.done', { code: result.code, count: result.chargeCount }))
          close()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          // Nothing changed: the panel names the paid charges and never offers to recall the rest (DR-97, UIWF-45).
          if (failure.code === 'batch_has_payments') {
            const details = failure.details as { paidCount?: number } | undefined
            setBlockedCount(Number(details?.paidCount ?? 0))
            void batch.refetch()
            return
          }
          // The batch moved under the dialog: refetch so it re-evaluates; a money action never offers an overwrite (DR-310).
          if (failure.code === 'version_conflict') {
            void batch.refetch()
            setBanner(t('web.fee-recall.conflict'))
            return
          }
          if (failure.code === 'invalid_transition') {
            void batch.refetch()
            setBanner(t('web.fee-recall.not-published'))
            return
          }
          const rule = reasonRuleOf(failure.details, t, 'reason')
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
        title={t('web.fee-recall.title', { code: '' })}
        dismissible={false}
      >
        <div className="flex flex-col gap-4 py-2" aria-hidden="true">
          <Skeleton className="h-16 w-full" />
          <FieldSkeleton />
        </div>
      </Dialog>
    )

  const blocked = paidCount !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('web.fee-recall.title', { code: data.code })}
      dismissible={!recall.isPending}
      footer={
        blocked ? (
          <>
            <Link
              to="/fees/$batchId"
              params={{ batchId }}
              search={{ view: 'all' }}
              className={buttonStyles({})}
              data-testid="fee-recall-view-paid"
            >
              {t('web.fee-recall.blocked.view', { count: paidCount })}
            </Link>
            <Button variant="ghost" onClick={close} data-testid="fee-recall-close">
              {t('common.action.close')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={recall.isPending}>
              {t('common.action.cancel')}
            </Button>
            <Button
              type="submit"
              form="fee-recall-form"
              variant="danger"
              loading={recall.isPending}
              data-testid="fee-recall-submit"
            >
              {t('web.fee-recall.submit')}
            </Button>
          </>
        )
      }
    >
      {blocked ? (
        <div className="py-2" data-testid="fee-recall-blocked">
          <Banner tone="warning" title={t('web.fee-recall.blocked.title')}>
            <div className="flex flex-col gap-1.5">
              <p>{t('web.fee-recall.blocked.body', { count: paidCount })}</p>
              <p>{t('web.fee-recall.blocked.hint')}</p>
            </div>
          </Banner>
        </div>
      ) : (
        <form
          id="fee-recall-form"
          onSubmit={submit}
          className="flex flex-col gap-4 py-2"
          noValidate
        >
          {banner && <Banner tone="danger">{banner}</Banner>}
          <p className="text-body text-ink" data-testid="fee-recall-body">
            {t('web.fee-recall.body', { count: data.counts.open })}
          </p>
          <TextAreaField
            label={t('web.fee-recall.reason')}
            required
            rows={3}
            maxLength={REASON_MAX}
            placeholder={t('web.fee-recall.reason.placeholder')}
            hint={t('web.fee-recall.reason.counter', { count: reason.length, max: REASON_MAX })}
            error={fieldError ?? undefined}
            value={reason}
            data-testid="fee-recall-reason"
            onChange={(event) => {
              setReason(event.target.value)
              if (fieldError) setFieldError(null)
            }}
          />
        </form>
      )}
    </Dialog>
  )
}
