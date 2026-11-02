import { ValidationError } from '@core/kernel'
import type { LocalDate } from '@rms/shared-types'

/** Crockford base 32 without I, L, O and U (DR-27): `TT` + up to 7 characters. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RADIX = 32n
/** 32^7 − 1: the largest order code whose transfer content is 9 characters (DOC-15 §4, DR-27). */
export const MAX_ORDER_CODE = 34_359_738_367n
/** The first value of `finance.order_code_seq` (DOC-15 §4, DR-27). */
export const MIN_ORDER_CODE = 1_000_000n

const PERIOD = /^(?:\d{4}|\d{6})$/
const CONTENT = /^TT([0-9A-HJKMNP-TV-Z]{1,7})$/

/** A period, a count or an order code the caller built wrongly (DOC-14 §10, DR-27). */
export class InvalidDocumentCodeError extends ValidationError {
  constructor(path: string, rule: string, message = `invalid ${path}`) {
    super([{ path, code: rule, message }])
  }
}

const assertPeriod = (period: string): void => {
  if (!PERIOD.test(period)) throw new InvalidDocumentCodeError('period', 'pattern')
}

const assertCount = (n: number): void => {
  if (!Number.isInteger(n) || n < 1) throw new InvalidDocumentCodeError('n', 'minimum')
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** `BL-YYMM-NNNN`, minimum width 4: the 10,000th is `BL-2610-10000` (DOC-14 §10). */
export function receiptNumber(period: string, n: number): string {
  assertPeriod(period)
  assertCount(n)
  return `BL-${period}-${pad(n, 4)}`
}

/** `PH-YYMM-NN`, minimum width 2 (DOC-14 §10). */
export function batchCode(period: string, n: number): string {
  assertPeriod(period)
  assertCount(n)
  return `PH-${period}-${pad(n, 2)}`
}

/** `TT-YYMMDD-NNNN`, minimum width 4 (DOC-14 §10). */
export function intentCode(period: string, n: number): string {
  assertPeriod(period)
  assertCount(n)
  return `TT-${period}-${pad(n, 4)}`
}

/** `YYMM` of a building day: the receipt period is the issue month in building time (DR-10). */
export function monthPeriod(localDate: LocalDate): string {
  return `${localDate.slice(2, 4)}${localDate.slice(5, 7)}`
}

/** `YYMMDD` of a building day: the intent period (DOC-14 §10). */
export function dayPeriod(localDate: LocalDate): string {
  return `${localDate.slice(2, 4)}${localDate.slice(5, 7)}${localDate.slice(8, 10)}`
}

/** `TT` + Crockford base 32 of the order code, upper case, no padding (DR-27, DOC-15 §4). */
export function transferContent(orderCode: bigint | number): string {
  if (typeof orderCode === 'number' && !Number.isInteger(orderCode))
    throw new InvalidDocumentCodeError('orderCode', 'type')
  const value = typeof orderCode === 'number' ? BigInt(orderCode) : orderCode
  if (value < MIN_ORDER_CODE) throw new InvalidDocumentCodeError('orderCode', 'minimum')
  if (value > MAX_ORDER_CODE) throw new InvalidDocumentCodeError('orderCode', 'maximum')
  let rest = value
  let digits = ''
  while (rest > 0n) {
    digits = `${ALPHABET.charAt(Number(rest % RADIX))}${digits}`
    rest /= RADIX
  }
  return `TT${digits}`
}

/** The reverse of `transferContent`; a non-canonical or out-of-range content is refused (DR-27). */
export function orderCodeFromContent(text: string): bigint {
  const body = CONTENT.exec(text)?.[1]
  if (!body) throw new InvalidDocumentCodeError('text', 'pattern')
  let value = 0n
  for (const char of body) value = value * RADIX + BigInt(ALPHABET.indexOf(char))
  if (value < MIN_ORDER_CODE || value > MAX_ORDER_CODE)
    throw new InvalidDocumentCodeError('text', 'pattern')
  if (transferContent(value) !== text) throw new InvalidDocumentCodeError('text', 'pattern')
  return value
}
