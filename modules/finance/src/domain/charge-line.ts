import { lineAmount, type Money, money, type QtyMilli } from '@rms/shared-types'

/**
 * The rules of one charge line (DOC-21 §4.2, DOC-18 §2.2 DQ-67…DQ-74, DOC-15 §5.3), shared by the fee import and the draft
 * edits of DOC-21 §3.2 so both refuse a line for the same reason with the same code. Pure: no I/O, no clock.
 */

export type ChargeLineKind = 'fee' | 'adjustment'

/** The columns a line rule names (DOC-21 §4.2); the import reports them, a draft edit maps them to its body fields. */
export type ChargeLineColumn =
  | 'item_name'
  | 'item_name_en'
  | 'kind'
  | 'quantity'
  | 'unit_price'
  | 'amount'
  | 'note'

export interface ChargeLineIssue {
  readonly column: ChargeLineColumn
  readonly code: string
  readonly params: Readonly<Record<string, string | number>>
}

/** A line as the import reads it or a draft edit receives it, before the rules. */
export interface ChargeLineInput {
  /** Blank means `fee` (DQ-68); `phí` and `điều chỉnh` are accepted aliases. */
  readonly kind?: string | null
  readonly itemName: string
  readonly itemNameEn?: string | null
  /** A number, or text with `.` or `,` as the decimal mark; blank means 1 (DOC-21 §4.2). */
  readonly quantity?: string | number | null
  readonly unitPrice?: string | number | null
  readonly amount?: string | number | null
  readonly note?: string | null
}

/** A line that passed every rule, in the shape of `finance.charge_line`. */
export interface ChargeLine {
  readonly kind: ChargeLineKind
  readonly itemName: { readonly vi: string; readonly en?: string }
  readonly quantityMilli: QtyMilli
  readonly unitPrice: Money
  readonly amount: Money
  readonly note: string | null
}

export type ChargeLineResult =
  | { readonly ok: true; readonly line: ChargeLine }
  | { readonly ok: false; readonly issues: readonly ChargeLineIssue[] }

const MAX_QUANTITY_MILLI = 999_999_999_999n // 999,999,999.999 (DQ-69)
const MAX_UNIT_PRICE = 9_999_999_999n // DQ-70
const MAX_AMOUNT = 99_999_999_999n // DQ-71, DR-317
const MAX_ITEM_NAME = 120 // DQ-67
const MAX_NOTE = 500 // DQ-73, DQ-74

const KIND_ALIASES: Readonly<Record<string, ChargeLineKind>> = {
  fee: 'fee',
  phí: 'fee',
  adjustment: 'adjustment',
  'điều chỉnh': 'adjustment',
}

const blank = (value: string | number | null | undefined): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

/** `12,345` and `12.345` are 12.345; at most three decimals, never negative (DQ-69). `null` when the text is not one. */
export function parseQuantityMilli(value: string | number): QtyMilli | null {
  const text = (typeof value === 'number' ? String(value) : value.trim()).replace(',', '.')
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text)
  if (!match) return null
  const whole = BigInt(match[1] ?? '0')
  const fraction = BigInt((match[2] ?? '').padEnd(3, '0'))
  const milli = whole * 1000n + fraction
  return milli > MAX_QUANTITY_MILLI ? null : milli
}

/** A whole number of đồng, signed when `signed`; `null` for a fraction, a grouping mark or text (DQ-70, DQ-71). */
export function parseWholeMoney(value: string | number, signed: boolean): Money | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? money(value) : null
  const text = value.trim()
  if (!(signed ? /^-?\d{1,15}$/ : /^\d{1,15}$/).test(text)) return null
  return money(BigInt(text))
}

/** The half-up amount of a fee line, quantity in thousandths (DR-11): 12.345 × 15,000 = 185,175. */
export const halfUpAmount = (quantityMilli: QtyMilli, unitPrice: Money): Money =>
  lineAmount(quantityMilli, unitPrice)

const abs = (value: bigint): bigint => (value < 0n ? -value : value)

type Fail = (
  column: ChargeLineColumn,
  code: string,
  params?: Record<string, string | number>,
) => void

/** The params of the `amount_invalid` text, which differs for an adjustment (DOC-18 §2.2 DQ-71). */
const amountParams = (kind: ChargeLineKind | undefined) => ({
  kind: kind ?? 'fee',
  max: Number(MAX_AMOUNT),
})

const invalidAmount = (kind: ChargeLineKind): ChargeLineResult => ({
  ok: false,
  issues: [{ column: 'amount', code: 'amount_invalid', params: amountParams(kind) }],
})

/** The fields each rule reads, parsed; a field that failed its own rule is reported through `fail`. */
interface ParsedFields {
  readonly kind: ChargeLineKind | undefined
  readonly itemName: { readonly vi: string; readonly en?: string }
  readonly note: string | null
  readonly quantity: QtyMilli | null
  readonly unitPrice: Money | null
  readonly amount: Money | null
}

/** DQ-67: trimmed, runs of white space (a line break of a cell included) collapsed to one space. */
const collapse = (text: string): string => text.trim().replace(/\s+/gu, ' ')
const CONTROL = /\p{Cc}/u
const NAME_LIMITS = { min: 1, max: MAX_ITEM_NAME }

