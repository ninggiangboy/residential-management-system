import { Document, Text, View } from '@react-pdf/renderer'
import type { MessageKey, Params, Translator } from '@rms/i18n-catalog'
import { createTranslator } from '@rms/i18n-catalog'
import type { MoneyCell, MoneyColumn, MoneyRow } from '@rms/pdf-assets'
import {
  CompanyHeader,
  LabelPair,
  MoneyTable,
  PageFooter,
  PageFrame,
  PDF_DOCUMENT_INFO,
  pdfStyles,
  Watermark,
} from '@rms/pdf-assets'
import { formatDate, formatMoney } from '@rms/shared-types'
import type {
  Bilingual,
  FeeNoticeInput,
  PdfChargeLine,
  PdfLanguage,
} from '../../application/pdf-renderer'

/**
 * The fee notice template of DOC-34 §6: a pure `FeeNoticeInput` → `<Document>` function (DOC-34 §2, §4.1). It
 * reads nothing (no clock, no I/O) and every label comes from the `pdf.*` catalog (DOC-68), so a test renders it
 * from a fixture alone; colours come only from the `@rms/pdf-assets` style sheet.
 */

/** A printed string and, in `both` mode, the smaller italic English line under it (DOC-34 §5, DR-71). */
interface PrintedLine {
  readonly text: string
  readonly secondary?: string
}

/** The translators and the `both`-mode rules of one document (DOC-34 §5, FR-36.1, DR-71). */
interface Phrases {
  readonly lang: PdfLanguage
  readonly primary: 'vi' | 'en'
  readonly vi: Translator
  readonly en: Translator
  readonly t: Translator
  readonly label: (key: MessageKey, params?: Params) => PrintedLine
  readonly data: (pair: Bilingual) => PrintedLine
}

/**
 * The two translators and the `both`-mode rules of DOC-34 §5: `both` prints its amounts, dates and labels in
 * `vi` and adds the smaller italic English line.
 */
function phrases(lang: PdfLanguage): Phrases {
  const vi = createTranslator('vi')
  const en = createTranslator('en')
  const t = lang === 'en' ? en : vi
  const label = (key: MessageKey, params?: Params): PrintedLine =>
    lang === 'both'
      ? { text: vi(key, params), secondary: en(key, params) }
      : { text: t(key, params) }
  const data = (pair: Bilingual): PrintedLine => {
    if (lang === 'vi') return { text: pair.vi }
    if (lang === 'en') return { text: pair.en ?? pair.vi }
    return pair.en != null && pair.en !== pair.vi
      ? { text: pair.vi, secondary: pair.en }
      : { text: pair.vi }
  }
  return { lang, primary: lang === 'en' ? 'en' : 'vi', vi, en, t, label, data }
}

/** U+2212 MINUS SIGN, printed for a negative amount as DOC-34 §6.1 shows (`−35.175 đ`). */
const MINUS = '\u2212'

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

/** `10/2026` in `vi`, `October 2026` in `en` (DOC-34 §6.1). */
function formatMonth(feeMonth: string, lang: 'vi' | 'en'): string {
  const [year = '', month = ''] = feeMonth.split('-')
  return lang === 'vi' ? `${month}/${year}` : `${MONTHS_EN[Number(month) - 1] ?? month} ${year}`
}

/** An amount as DOC-34 §5 prints it; a negative amount uses the U+2212 minus sign of §6.1. */
function formatAmount(amount: number, lang: PdfLanguage): string {
  return formatMoney(amount, lang === 'en' ? 'en' : 'vi').replace('-', MINUS)
}

/** A quantity as DOC-34 §7.2 prints it: the language decimal separator, `12,345` in `vi` (PD-14). */
function formatQuantity(quantity: string, lang: 'vi' | 'en'): string {
  return lang === 'vi' ? quantity.replace('.', ',') : quantity
}

/** The Basis cell of DOC-34 §6.1: `quantity × unit price`, the price alone when the quantity is 1, or an adjustment's note (DR-19). */
function basisText(line: PdfChargeLine, p: Phrases): string {
  if (line.kind === 'adjustment') return line.note ?? ''
  const price = formatMoney(line.unitPrice, p.primary)
  if (Number(line.quantity) === 1) return price
  return p.t('pdf.common.quantity_price', {
    quantity: formatQuantity(line.quantity, p.primary),
    unitPrice: price,
  })
}

/** A printed line flattened for a primitive that takes one string; the `both`-mode English line keeps its own row (DOC-34 §5). */
const flatten = (line: PrintedLine): string =>
  line.secondary ? `${line.text}\n${line.secondary}` : line.text

