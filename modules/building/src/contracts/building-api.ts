import type { BuildingId, StaffContext } from '@rms/shared-types'
import type { BuildingSettings } from './settings'

export interface Bilingual {
  vi: string
  en?: string
}

/** What other modules know of a building (DOC-36 §3); cached 60 s. */
export interface BuildingDto {
  buildingId: string
  code: string
  name: Bilingual
  timeZone: string
  isDemo: boolean
}

export type GatewayProvider = 'payos' | 'vietqr'
export type GatewayDriver = 'payos' | 'vietqr' | 'fake'

export interface ReceivingAccount {
  bankBin: string
  accountNumber: string
  accountName: string
}

/** The active configuration of one provider, decrypted in memory: never logged, and the blob is never returned (DOC-36 §3.1). */
export interface GatewayConfigDto {
  id: string
  provider: GatewayProvider
  driver: GatewayDriver
  status: 'active' | 'disabled'
  receivingAccount: ReceivingAccount
  secrets: Record<string, string>
}

export type TermsKind = 'terms' | 'privacy'

/** One row of the gate of DOC-35 §9.2: the latest version of a kind that the account has not accepted. */
export interface MissingTerm {
  kind: TermsKind
  version: number
  versionId: string
}

export interface BuildingApi {
  /** The saved keys overlaid on the code defaults (DR-111). */
  getSettings(buildingId: string): Promise<BuildingSettings>
  getBuilding(buildingId: string): Promise<BuildingDto | null>
  /** The real building and the demo one. */
  listBuildings(): Promise<BuildingDto[]>
  /** `false` for an unknown id: callers that act on it first have a row from another read. */
  isDemo(buildingId: string): Promise<boolean>
  /**
   * The active row of `(buildingId, provider)`, decrypted. With no option it may answer from a 60 s cache; with
   * `{ lock: 'share' }` it skips the cache and takes `SELECT … FOR SHARE` inside the caller's transaction, which is how
   * an intent being created and a change of the receiving account exclude each other (DOC-36 §7.3).
   */
  getGatewayConfig(
    buildingId: string,
    provider: GatewayProvider,
    opts?: { lock?: 'share' },
  ): Promise<GatewayConfigDto | null>
  /** One statement, no cache: the very next request after a publish must be refused (DOC-35 §9.2, DR-125). */
  hasAcceptedLatestTerms(accountId: string, buildingId: string): Promise<boolean>
  missingTerms(accountId: string, buildingId: string): Promise<MissingTerm[]>
}

/** Environment flags read at boot; the same map for every building (DOC-36 §3.3). */
export interface FeatureApi {
  get(buildingId: string): Promise<Record<string, boolean>>
}

/**
 * `building` cannot import `finance` (the other way round is the real dependency), so it declares the question and `finance`
 * answers it from `integrations/building` (DOC-12 §4.4, DOC-36 §7.3).
 */
export interface ActiveIntentProbe {
  /** Pending, creating or cancelling intents of the building under the provider. */
  hasActive(buildingId: string, provider: GatewayProvider): Promise<boolean>
}

export type StepUpAction = 'gateway_config' | 'admin_change' | 'staff_email'

/**
 * `IdentityApi.verifyStepUp` as `building` needs it (DOC-09 §7.3): checks the password, consumes the live code, counts a wrong
 * password, queues the notices to the Admins in the caller's transaction, and throws on any failure.
 */
export interface StepUpVerifier {
  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void>
}

export type { BuildingId }
