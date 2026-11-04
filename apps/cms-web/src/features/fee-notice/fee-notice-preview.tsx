import {
  createTranslator,
  loadWebLanguage,
  type MessageKey,
  type Params,
  type Translator,
} from '@rms/i18n-catalog/web'
import { formatDate, formatMoney } from '@rms/shared-types'
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { day } from '../../lib/day'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import type { BuildingDocument } from '../building/model'
import type { BatchChargeItem, FeeBatchView, FeeNoticeLanguage } from '../fee-batch/hooks'

type ChargeLine = NonNullable<BatchChargeItem['lines']>[number]
type Bilingual = { vi: string; en?: string | null }

/** A printed string and, in `both` mode, the smaller italic English line under it (DOC-34 §5, DR-71). */
interface NoticeLine {
  text: string
  secondary?: string
}

/** The translators and the `both`-mode rules of one notice (DOC-34 §5, FR-36.1): `both` prints the `vi` line and adds the English one. */
interface Phrases {
  primary: 'vi' | 'en'
  vi: Translator
  en: Translator | null
  t: (key: MessageKey, params?: Params) => string
  line: (key: MessageKey, params?: Params) => NoticeLine
  data: (pair: Bilingual) => NoticeLine
}

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** U+2212 MINUS SIGN, printed for a negative amount as DOC-34 §6.1 shows (`−35.175 đ`). */
const MINUS = '\u2212'

/** `10/2026` in `vi`, `October 2026` in `en` (DOC-34 §6.1). */
function formatMonth(feeMonth: string | Date, lang: 'vi' | 'en'): string {
  const [year = '', month = ''] = day(feeMonth).split('-')
  return lang === 'vi' ? `${month}/${year}` : `${MONTHS_EN[Number(month) - 1] ?? month} ${year}`
}

/** A quantity as DOC-34 §7.2 prints it: the language decimal separator, `12,345` in `vi` (PD-14). */
const formatQuantity = (quantity: string, lang: 'vi' | 'en') =>
  lang === 'vi' ? quantity.replace('.', ',') : quantity

/** An amount as DOC-34 §5 prints it; a negative amount uses the U+2212 minus sign of §6.1. */
const formatAmount = (value: number, lang: 'vi' | 'en') =>
  formatMoney(value, lang).replace('-', MINUS)

/**
 * Whether the English catalog is already in memory (DR-308): `createTranslator('en')` throws while `loadWebLanguage('en')` has
 * not resolved, so it is a safe probe that the notice does not flash the Vietnamese words of an English notice for a frame.
 */
function englishLoaded(): boolean {
  try {
    createTranslator('en')
    return true
  } catch {
    return false
  }
}

/**
 * The two translators of one notice (`vi` is always in memory, English loads on demand, DR-308). The lines inside the preview
 * are the words of the PDF (DOC-34 §6) held as `web.fee-notice.preview.*` keys, because the web bundle carries only the `web.*`
 * and shared families (DR-179).
 */
