/**
 * Which strategies of DOC-27 §11.1 run for a typed text. `q` is normalised once (Unicode NFC, trimmed, inner spaces collapsed); then
 * every strategy whose condition holds runs, and a text can start more than one (`A-15` is a code prefix and a name fragment).
 */
export interface LookupPlan {
  /** The text as normalised. */
  q: string
  /** Unit code prefix: at least 2 characters. */
  unitCode: string | null
  /** Resident name: the folded text has at least 3 characters and is not only digits and separators. */
  name: string | null
  /** Resident phone: only digits, spaces, `+`, `.` and `-`, with 4 to 15 digits once the leading `0` is dropped (FR-18.5). */
  phoneSuffix: string | null
}

const MIN_CODE = 2
const MIN_NAME = 3
const MIN_DIGITS = 4
/** No E.164 number has more digits, and `IdentityApi` refuses a longer fragment. */
const MAX_DIGITS = 15
const PHONE_TEXT = /^[\d\s+.-]+$/

export const normalizeQuery = (q: string): string => q.normalize('NFC').trim().replace(/\s+/g, ' ')

/** Lower case with the diacritics removed and `đ` written `d`: what the name index holds (DR-41). */
export const foldText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd')

export function planLookup(raw: string): LookupPlan {
  const q = normalizeQuery(raw)
  const folded = foldText(q)
  const digits = q.replace(/\D/g, '')
  const phone = PHONE_TEXT.test(q) ? digits.replace(/^0/, '') : ''
  return {
    q,
    unitCode: [...q].length >= MIN_CODE ? q : null,
    name: [...folded].length >= MIN_NAME && !PHONE_TEXT.test(q) ? q : null,
    phoneSuffix: phone.length >= MIN_DIGITS && phone.length <= MAX_DIGITS ? phone : null,
  }
}
