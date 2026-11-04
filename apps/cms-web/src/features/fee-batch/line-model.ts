import { lineAmount, money } from '@rms/shared-types'
import type { BatchChargeItem, ChargeLineInput } from './hooks'

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
