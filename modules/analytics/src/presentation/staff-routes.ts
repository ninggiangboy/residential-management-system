import { type RouteSet, routePlugin, staffRoute } from '@core/http'
import { type Guards, STAFF_ROLES, staffOf } from '@rms/shared-types'
import type { Static } from '@sinclair/typebox'
import type { UsageRateLimits } from '../application/usage-rate-limits'
import type { RecordUsageEvents } from '../application/use-cases/record-usage-events'
import { refuseLargeBody, respond, takeIpBucket, UsageBatchBody } from './usage-http'

export interface StaffUsageRouteDeps {
  recordUsageEvents: RecordUsageEvents
  limits: UsageRateLimits
  guards: Guards
}

/** `POST /staff/usage-events` (E-174, DOC-104 §6.1): the batch of the staff app and the web CMS, open to every staff role. */
export function staffUsageRoutes(d: StaffUsageRouteDeps) {
  const record = async (context: { body: Static<typeof UsageBatchBody>; set: RouteSet }) => {
    const result = await d.recordUsageEvents.execute({
      audience: 'staff',
      buildingId: staffOf(context).buildingId,
      batch: context.body,
    })
    respond(context.set, result)
  }

  const meta = staffRoute(d.guards, 'usage', STAFF_ROLES, {
    endpoint: 'E-174',
    operationId: 'recordStaffUsageEvents',
    summary: 'Record the usage of the staff app and the web CMS',
    description:
      'The same batch as the resident route, for the staff app and the web CMS. Records no person: no account, role, device or IP address. Answers 204 also when every event was dropped; `X-Usage-Enabled: false` tells the client to stop sending until its next launch.',
  })
  return routePlugin({ prefix: '/staff/usage-events' }).post('/', record, {
    ...meta,
    transform: [refuseLargeBody, meta.transform, takeIpBucket(d.limits)],
    body: UsageBatchBody,
  })
}
