import {
  describedEnum,
  IdParams,
  type RouteInfo,
  type RouteSet,
  residentRoute,
  routePlugin,
  strictObject,
} from '@core/http'
import { type Guards, residentOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { ResidentQueries } from '../application/queries/resident-queries'
import type { SessionQueries } from '../application/queries/session-queries'
import type { RevokeResidentSession } from '../application/use-cases/revoke-resident-session'
import type { UpdateResidentMe } from '../application/use-cases/update-resident-me'

export interface ResidentRouteDeps {
  revokeResidentSession: RevokeResidentSession
  updateResidentMe: UpdateResidentMe
  residentQueries: ResidentQueries
  sessionQueries: SessionQueries
  guards: Guards
}

/** At least one key is checked by the use case; unknown keys are refused, so `displayName` and `phone` are 400 (UIRQ-04). */
const UpdateMeBody = strictObject({
  language: Type.Optional(
    describedEnum({ vi: 'Vietnamese', en: 'English' }, 'The interface language.'),
  ),
  pushEnabled: Type.Optional(
    Type.Boolean({ description: 'Whether push notifications are on for this account' }),
  ),
})

/**
 * `/me/*` of `identity` (DOC-26 §7): the account and the sessions of the signed-in resident. These are token-only routes (the
 * `resident` guard and no unit, DOC-12 §5.3): a resident reaches them before choosing a unit and without accepting the latest
 * terms, so the terms gate (inside `unit(capability)`) never meets them (DOC-35 §9.2, DR-143).
 */
export function residentRoutes(d: ResidentRouteDeps) {
  const me = (context: object) => d.residentQueries.me(residentOf(context))

  const updateMe = async (context: { body: Static<typeof UpdateMeBody>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.updateResidentMe.execute(residentOf(context), context.body)
  }

  const listSessions = async (context: object) => ({
    items: await d.sessionQueries.listResident(residentOf(context)),
  })

  const revokeSession = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.revokeResidentSession.execute(residentOf(context), context.params.id)
    context.set.status = 204
  }

  const route = (info: RouteInfo) => residentRoute(d.guards, 'resident', info)

  return routePlugin({ prefix: '/me' })
    .get(
      '/',
      me,
      route({
        endpoint: 'E-13',
        operationId: 'getMe',
        summary: 'Get the signed-in resident',
        description:
          'The account of the signed-in resident and their active memberships. Called at app start, after a unit switch and when the app returns to the foreground.',
      }),
    )
    .patch('/', updateMe, {
      ...route({
        endpoint: 'E-14',
        operationId: 'updateMe',
        summary: 'Update the signed-in resident',
        description:
          'Changes the language, the push notification toggle or the avatar. The phone and the name are changed by the building manager, not here.',
      }),
      body: UpdateMeBody,
    })
    .get(
      '/sessions',
      listSessions,
      route({
        endpoint: 'E-20',
        operationId: 'listMySessions',
        summary: 'List my sessions',
        description: 'The live sessions of the signed-in resident, with the current one marked.',
      }),
    )
    .delete('/sessions/:id', revokeSession, {
      ...route({
        endpoint: 'E-21',
        operationId: 'revokeMySession',
        summary: 'Revoke one of my sessions',
        description:
          'Ends one of the resident sessions, or the current one, which equals a sign-out.',
      }),
      params: IdParams,
    })
}
