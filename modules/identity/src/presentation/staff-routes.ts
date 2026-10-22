import { routePlugin, strictObject } from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
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

const audience = (roles: readonly string[]) => ({
  detail: { tags: ['staff'], 'x-audience': { kind: 'staff', roles } },
})

/** `/staff/*` of `identity` (DOC-26 §7): the profile, the sessions of the signed-in member, and the step-up code request. */
export function staffRoutes(d: StaffRouteDeps) {
  return routePlugin({ prefix: '/staff' })
    .get('/me', (context) => d.staffQueries.me(staffOf(context)), {
      ...d.guards.staff(GET_STAFF_ME_ROLES),
      ...audience(GET_STAFF_ME_ROLES),
    })
    .get(
      '/sessions',
      async (context) => {
        const staff = staffOf(context)
        return { items: await d.sessionQueries.listStaff(staff, staff.sessionId) }
      },
      { ...d.guards.staff(LIST_STAFF_SESSIONS_ROLES), ...audience(LIST_STAFF_SESSIONS_ROLES) },
    )
    .delete(
      '/sessions/:id',
      async (context) => {
        await d.revokeStaffSession.execute(staffOf(context), context.params.id)
        context.set.status = 204
      },
      {
        ...d.guards.staff(REVOKE_STAFF_SESSION_ROLES),
        params: strictObject({ id: Type.String({ format: 'uuid' }) }),
        ...audience(REVOKE_STAFF_SESSION_ROLES),
      },
    )
    .post(
      '/step-up',
      async (context) => {
        await d.requestStepUp.execute(staffOf(context), context.body.action)
        context.set.status = 204
      },
      {
        ...d.guards.staff(REQUEST_STEP_UP_ROLES),
        body: strictObject({
          action: Type.Union([
            Type.Literal('gateway_config'),
            Type.Literal('admin_change'),
            Type.Literal('staff_email'),
          ]),
        }),
        ...audience(REQUEST_STEP_UP_ROLES),
      },
    )
}
