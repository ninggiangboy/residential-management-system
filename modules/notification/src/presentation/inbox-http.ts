import { describedEnum, strictObject } from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Static, Type } from '@sinclair/typebox'

/** The body of E-22 and E-34 (DOC-31 §5.1, DR-300): the token pattern is the one the table enforces. */
export const RegisterDeviceBody = strictObject({
  expoPushToken: Type.String({
    maxLength: 200,
    pattern: '^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{1,180}\\]$',
    description: 'The Expo push token the OS issued',
    examples: ['ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'],
  }),
  platform: describedEnum({ ios: 'iOS', android: 'Android' }, 'The platform of the device.'),
  appVersion: Type.String({
    maxLength: 20,
    pattern: '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$',
    description: 'The semantic version of the app',
    examples: ['1.0.3'],
  }),
})

/** The query of E-76 and E-78: keyset pages (DOC-50 §9). The limit is a string here and checked by `inboxPage`. */
export const InboxQuery = Type.Object({
  cursor: Type.Optional(Type.String({ description: 'Opaque, from `nextCursor`' })),
  limit: Type.Optional(
    Type.String({ pattern: '^[0-9]{1,4}$', description: 'Entries per page, 1…100 (default 20)' }),
  ),
})

/** `limit` 1…100 or 400 `validation_failed` with the rule `minimum` or `maximum` (DOC-31 §4.4). */
export function inboxPage(query: Static<typeof InboxQuery>): { cursor?: string; limit?: number } {
  if (query.limit === undefined) return query.cursor === undefined ? {} : { cursor: query.cursor }
  const limit = Number(query.limit)
  if (limit < 1 || limit > 100)
    throw new ValidationError([
      {
        path: 'limit',
        code: limit < 1 ? 'minimum' : 'maximum',
        message: 'limit is 1 to 100',
      },
    ])
  return query.cursor === undefined ? { limit } : { cursor: query.cursor, limit }
}

/** The body of E-77 and E-79 (DOC-31 §4.4). */
export const ReadAllBody = strictObject({
  upToId: Type.String({
    format: 'uuid',
    description: 'The id of the newest entry the client shows; a newer entry stays unread',
  }),
})
