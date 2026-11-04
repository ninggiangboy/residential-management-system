import { lineAmount, money } from '@rms/shared-types'
import { type ReactElement, useEffect, useRef, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button, IconButton } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/controls'
import { SelectField } from '../../components/ui/select-field'
import { TextField } from '../../components/ui/text-field'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'
import { type BatchChargeItem, type ChargeLineInput, useFeeBatchMutations } from './hooks'

/** One line as the editor holds it: text fields, so a half-typed value is never lost to parsing (DOC-66 §4). */
export interface LineDraft {
  key: string
  kind: 'fee' | 'adjustment'
  nameVi: string
  nameEn: string
  quantity: string
  unitPrice: string
  /** A typed amount: the adjustment's only number, read-only and computed for a fee line. */
  amount: string
  note: string
}

/** Field errors of a save, keyed `"<lineIndex>.<field>"` (the `lines[i].<field>` paths of E-94/E-170). */
export type LineIssues = ReadonlyMap<string, string>

const FIELD_OF_PATH: Readonly<Record<string, string>> = {
  'itemName.vi': 'nameVi',
  'itemName.en': 'nameEn',
  kind: 'kind',
  quantity: 'quantity',
  unitPrice: 'unitPrice',
  amount: 'amount',
  note: 'note',
}

/** The largest quantity the API takes (`numeric(12,3)`, DOC-14 §6). */
const MAX_QTY_MILLI = 999_999_999_999n

/** `12,345` and `12.345` are 12.345; at most three decimals, never negative (DQ-69). */
export function parseQuantityMilli(text: string): bigint | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(text.trim())
  if (!match) return null
  const milli = BigInt(match[1] ?? '0') * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'))
  return milli > MAX_QTY_MILLI ? null : milli
}

/** A whole, non-negative number of đồng; `null` for a fraction or text (DQ-70). */
export function parseWholeMoney(text: string): number | null {
  const value = text.trim()
  return /^\d{1,15}$/.test(value) ? Number(value) : null
}

/** A whole, signed amount: the only number an adjustment carries (DQ-71). */
function parseSignedMoney(text: string): number | null {
  const value = text.trim()
  return /^-?\d{1,15}$/.test(value) ? Number(value) : null
}

/** The half-up amount of a fee line, or the typed amount of an adjustment (DR-11): `null` until the fields parse. */
export function lineAmountOf(line: LineDraft): number | null {
  if (line.kind === 'adjustment') return parseSignedMoney(line.amount)
  const quantity = parseQuantityMilli(line.quantity)
  const unitPrice = parseWholeMoney(line.unitPrice)
  if (quantity === null || unitPrice === null) return null
  return Number(lineAmount(quantity, money(unitPrice)))
}

export const blankLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  kind: 'fee',
  nameVi: '',
  nameEn: '',
  quantity: '1',
  unitPrice: '',
  amount: '',
  note: '',
})

/** One line as E-93 returns it with `include=lines`. */
type ChargeLine = NonNullable<BatchChargeItem['lines']>[number]

/** Seeds the editor from the lines E-93 returned with `include=lines`. */
export function draftLines(lines: readonly ChargeLine[]): LineDraft[] {
  return lines.map((line) => ({
    key: crypto.randomUUID(),
    kind: line.kind,
    nameVi: line.itemName.vi,
    nameEn: line.itemName.en ?? '',
    quantity: line.quantity,
    unitPrice: String(line.unitPrice),
    amount: String(line.amount),
    note: line.note ?? '',
  }))
}

const itemNameOf = (line: LineDraft): ChargeLineInput['itemName'] => {
  const vi = line.nameVi.trim()
  const en = line.nameEn.trim()
  return en === '' ? { vi } : { vi, en }
}

const noteOf = (line: LineDraft): string | null =>
  line.note.trim() === '' ? null : line.note.trim()

/** A fee line: its quantity and unit price; the amount is sent too, so a mismatch is caught (DOC-21 §3.2). */
function feeBody(line: LineDraft): ChargeLineInput {
  const amount = lineAmountOf(line)
  const unitPrice = parseWholeMoney(line.unitPrice)
  return {
    kind: 'fee',
    itemName: itemNameOf(line),
    quantity: line.quantity.trim() === '' ? '1' : line.quantity.trim(),
    ...(unitPrice !== null ? { unitPrice } : {}),
    ...(amount !== null ? { amount } : {}),
    note: noteOf(line),
  }
}

/** An adjustment: its typed amount and the reason it needs (DQ-71). */
function adjustmentBody(line: LineDraft): ChargeLineInput {
  const amount = parseSignedMoney(line.amount)
  return {
    kind: 'adjustment',
    itemName: itemNameOf(line),
    ...(amount !== null ? { amount } : {}),
    note: noteOf(line),
  }
}

/** The body of E-94/E-170: a fee line sends its quantity and price, an adjustment its typed amount and note (DOC-21 §3.2). */
export function bodyOfLines(lines: readonly LineDraft[]): ChargeLineInput[] {
  return lines.map((line) => (line.kind === 'adjustment' ? adjustmentBody(line) : feeBody(line)))
}

