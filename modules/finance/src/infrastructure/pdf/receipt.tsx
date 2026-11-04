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
import type { LocalDate, MemberType } from '@rms/shared-types'
import { amountInWords, formatDate, formatDateTime, formatMoney } from '@rms/shared-types'
import type {
  Bilingual,
  PdfChargeLine,
  PdfLanguage,
  PdfPaymentMethod,
  ReceiptInput,
} from '../../application/pdf-renderer'

/**
 * The receipt template of DOC-34 §7: a pure `ReceiptInput` → `<Document>` function (DOC-34 §2, §4.1). Everything
 * printed comes from the caller's frozen snapshot (DR-17), so a change of the company, logo or payer never alters an
 * old receipt; the title and the tax statement stay bilingual in every mode (DR-295) and the void copy carries the
 * `VOID` watermark of §7.1. It reads no clock, so one input gives byte-identical output (PD-29).
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
 * The two translators and the `both`-mode rules of DOC-34 §5: `both` prints its amounts, dates and labels in `vi` and
 * adds the smaller italic English line.
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

/** U+2212 MINUS SIGN, printed for a negative amount as DOC-34 §7.2 shows (`−35.175 đ`). */
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

/** `10/2026` in `vi`, `October 2026` in `en`; DOC-34 §7.1 prints `10/2026`. */
function formatMonth(feeMonth: string, lang: 'vi' | 'en'): string {
  const [year = '', month = ''] = feeMonth.split('-')
  return lang === 'vi' ? `${month}/${year}` : `${MONTHS_EN[Number(month) - 1] ?? month} ${year}`
}

/** An amount as DOC-34 §5 prints it; a negative amount uses the U+2212 minus sign of §7.2. */
function formatAmount(amount: number, lang: PdfLanguage): string {
  return formatMoney(amount, lang === 'en' ? 'en' : 'vi').replace('-', MINUS)
}

/** A quantity as DOC-34 §7.2 prints it: the language decimal separator, `12,345` in `vi` (PD-14). */
function formatQuantity(quantity: string, lang: 'vi' | 'en'): string {
  return lang === 'vi' ? quantity.replace('.', ',') : quantity
}

/** The Basis cell of DOC-34 §7.2: `quantity × unit price`, the price alone for a quantity of 1, or an adjustment's note (DR-19). */
function basisText(line: PdfChargeLine, p: Phrases): string {
  if (line.kind === 'adjustment') return line.note ?? ''
  const price = formatMoney(line.unitPrice, p.primary)
  if (Number(line.quantity) === 1) return price
  return p.t('pdf.common.quantity_price', {
    quantity: formatQuantity(line.quantity, p.primary),
    unitPrice: price,
  })
}

/** A PrintedLine flattened for a primitive that takes one string; the `both`-mode English line keeps its own row. */
const flatten = (line: PrintedLine): string =>
  line.secondary ? `${line.text}\n${line.secondary}` : line.text

/** The method labels of DOC-34 §7.1, one `pdf.receipt.method_*` key per payment source. */
const METHOD_KEY: Record<PdfPaymentMethod, MessageKey> = {
  online: 'pdf.receipt.method_online',
  cash: 'pdf.receipt.method_cash',
  bank_transfer: 'pdf.receipt.method_bank_transfer',
}

/**
 * The payer's member type of DOC-34 §7.1 ("Chủ hộ", "Thành viên", "Người thuê"). The catalog has no
 * `pdf.receipt.member_helper` key, so a helper prints as a member (the gap is reported, not filled here).
 */
const MEMBER_TYPE_KEY: Record<MemberType, MessageKey> = {
  owner: 'pdf.receipt.member_owner',
  family: 'pdf.receipt.member_member',
  tenant: 'pdf.receipt.member_tenant',
  helper: 'pdf.receipt.member_member',
}

/** The header of DOC-34 §7.1/§7.2: the logo, the company block and the building name; address and hotline print joined by ` · `. */
function HeaderBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const { company } = input
  const contact = [company.address, company.hotline].filter(Boolean).join(' · ')
  return (
    <CompanyHeader
      name={flatten(p.data(company.name))}
      contactLine={contact === '' ? undefined : contact}
      buildingName={flatten(p.data(input.building.name))}
      logo={input.logo ?? undefined}
    />
  )
}