/** The header row of DOC-34 §6.1: the logo, the company block, the contact line and the building name. */
function HeaderBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const company = input.building.company
  const hotline = input.building.hotline
  const contact = [
    hotline ? p.t('pdf.common.hotline', { hotline }) : '',
    input.building.email ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <CompanyHeader
      name={flatten(p.data(company.name))}
      address={company.address ?? input.building.address}
      contactLine={contact === '' ? undefined : contact}
      buildingName={flatten(p.data(input.building.name))}
      logo={input.building.logo ?? undefined}
    />
  )
}

/** The title of DOC-34 §6.1; §6.2 prints the primary line upper case, and `both` adds the English line under it (§5). */
function titleLine(feeMonth: string, p: Phrases): PrintedLine {
  const vi = p.vi('pdf.fee_notice.title', { month: formatMonth(feeMonth, 'vi') })
  const en = p.en('pdf.fee_notice.title', { month: formatMonth(feeMonth, 'en') })
  if (p.lang === 'en') return { text: en.toUpperCase() }
  if (p.lang === 'vi') return { text: vi.toUpperCase() }
  return { text: vi.toUpperCase(), secondary: en }
}

function TitleBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const title = titleLine(props.input.batch.feeMonth, props.phrases)
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={pdfStyles.title}>{title.text}</Text>
      {title.secondary ? <Text style={pdfStyles.subtitle}>{title.secondary}</Text> : null}
    </View>
  )
}

/** One label/value cell of the information block (DOC-34 §6.1); a cell is half of the row. */
function InfoCell(props: { label: PrintedLine; value: PrintedLine }) {
  return (
    <LabelPair
      label={props.label.text}
      labelSecondary={props.label.secondary}
      value={props.value.text}
      valueSecondary={props.value.secondary}
      width="50%"
    />
  )
}

/** The 2 × 2 information block of DOC-34 §6.1: Unit · Owner · Batch · Issue date. */
function InfoBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const owner = input.unit.ownerName ?? '—'
  const batchValue = `${input.batch.code}\n${p.data(input.batch.name).text}`
  return (
    <View style={{ marginTop: 10 }}>
      <View style={pdfStyles.row}>
        <InfoCell label={p.label('pdf.common.unit')} value={{ text: input.unit.code }} />
        <InfoCell label={p.label('pdf.fee_notice.owner')} value={{ text: owner }} />
      </View>
      <View style={[pdfStyles.row, { marginTop: 6 }]}>
        <InfoCell label={p.label('pdf.common.batch')} value={{ text: batchValue }} />
        <InfoCell
          label={p.label('pdf.fee_notice.issue_date')}
          value={{ text: formatDate(input.batch.issueDate, p.primary) }}
        />
      </View>
    </View>
  )
}

function column(
  key: string,
  label: PrintedLine,
  width: string,
  align: 'left' | 'right',
): MoneyColumn {
  return { key, header: label.text, headerSecondary: label.secondary, width, align }
}

function lineRow(line: PdfChargeLine, at: number, p: Phrases): MoneyRow {
  const item = p.data(line.itemName)
  const cells: MoneyCell[] = [
    { text: item.text, secondary: item.secondary },
    { text: basisText(line, p) },
    { text: formatAmount(line.amount, p.lang) },
  ]
  return { key: `line-${at}`, cells }
}

/** The Item · Basis · Amount table of DOC-34 §6.1 with its total block. */
function LinesTable(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const total = p.label('pdf.fee_notice.total')
  return (
    <View style={{ marginTop: 8 }}>
      <View style={pdfStyles.rule} />
      <MoneyTable
        columns={[
          column('item', p.label('pdf.common.item'), '45%', 'left'),
          column('basis', p.label('pdf.fee_notice.basis'), '35%', 'left'),
          column('amount', p.label('pdf.common.amount'), '20%', 'right'),
        ]}
        rows={input.lines.map((line, at) => lineRow(line, at, p))}
        total={{
          label: total.text,
          labelSecondary: total.secondary,
          amount: formatAmount(input.total, p.lang),
        }}
      />
    </View>
  )
}

/** The due-date line of DOC-34 §6.1, right-aligned under the total as §6.2 shows. */
function DueBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const label = p.label('pdf.fee_notice.due_date')
  return (
    <View style={[pdfStyles.row, { justifyContent: 'flex-end', marginTop: 4 }]}>
      <View style={{ marginRight: 8, textAlign: 'right' }}>
        <Text style={pdfStyles.label}>{label.text}</Text>
        {label.secondary ? <Text style={pdfStyles.secondary}>{label.secondary}</Text> : null}
      </View>
      <Text style={pdfStyles.amount}>{formatDate(input.batch.dueDate, p.primary)}</Text>
    </View>
  )
}

