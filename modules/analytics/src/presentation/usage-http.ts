import { requestContext } from '@core/context'
import { bucketIp, describedEnum, type RouteSet, strictObject } from '@core/http'
import { PayloadTooLargeError } from '@core/kernel'
import {
  USAGE_AGE_MAX_MS,
  USAGE_BATCH_MAX_BYTES,
  USAGE_BATCH_MAX_EVENTS,
  USAGE_DURATION_MAX_SEC,
  USAGE_NAME_MAX,
} from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
import type { UsageRateLimits } from '../application/usage-rate-limits'
import type { RecordUsageEventsResult } from '../application/use-cases/record-usage-events'

/** The body of E-173 and E-174 (DOC-104 §6.2, DOC-51 §10A): the same for both, and an unknown key anywhere is 400. */
export const UsageBatchBody = strictObject({
  app: describedEnum(
    { resident: 'The resident app', staff: 'The staff app', web: 'The web CMS' },
    'The app that reports. A label the client states; it is not checked against the token.',
  ),
  appVersion: Type.String({
    pattern: '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$',
    maxLength: 14,
    description: 'The version of the app, digits only, for example `1.0.3`',
  }),
  platform: describedEnum(
    { ios: 'iOS', android: 'Android', web: 'A web browser' },
    'The platform the app runs on.',
  ),
  sessionId: Type.String({
    format: 'uuid',
    description:
      'A UUID v4 that the client made in memory at launch; renewed after 30 minutes in the background. It identifies no person',
  }),
  events: Type.Array(
    strictObject({
      event: describedEnum(
        {
          screen_view: 'A screen was shown to a signed-in user',
          tap: 'A listed control was pressed',
          app_open: 'The app came to the foreground',
          app_close: 'The app left the foreground',
        },
        'The kind of event.',
      ),
      name: Type.String({
        maxLength: USAGE_NAME_MAX,
        description:
          'A screen id (`screen_view`), `<Screen>.<control>` (`tap`), `Launch` or `Resume` (`app_open`), `Background` (`app_close`). A name outside the lists is dropped, not refused',
      }),
      ageMs: Type.Integer({
        minimum: 0,
        maximum: USAGE_AGE_MAX_MS,
        description: 'Milliseconds between the event and the moment the batch is sent',
      }),
      durationSec: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: USAGE_DURATION_MAX_SEC,
          description:
            'Required on `app_close`, refused on any other event: the seconds of the foreground stretch that it closes',
        }),
      ),
    }),
    {
      minItems: 1,
      maxItems: USAGE_BATCH_MAX_EVENTS,
      description:
        'The events of the batch, oldest first: 1 to 50. The client keeps them in memory and sends them when the app leaves the foreground',
    },
  ),
})

/**
 * Before the body is read: the declared length decides, so an oversized batch is a bare 413 and never a list of 400 findings
 * (DOC-104 §6.1 step 1).
 */
export const refuseLargeBody = ({ request }: { request: Request }) => {
  if (Number(request.headers.get('content-length') ?? 0) > USAGE_BATCH_MAX_BYTES)
    throw new PayloadTooLargeError()
}

/** Step 4 of DOC-104 §6.1: the IP bucket is spent after the credential is proved and before the body is validated. */
export const takeIpBucket = (limits: UsageRateLimits) => async () => {
  await limits.takeIp(bucketIp(requestContext.get()?.ip ?? 'unknown'))
}

/** 204 with no body, `no-store`; `X-Usage-Enabled: false` tells the client to stop until its next launch (DOC-104 §5.4). */
export function respond(set: RouteSet, result: RecordUsageEventsResult): void {
  set.status = 204
  set.headers['cache-control'] = 'no-store'
  if (!result.enabled) set.headers['x-usage-enabled'] = 'false'
}