/** The bilingual title of DOC-34 §7.1 (DR-17, DR-295): "BIÊN LAI THU TIỀN / PAYMENT RECEIPT" in every mode. */
const titleText = (p: Phrases): string =>
  `${p.vi('pdf.receipt.title')} / ${p.en('pdf.receipt.title')}`

/** "Số: BL-2610-0153 · Ngày: 09/10/2026 09:12" (DOC-34 §7.1, §7.2), the labels and the date following §5. */
function numberLine(input: ReceiptInput, p: Phrases): PrintedLine {
  const at = (t: Translator, lang: 'vi' | 'en'): string => {
    const date = formatDateTime(input.issuedAt, lang)
    return `${t('pdf.receipt.number')}: ${input.number} · ${t('pdf.receipt.date')}: ${date}`
  }
  if (p.lang === 'en') return { text: at(p.en, 'en') }
  const vi = at(p.vi, 'vi')
  return p.lang === 'vi' ? { text: vi } : { text: vi, secondary: at(p.en, 'en') }
}

/** The void line of DOC-34 §7.1, always both: "ĐÃ HỦY ngày 12/10/2026 · Voided on Oct 12, 2026". */
const voidLine = (voidedOn: LocalDate, p: Phrases): string => {
  const vi = p.vi('pdf.receipt.voided_on', { date: formatDate(voidedOn, 'vi') })
  const en = p.en('pdf.receipt.voided_on', { date: formatDate(voidedOn, 'en') })
  return `${vi} · ${en}`
}

/**
 * The `VOID` stamp of DOC-34 §7.1: the diagonal reads "VOID" in every language mode, so the English catalog value of
 * `pdf.receipt.void_stamp` is printed and no literal string is used.
 */
const voidStamp = (p: Phrases): string => p.en('pdf.receipt.void_stamp')

/** The title, number, date and — on the void copy — the void line of DOC-34 §7.1/§7.2. */
function TitleBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const number = numberLine(input, p)
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[pdfStyles.title, { textAlign: 'center' }]}>{titleText(p)}</Text>
      <Text style={[pdfStyles.subtitle, { textAlign: 'center' }]}>{number.text}</Text>
      {number.secondary ? (
        <Text style={[pdfStyles.secondary, { textAlign: 'center' }]}>{number.secondary}</Text>
      ) : null}
      {input.void ? (
        <Text style={[pdfStyles.secondary, { textAlign: 'center' }]}>
          {voidLine(input.void.voidedOn, p)}
        </Text>
      ) : null}
    </View>
  )
}

/** One label/value cell of the information block (DOC-34 §7.1); a cell is half of the row. */
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

/** The payer value of DOC-34 §7.1: the name, and in parentheses the member type when it is known. */
function payerValue(input: ReceiptInput, p: Phrases): PrintedLine {
  const name = input.payer.name ?? '—'
  const type = input.payer.memberType
  if (type === null) return { text: name }
  const label = p.label(MEMBER_TYPE_KEY[type])
  return { text: `${name} (${label.text})`, secondary: label.secondary }
}

/** The 2 × 2 information block of DOC-34 §7.1: Unit · Payer · Batch · Fee month. */
function InfoBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const batchValue = `${input.batch.code}\n${p.data(input.batch.name).text}`
  return (
    <View style={{ marginTop: 10 }}>
      <View style={pdfStyles.row}>
        <InfoCell label={p.label('pdf.common.unit')} value={{ text: input.unit.code }} />
        <InfoCell label={p.label('pdf.receipt.payer')} value={payerValue(input, p)} />
      </View>
      <View style={[pdfStyles.row, { marginTop: 6 }]}>
        <InfoCell label={p.label('pdf.common.batch')} value={{ text: batchValue }} />
        <InfoCell
          label={p.label('pdf.receipt.fee_month')}
          value={{ text: formatMonth(input.batch.feeMonth, p.primary) }}
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

/** The total in words of DOC-34 §7.1: the `vi` words in every mode, plus the English words in `en` or `both`. */
function wordsLine(amount: number, p: Phrases): PrintedLine {
  if (p.lang === 'en') return { text: amountInWords(amount, 'en') }
  const vi = amountInWords(amount, 'vi')
  return p.lang === 'vi' ? { text: vi } : { text: vi, secondary: amountInWords(amount, 'en') }
}

/** The "Bằng chữ / In words" line of DOC-34 §7.2, under the total. */
function WordsBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const label = p.label('pdf.receipt.in_words')
  const words = wordsLine(input.amount, p)
  return (
    <View style={{ marginTop: 4 }}>
      <LabelPair
        label={label.text}
        labelSecondary={label.secondary}
        value={words.text}
        valueSecondary={words.secondary}
      />
    </View>
  )
}

