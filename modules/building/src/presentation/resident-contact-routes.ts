import { type RouteSet, residentRoute, routePlugin } from '@core/http'
import { UnavailableError } from '@core/kernel'
import { type Guards, residentOf } from '@rms/shared-types'
import type { BuildingApi } from '../contracts'
import { contactOf } from './public-routes'
import type { ResidentBuildings } from './resident-terms-routes'

export interface ResidentContactRouteDeps {
  buildings: Pick<BuildingApi, 'getBuilding' | 'listBuildings'>
  residentBuildings: ResidentBuildings
  guards: Guards
}

/**
 * `GET /me/contact` (E-15, DOC-51 §5): the office's contact for a signed-in resident who cannot do something themselves. The
 * building is that of the account's first active membership; an account with none gets the deployment's real building, as E-03
 * does (UC-14 E7). A token-only route, so it answers before a unit is chosen and without the latest terms (DR-143).
 */
export function residentContactRoutes(d: ResidentContactRouteDeps) {
  const contact = async (context: { set: RouteSet }) => {
    const [buildingId] = await d.residentBuildings.buildingIdsOf(residentOf(context).accountId)
    const building = buildingId
      ? await d.buildings.getBuilding(buildingId)
      : await d.buildings.listBuildings().then((rows) => rows.find((row) => !row.isDemo) ?? rows[0])
    if (!building) throw new UnavailableError()
    context.set.headers['cache-control'] = 'private, max-age=60'
    return contactOf(building)
  }

  return routePlugin({ prefix: '/me/contact' }).get(
    '/',
    contact,
    residentRoute(d.guards, 'building', {
      endpoint: 'E-15',
      operationId: 'getBuildingContact',
      summary: 'Get the building contact',
      description:
        'The manager contact for a signed-in resident who cannot do something themselves, such as changing a phone number, fixing a name, or having no unit linked.',
    }),
  )
}
