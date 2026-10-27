import type { Database } from '@core/db'
import { type Idempotent, routePlugin } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { ObjectStorage } from '@core/storage'
import type { Audited } from '@mod/audit/contracts'
import { type DemoResettable, type Guards, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { BuildingApiImpl } from './application/api/building-api-impl'
import { FilesApiImpl } from './application/api/files-api-impl'
import { BuildingDocumentLoader } from './application/building-document'
import { BuildingDemo } from './application/demo-building'
import { DemoReset, type DemoSeedSource } from './application/demo-reset'
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
import { EnsureDemoBuilding } from './application/use-cases/ensure-demo-building'
import { ExpireOrphanUploads } from './application/use-cases/expire-orphan-uploads'
import { PublishTerms } from './application/use-cases/publish-terms'
import { PurgeDeletedFiles } from './application/use-cases/purge-deleted-files'
import { RegisterFile } from './application/use-cases/register-file'
import { RemoveFile } from './application/use-cases/remove-file'
import { ReportStorageQuota } from './application/use-cases/report-storage-quota'
import { ResetDemo } from './application/use-cases/reset-demo'
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
import { SqlDemoResetLimiter, SqlDemoResetLock } from './infrastructure/demo/sql-demo-reset'
import { CoreObjectStore } from './infrastructure/files/core-object-store'
import { SharpThumbnailer } from './infrastructure/files/sharp-thumbnailer'
import { SqlUploadRateLimiter } from './infrastructure/files/sql-upload-rate-limiter'
import { demoResetJob } from './infrastructure/jobs/demo-jobs'
import { orphanUploadsJob, storageQuotaJob } from './infrastructure/jobs/file-jobs'
import { DrizzleBuildingRepository } from './infrastructure/persistence/drizzle-building-repository'
import { DrizzleDemoRepository } from './infrastructure/persistence/drizzle-demo-repository'
import { DrizzleFileRepository } from './infrastructure/persistence/drizzle-file-repository'
import { DrizzleGatewayConfigRepository } from './infrastructure/persistence/drizzle-gateway-config-repository'
import { DrizzleSettingsRepository } from './infrastructure/persistence/drizzle-settings-repository'
import { DrizzleTermsRepository } from './infrastructure/persistence/drizzle-terms-repository'
import { buildingInbox, buildingOutbox } from './infrastructure/persistence/schema'
import { buildingManifest } from './manifest'
import {
  type BuildingRouteDeps,
  buildingRoutes,
  type StaffNames,
} from './presentation/building-routes'
import { type PublicRouteDeps, publicRoutes } from './presentation/public-routes'
import {
  type ResidentContactRouteDeps,
  residentContactRoutes,
} from './presentation/resident-contact-routes'
import {
  type ResidentBuildings,
  type ResidentTermsRouteDeps,
  residentTermsRoutes,
} from './presentation/resident-terms-routes'
import { type UploadRouteDeps, uploadRoutes } from './presentation/upload-routes'

export interface BuildingDeps {
  /** The wrapper of DOC-50 §8 for the routes behind an `Idempotency-Key` (E-36). */
  idempotent: Idempotent
  /** The guards of DOC-12 §5.3, built by the composition root from the contracts of `identity`. */
  guards: Guards
  /** The names of the staff who published a terms version, from `identity`. */
  staffNames: StaffNames
  /** The buildings of the account of `GET /me/terms`, from `residency`. */
  residentBuildings: ResidentBuildings
  storage: ObjectStorage
  /** The `SETTINGS_ENCRYPTION_KEYS` ring (DOC-36 §6). */
  secretBox: SecretBox
  /** `IdentityApi.verifyStepUp`, from P1-10. */
  stepUp: StepUpVerifier
  /** `finance` answers it from `integrations/building`; it is required in production and staging (DOC-36 §10.1 check 5). */
  probe: ActiveIntentProbe
  audited: Audited
  files: FilesConfig
  /** The release block of `GET /public/config` (E-03). */
  publicConfig: PublicRouteDeps['publicConfig']
  /** `SETTINGS_CACHE_SECONDS`. */
  settingsCacheSeconds: number
  /** `UPLOAD_RATE_PER_HOUR`. */
  uploadRatePerHour: number
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  outboxMaxPayloadBytes: number
  /** The `FEATURE_*` flags read at boot (DOC-36 §3.3). */
  features: Record<string, boolean>
  /**
   * The demo reset (DOC-36 §10): the seed, the modules to reset and the catch-up window of the nightly job
   * (`JOB_DEMO_RESET_GRACE_MINUTES`). The modules are a function because `building` is installed before the ones it resets.
   */
  demo: {
    source: DemoSeedSource
    modules: () => readonly DemoResettable[]
    graceMinutes: number
  }
  thumbnailer?: Thumbnailer
  usage?: UsageReporter
  /** `MetricsPort` of the host (DOC-40 §4.3); none in the tests of a module that does not look at it. */
  metrics?: MetricsPort
}

export interface BuildingModuleDeps extends BuildingDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

/** What the staff and resident routes call (DOC-12 §4.5). */
export interface BuildingUseCases {
  /** `PATCH /staff/settings`. */
  updateBuildingSettings: UpdateBuildingSettings
  /** `PUT /staff/gateway` (DOC-36 §7.3). */
  saveGatewayConfig: SaveGatewayConfig
  /** `POST /staff/terms` (DOC-35 §9). */
  publishTerms: PublishTerms
  /** `POST /staff/demo/reset` (E-56). */
  resetDemo: ResetDemo
  /** `POST /me/terms` (DOC-35 §9.3). */
  acceptTerms: AcceptTerms
}

export interface BuildingModule extends AppModule<'building'> {
  readonly api: BuildingApi
  /** The nightly job and the route call this; `seed:demo` creates the building row first with `ensureDemoBuilding`. */
  readonly demo: {
    reset: DemoReset
    ensureBuilding: EnsureDemoBuilding
    /** `building`'s own part of the reset, which the module list of the host includes. */
    resettable: DemoResettable
  }
  readonly features: FeatureApi
  readonly files: FilesApi
  /** The reads behind `GET /staff/settings` and `GET /staff/gateway` (DOC-36 §4, §7.1). */
  readonly queries: BuildingQueries
  readonly useCases: BuildingUseCases
  /** `/staff/settings`, `/gateway`, `/terms` and `/uploads` (E-36, E-37, E-47…E-50, E-52, E-53), `/me/terms` (E-16, E-17) and `/me/contact` (E-15). */
  readonly routes: BuildingRoutes
}

export type BuildingRoutes = ReturnType<typeof createRoutes>

function createRoutes(
  d: BuildingRouteDeps &
    UploadRouteDeps &
    ResidentTermsRouteDeps &
    ResidentContactRouteDeps &
    PublicRouteDeps,
) {
  return routePlugin()
    .use(buildingRoutes(d))
    .use(uploadRoutes(d))
    .use(residentTermsRoutes(d))
    .use(residentContactRoutes(d))
    .use(publicRoutes(d))
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

  // The demo reset (DOC-36 §10): `building` runs every module's part, its own included.
  const demoRows = new DrizzleDemoRepository(database)
  const demoResettable = new BuildingDemo(
    directory,
    demoRows,
    fileRows,
    fileDeleter,
    deps.secretBox,
    clock,
  )
  const demoReset = new DemoReset(
    database,
    directory,
    new SqlDemoResetLock(database),
    () => [demoResettable, ...deps.demo.modules()],
    deps.demo.source,
    clock,
    logger,
    deps.metrics ?? NO_METRICS,
  )

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
    resetDemo: new ResetDemo(
      database,
      directory,
      demoReset,
      new SqlDemoResetLimiter(database),
      deps.audited,
    ),
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

  const api = new BuildingApiImpl(directory, queries)

  return {
    name: 'building',
    docs: [
      {
        name: 'public',
        description: 'Configuration an app reads before anyone signs in.',
      },
      {
        name: 'building',
        description:
          'The building: its settings, payment gateway configuration and terms versions for staff; the manager contact and the terms acceptance for residents.',
      },
      {
        name: 'files',
        description:
          'File uploads in two steps: register the file and get a presigned URL, then verify it after the upload.',
      },
    ],
    api,
    demo: {
      reset: demoReset,
      ensureBuilding: new EnsureDemoBuilding(database, demoRows),
      resettable: demoResettable,
    },
    features: { get: async () => ({ ...deps.features }) },
    files,
    queries,
    useCases,
    routes: createRoutes({
      queries,
      files,
      ...useCases,
      staffNames: deps.staffNames,
      residentBuildings: deps.residentBuildings,
      guards: deps.guards,
      idempotent: deps.idempotent,
      buildings: api,
      clock,
      publicConfig: deps.publicConfig,
    }),
    handlers,
    outbox: { name: 'building', table: buildingOutbox, inboxTable: buildingInbox },
    jobs: [
      storageQuotaJob(new ReportStorageQuota(fileRows, directory, deps.usage ?? NO_USAGE)),
      orphanUploadsJob(
        new ExpireOrphanUploads(fileRows, database, fileDeleter, clock, deps.files),
        new PurgeDeletedFiles(fileRows, database, clock, deps.files),
      ),
      demoResetJob(directory, demoReset, deps.demo.graceMinutes),
    ],
  }
}
