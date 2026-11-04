import { ValidationError, VersionConflictError } from '@core/kernel'
import { staffOf } from '@rms/shared-types'

/** The key of an `Idempotency-Key` belongs to the staff account (DOC-50 §8.3). */
export const staffAccount = (context: object) => ({
  kind: 'staff' as const,
  id: staffOf(context).staffId as string,
})

export const quoted = (value: string | number) => `"${value}"`

/** `If-Match: "3"` → `3`; a header that is not a whole number cannot match any version (409). Absent is `undefined` (428). */
export function versionOf(header: string | null): number | undefined {
  if (header === null) return undefined
  const match = /^"?(\d+)"?$/.exec(header.trim())
  if (!match) throw new VersionConflictError()
  return Number(match[1])
}

/** The opaque cursor of DOC-50 §10: the key of the last row of the page. */
export const encodeCursor = (key: Record<string, string>) =>
  Buffer.from(JSON.stringify(key)).toString('base64url')

/** 400 `invalid_cursor` when the text does not decode to the keys the list was written with. */
export function decodeCursor<K extends string>(
  cursor: string,
  keys: readonly K[],
): Record<K, string> {
  try {
    const found = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      K,
      unknown
    >
    if (!keys.every((key) => typeof found[key] === 'string')) throw new Error('bad cursor')
    return found as Record<K, string>
  } catch {
    throw new ValidationError([], 'invalid_cursor', 'The cursor is not valid')
  }
}

/** A cursor key that is a date; 400 `invalid_cursor` when it is not one. */
export function cursorDate(text: string): Date {
  const date = new Date(text)
  if (Number.isNaN(date.getTime()))
    throw new ValidationError([], 'invalid_cursor', 'The cursor is not valid')
  return date
}

/** A query parameter that is a whole number within bounds, or a 400 `validation_failed` naming it. */
export function wholeParam(
  path: string,
  text: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max)
    throw new ValidationError([
      { path, code: value < min ? 'minimum' : 'maximum', message: `${min} to ${max}` },
    ])
  return value
}
