import type { MessageKey } from '@rms/i18n-catalog/web'
import { type ReactElement, useEffect, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { useFeeBatchMutations } from './hooks'
import {
  blankLine,
  bodyOfLines,
  issuesOf,
  type LineDraft,
  type LineIssues,
  LineRows,
} from './line-editor'

/** The 404/409/422 codes of E-170 that name the unit; each has its own sentence (DOC-66 §6). */
const UNIT_CODE_KEY: Readonly<Record<string, MessageKey>> = {
  unit_not_found: 'web.fee-batch.error.unit_not_found',
  charge_exists: 'web.fee-batch.error.charge_exists',
  unit_without_owner: 'web.fee-batch.error.unit_without_owner',
}

/** The editor of a new charge of one unit (E-170): the same lines as an edit, in the "Chưa có khoản phí" tab (DOC-66 §4). */
export function AddChargeRow({
  batchId,
  unitCode,
  onAdded,
  onCancel,
  onDirtyChange,
}: {
  batchId: string
  unitCode: string
  onAdded: () => void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}): ReactElement {
  const { t } = useI18n()
  const canWrite = useCanWrite()
  const { addCharge } = useFeeBatchMutations(batchId)
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()])
  const [showEn, setShowEn] = useState(false)
  const [issues, setIssues] = useState<LineIssues>(new Map())
  const [banner, setBanner] = useState<string | null>(null)
  const [tableError, setTableError] = useState<string | null>(null)

  // The row leaves (a save, a cancel): the host's guard is cleared with it.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const change = (index: number, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
    onDirtyChange(true)
  }
  const remove = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index))
    onDirtyChange(true)
  }
  const add = () => {
    setLines((current) => [...current, blankLine()])
    onDirtyChange(true)
  }

  const save = () => {
    setBanner(null)
    setTableError(null)
    setIssues(new Map())
    addCharge.mutate(
      { unitCode, lines: bodyOfLines(lines) },
      {
        onSuccess: () => {
          onDirtyChange(false)
          onAdded()
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown)
          if (failure.code === 'validation_failed' && Array.isArray(failure.details)) {
            setIssues(issuesOf(failure.details))
            return
          }
          if (failure.code === 'charge_total_zero') {
            setTableError(t('web.fee-batch.charge.total-zero'))
            return
          }
          const named = UNIT_CODE_KEY[failure.code]
          if (named) {
            setBanner(t(named, { code: unitCode }))
            return
          }
          setBanner(errorText(t, failure))
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="add-charge-editor">
      {banner && <Banner tone="warning">{banner}</Banner>}
      {tableError && <Banner tone="danger">{tableError}</Banner>}
      <LineRows
        lines={lines}
        issues={issues}
        showEn={showEn}
        disabled={!canWrite || addCharge.isPending}
        onChange={change}
        onRemove={remove}
        onAdd={add}
        onToggleEn={setShowEn}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          disabled={addCharge.isPending}
          data-testid="charge-add-cancel"
          onClick={onCancel}
        >
          {t('common.action.cancel')}
        </Button>
        <Button
          loading={addCharge.isPending}
          disabled={!canWrite || lines.length === 0}
          data-testid="charge-add-save"
          onClick={save}
        >
          {t('web.fee-batch.charge.save', { unit: unitCode })}
        </Button>
      </div>
    </div>
  )
}
