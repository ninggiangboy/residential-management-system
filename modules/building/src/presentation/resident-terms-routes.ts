import { requestContext } from '@core/context'
import { type RouteInfo, type RouteSet, residentRoute, routePlugin, strictObject } from '@core/http'
import { NotFoundError } from '@core/kernel'
import { type Guards, residentOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { BuildingQueries } from '../application/queries/building-queries'
import type { AcceptTerms } from '../application/use-cases/accept-terms'

/** The buildings an account belongs to, from `residency`: the composition root binds it (DOC-12 §4.4, DOC-35 §9.3). */
export interface ResidentBuildings {
  buildingIdsOf(accountId: string): Promise<string[]>
}

export interface ResidentTermsRouteDeps {
  queries: BuildingQueries
  acceptTerms: AcceptTerms
  residentBuildings: ResidentBuildings
  guards: Guards
}

const AcceptBody = strictObject({
  versionIds: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 10 }),
})

/** `en` when the caller asks for it and the version has an English text; Vietnamese otherwise (DR-71). */
const wantsEnglish = (header: string | null) =>
  header?.trim().toLowerCase().startsWith('en') ?? false

/**
 * `GET /me/terms` and `POST /me/terms` (E-16, E-17; DOC-35 §9.3). Token-only routes: a resident reaches them before choosing a
 * unit and without having accepted the latest terms, so the gate inside `unit(capability)` never meets them (DR-143). The
 * building comes from the account's memberships, not from the request; with one building per deployment (DR-115) there is one.
 */
export function residentTermsRoutes(d: ResidentTermsRouteDeps) {
  const list = async (context: { request: Request; set: RouteSet }) => {
    const { accountId } = residentOf(context)
    const english = wantsEnglish(context.request.headers.get('accept-language'))
    context.set.headers['cache-control'] = 'no-store'
    const items = []
    for (const buildingId of await d.residentBuildings.buildingIdsOf(accountId))
      for (const row of await d.queries.termsOf(accountId, buildingId))
        items.push({
          versionId: row.id,
          kind: row.kind,
          version: row.version,
          accepted: row.accepted,
          text: english ? (row.text.en ?? row.text.vi) : row.text.vi,
        })
    return { items }
  }

  const accept = async (context: {
    request: Request
    body: Static<typeof AcceptBody>
    set: RouteSet
  }) => {
    const { accountId } = residentOf(context)
    const [buildingId] = await d.residentBuildings.buildingIdsOf(accountId)
    if (!buildingId) throw new NotFoundError()
    await d.acceptTerms.execute({
      accountId,
      buildingId,
      versionIds: context.body.versionIds,
      ip: requestContext.get()?.ip ?? null,
      appVersion: context.request.headers.get('x-app-version'),
    })
    context.set.status = 204
  }

  const route = (info: RouteInfo) => residentRoute(d.guards, 'building', info)

  return routePlugin({ prefix: '/me/terms' })
    .get('/', list, route({ endpoint: 'E-16', operationId: 'getMyTerms' }))
    .post('/', accept, {
      ...route({ endpoint: 'E-17', operationId: 'acceptTerms' }),
      body: AcceptBody,
    })
}