/** The pay-at-office line of DOC-34 §6.1, whose working hours read in the document's language. */
function officeLine(workingHours: Bilingual, p: Phrases): PrintedLine {
  const vi = p.vi('pdf.fee_notice.pay_office', { workingHours: workingHours.vi })
  const en = p.en('pdf.fee_notice.pay_office', { workingHours: workingHours.en ?? workingHours.vi })
  if (p.lang === 'en') return { text: en }
  if (p.lang === 'vi') return { text: vi }
  return { text: vi, secondary: en }
}

function numbered(line: PrintedLine, at: number): PrintedLine {
  return line.secondary
    ? { text: `${at}. ${line.text}`, secondary: line.secondary }
    : { text: `${at}. ${line.text}` }
}

/** The numbered "How to pay" lines of DOC-34 §6.1: the app when the gateway is active, the office when working hours are set; neither omits the block. */
function paymentLines(input: FeeNoticeInput, p: Phrases): PrintedLine[] {
  const lines: PrintedLine[] = []
  if (input.gatewayActive) lines.push(p.label('pdf.fee_notice.pay_app'))
  if (input.building.workingHours) lines.push(officeLine(input.building.workingHours, p))
  return lines.map((line, at) => numbered(line, at + 1))
}

function PaymentBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const lines = paymentLines(input, p)
  if (lines.length === 0) return null
  const heading = p.label('pdf.fee_notice.how_to_pay')
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={pdfStyles.label}>{heading.text}</Text>
      {heading.secondary ? <Text style={pdfStyles.secondary}>{heading.secondary}</Text> : null}
      {lines.map((line) => (
        <View key={line.text} style={{ marginTop: 4 }}>
          <Text>{line.text}</Text>
          {line.secondary ? <Text style={pdfStyles.secondary}>{line.secondary}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/** The closing line of DOC-34 §6.1: the hotline clause is dropped when the building has no hotline. */
function ClosingBlock(props: { input: FeeNoticeInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const hotline = input.building.hotline
  const line = hotline
    ? p.label('pdf.fee_notice.questions', { hotline })
    : p.label('pdf.fee_notice.questions_no_hotline')
  return (
    <View style={{ marginTop: 12 }}>
      <Text>{line.text}</Text>
      {line.secondary ? <Text style={pdfStyles.secondary}>{line.secondary}</Text> : null}
    </View>
  )
}

/** The footer text of DOC-34 §5: `Trang 1/2`, `Page 1 of 2`, or both joined by `·`. */
function footerText(page: number, total: number, p: Phrases): string {
  const vi = p.vi('pdf.common.page', { page, total })
  const en = p.en('pdf.common.page', { page, total })
  if (p.lang === 'en') return en
  if (p.lang === 'vi') return vi
  return `${vi} · ${en}`
}

/** The draft mark of DOC-34 §6.1, always both languages: `BẢN NHÁP · DRAFT`. */
const draftMark = (p: Phrases): string =>
  `${p.vi('pdf.fee_notice.draft_mark')} · ${p.en('pdf.fee_notice.draft_mark')}`

/**
 * The fee notice template of DOC-34 §6 (DOC-34 §2, §4.1, PD-29): it reads no clock and sets no `creationDate`, so
 * one input gives byte-identical output, and it prints the draft mark on every page through a fixed `Watermark`.
 */
export function FeeNoticeDocument(props: { input: FeeNoticeInput }) {
  const { input } = props
  const p = phrases(input.language)
  const code = `${input.batch.code} · ${input.unit.code}`
  const company = input.building.company.name
  return (
    <Document
      title={code}
      author={p.primary === 'en' ? (company.en ?? company.vi) : company.vi}
      {...PDF_DOCUMENT_INFO}
    >
      <PageFrame
        footer={<PageFooter code={code} pageText={(page, total) => footerText(page, total, p)} />}
      >
        {input.draft ? <Watermark text={draftMark(p)} fontSize={72} /> : null}
        <HeaderBlock input={input} phrases={p} />
        <TitleBlock input={input} phrases={p} />
        <InfoBlock input={input} phrases={p} />
        <LinesTable input={input} phrases={p} />
        <DueBlock input={input} phrases={p} />
        <PaymentBlock input={input} phrases={p} />
        <ClosingBlock input={input} phrases={p} />
      </PageFrame>
    </Document>
  )
}
