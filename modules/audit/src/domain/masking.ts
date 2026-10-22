import type { AuditChange, AuditValue, MaskKind } from '../contracts'
import { MASKED } from '../contracts'
import { UnmaskedAuditFieldError } from './errors'

/**
 * Masking by field class (DOC-35 §3.4, §7). A secret, a CCCD number, a date of birth, a full name and a free-text note are
 * recorded as `[masked]`; a phone and an email in their own masked shape, so the row still tells two values apart a little.
 */

/** Countries whose calling code has one digit, then two; every other code has three (ITU E.164 codes are prefix-free). */
const ONE_DIGIT_CODES = new Set(['1', '7'])
const TWO_DIGIT_CODES = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(
    ' ',
  ),
)

const BULLET = '•'

function callingCodeLength(digits: string): number {
  if (ONE_DIGIT_CODES.has(digits.slice(0, 1))) return 1
  if (TWO_DIGIT_CODES.has(digits.slice(0, 2))) return 2
  return 3
}

/** `+84901234567` → `+84•••••567`: country code, five bullets, last three digits (fixed length, so the length is not revealed). */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  const last = digits.slice(-3)
  if (!value.trim().startsWith('+') || digits.length < 8) return `${BULLET.repeat(5)}${last}`
  return `+${digits.slice(0, callingCodeLength(digits))}${BULLET.repeat(5)}${last}`
}

/** `le@example.com` → `l•••@example.com`: first character, three bullets, domain. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at < 1) return MASKED
  return `${value.slice(0, 1)}${BULLET.repeat(3)}${value.slice(at)}`
}

function maskValue(kind: MaskKind, value: AuditValue): AuditValue {
  if (value === null) return null
  switch (kind) {
    case 'phone':
      return maskPhone(String(value))
    case 'email':
      return maskEmail(String(value))
    default:
      return MASKED
  }
}

/** Applies the masks a use case declared, field by field. A field it did not declare is left for `assertMasked` to judge. */
export function applyMasks(
  changes: readonly AuditChange[],
  masks: Readonly<Record<string, MaskKind>> = {},
): AuditChange[] {
  return changes.map((change) => {
    const kind = masks[change.field]
    return kind
      ? { ...change, before: maskValue(kind, change.before), after: maskValue(kind, change.after) }
      : change
  })
}

/**
 * The global deny-list of field names (DOC-35 §3.4, §7.3): the last segment of the path, lower case, without separators. A field
 * on it must reach `record` masked; the check is the second line of defence behind the masks a use case declares.
 */
const FULLY_MASKED = new Set([
  'secret',
  'secrets',
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'apikey',
  'checksumkey',
  'stepupcode',
  'otp',
  'cccd',
  'cccdenc',
  'dateofbirth',
  'fullname',
  'displayname',
  'payername',
  'note',
])
const PHONE_FIELDS = new Set(['phone', 'loginphone'])
const EMAIL_FIELDS = new Set(['email'])

const MASKED_PHONE = /^(\+\d{1,3})?•{5}\d{3}$/
const MASKED_EMAIL = /^[^@]•{3}@[^@]+$/

const leaf = (field: string) =>
  (field.split('.').pop() ?? field).toLowerCase().replace(/[^a-z0-9]/g, '')

function isSafe(field: string, value: AuditValue): boolean {
  if (value === null) return true
  const name = leaf(field)
  if (FULLY_MASKED.has(name)) return value === MASKED
  if (PHONE_FIELDS.has(name)) return typeof value === 'string' && MASKED_PHONE.test(value)
  if (EMAIL_FIELDS.has(name)) return typeof value === 'string' && MASKED_EMAIL.test(value)
  return true
}

/** Throws `UnmaskedAuditFieldError` for the first change of a deny-listed field that carries a plain value. */
export function assertMasked(changes: readonly AuditChange[]): void {
  for (const change of changes)
    if (!isSafe(change.field, change.before) || !isSafe(change.field, change.after))
      throw new UnmaskedAuditFieldError(change.field)
}
