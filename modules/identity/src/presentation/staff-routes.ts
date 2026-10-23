import { IdParams, type RouteSet, routePlugin, staffRoute, strictObject } from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  LIST_STAFF_SESSIONS_ROLES,
  type SessionQueries,
} from '../application/queries/session-queries'
import { GET_STAFF_ME_ROLES, type StaffQueries } from '../application/queries/staff-queries'
import { REQUEST_STEP_UP_ROLES, type RequestStepUp } from '../application/use-cases/request-step-up'
import {
  REVOKE_STAFF_SESSION_ROLES,
  type RevokeStaffSession,
} from '../application/use-cases/revoke-staff-session'

export interface StaffRouteDeps {
  requestStepUp: RequestStepUp
  revokeStaffSession: RevokeStaffSession
  staffQueries: StaffQueries
  sessionQueries: SessionQueries
  guards: Guards
}

const StepUpBody = strictObject({
  action: Type.Union([
    Type.Literal('gateway_config'),
    Type.Literal('admin_change'),
    Type.Literal('staff_email'),
  ]),
})

/** `/staff/*` of `identity` (DOC-26 §7): the profile, the sessions of the signed-in member, and the step-up code request. */
export function staffRoutes(d: StaffRouteDeps) {
  const me = (context: object) => d.staffQueries.me(staffOf(context))

  const listSessions = async (context: object) => {
    const staff = staffOf(context)
    return { items: await d.sessionQueries.listStaff(staff, staff.sessionId) }
  }

  const revokeSession = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.revokeStaffSession.execute(staffOf(context), context.params.id)
    context.set.status = 204
  }

  const requestStepUp = async (context: { body: Static<typeof StepUpBody>; set: RouteSet }) => {
    await d.requestStepUp.execute(staffOf(context), context.body.action)
    context.set.status = 204
  }

  const route = (roles: Parameters<Guards['staff']>[0]) => staffRoute(d.guards, 'staff', roles)

  return routePlugin({ prefix: '/staff' })
    .get('/me', me, route(GET_STAFF_ME_ROLES))
    .get('/sessions', listSessions, route(LIST_STAFF_SESSIONS_ROLES))
    .delete('/sessions/:id', revokeSession, {
      ...route(REVOKE_STAFF_SESSION_ROLES),
      params: IdParams,
    })
    .post('/step-up', requestStepUp, { ...route(REQUEST_STEP_UP_ROLES), body: StepUpBody })
}