function parseNames(input: ChargeLineInput, fail: Fail): ParsedFields['itemName'] {
  const vi = collapse(input.itemName)
  const en = collapse(input.itemNameEn ?? '')
  if (vi.length < 1 || vi.length > MAX_ITEM_NAME || CONTROL.test(vi))
    fail('item_name', 'item_name_invalid', NAME_LIMITS)
  if (en.length > MAX_ITEM_NAME || CONTROL.test(en))
    fail('item_name_en', 'item_name_invalid', NAME_LIMITS)
  return en === '' ? { vi } : { vi, en }
}

function kindOf(input: ChargeLineInput): ChargeLineKind | undefined {
  const kindText = (input.kind ?? '').trim().toLowerCase()
  return kindText === '' ? 'fee' : KIND_ALIASES[kindText]
}

function parseKindAndNote(input: ChargeLineInput, fail: Fail) {
  const kind = kindOf(input)
  if (!kind) fail('kind', 'kind_invalid', { value: input.kind ?? '' })
  const note = blank(input.note) ? null : (input.note as string).trim()
  if (note !== null && note.length > MAX_NOTE) fail('note', 'note_too_long', { max: MAX_NOTE })
  if (kind === 'adjustment' && note === null) fail('note', 'adjustment_note_required')
  return { kind, note }
}

function parseNumbers(input: ChargeLineInput, fail: Fail) {
  const quantity = blank(input.quantity)
    ? 1000n
    : parseQuantityMilli(input.quantity as string | number)
  if (quantity === null) fail('quantity', 'quantity_invalid', { max: 999_999_999.999 })
  const unitPrice = blank(input.unitPrice)
    ? null
    : parseWholeMoney(input.unitPrice as string | number, false)
  if (!blank(input.unitPrice) && (unitPrice === null || unitPrice > MAX_UNIT_PRICE))
    fail('unit_price', 'unit_price_invalid', { max: Number(MAX_UNIT_PRICE) })
  const amount = blank(input.amount) ? null : parseWholeMoney(input.amount as string | number, true)
  if (!blank(input.amount) && (amount === null || abs(amount) > MAX_AMOUNT))
    fail('amount', 'amount_invalid', amountParams(kindOf(input)))
  return { quantity, unitPrice, amount }
}

/** An adjustment is typed by the Manager: quantity 1, unit price 0, any non-zero amount (DOC-21 §4.2, DR-19). */
function adjustment(fields: ParsedFields): ChargeLineResult {
  const { itemName, amount, note } = fields
  if (amount === null || amount === 0n) return invalidAmount('adjustment')
  const line = {
    kind: 'adjustment' as const,
    itemName,
    quantityMilli: 1000n,
    unitPrice: money(0),
    amount,
    note,
  }
  return { ok: true, line }
}

/** A fee line: the half-up product, or the amount alone as quantity 1 (DOC-21 §4.2, DQ-71, DQ-72). */
function feeLine(fields: ParsedFields, quantity: QtyMilli): ChargeLineResult {
  const { itemName, unitPrice, amount, note } = fields
  // A typed fee amount of 0 or below breaks DQ-71 before it can mismatch (DOC-21 §4.2: 0.001 × 500 saying 0).
  if (amount !== null && amount <= 0n) return invalidAmount('fee')
  if (unitPrice === null) {
    if (amount === null) return invalidAmount('fee')
    // Only the amount: quantity 1 and the unit price is the amount.
    return {
      ok: true,
      line: { kind: 'fee', itemName, quantityMilli: 1000n, unitPrice: amount, amount, note },
    }
  }
  const computed = halfUpAmount(quantity, unitPrice)
  if (amount !== null && amount !== computed) {
    // A mismatch is an error and is never silently recomputed (FR-01.5, DQ-72).
    const params = { expected: Number(computed), got: Number(amount) }
    return { ok: false, issues: [{ column: 'amount', code: 'amount_mismatch', params }] }
  }
  // A fee row of 0 is refused, not rounded up (DOC-21 §4.2: 0.001 × 499).
  if (computed <= 0n || computed > MAX_AMOUNT) return invalidAmount('fee')
  return {
    ok: true,
    line: { kind: 'fee', itemName, quantityMilli: quantity, unitPrice, amount: computed, note },
  }
}

/** Every rule of DQ-67…DQ-74 on one line; all the field issues are returned, not only the first. */
export function checkChargeLine(input: ChargeLineInput): ChargeLineResult {
  const issues: ChargeLineIssue[] = []
  const fail: Fail = (column, code, params = {}) => issues.push({ column, code, params })
  const fields: ParsedFields = {
    itemName: parseNames(input, fail),
    ...parseKindAndNote(input, fail),
    ...parseNumbers(input, fail),
  }
  if (issues.length > 0 || !fields.kind || fields.quantity === null) return { ok: false, issues }
  return fields.kind === 'adjustment' ? adjustment(fields) : feeLine(fields, fields.quantity)
}

/** The amount of a charge: the sum of its lines; it must stay above zero (DQ-76, `ck_charge_amount`). */
export const chargeTotal = (lines: readonly Pick<ChargeLine, 'amount'>[]): Money =>
  money(lines.reduce((sum, line) => sum + line.amount, 0n))

/** `numeric(12,3)` text of a quantity in thousandths, for the insert: 12345n → `12.345`. */
export function quantityText(quantityMilli: QtyMilli): string {
  const whole = quantityMilli / 1000n
  const fraction = (quantityMilli % 1000n).toString().padStart(3, '0')
  return `${whole}.${fraction}`
}
