/**
 * The receipt total in words: DOC-34 §7.1 (PD-15, DR-295), beside the DR-71 formatters. Pure and
 * dependency-free, with no `Intl`, so the API, the web and the PDF print the same text.
 *
 * Vietnamese reads groups of three with `nghìn`, `triệu` and `tỷ`: `mười`/`mươi`, `mốt` (21),
 * `lăm` (15, 25), `linh` (105) and `không trăm` inside a group. English is lower-case words
 * with hyphenated tens and "dong". Both start with a capital and end with the currency word.
 */

const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

const EN_DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

const EN_TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]

const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]

const VI_SCALES = ['nghìn', 'triệu', 'tỷ']
const EN_SCALES = ['thousand', 'million', 'billion', 'trillion']

/** `nghìn`, `triệu`, `tỷ`, then `nghìn tỷ`, `triệu tỷ`, `tỷ tỷ` … so that any size reads correctly. */
function viScale(index: number): string {
  const base = VI_SCALES[(index - 1) % 3]!
  const ty = Math.floor((index - 1) / 3)
  return ty === 0 ? base : `${base}${' tỷ'.repeat(ty)}`
}

/** `thousand`, `million`, `billion`, `trillion`, then the same four again. */
const enScale = (index: number): string => EN_SCALES[(index - 1) % 4]!

/** A group of three digits: `sáu trăm ba mươi tám`, `không trăm linh năm`, `hai mươi mốt`. */
function viGroup(group: number, hasHigher: boolean): string {
  const hundreds = Math.floor(group / 100)
  const tens = Math.floor((group % 100) / 10)
  const units = group % 10
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${VI_DIGITS[hundreds]} trăm`)
  else if (hasHigher && (tens > 0 || units > 0)) parts.push('không trăm')
  if (tens > 1) parts.push(`${VI_DIGITS[tens]} mươi`)
  else if (tens === 1) parts.push('mười')
  else if (units > 0 && (hundreds > 0 || hasHigher)) parts.push('linh')
  if (units > 0) {
    if (tens >= 1)
      parts.push(units === 1 ? (tens > 1 ? 'mốt' : 'một') : units === 5 ? 'lăm' : VI_DIGITS[units]!)
    else parts.push(VI_DIGITS[units]!)
  }
  return parts.join(' ')
}

/** A group of three digits: `six hundred thirty-eight`, `twenty-one`, `fifteen`. */
function enGroup(group: number): string {
  const hundreds = Math.floor(group / 100)
  const tens = Math.floor((group % 100) / 10)
  const units = group % 10
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${EN_DIGITS[hundreds]} hundred`)
  if (tens === 1) parts.push(EN_TEENS[units]!)
  else if (tens > 1) parts.push(units > 0 ? `${EN_TENS[tens]}-${EN_DIGITS[units]}` : EN_TENS[tens]!)
  else if (units > 0) parts.push(EN_DIGITS[units]!)
  return parts.join(' ')
}

/**
 * `2638000` → "Hai triệu sáu trăm ba mươi tám nghìn đồng" / "Two million six hundred thirty-eight
 * thousand dong". DOC-34 §7.1 (PD-15, DR-295). The amount is an integer đồng: a fraction or a
 * negative amount throws `RangeError`.
 */
export function amountInWords(amount: bigint | number, lang: 'vi' | 'en'): string {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount))
    throw new RangeError(`Amount must be an integer, got ${amount}`)
  const value = BigInt(amount)
  if (value < 0n) throw new RangeError(`Amount must not be negative, got ${amount}`)
  if (value === 0n) return lang === 'vi' ? 'Không đồng' : 'Zero dong'

  const groups: number[] = []
  for (let rest = value; rest > 0n; rest /= 1000n) groups.push(Number(rest % 1000n))

  const segments: string[] = []
  let hasHigher = false
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i] ?? 0
    if (group === 0) continue
    const groupWords = lang === 'vi' ? viGroup(group, hasHigher) : enGroup(group)
    const scale = i === 0 ? '' : lang === 'vi' ? viScale(i) : enScale(i)
    segments.push(scale === '' ? groupWords : `${groupWords} ${scale}`)
    hasHigher = true
  }

  const words = segments.join(' ')
  const suffix = lang === 'vi' ? ' đồng' : ' dong'
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${suffix}`
}
