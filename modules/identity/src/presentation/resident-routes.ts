import { IdParams, type RouteInfo, type RouteSet, residentRoute, routePlugin } from '@core/http'
import { type Guards, residentOf } from '@rms/shared-types'
import type { Static } from '@sinclair/typebox'
import type { ResidentQueries } from '../application/queries/resident-queries'
import type { SessionQueries } from '../application/queries/session-queries'
import type { RevokeResidentSession } from '../application/use-cases/revoke-resident-session'

export interface ResidentRouteDeps {
  revokeResidentSession: RevokeResidentSession
  residentQueries: ResidentQueries
  sessionQueries: SessionQueries
  guards: Guards
}

/**
 * `/me/*` of `identity` (DOC-26 §7): the account and the sessions of the signed-in resident. These are token-only routes (the
 * `resident` guard and no unit, DOC-12 §5.3): a resident reaches them before choosing a unit and without accepting the latest
 * terms, so the terms gate (inside `unit(capability)`) never meets them (DOC-35 §9.2, DR-143).
 */
export function residentRoutes(d: ResidentRouteDeps) {
  const me = (context: object) => d.residentQueries.me(residentOf(context))

  const listSessions = async (context: object) => ({
    items: await d.sessionQueries.listResident(residentOf(context)),
  })

  const revokeSession = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.revokeResidentSession.execute(residentOf(context), context.params.id)
    context.set.status = 204
  }

  const route = (info: RouteInfo) => residentRoute(d.guards, 'resident', info)

  return routePlugin({ prefix: '/me' })
    .get('/', me, route({ endpoint: 'E-13', operationId: 'getMe' }))
    .get('/sessions', listSessions, route({ endpoint: 'E-20', operationId: 'listMySessions' }))
    .delete('/sessions/:id', revokeSession, {
      ...route({ endpoint: 'E-21', operationId: 'revokeMySession' }),
      params: IdParams,
    })
}
