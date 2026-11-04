import type { MessageKey } from '@rms/i18n-catalog/web'
import { type ReactElement, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type FeeBatchView, useFeeBatchMutations } from './hooks'

const pad = (value: number) => String(value).padStart(2, '0')
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The same checks E-95 makes, as inline lines before the press; the server stays the arbiter (DOC-66 §6, UIWF-18). */
function checksOf(counts: FeeBatchView['counts'], total: number, dueDate: string): MessageKey[] {
  const checks: MessageKey[] = []
  if (counts.charges === 0) checks.push('error.no_charges')
  else if (total === 0) checks.push('error.charge_total_zero')
  if (dueDate < today()) checks.push('error.due_date_in_past')
  return checks
}

/** The units E-95 names when a charge totals zero (`details[].path` is the unit code, DOC-21 §3.3). */
function zeroUnitsOf(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return (details as { path?: string; code?: string }[])
    .filter((detail) => detail.code === 'charge_total_zero')
    .map((detail) => detail.path ?? '')
    .filter((code) => code !== '')
}

/** "Phát hành đợt phí": the summary, the checks and E-95 under the batch `If-Match` (DOC-66 §6). */
export function PublishDialog({
  open,
  batch,
  onClose,
  onPublished,
  onConflict,
}: {
  open: boolean
  batch: FeeBatchView
  onClose: () => void
  onPublished: () => void
  onConflict: () => void
}): ReactElement {
  const { t, formatMoney, formatDate } = useI18n()
  const { publish } = useFeeBatchMutations(batch.id)
  const checks = checksOf(batch.counts, batch.total, batch.dueDate)
  const [banner, setBanner] = useState<string | null>(null)

  const confirm = () => {
    setBanner(null)
    publish.mutate(batch.version, {
      onSuccess: () => {
        toast.success(
          t('web.fee-batch.publish.toast', { code: batch.code, units: batch.counts.charges }),
        )
        onPublished()
      },
      onError: (thrown) => {
        const failure = apiErrorOf(thrown)
        onConflict()
        // Published or discarded by someone else: the page reloads, no dialog stays on a stale state (UIWF-19).
        if (failure.code === 'invalid_transition' || failure.code === 'not_found') {
          onClose()
          return
        }
        const zeroUnits = zeroUnitsOf(failure.details)
        setBanner(
          zeroUnits.length > 0
            ? t('web.fee-batch.publish.units-zero', { units: zeroUnits.join(', ') })
            : errorText(t, failure),
        )
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('web.fee-batch.publish.title', { code: batch.code })}
      dismissible={!publish.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={publish.isPending}>
            {t('common.action.cancel')}
          </Button>
          <Button
            loading={publish.isPending}
            disabled={checks.length > 0}
            data-testid="publish-confirm"
            onClick={confirm}
          >
            {t('web.fee-batch.action.publish')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        {banner && <Banner tone="danger">{banner}</Banner>}
        <p className="text-body text-ink" data-testid="publish-summary">
          {t('web.fee-batch.publish.summary', {
            units: batch.counts.charges,
            lines: batch.counts.lines,
            total: formatMoney(batch.total),
          })}
        </p>
        <p className="text-secondary text-ink-muted">
          {t('web.fee-batch.meta', {
            month: Number(batch.feeMonth.slice(5, 7)),
            year: batch.feeMonth.slice(0, 4),
            date: formatDate(batch.dueDate),
          })}
        </p>
        <p className="text-secondary text-ink-muted">
          {t('web.fee-batch.publish.body', { units: batch.counts.charges })}
        </p>
        {checks.length > 0 && (
          <div data-testid="publish-checks">
            <Banner tone="warning" title={t('web.fee-batch.publish.checks')}>
              <ul className="list-disc pl-4">
                {checks.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </Banner>
          </div>
        )}
      </div>
    </Dialog>
  )
}
