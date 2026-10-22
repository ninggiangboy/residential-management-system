import { Database } from '@core/db'
import {
  type Clock,
  createSecretBox,
  type IdGenerator,
  keyRingFromBase64,
  SystemClock,
  UnavailableError,
  UuidV7Generator,
} from '@core/kernel'
import { type AppModule, createRuntime, type MaintenanceStore, SqlJobRunStore } from '@core/runtime'
import { createObjectStorage, type ObjectStorage } from '@core/storage'
import type { Logger } from '@core/telemetry'
import { auditActionCatalogOf, installAudit } from '@mod/audit'
import { installBuilding } from '@mod/building'
import type { ActiveIntentProbe, StepUpVerifier } from '@mod/building/contracts'
import type { Config } from './config'
import { MODULE_CATALOG } from './module-catalog'

/**
 * Replacements for what a test must not share with the real world (DOC-12 §5.1). The mailer, SMS sender, payment gateway,
 * storage and clock join this list with the tasks that add them.
 */
export interface ContainerOverrides {
  clock?: Clock
  ids?: IdGenerator
  /** Where the maintenance flag is read from (tests: no shared state with other processes on the database). */
  maintenanceStore?: Pick<MaintenanceStore, 'read'>
  /** The object storage (tests: a fake). */
  storage?: ObjectStorage
  /** `IdentityApi.verifyStepUp`; the real one comes with P1-10. */
  stepUp?: StepUpVerifier
  /** `finance`'s answer to "is an intent active?"; the real one comes with the finance module (DOC-36 §7.3). */
  probe?: ActiveIntentProbe
}

/** Until `identity` (P1-10) installs, no proof can be checked, so a change that asks for one is refused. */
const noStepUp: StepUpVerifier = {
  verifyStepUp: async () => {
    throw new UnavailableError('step_up_unavailable', 'Step-up is not available yet')
  },
}

/** Until `finance` is installed no intent can exist, so none is active. The boot guard refuses this stand-in in production (DOC-36 §10.1 check 5). */
const noIntents: ActiveIntentProbe = { hasActive: async () => false }

/** What the process says about its own life, read by `/health/ready` and by the shutdown. */
interface Lifecycle {
  /** True from the moment shutdown starts: readiness answers 503 `stopping` so the proxy drains the process first. */
  stopping: boolean
}

/**
 * The composition root: the only place that knows concrete adapters and how modules are wired together (DOC-12 §5.1).
 * Providers first, in the contract graph's order; a module's `install…` call goes in as its task lands.
 */