/** The per-field sentences of a `validation_failed` answer, as `lines[i].<field>` (DOC-18 §2.2 rule codes, DOC-68 §3.7). */
export function issuesOf(details: unknown): LineIssues {
  const issues = new Map<string, string>()
  if (!Array.isArray(details)) return issues
  for (const detail of details as { path?: string; code?: string }[]) {
    const path = detail.path ?? ''
    const match = /^lines\[(\d+)\]\.(.+)$/.exec(path)
    if (!match || detail.code === undefined) continue
    const field = FIELD_OF_PATH[match[2] ?? ''] ?? match[2] ?? ''
    issues.set(`${match[1]}.${field}`, detail.code)
  }
  return issues
}

/** The sentence of a line rule code, or the server's text when the catalog has none (DOC-18 §2.2). */
export function issueText(t: ReturnType<typeof useI18n>['t'], code: string): string {
  const key = `web.fee-batch.line.error.${code}`
  return t.has(key) ? t(key) : errorText(t, { code, message: code })
}

const sr = (text: string) => <span className="sr-only">{text}</span>

/** The rows of a charge: one per line, the computed amount, "Thêm khoản" and the English-name toggle (DOC-66 §4). */
export function LineRows({
  lines,
  issues,
  showEn,
  disabled,
  onChange,
  onRemove,
  onAdd,
  onToggleEn,
}: {
  lines: readonly LineDraft[]
  issues: LineIssues
  showEn: boolean
  disabled: boolean
  onChange: (index: number, patch: Partial<LineDraft>) => void
  onRemove: (index: number) => void
  onAdd: () => void
  onToggleEn: (show: boolean) => void
}): ReactElement {
  const { t, formatMoney } = useI18n()
  const errorAt = (index: number, field: string) => {
    const code = issues.get(`${index}.${field}`)
    return code === undefined ? undefined : issueText(t, code)
  }
  const grid =
    'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_2.25rem] items-start gap-3'
  return (
    <div>
      <div
        className={`${grid} border-b border-line pb-2 text-caption text-ink-muted`}
        aria-hidden="true"
      >
        <span>{t('web.fee-batch.line.name')}</span>
        <span>{t('web.fee-batch.line.kind')}</span>
        <span>{t('web.fee-batch.line.qty')}</span>
        <span>{t('web.fee-batch.line.price')}</span>
        <span className="text-right">{t('web.fee-batch.line.amount')}</span>
        <span />
      </div>
      {lines.map((line, index) => {
        const adjustment = line.kind === 'adjustment'
        const amount = lineAmountOf(line)
        return (
          <div key={line.key} className="border-b border-line py-3 last:border-b-0">
            <div className={grid}>
              <TextField
                label={sr(t('web.fee-batch.line.name'))}
                required
                value={line.nameVi}
                disabled={disabled}
                maxLength={200}
                error={errorAt(index, 'nameVi')}
                data-testid={`line-name-${index}`}
                onChange={(event) => onChange(index, { nameVi: event.target.value })}
              />
              <SelectField
                label={sr(t('web.fee-batch.line.kind'))}
                value={line.kind}
                disabled={disabled}
                error={errorAt(index, 'kind')}
                onValueChange={(value) => onChange(index, { kind: value as LineDraft['kind'] })}
                options={[
                  { value: 'fee', label: t('web.fee-batch.line.kind.fee') },
                  { value: 'adjustment', label: t('web.fee-batch.line.kind.adjustment') },
                ]}
              />
              <TextField
                label={sr(t('web.fee-batch.line.qty'))}
                inputMode="decimal"
                value={line.quantity}
                disabled={disabled || adjustment}
                error={errorAt(index, 'quantity')}
                data-testid={`line-qty-${index}`}
                onChange={(event) => onChange(index, { quantity: event.target.value })}
              />
              <TextField
                label={sr(t('web.fee-batch.line.price'))}
                inputMode="numeric"
                suffix={t('web.fee-batch.line.unit')}
                value={line.unitPrice}
                disabled={disabled || adjustment}
                error={errorAt(index, 'unitPrice')}
                data-testid={`line-price-${index}`}
                onChange={(event) => onChange(index, { unitPrice: event.target.value })}
              />
              {adjustment ? (
                <TextField
                  label={sr(t('web.fee-batch.line.amount'))}
                  inputMode="numeric"
                  suffix={t('web.fee-batch.line.unit')}
                  value={line.amount}
                  disabled={disabled}
                  error={errorAt(index, 'amount')}
                  data-testid={`line-amount-${index}`}
                  onChange={(event) => onChange(index, { amount: event.target.value })}
                />
              ) : (
                <div
                  className="flex h-control-md items-center justify-end tabular-nums text-ink"
                  data-testid={`line-amount-${index}`}
                >
                  {amount === null ? t('common.table.empty-cell') : formatMoney(amount)}
                </div>
              )}
              <IconButton
                icon="trash"
                label={t('web.fee-batch.line.remove')}
                size="sm"
                disabled={disabled}
                data-testid={`line-remove-${index}`}
                onClick={() => onRemove(index)}
              />
            </div>
            {adjustment && (
              <TextField
                className="mt-3"
                label={t('web.fee-batch.line.note')}
                required
                value={line.note}
                disabled={disabled}
                maxLength={500}
                error={errorAt(index, 'note')}
                data-testid={`line-note-${index}`}
                onChange={(event) => onChange(index, { note: event.target.value })}
              />
            )}
            {showEn && !adjustment && (
              <TextField
                className="mt-3"
                label={t('web.fee-batch.line.en')}
                value={line.nameEn}
                disabled={disabled}
                maxLength={200}
                error={errorAt(index, 'nameEn')}
                data-testid={`line-name-en-${index}`}
                onChange={(event) => onChange(index, { nameEn: event.target.value })}
              />
            )}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={disabled}
          data-testid="line-add"
          onClick={onAdd}
        >
          {t('web.fee-batch.line.add')}
        </Button>
        <Checkbox
          checked={showEn}
          disabled={disabled}
          label={t('web.fee-batch.line.en-toggle')}
          onCheckedChange={onToggleEn}
        />
      </div>
    </div>
  )
}

/** A hook shared by both editors: the draft state, its dirty flag and the field-issue map of a failed save. */
function useLineDraft(seed: LineDraft[], onDirtyChange: (dirty: boolean) => void) {
  const initial = useRef(seed)
  const [lines, setLines] = useState<LineDraft[]>(seed)
  const [issues, setIssues] = useState<LineIssues>(new Map())
  const [banner, setBanner] = useState<string | null>(null)
  const [tableError, setTableError] = useState<string | null>(null)
  const [showEn, setShowEn] = useState(seed.some((line) => line.nameEn !== ''))
  const dirty = JSON.stringify(lines) !== JSON.stringify(initial.current)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  // The row leaves (a save, a cancel, another row): the host's guard is cleared with it.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const change = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  const remove = (index: number) => setLines((current) => current.filter((_, i) => i !== index))
  const add = () => setLines((current) => [...current, blankLine()])

  return {
    lines,
    issues,
    banner,
    tableError,
    showEn,
    dirty,
    change,
    remove,
    add,
    setShowEn,
    setIssues,
    setBanner,
    setTableError,
  }
}

/** Applies a failed save: a 409 refetches and keeps the typed form; a `validation_failed` marks its lines (DOC-66 §6). */
function useSaveFailure(
  onConflict: () => void,
  setBanner: (text: string | null) => void,
  setIssues: (issues: LineIssues) => void,
  setTableError: (text: string | null) => void,
) {
  const { t } = useI18n()
  return (thrown: unknown) => {
    const failure = apiErrorOf(thrown)
    if (failure.code === 'version_conflict') {
      onConflict()
      setBanner(t('error.version_conflict'))
      return
    }
    if (failure.code === 'charge_total_zero') {
      setTableError(t('web.fee-batch.charge.total-zero'))
      return
    }
    if (failure.code === 'validation_failed' && Array.isArray(failure.details)) {
      setIssues(issuesOf(failure.details))
      return
    }
    setBanner(errorText(t, failure))
  }
}

/** The editor of one draft charge (E-94): the lines, "Hủy" and "Lưu căn {unit}" (DOC-66 §4, UIWF-16/17). */
export function ChargeEditor({
  batchId,
  charge,
  onSaved,
  onCancel,
  onConflict,
  onDirtyChange,
}: {
  batchId: string
  charge: BatchChargeItem
  onSaved: () => void
  onCancel: () => void
  onConflict: () => void
  onDirtyChange: (dirty: boolean) => void
}): ReactElement | null {
  const { t } = useI18n()
  const canWrite = useCanWrite()
  const { saveCharge } = useFeeBatchMutations(batchId)
  const draft = useLineDraft(charge.lines ? draftLines([...charge.lines]) : [], onDirtyChange)
  const fail = useSaveFailure(onConflict, draft.setBanner, draft.setIssues, draft.setTableError)
  if (!charge.lines) return null

  const save = () => {
    draft.setBanner(null)
    draft.setTableError(null)
    draft.setIssues(new Map())
    saveCharge.mutate(
      { chargeId: charge.chargeId, version: charge.version, lines: bodyOfLines(draft.lines) },
      {
        onSuccess: () => onSaved(),
        onError: fail,
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {draft.banner && <Banner tone="warning">{draft.banner}</Banner>}
      {draft.tableError && <Banner tone="danger">{draft.tableError}</Banner>}
      <LineRows
        lines={draft.lines}
        issues={draft.issues}
        showEn={draft.showEn}
        disabled={!canWrite || saveCharge.isPending}
        onChange={draft.change}
        onRemove={draft.remove}
        onAdd={draft.add}
        onToggleEn={draft.setShowEn}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          disabled={saveCharge.isPending}
          data-testid="charge-cancel"
          onClick={onCancel}
        >
          {t('common.action.cancel')}
        </Button>
        <Button
          loading={saveCharge.isPending}
          disabled={!canWrite || draft.lines.length === 0}
          data-testid="charge-save"
          onClick={save}
        >
          {t('web.fee-batch.charge.save', { unit: charge.unitCode })}
        </Button>
      </div>
    </div>
  )
}
