import { ValidationError } from '@core/kernel'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The opaque cursor of an inbox page: the id of the last item, base64url (DOC-31 §4.4, DOC-50 §9). */
export const encodeInboxCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url')

/** A cursor that cannot be decoded is 400 `invalid_cursor` (DOC-42 §5). */
export function decodeInboxCursor(cursor: string): string {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const id = (value as { id?: unknown } | null)?.id
    if (typeof id === 'string' && UUID.test(id)) return id
  } catch {
    // falls through to the error below
  }
  throw new ValidationError(
    [{ path: 'cursor', code: 'invalid_cursor', message: 'Invalid cursor' }],
    'invalid_cursor',
  )
}
