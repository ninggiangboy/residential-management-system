import { type RouteSet, routePlugin, unitRoute } from '@core/http'
import { type Guards, unitOf } from '@rms/shared-types'
import type { Static } from '@sinclair/typebox'
import type { UsageRateLimits } from '../application/usage-rate-limits'
import type { RecordUsageEvents } from '../application/use-cases/record-usage-events'
import { refuseLargeBody, respond, takeIpBucket, UsageBatchBody } from './usage-http'

export interface ResidentUsageRouteDeps {
  recordUsageEvents: RecordUsageEvents
  limits: UsageRateLimits
  guards: Guards
}

/**
 * `POST /me/usage-events` (E-173, DOC-104 §6.1): the resident app's batch. The audience is `unit: broadcast_notices`, the capability
 * that every member type holds, so it works as "any member"; the building is that of the active membership and never of the body.
 */
export function residentUsageRoutes(d: ResidentUsageRouteDeps) {
  const record = async (context: { body: Static<typeof UsageBatchBody>; set: RouteSet }) => {
    const result = await d.recordUsageEvents.execute({
      audience: 'resident',
      buildingId: unitOf(context).buildingId,
      batch: context.body,
    })
    respond(context.set, result)
  }

  const meta = unitRoute(d.guards, 'usage', 'broadcast_notices', {
    endpoint: 'E-173',
    operationId: 'recordMyUsageEvents',
    summary: 'Record the usage of the resident app',
    description:
      'One batch of the screens opened, the listed controls pressed, and when the app was opened and left. Records no person: no account, unit, device or IP address. Answers 204 also when every event was dropped; `X-Usage-Enabled: false` tells the app to stop sending until its next launch.',
  })
  return routePlugin({ prefix: '/me/usage-events' }).post('/', record, {
    ...meta,
    transform: [refuseLargeBody, meta.transform, takeIpBucket(d.limits)],
    body: UsageBatchBody,
  })
}
