import { routePlugin, strictObject } from '@core/http'
import { type Guards, residentOf } from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
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
 * The audience of a token-only resident route: the `resident` guard and no unit (DOC-12 §5.3). A resident reaches these before
 * choosing a unit and without accepting the latest terms, so the terms gate (inside `unit(capability)`) never meets them
 * (DOC-35 §9.2, DR-143).
 */
const audience = { detail: { tags: ['resident'], 'x-audience': { kind: 'resident' } } }

/** `/me/*` of `identity` (DOC-26 §7): the account and the sessions of the signed-in resident. */
export function residentRoutes(d: ResidentRouteDeps) {
  return routePlugin({ prefix: '/me' })
    .get('/', (context) => d.residentQueries.me(residentOf(context)), {
      ...d.guards.resident(),
      ...audience,
    })
    .get(
      '/sessions',
      async (context) => ({ items: await d.sessionQueries.listResident(residentOf(context)) }),
      { ...d.guards.resident(), ...audience },
    )
    .delete(
      '/sessions/:id',
      async (context) => {
        await d.revokeResidentSession.execute(residentOf(context), context.params.id)
        context.set.status = 204
      },
      {
        ...d.guards.resident(),
        params: strictObject({ id: Type.String({ format: 'uuid' }) }),
        ...audience,
      },
    )
}
