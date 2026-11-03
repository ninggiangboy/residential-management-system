import { type RouteInfo, type RouteSet, routePlugin, staffRoute } from '@core/http'
import { RateLimitedError } from '@core/kernel'
import { type Guards, STAFF_ROLES, staffOf } from '@rms/shared-types'
import type { StaffEventStreams } from '../application/staff-event-streams'

export interface StaffEventsRouteDeps {
  streams: StaffEventStreams
  guards: Guards
}

/** `exp` (seconds) of a bearer token the staff guard has already verified (DOC-26 §3.1); 0 when it cannot be read. */
function tokenExpiry(authorization: string | null): Date {
  const payload = authorization?.slice('Bearer '.length).split('.')[1]
  try {
    const exp = payload
      ? (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }).exp
      : 0
    return new Date((exp ?? 0) * 1000)
  } catch {
    return new Date(0)
  }
}

/**
 * E-75 `GET /staff/events` (DOC-52 §4, ADR-0024): the server-sent events stream of the web CMS. The staff guard runs once, at
 * open; the stream closes at the token's `exp` (DOC-52 §10.2), so a revoked session cannot outlive its access token. A fourth
 * stream of one account on this process is 429 `rate_limited` with `scope: sse_streams` and `Retry-After: 30` (DOC-52 §10.3).
 */
export function staffEventsRoutes(d: StaffEventsRouteDeps) {
  const open = async (context: { request: Request; set: RouteSet }) => {
    const staff = staffOf(context)
    const result = await d.streams.open({
      buildingId: staff.buildingId,
      accountId: staff.staffId,
      role: staff.role,
      sessionId: staff.sessionId,
      tokenExpiresAt: tokenExpiry(context.request.headers.get('authorization')),
      lastEventId: context.request.headers.get('last-event-id'),
    })
    if (result.rejected) throw new RateLimitedError('sse_streams', 30)
    return new Response(result.stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    })
  }

  const info: RouteInfo = {
    endpoint: 'E-75',
    operationId: 'streamStaffEvents',
    summary: 'Open the event stream of the web CMS',
    description:
      'A server-sent events stream that tells the web CMS something changed so it refetches: ids, codes and enumerated words only. Send `Last-Event-ID` to replay what a closed tab missed. The stream ends when the access token expires.',
  }
  return routePlugin({ prefix: '/staff' }).get('/events', open, {
    ...staffRoute(d.guards, 'realtime', STAFF_ROLES, info),
  })
}
