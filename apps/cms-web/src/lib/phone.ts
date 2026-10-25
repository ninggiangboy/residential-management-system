/** The digits of a typed phone: `0912 345 678` → `0912345678`. */
export const digitsOf = (text: string) => text.replace(/\D/g, '')

/**
 * The E.164 digits a typed Vietnamese number stands for (`0912345678` and `84912345678` → `84912345678`), used to find the account
 * of a phone in a suffix search (DOC-65 `W-Resident-Add` §5). Another country code is compared as typed.
 */
export function nationalDigits(text: string): string {
  const digits = digitsOf(text)
  if (digits.startsWith('84')) return digits
  if (digits.startsWith('0')) return `84${digits.slice(1)}`
  return digits
}
