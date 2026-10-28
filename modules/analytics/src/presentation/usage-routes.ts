import { routePlugin } from '@core/http'
import { residentUsageRoutes } from './resident-routes'
import { staffUsageRoutes } from './staff-routes'

type Deps = Parameters<typeof residentUsageRoutes>[0] & Parameters<typeof staffUsageRoutes>[0]

/** E-173 and E-174 (DOC-104 §6.1): two routes because a resident token never passes a staff guard (DOC-12 §5.3); one use case. */
export const usageRoutes = (deps: Deps) =>
  routePlugin().use(residentUsageRoutes(deps)).use(staffUsageRoutes(deps))
