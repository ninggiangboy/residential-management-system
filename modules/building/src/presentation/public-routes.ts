import { publicRoute, type RouteSet, routePlugin } from '@core/http'
import { type Clock, UnavailableError } from '@core/kernel'
import type { BuildingApi } from '../contracts'

/** Where a store lists an app; a platform without a link has `null` (the client hides the button, DOC-64 `/wrong-app`). */
export interface StoreUrls {
  ios: string | null
  android: string | null
}

export interface AppRelease {
  minVersion: string
  storeUrl: StoreUrls
}

/** `MIN_APP_VERSION_*` and `STORE_URL_*` of DOC-41 §7: environment configuration, not database rows (DOC-51 E-03). */
export interface PublicConfigOptions {
  resident: AppRelease
  staff: AppRelease
}

export interface PublicRouteDeps {
  buildings: Pick<BuildingApi, 'listBuildings'>
  clock: Clock
  publicConfig: PublicConfigOptions
}

const nullable = <T>(value: T | undefined): T | null => value ?? null

/**
 * `GET /public/config` (E-03, DOC-51 §3): what a client needs before anyone signs in, the same for every caller. The building
 * is the deployment's real one; a deployment with only a demo building answers with it (`local`, review builds, DR-145). The
 * answer holds no address, no company data and no secret. The directory caches the building for `SETTINGS_CACHE_SECONDS`.
 */
export function publicRoutes(d: PublicRouteDeps) {
  const config = async (context: { set: RouteSet }) => {
    const buildings = await d.buildings.listBuildings()
    const building = buildings.find((row) => !row.isDemo) ?? buildings[0]
    if (!building) throw new UnavailableError()
    context.set.headers['cache-control'] = 'public, max-age=60'
    const { contact } = building
    return {
      serverTime: d.clock.now().toISOString(),
      languages: ['vi', 'en'] as const,
      defaultLanguage: 'vi' as const,
      apps: d.publicConfig,
      contact: {
        name: { vi: building.name.vi, en: nullable(building.name.en) },
        hotline: contact.hotline,
        workingHours: contact.workingHours
          ? { vi: contact.workingHours.vi, en: nullable(contact.workingHours.en) }
          : null,
        email: contact.email,
      },
    }
  }

  return routePlugin({ prefix: '/public' }).get(
    '/config',
    config,
    publicRoute('public', { endpoint: 'E-03', operationId: 'getPublicConfig' }),
  )
}
