import { describedEnum, strictObject } from '@core/http'
import { Type } from '@sinclair/typebox'

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

/** The query of E-76 and E-78: keyset pages (DOC-50 §9). */
export const InboxQuery = Type.Object({
  cursor: Type.Optional(Type.String({ description: 'Opaque, from `nextCursor`' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
})

/** The body of E-77 and E-79 (DOC-31 §4.4). */
export const ReadAllBody = strictObject({
  upToId: Type.String({
    format: 'uuid',
    description: 'The id of the newest entry the client shows; a newer entry stays unread',
  }),
})
