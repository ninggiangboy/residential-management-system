import { PasswordWeakError } from './errors'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** NFC before hashing, so the same password typed on two keyboards matches (DOC-26 §4.2). Never trimmed. */
export const normalizePassword = (plain: string): string => plain.normalize('NFC')

/** 8 to 128 characters counted after normalization, with at least one letter and one digit (FR-13.5). */
export function isAcceptablePassword(plain: string): boolean {
  const length = [...normalizePassword(plain)].length
  return (
    length >= PASSWORD_MIN_LENGTH &&
    length <= PASSWORD_MAX_LENGTH &&
    /\p{L}/u.test(plain) &&
    /\p{Nd}/u.test(plain)
  )
}

/** Returns the normalized password, or throws 400 `validation_failed` with the rule `password_weak`. */
export function assertPasswordRule(plain: string): string {
  if (!isAcceptablePassword(plain)) throw new PasswordWeakError()
  return normalizePassword(plain)
}