function usePhrases(lang: FeeNoticeLanguage): Phrases {
  const [enReady, setEnReady] = useState(englishLoaded)
  useEffect(() => {
    if (lang === 'vi' || enReady) return
    let alive = true
    void loadWebLanguage('en').then(
      () => {
        if (alive) setEnReady(true)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [lang, enReady])

  return useMemo<Phrases>(() => {
    const vi = createTranslator('vi')
    const en = enReady ? createTranslator('en') : null
    const primary: 'vi' | 'en' = lang === 'en' ? 'en' : 'vi'
    const t = (key: MessageKey, params?: Params) =>
      (primary === 'en' ? (en ?? vi) : vi)(key, params)
    const line = (key: MessageKey, params?: Params): NoticeLine =>
      lang === 'both' && en
        ? { text: vi(key, params), secondary: en(key, params) }
        : { text: t(key, params) }
    const data = (pair: Bilingual): NoticeLine => {
      if (lang === 'vi') return { text: pair.vi }
      if (lang === 'en') return { text: pair.en ?? pair.vi }
      return pair.en != null && pair.en !== pair.vi
        ? { text: pair.vi, secondary: pair.en }
        : { text: pair.vi }
    }
    return { primary, vi, en, t, line, data }
  }, [lang, enReady])
}

/** The title of DOC-34 §6.1; §6.2 prints the primary line upper case, and `both` adds the English line under it (§5). */
function titleLine(feeMonth: string | Date, lang: FeeNoticeLanguage, p: Phrases): NoticeLine {
  const viText = p.vi('web.fee-notice.preview.title', { month: formatMonth(feeMonth, 'vi') })
  const enText = (p.en ?? p.vi)('web.fee-notice.preview.title', {
    month: formatMonth(feeMonth, 'en'),
  })
  if (lang === 'en') return { text: enText.toUpperCase() }
  if (lang === 'vi') return { text: viText.toUpperCase() }
  return { text: viText.toUpperCase(), secondary: enText }
}

/** The pay-at-office line of DOC-34 §6.1, whose working hours read in the notice's language. */
function officeLine(workingHours: Bilingual, lang: FeeNoticeLanguage, p: Phrases): NoticeLine {
  const viText = p.vi('web.fee-notice.preview.pay-office', { workingHours: workingHours.vi })
  const enText = (p.en ?? p.vi)('web.fee-notice.preview.pay-office', {
    workingHours: workingHours.en ?? workingHours.vi,
  })
  if (lang === 'en') return { text: enText }
  if (lang === 'vi') return { text: viText }
  return { text: viText, secondary: enText }
}

/** The Basis cell of DOC-34 §6.1: `quantity × unit price`, the price alone when the quantity is 1, or an adjustment's note (DR-19). */
function basisText(line: ChargeLine, p: Phrases): string {
  if (line.kind === 'adjustment') return line.note ?? ''
  const price = formatMoney(line.unitPrice, p.primary)
  if (Number(line.quantity) === 1) return price
  return p.t('web.fee-notice.preview.quantity-price', {
    quantity: formatQuantity(line.quantity, p.primary),
    unitPrice: price,
  })
}

/** A printed line: the primary text and, in `both` mode, the smaller muted line under it. */
function LineText({ line, className }: { line: NoticeLine; className?: string }): ReactElement {
  return (
    <span className={className}>
      {line.text}
      {line.secondary ? (
        <span className="block text-caption text-ink-muted italic">{line.secondary}</span>
      ) : null}
    </span>
  )
}

function InfoCell({ label, value }: { label: NoticeLine; value: NoticeLine }): ReactElement {
  return (
    <div className="min-w-0">
      <LineText line={label} className="block text-caption text-ink-muted" />
      <LineText line={value} className="block text-body-strong" />
    </div>
  )
}

function NoticeTh({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn('py-1.5 pr-3 align-bottom text-caption font-medium text-ink-muted', className)}
    >
      {children}
    </th>
  )
}

function NoticeTd({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('py-2 pr-3', className)}>{children}</td>
}

/** The logo, the company block, the contact line and the building name (DOC-34 §6.1). */
function PreviewHeader({
  building,
  p,
}: {
  building: BuildingDocument['building'] | undefined
  p: Phrases
}): ReactElement {
  const company = building?.company
  const address = company?.address ?? building?.address ?? ''
  const contact = [
    building?.hotline ? p.t('web.fee-notice.preview.hotline', { hotline: building.hotline }) : '',
    building?.email ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line pb-3">
      <div className="flex min-w-0 items-start gap-3">
        {building?.logoUrl ? (
          <img src={building.logoUrl} alt="" className="h-12 w-12 rounded-control object-contain" />
        ) : null}
        <div className="min-w-0">
          {company ? (
            <LineText line={p.data(company.name)} className="block text-body-strong" />
          ) : (
            <Skeleton className="h-4 w-40" />
          )}
          {address ? <p className="text-caption text-ink-muted">{address}</p> : null}
          {contact ? <p className="text-caption text-ink-muted">{contact}</p> : null}
        </div>
      </div>
      {building ? (
        <LineText line={p.data(building.name)} className="max-w-48 text-right text-body-strong" />
      ) : null}
    </header>
  )
}

/** The 2 × 2 block of DOC-34 §6.1: Unit · Owner · Batch · Issue date. */
function PreviewInfo({
  batch,
  charge,
  issueDate,
  p,
}: {
  batch: FeeBatchView
  charge: BatchChargeItem
  issueDate: string
  p: Phrases
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      <InfoCell label={p.line('web.fee-notice.preview.unit')} value={{ text: charge.unitCode }} />
      <InfoCell
        label={p.line('web.fee-notice.preview.owner')}
        value={{ text: charge.ownerName ?? p.t('common.table.empty-cell') }}
      />
      <InfoCell
        label={p.line('web.fee-notice.preview.batch')}
        value={{ text: batch.code, secondary: p.data(batch.name).text }}
      />
      <InfoCell label={p.line('web.fee-notice.preview.issue-date')} value={{ text: issueDate }} />
    </div>
  )
}

/** The Item · Basis · Amount table of DOC-34 §6.1. */
function PreviewTable({ lines, p }: { lines: readonly ChargeLine[]; p: Phrases }): ReactElement {
  return (
    <table className="w-full border-t border-line">
      <thead>
        <tr>
          <NoticeTh>
            <LineText line={p.line('web.fee-notice.preview.item')} />
          </NoticeTh>
          <NoticeTh>
            <LineText line={p.line('web.fee-notice.preview.basis')} />
          </NoticeTh>
          <NoticeTh className="text-right">
            <LineText line={p.line('web.fee-notice.preview.amount')} />
          </NoticeTh>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.position} className="border-t border-line/60 align-top">
            <NoticeTd>
              <LineText line={p.data(line.itemName)} />
            </NoticeTd>
            <NoticeTd className="text-ink-muted">{basisText(line, p)}</NoticeTd>
            <NoticeTd className="text-right tabular-nums">
              {formatAmount(line.amount, p.primary)}
            </NoticeTd>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PreviewTotal({ total, p }: { total: number; p: Phrases }): ReactElement {
  return (
    <div className="flex items-center justify-end gap-4">
      <LineText
        line={p.line('web.fee-notice.preview.total')}
        className="text-label text-ink-muted"
      />
      <span className="text-body-strong tabular-nums">{formatAmount(total, p.primary)}</span>
    </div>
  )
}

function PreviewDue({ dueDate, p }: { dueDate: string | Date; p: Phrases }): ReactElement {
  return (
    <div className="flex items-center justify-end gap-4">
      <LineText
        line={p.line('web.fee-notice.preview.due-date')}
        className="text-label text-ink-muted"
      />
      <span className="tabular-nums">{formatDate(dueDate, p.primary)}</span>
    </div>
  )
}

/** The numbered "How to pay" lines of DOC-34 §6.1; neither line means the block is omitted. */
function PreviewPayment({
  payLines,
  p,
}: {
  payLines: readonly NoticeLine[]
  p: Phrases
}): ReactElement | null {
  if (payLines.length === 0) return null
  return (
    <div>
      <LineText
        line={p.line('web.fee-notice.preview.how-to-pay')}
        className="text-label text-ink-muted"
      />
      <ol className="mt-1 flex flex-col gap-1">
        {payLines.map((line, index) => (
          <li key={line.text} className="flex gap-1">
            <span className="tabular-nums">{index + 1}.</span>
            <LineText line={line} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The diagonal "BẢN NHÁP · DRAFT" of DOC-34 §6.1, shown only for a draft batch. */
function DraftMark({ children }: { children: ReactNode }): ReactElement {
  return (
    <span
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      aria-hidden="true"
    >
      <span
        className="motion-fade -rotate-[30deg] text-display font-bold tracking-wider text-danger/15"
        data-testid="draft-mark"
      >
        {children}
      </span>
    </span>
  )
}

/** The card frame while the shown charge loads: the preview's shape in placeholder bars (DOC-66 §7). */
function PreviewSkeleton(): ReactElement {
  return (
    <Card
      className="relative mx-auto aspect-[210/297] w-full max-w-[820px] overflow-hidden"
      data-testid="notice-preview-loading"
    >
      <div className="flex h-full flex-col gap-5 p-10" aria-hidden="true">
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="h-12 w-52" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-6 w-64" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((cell) => (
            <Skeleton key={cell} className="h-5 w-40" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="ml-auto h-5 w-48" />
      </div>
    </Card>
  )
}

/**
 * The A4 paper of `W-Fee-Notice` (DOC-66 §4): the notice built in HTML from E-91 and E-93, in `vi`, `en` or `both`, with the draft
 * mark of DOC-34 §6.1. It mirrors the render of DOC-34 §6, which is the source of the words and of the two "how to pay" switches.
 */
export function FeeNoticePreview({
  batch,
  charge,
  loading,
  lang,
  settings,
  gatewayActive,
}: {
  batch: FeeBatchView
  charge: BatchChargeItem | undefined
  loading: boolean
  lang: FeeNoticeLanguage
  settings: BuildingDocument | undefined
  gatewayActive: boolean
}): ReactElement {
  const { t } = useI18n()
  const p = usePhrases(lang)

  if (loading && !charge) return <PreviewSkeleton />
  if (!charge)
    return (
      <Card className="mx-auto flex aspect-[210/297] w-full max-w-[820px] items-center justify-center p-10">
        <p className="text-body text-ink-muted" data-testid="notice-preview-empty">
          {t('web.fee-notice.unit.not-found')}
        </p>
      </Card>
    )

  const building = settings?.building
  const title = titleLine(batch.feeMonth, lang, p)
  const payLines: NoticeLine[] = []
  if (gatewayActive) payLines.push(p.line('web.fee-notice.preview.pay-app'))
  if (building?.workingHours) payLines.push(officeLine(building.workingHours, lang, p))
  const closing = building?.hotline
    ? p.line('web.fee-notice.preview.questions', { hotline: building.hotline })
    : p.line('web.fee-notice.preview.questions-no-hotline')
  const issueDate = formatDate(batch.publishedAt ?? new Date(), p.primary)

  return (
    <Card className="relative mx-auto aspect-[210/297] w-full max-w-[820px] overflow-hidden">
      {batch.status === 'draft' && <DraftMark>{t('web.fee-notice.draft-mark')}</DraftMark>}
      <div
        className="flex h-full flex-col gap-4 overflow-hidden p-10 text-body text-ink"
        data-testid="notice-preview"
      >
        <PreviewHeader building={building} p={p} />

        <div>
          <p className="text-title-3 tracking-wide uppercase">{title.text}</p>
          {title.secondary ? (
            <p className="text-secondary text-ink-muted">{title.secondary}</p>
          ) : null}
        </div>

        <PreviewInfo batch={batch} charge={charge} issueDate={issueDate} p={p} />
        <PreviewTable lines={charge.lines ?? []} p={p} />
        <PreviewTotal total={charge.amount} p={p} />
        <PreviewDue dueDate={batch.dueDate} p={p} />
        <PreviewPayment payLines={payLines} p={p} />

        <p className="mt-auto text-caption text-ink-muted">
          <LineText line={closing} />
        </p>
      </div>
    </Card>
  )
}
