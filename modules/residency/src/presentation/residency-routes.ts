import { routePlugin } from '@core/http'
import { importRoutes } from './import-routes'
import { membershipRoutes } from './membership-routes'
import { residentRoutes } from './resident-routes'
import { unitRoutes } from './unit-routes'
import { unitTypeRoutes } from './unit-type-routes'

type Deps = Parameters<typeof importRoutes>[0] &
  Parameters<typeof unitRoutes>[0] &
  Parameters<typeof unitTypeRoutes>[0] &
  Parameters<typeof residentRoutes>[0] &
  Parameters<typeof membershipRoutes>[0]

/**
 * Every staff route of `residency` (DOC-27): the imports (E-71…E-74, E-169), the units (E-57…E-62), the unit types (E-180…E-182), the residents (E-63…E-67)
 * and the memberships (E-69). The household routes of the owner (`/me/members`) come with P4-10.
 */
export const residencyRoutes = (deps: Deps) =>
  routePlugin()
    .use(importRoutes(deps))
    .use(unitRoutes(deps))
    .use(unitTypeRoutes(deps))
    .use(residentRoutes(deps))
    .use(membershipRoutes(deps))
