import type { Database } from '@core/db'
import type { SecretBox } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule, ModuleHost } from '@core/runtime'
import type { ObjectStorage } from '@core/storage'
import type { Audited } from '@mod/audit/contracts'
import { BuildingSettingsService } from './application/building-settings'
import { BuildingDirectory } from './application/directory'
import { DeleteFileObjectHandler, MakeThumbnailHandler } from './application/file-handlers'
import { FileJobs, type UsageReporter } from './application/file-jobs'
import { type FilesConfig, FilesService } from './application/files-service'
import { GatewayService } from './application/gateway-service'
import type { Thumbnailer } from './application/ports'
import { TermsService } from './application/terms-service'
import type {
  ActiveIntentProbe,
  BuildingApi,
  FeatureApi,
  FilesApi,
  GatewayProvider,
  StepUpVerifier,
} from './contracts'
import { CoreObjectStore } from './infrastructure/files/core-object-store'
import { SharpThumbnailer } from './infrastructure/files/sharp-thumbnailer'
import { SqlUploadRateLimiter } from './infrastructure/files/sql-upload-rate-limiter'
import { orphanUploadsJob, storageQuotaJob } from './infrastructure/jobs/file-jobs'
import { DrizzleBuildingRepository } from './infrastructure/persistence/drizzle-building-repository'
import { DrizzleFileRepository } from './infrastructure/persistence/drizzle-file-repository'
import { DrizzleGatewayConfigRepository } from './infrastructure/persistence/drizzle-gateway-config-repository'
import { DrizzleSettingsRepository } from './infrastructure/persistence/drizzle-settings-repository'
import { DrizzleTermsRepository } from './infrastructure/persistence/drizzle-terms-repository'
import { buildingInbox, buildingOutbox } from './infrastructure/persistence/schema'
import { buildingManifest } from './manifest'

export type { BuildingDocument } from './application/building-settings'
export type { UsageReporter } from './application/file-jobs'
export type { FilesConfig } from './application/files-service'
export type { GatewayView, SaveGatewayInput } from './application/gateway-service'
export { buildingManifest } from './manifest'

export interface BuildingDeps {
  storage: ObjectStorage
  /** The `SETTINGS_ENCRYPTION_KEYS` ring (DOC-36 §6). */
  secretBox: SecretBox
  /** `IdentityApi.verifyStepUp`, from P1-10. */
  stepUp: StepUpVerifier
  /** `finance` answers it from `integrations/building`; it is required in production and staging (DOC-36 §10.1 check 5). */
  probe: ActiveIntentProbe
  audited: Audited
  files: FilesConfig
  /** `SETTINGS_CACHE_SECONDS`. */
  settingsCacheSeconds: number
  /** `UPLOAD_RATE_PER_HOUR`. */
  uploadRatePerHour: number
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  outboxMaxPayloadBytes: number
  /** The `FEATURE_*` flags read at boot (DOC-36 §3.3). */
  features: Record<string, boolean>
  thumbnailer?: Thumbnailer
  usage?: UsageReporter
}

/** The host narrowed to what `building` needs (DOC-12 §4.2). */
export type BuildingHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> & BuildingDeps

export interface BuildingModule extends AppModule<'building'> {
  readonly api: BuildingApi
  readonly features: FeatureApi
  readonly files: FilesApi
  /** `GET` and `PATCH /staff/settings` (the document of DOC-36 §4). */
  readonly settings: BuildingSettingsService
  readonly gateway: GatewayService
  readonly terms: TermsService
}

const NO_USAGE: UsageReporter = { report() {} }

export function installBuilding(host: BuildingHost): BuildingModule {
  const database: Database = host.database
  const { clock, ids, logger } = host

  const buildings = new DrizzleBuildingRepository(database)
  const settings = new DrizzleSettingsRepository(database)
  const gateways = new DrizzleGatewayConfigRepository(database)
  const terms = new DrizzleTermsRepository(database)
  const fileRows = new DrizzleFileRepository(database)
  const store = new CoreObjectStore(host.storage)
  const thumbnailer = host.thumbnailer ?? new SharpThumbnailer()

  const outbox = new DrizzleOutboxWriter(database, buildingOutbox, () => ids.next(), {
    source: 'building',
    types: new Set(Object.keys(buildingManifest.outboxPolicies)),
    maxPayloadBytes: host.outboxMaxPayloadBytes,
  })
  const inbox = new DrizzleInboxGuard(database, buildingInbox)

  const directory = new BuildingDirectory(
    buildings,
    settings,
    clock,
    logger,
    host.settingsCacheSeconds,
  )
  const files = new FilesService({
    files: fileRows,
    store,
    uow: database,
    transaction: database,
    outbox,
    clock,
    ids,
    directory,
    rateLimiter: new SqlUploadRateLimiter(database, host.uploadRatePerHour),
    thumbnailer,
    config: host.files,
  })
  const gateway = new GatewayService({
    uow: database,
    gateways,
    directory,
    secretBox: host.secretBox,
    stepUp: host.stepUp,
    probe: host.probe,
    audited: host.audited,
    clock,
    ids,
    cacheSeconds: host.settingsCacheSeconds,
  })
  const termsService = new TermsService({
    uow: database,
    terms,
    directory,
    audited: host.audited,
    ids,
  })
  const settingsService = new BuildingSettingsService({
    uow: database,
    buildings,
    settings,
    files: fileRows,
    filesApi: files,
    directory,
    audited: host.audited,
  })
  const jobs = new FileJobs({
    files: fileRows,
    directory,
    uow: database,
    outbox,
    clock,
    config: host.files,
    usage: host.usage ?? NO_USAGE,
  })

  const api: BuildingApi = {
    getSettings: (buildingId) => directory.getSettings(buildingId),
    getBuilding: (buildingId) => directory.getBuilding(buildingId),
    listBuildings: () => directory.listBuildings(),
    isDemo: (buildingId) => directory.isDemo(buildingId),
    getGatewayConfig: (buildingId, provider: GatewayProvider, opts) =>
      gateway.getConfig(buildingId, provider, opts),
    hasAcceptedLatestTerms: (accountId, buildingId) =>
      termsService.hasAcceptedLatest(accountId, buildingId),
    missingTerms: (accountId, buildingId) => termsService.missing(accountId, buildingId),
  }
  const features: FeatureApi = { get: async () => ({ ...host.features }) }

  const handlers: IntegrationEventHandler[] = [
    new DeleteFileObjectHandler(fileRows, store, inbox),
    new MakeThumbnailHandler(
      fileRows,
      store,
      thumbnailer,
      inbox,
      database,
      clock,
      ids,
      host.files,
      logger,
    ),
  ]

  return {
    name: 'building',
    api,
    features,
    files,
    settings: settingsService,
    gateway,
    terms: termsService,
    handlers,
    outbox: { name: 'building', table: buildingOutbox, inboxTable: buildingInbox },
    jobs: [storageQuotaJob(jobs), orphanUploadsJob(jobs)],
  }
}