export function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {},
) {
  const clock = overrides.clock ?? new SystemClock()
  const ids = overrides.ids ?? new UuidV7Generator()

  // One pool + one transaction context for all modules; modules differ only by PostgreSQL schema.
  const database = new Database({
    url: config.db.DATABASE_URL,
    poolMax: config.db.DB_POOL_MAX,
    prepare: config.db.DB_PREPARE,
  })

  const { jobs: jobsConfig, db, core } = config

  /** Modules in install order. A module that needs others takes them from the `modules` of its own install call. */
  const installed: AppModule[] = []

  // The base of every other module: they write their audit rows through it, in their own transaction (ADR-0018).
  const audit = installAudit({
    logger,
    ids,
    database,
    actions: auditActionCatalogOf(MODULE_CATALOG),
    purgeGraceMinutes: jobsConfig.JOB_AUDIT_PURGE_GRACE_MINUTES,
  })
  installed.push(audit)

  const { files: filesConfig, secrets, http } = config
  const storage =
    overrides.storage ??
    createObjectStorage({
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: filesConfig.S3_ENDPOINT,
      S3_PUBLIC_ENDPOINT: filesConfig.S3_PUBLIC_ENDPOINT,
      S3_REGION: filesConfig.S3_REGION,
      S3_BUCKET: filesConfig.S3_BUCKET,
      S3_ACCESS_KEY_ID: secrets.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: secrets.S3_SECRET_ACCESS_KEY,
      STORAGE_LOCAL_DIR: '',
      STORAGE_LOCAL_PUBLIC_URL: 'http://localhost',
    })
  if (!secrets.SETTINGS_ENCRYPTION_KEYS) throw new Error('SETTINGS_ENCRYPTION_KEYS is required')
  const building = installBuilding({
    logger,
    clock,
    ids,
    database,
    storage,
    secretBox: createSecretBox(keyRingFromBase64(secrets.SETTINGS_ENCRYPTION_KEYS)),
    stepUp: overrides.stepUp ?? noStepUp,
    probe: overrides.probe ?? noIntents,
    audited: audit.audited,
    files: {
      env: core.APP_ENV,
      uploadUrlTtlSeconds: filesConfig.FILES_UPLOAD_URL_TTL_SECONDS,
      downloadUrlTtlSeconds: filesConfig.FILES_DOWNLOAD_URL_TTL_SECONDS,
      paperUrlTtlSeconds: filesConfig.FILES_PAPER_URL_TTL_SECONDS,
      limits: {
        imageBytes: filesConfig.FILES_MAX_IMAGE_BYTES,
        videoBytes: filesConfig.FILES_MAX_VIDEO_BYTES,
        attachmentBytes: filesConfig.FILES_MAX_ATTACHMENT_BYTES,
        importBytes: filesConfig.FILES_MAX_IMPORT_BYTES,
        logoBytes: filesConfig.FILES_MAX_LOGO_BYTES,
        generatedBytes: filesConfig.FILES_GENERATED_MAX_BYTES,
      },
      thumbnailWidth: filesConfig.FILES_THUMBNAIL_WIDTH,
      logoWidth: filesConfig.FILES_LOGO_WIDTH,
      orphanAfterHours: filesConfig.FILES_ORPHAN_AFTER_HOURS,
      deletedRowRetentionDays: filesConfig.FILES_DELETED_ROW_RETENTION_DAYS,
    },
    settingsCacheSeconds: http.SETTINGS_CACHE_SECONDS,
    uploadRatePerHour: filesConfig.UPLOAD_RATE_PER_HOUR,
    outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
    features: { ticketDeadlines: http.FEATURE_TICKET_DEADLINES },
  })
  installed.push(building)

  const runtime = createRuntime({
    modules: installed,
    manifests: MODULE_CATALOG,
    database,
    clock,
    ids,
    logger,
    relay: {
      pollIntervalMs: jobsConfig.OUTBOX_POLL_INTERVAL_MS,
      batchSize: jobsConfig.OUTBOX_BATCH_SIZE,
      concurrency: jobsConfig.OUTBOX_CONCURRENCY,
      leaseSeconds: jobsConfig.OUTBOX_LEASE_SECONDS,
      backoffBaseSeconds: jobsConfig.OUTBOX_BACKOFF_BASE_SECONDS,
      backoffMaxSeconds: jobsConfig.OUTBOX_BACKOFF_MAX_SECONDS,
      deferBudgetHours: jobsConfig.OUTBOX_DEFER_BUDGET_HOURS,
      retentionDays: jobsConfig.OUTBOX_RETENTION_DAYS,
      cleanupIntervalMinutes: jobsConfig.OUTBOX_CLEANUP_INTERVAL_MINUTES,
      attempts: {
        default: jobsConfig.OUTBOX_MAX_ATTEMPTS,
        sms: jobsConfig.OUTBOX_SMS_MAX_ATTEMPTS,
        push: jobsConfig.OUTBOX_PUSH_MAX_ATTEMPTS,
        intent_cancel: jobsConfig.OUTBOX_INTENT_CANCEL_MAX_ATTEMPTS,
      },
    },
    jobs: {
      store: new SqlJobRunStore(database),
      buildings: async () =>
        (await building.api.listBuildings()).map(({ buildingId }) => ({ buildingId })),
      timeZone: core.JOBS_TIME_ZONE,
      tickSeconds: jobsConfig.JOBS_SCHEDULER_TICK_SECONDS,
    },
    dbPoolMax: db.DB_POOL_MAX,
    maintenance: {
      pollIntervalMs: core.MAINTENANCE_POLL_INTERVAL_MS,
      store: overrides.maintenanceStore,
    },
  })
  const lifecycle: Lifecycle = { stopping: false }

  return {
    config,
    logger,
    clock,
    ids,
    database,
    /** The installed modules, in install order. */
    modules: installed as readonly AppModule[],
    runtime,
    maintenance: runtime.maintenance,
    lifecycle,
    /** Stops the timers and closes the pool. The HTTP servers and the worker are stopped first by the caller. */
    close: () => runtime.close(),
  }
}

export type Container = ReturnType<typeof createContainer>
