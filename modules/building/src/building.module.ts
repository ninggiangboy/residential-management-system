import type { Database } from '@core/db'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { ObjectStorage } from '@core/storage'
import type { Audited } from '@mod/audit/contracts'
import { BuildingApiImpl } from './application/api/building-api-impl'
import { FilesApiImpl } from './application/api/files-api-impl'
import { BuildingDocumentLoader } from './application/building-document'
import { BuildingDirectory } from './application/directory'
import { FileDeleter } from './application/file-deleter'
import type { FilesConfig } from './application/files-config'
import { GatewayConfigReader } from './application/gateway-config-reader'
import { DeleteFileObjectHandler } from './application/handlers/delete-file-object'
import { MakeThumbnailHandler } from './application/handlers/make-thumbnail'
import type { Thumbnailer, UsageReporter } from './application/ports'
import { BuildingQueries } from './application/queries/building-queries'
import { FileQueries } from './application/queries/file-queries'
import { AcceptTerms } from './application/use-cases/accept-terms'
import { AttachFile } from './application/use-cases/attach-file'
import { ExpireOrphanUploads } from './application/use-cases/expire-orphan-uploads'
import { PublishTerms } from './application/use-cases/publish-terms'
import { PurgeDeletedFiles } from './application/use-cases/purge-deleted-files'
import { RegisterFile } from './application/use-cases/register-file'
import { RemoveFile } from './application/use-cases/remove-file'
import { ReportStorageQuota } from './application/use-cases/report-storage-quota'
import { SaveGatewayConfig } from './application/use-cases/save-gateway-config'
import { StoreGeneratedFile } from './application/use-cases/store-generated-file'
import { UpdateBuildingSettings } from './application/use-cases/update-building-settings'
import { VerifyFile } from './application/use-cases/verify-file'
import type {
  ActiveIntentProbe,
  BuildingApi,
  FeatureApi,
  FilesApi,
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

export interface BuildingModuleDeps extends BuildingDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

/** What the staff and resident routes call (the routes come with the `staff` guard, P1-10; DOC-12 §4.5). */
export interface BuildingUseCases {
  /** `PATCH /staff/settings`. */
  updateBuildingSettings: UpdateBuildingSettings
  /** `PUT /staff/gateway` (DOC-36 §7.3). */
  saveGatewayConfig: SaveGatewayConfig
  /** `POST /staff/terms` (DOC-35 §9). */
  publishTerms: PublishTerms
  /** `POST /me/terms` (DOC-35 §9.3). */
  acceptTerms: AcceptTerms
}

export interface BuildingModule extends AppModule<'building'> {
  readonly api: BuildingApi
  readonly features: FeatureApi
  readonly files: FilesApi
  /** The reads behind `GET /staff/settings` and `GET /staff/gateway` (DOC-36 §4, §7.1). */
  readonly queries: BuildingQueries
  readonly useCases: BuildingUseCases
}

const NO_USAGE: UsageReporter = { report() {} }

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createBuildingModule(deps: BuildingModuleDeps): BuildingModule {
  const { database, clock, ids, logger } = deps

  const buildings = new DrizzleBuildingRepository(database)
  const settings = new DrizzleSettingsRepository(database)
  const gateways = new DrizzleGatewayConfigRepository(database)
  const terms = new DrizzleTermsRepository(database)
  const fileRows = new DrizzleFileRepository(database)
  const store = new CoreObjectStore(deps.storage)
  const thumbnailer = deps.thumbnailer ?? new SharpThumbnailer()

  const outbox = new DrizzleOutboxWriter(database, buildingOutbox, () => ids.next(), {
    source: 'building',
    types: new Set(Object.keys(buildingManifest.outboxPolicies)),
    maxPayloadBytes: deps.outboxMaxPayloadBytes,
  })
  const inbox = new DrizzleInboxGuard(database, buildingInbox)

  const directory = new BuildingDirectory(
    buildings,
    settings,
    clock,
    logger,
    deps.settingsCacheSeconds,
  )

  // Files (DOC-37)
  const registerFile = new RegisterFile(
    fileRows,
    store,
    database,
    new SqlUploadRateLimiter(database, deps.uploadRatePerHour),
    directory,
    clock,
    ids,
    deps.files,
  )
  const fileDeleter = new FileDeleter(fileRows, outbox)
  const verifyFile = new VerifyFile(
    fileRows,
    store,
    database,
    database,
    fileDeleter,
    outbox,
    clock,
    deps.files,
  )
  const files = new FilesApiImpl(
    {
      registerFile,
      verifyFile,
      attachFile: new AttachFile(fileRows, clock, database),
      removeFile: new RemoveFile(fileRows, fileDeleter, clock, database),
      storeGeneratedFile: new StoreGeneratedFile(fileRows, store, database, clock, ids, deps.files),
    },
    new FileQueries(fileRows, directory, store, deps.files),
  )

  // Gateway configuration (DOC-36 §7)
  const reader = new GatewayConfigReader(gateways, deps.secretBox, clock, deps.settingsCacheSeconds)

  // Settings (DOC-36 §4)
  const documents = new BuildingDocumentLoader(buildings, settings, files)

  const queries = new BuildingQueries(documents, gateways, terms, directory, reader)

  const useCases: BuildingUseCases = {
    updateBuildingSettings: new UpdateBuildingSettings(
      database,
      buildings,
      settings,
      fileRows,
      files,
      directory,
      documents,
      deps.audited,
    ),
    saveGatewayConfig: new SaveGatewayConfig(
      database,
      gateways,
      directory,
      reader,
      deps.secretBox,
      deps.stepUp,
      deps.probe,
      deps.audited,
      ids,
    ),
    publishTerms: new PublishTerms(database, terms, directory, deps.audited, ids),
    acceptTerms: new AcceptTerms(database, terms),
  }

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
      deps.files,
      logger,
    ),
  ]

  return {
    name: 'building',
    api: new BuildingApiImpl(directory, queries),
    features: { get: async () => ({ ...deps.features }) },
    files,
    queries,
    useCases,
    handlers,
    outbox: { name: 'building', table: buildingOutbox, inboxTable: buildingInbox },
    jobs: [
      storageQuotaJob(new ReportStorageQuota(fileRows, directory, deps.usage ?? NO_USAGE)),
      orphanUploadsJob(
        new ExpireOrphanUploads(fileRows, database, fileDeleter, clock, deps.files),
        new PurgeDeletedFiles(fileRows, database, clock, deps.files),
      ),
    ],
  }
}
