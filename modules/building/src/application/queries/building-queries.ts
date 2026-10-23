import { requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type {
  GatewayConfigDto,
  GatewayDriver,
  GatewayProvider,
  MissingTerm,
  TermsKind,
} from '../../contracts'
import { GATEWAY_DRIVERS } from '../../domain/gateway-config'
import type { GatewayConfigRepository } from '../../domain/gateway-config-repository'
import type { TermsRepository } from '../../domain/terms-repository'
import type { BuildingDocument, BuildingDocumentLoader } from '../building-document'
import type { BuildingDirectory } from '../directory'
import type { GatewayConfigReader, GatewayView } from '../gateway-config-reader'
import { scopeOf } from '../scope-of'

/** `GET /staff/settings` and `GET /staff/gateway` are the Admin's alone (DOC-36 §4, §7.1). The routes read these lists for their `audience`. */
export const GET_SETTINGS_ROLES = ['admin'] as const satisfies readonly StaffRole[]
export const GET_GATEWAY_ROLES = ['admin'] as const satisfies readonly StaffRole[]
export const LIST_TERMS_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/** The reads of the building: settings, gateway configuration and terms. No state change, no transaction, no rule of its own (DOC-12 §4.5 rule 3). */
export class BuildingQueries {
  constructor(
    private readonly documents: BuildingDocumentLoader,
    private readonly gateways: GatewayConfigRepository,
    private readonly terms: TermsRepository,
    private readonly directory: BuildingDirectory,
    private readonly reader: GatewayConfigReader,
  ) {}

  /** `GET /staff/settings` (DOC-36 §4): the building row and the settings in one document, with its `ETag`. */
  async settings(staff: StaffContext): Promise<BuildingDocument> {
    requireRole(staff, GET_SETTINGS_ROLES)
    return this.documents.load(staff.buildingId)
  }

  /** `GET /staff/gateway`: the active configurations with masked secrets and the drivers this building may use (DOC-36 §7.1). */
  async gatewayView(staff: StaffContext) {
    requireRole(staff, GET_GATEWAY_ROLES)
    const { gateways, directory, reader } = this
    const isDemo = await directory.isDemo(staff.buildingId)
    const configs: GatewayView[] = []
    for (const provider of ['payos', 'vietqr'] as const) {
      const row = await gateways.findActive(staff.scope, provider)
      if (row) configs.push(await reader.view(row))
    }
    const drivers = Object.fromEntries(
      (Object.keys(GATEWAY_DRIVERS) as GatewayDriver[]).map((driver) => [
        driver,
        { fields: GATEWAY_DRIVERS[driver].fields, allowed: driver !== 'fake' || isDemo },
      ]),
    ) as Record<GatewayDriver, { fields: readonly string[]; allowed: boolean }>
    return { configs, drivers }
  }

  /** `BuildingApi.getGatewayConfig` (DOC-36 §3.1): the active row of `(building, provider)`, decrypted, from a short cache unless it takes the lock. */
  gatewayConfig(
    buildingId: string,
    provider: GatewayProvider,
    opts: { lock?: 'share' } = {},
  ): Promise<GatewayConfigDto | null> {
    return this.reader.config(buildingId, provider, opts)
  }

  /** `GET /staff/terms` (E-52): every published version, newest first, with the number of accounts that accepted it. */
  async termsVersions(staff: StaffContext, kind: TermsKind | null) {
    requireRole(staff, LIST_TERMS_ROLES)
    return this.terms.list(staff.scope, kind)
  }

  /**
   * The gate of DOC-35 §9.2: the latest version of each kind that the account has not accepted. No cache: the very next request
   * after a publish must be refused, and two API containers cannot share an invalidation (DR-125).
   */
  async missingTerms(accountId: string, buildingId: string): Promise<MissingTerm[]> {
    const rows = await this.terms.missing(scopeOf(buildingId), accountId)
    return rows.map((row) => ({ kind: row.kind, version: row.version, versionId: row.id }))
  }

  /** `GET /me/terms` (E-16, DOC-35 §9.3): the latest version of each kind for one building, with the account's acceptance. */
  termsOf(accountId: string, buildingId: string) {
    return this.terms.latestFor(scopeOf(buildingId), accountId)
  }
}