/** The Item · Quantity × unit price · Amount table of DOC-34 §7.1 with its total block. */
function LinesTable(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const total = p.label('pdf.receipt.total')
  return (
    <View style={{ marginTop: 8 }}>
      <View style={pdfStyles.rule} />
      <MoneyTable
        columns={[
          column('item', p.label('pdf.common.item'), '45%', 'left'),
          column('basis', p.label('pdf.receipt.quantity_price'), '35%', 'left'),
          column('amount', p.label('pdf.common.amount'), '20%', 'right'),
        ]}
        rows={input.items.map((line, at) => lineRow(line, at, p))}
        total={{
          label: total.text,
          labelSecondary: total.secondary,
          amount: formatAmount(input.amount, p.lang),
        }}
      />
      <WordsBlock input={input} phrases={p} />
    </View>
  )
}

/** The payment block of DOC-34 §7.1: Method · Reference, then Paid at, in building time. */
function PaymentBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  return (
    <View style={{ marginTop: 12 }}>
      <View style={pdfStyles.row}>
        <InfoCell label={p.label('pdf.receipt.method')} value={p.label(METHOD_KEY[input.method])} />
        <InfoCell
          label={p.label('pdf.receipt.reference')}
          value={{ text: input.reference ?? '—' }}
        />
      </View>
      <View style={[pdfStyles.row, { marginTop: 6 }]}>
        <InfoCell
          label={p.label('pdf.receipt.paid_at')}
          value={{ text: formatDateTime(input.paidAt, p.primary) }}
        />
        <View style={{ width: '50%' }} />
      </View>
    </View>
  )
}

/** The tax statement of DOC-34 §7.1, always both languages (DR-17): the receipt is not a VAT invoice. */
const statementText = (p: Phrases): string =>
  `${p.vi('pdf.receipt.statement')} / ${p.en('pdf.receipt.statement')}`

function StatementBlock(props: { phrases: Phrases }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text>{statementText(props.phrases)}</Text>
    </View>
  )
}

/** The void reason of DOC-34 §7.1, printed only when the void carries one. */
function VoidReasonBlock(props: { input: ReceiptInput; phrases: Phrases }) {
  const { input, phrases: p } = props
  const reason = input.void?.reason
  if (!reason) return null
  const label = p.label('pdf.receipt.void_reason')
  return (
    <View style={{ marginTop: 4 }}>
      <LabelPair label={label.text} labelSecondary={label.secondary} value={reason} />
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

/**
 * The receipt template of DOC-34 §7 (DOC-34 §2, §4.1, PD-29): it reads no clock and sets no `creationDate`, so one
 * input gives byte-identical output; a void copy adds the fixed `VOID` watermark on every page (PD-12).
 */
export function ReceiptDocument(props: { input: ReceiptInput }) {
  const { input } = props
  const p = phrases(input.language)
  const company = input.company.name
  return (
    <Document
      title={input.number}
      author={p.primary === 'en' ? (company.en ?? company.vi) : company.vi}
      {...PDF_DOCUMENT_INFO}
    >
      <PageFrame
        footer={
          <PageFooter code={input.number} pageText={(page, total) => footerText(page, total, p)} />
        }
      >
        {input.void ? <Watermark text={voidStamp(p)} /> : null}
        <HeaderBlock input={input} phrases={p} />
        <TitleBlock input={input} phrases={p} />
        <InfoBlock input={input} phrases={p} />
        <LinesTable input={input} phrases={p} />
        <PaymentBlock input={input} phrases={p} />
        <VoidReasonBlock input={input} phrases={p} />
        <StatementBlock phrases={p} />
      </PageFrame>
    </Document>
  )
}
