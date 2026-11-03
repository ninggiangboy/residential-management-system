import { Database, SqlIdempotencyStore } from '@core/db'
import { createIdempotent } from '@core/http'
import {
  type Clock,
  createSecretBox,
  type IdGenerator,
  keyRingFromBase64,
  type SecretBox,
  SystemClock,
  UuidV7Generator,
} from '@core/kernel'
import type { Mailer } from '@core/mail'
import { OutboxStats } from '@core/messaging'
import { type AppModule, createRuntime, type MaintenanceStore, SqlJobRunStore } from '@core/runtime'
import { createObjectStorage, type ObjectStorage } from '@core/storage'
import type { Logger } from '@core/telemetry'
import { installAnalytics } from '@mod/analytics'
import { auditActionCatalogOf, installAudit } from '@mod/audit'
import { installBuilding } from '@mod/building'
import type { ActiveIntentProbe, StepUpVerifier } from '@mod/building/contracts'
import { installFinance } from '@mod/finance'
import { activeIntentProbe } from '@mod/finance/integrations/building'
import { financeNotifications } from '@mod/finance/integrations/notification'
import { financeRealtime } from '@mod/finance/integrations/realtime'
import { feeImportHandler } from '@mod/finance/integrations/residency'
import { type ActiveMemberships, installIdentity, type SmsSender } from '@mod/identity'
import type { OpenTicketsProbe } from '@mod/identity/contracts'
import { identityNotifications } from '@mod/identity/integrations/notification'
import { identityRealtime } from '@mod/identity/integrations/realtime'
import { installNotification } from '@mod/notification'
import { notificationRealtime } from '@mod/notification/integrations/realtime'
import { installRealtime } from '@mod/realtime'
import { installResidency } from '@mod/residency'
import { residencyNotifications } from '@mod/residency/integrations/notification'
import type { Guards } from '@rms/shared-types'
import { buildDemoPlan } from '../demo/plan'
import type { AccountBuildings } from './boot-guard'
import type { Config } from './config'
import { financePorts } from './finance-ports'
import { createGuards, type GuardDeps } from './guards'
import { createMailerFor } from './mailer'
import { createAppMetrics, registerPulledMetrics } from './metrics'
import { MODULE_CATALOG, MODULE_NAMES } from './module-catalog'
import { outboxSourcesOf } from './outbox-sources'
import { createSmsSenderFor } from './sms'
import { createTermsGate } from './terms-gate'

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
  /** The mailer (tests: one that records). */
  mailer?: Mailer
  /** `IdentityApi.verifyStepUp` for `building` (tests: a stand-in); by default `identity`'s own. */
  stepUp?: StepUpVerifier
  /** The SMS sender (tests: one that records); by default the driver `SMS_DRIVER` names. */
  sms?: SmsSender
  /** `ResidencyApi.listActiveMemberships` for the sign-in answer (tests: a stand-in); by default `residency`'s own. */
  memberships?: ActiveMemberships
  /** `ResidencyApi.buildingIdsOfAccounts` for boot guard check 1 (tests: a stand-in); by default `residency`'s own. */
  accountBuildings?: AccountBuildings
  /** `finance`'s answer to "is an intent active?"; the real one comes with the finance module (DOC-36 §7.3). */
  probe?: ActiveIntentProbe
  /**
   * The guards every module receives (DR-99, DR-172): the mutants of the authorization matrix replace one of them with a
   * defective one (EXP-10 §3). Test code only; production never passes it.
   */
  guards?: (real: Guards, deps: GuardDeps) => Guards
  /** `tickets`' answer to "does this staff member hold open tickets?"; the real one comes with the tickets module (DOC-26 §2.1). */
  tickets?: OpenTicketsProbe
}

/**
 * Until `tickets` is installed (P3) no ticket exists, so no staff member holds one. Like the active-intent stand-in before `finance` existed, this is a stand-in the boot
 * guard must refuse in production once the module exists (DOC-26 §2.1).
 */
const noTicketsYet: OpenTicketsProbe = {
  openTicketsOf: async () => [],
  reassignAll: async () => 0,
}

/** Keys live 24 hours (DR-74) and the sweep runs every hour (DOC-38 §4.2). */
const IDEMPOTENCY_RETENTION_MS = 24 * 3_600_000
const IDEMPOTENCY_SWEEP_MS = 3_600_000

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
  // The registry of this process (DOC-40 §2): modules receive their counters from it, `/metrics` on the ops port serves it.
  const metricsSettings = {
    cacheSeconds: config.observability.METRICS_CACHE_SECONDS,
    queryTimeoutMs: config.observability.METRICS_QUERY_TIMEOUT_MS,
  }
  const metrics = createAppMetrics(metricsSettings)

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
    metrics: metrics.audit,
  })
  installed.push(audit)

  const { files: filesConfig, secrets, http } = config
  const demoPlan = buildDemoPlan()
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
  const secretBox = createSecretBox(keyRingFromBase64(secrets.SETTINGS_ENCRYPTION_KEYS))
  // The guards are built from the contracts of `identity`, which is installed after `building` and with the routes that use
  // them: forwarders close the loop. They are read per request, long after `identity` exists.
  // The gate of DOC-35 §9.2 reads `building`; the `unit(capability)` guard calls it once it knows the building.
  const termsGate = createTermsGate({
    missingTerms: (...args) => building.api.missingTerms(...args),
  })
  const guardDeps: GuardDeps = {
    verifier: { verify: (token) => identity.verifier.verify(token) },
    identity: { getStaff: (ids) => identity.api.getStaff(ids) },
    residency: { getMembership: (...args) => residency.api.getMembership(...args) },
    termsGate,
    metrics: metrics.port,
  }
  const realGuards = createGuards(guardDeps)
  const guards = overrides.guards ? overrides.guards(realGuards, guardDeps) : realGuards
  // The wrapper of DOC-50 §8 for every route marked `R`; its store is `platform.idempotency_key` (DOC-17 §3).
  const idempotencyStore = new SqlIdempotencyStore(database)
  const idempotent = createIdempotent(idempotencyStore, clock, metrics.idempotency)
  const building = installBuilding({
    idempotent,
    logger,
    clock,
    ids,
    database,
    usage: metrics.usage,
    storage,
    secretBox,
    // `identity` is installed after `building` (it reads the lockout settings), so the proof is forwarded to it (DOC-12 §4.4).
    stepUp: overrides.stepUp ?? { verifyStepUp: (...args) => identity.api.verifyStepUp(...args) },
    // `finance` is installed after `building` (it reads the settings and the gateway configuration), so the probe is forwarded
    // to it once it exists (DOC-36 §7.3, DOC-12 §4.4).
    probe:
      overrides.probe ??
      activeIntentProbe({ hasActiveIntent: (...args) => finance.api.hasActiveIntent(...args) }),
    audited: audit.audited,
    guards,
    residentBuildings: {
      buildingIdsOf: async (accountId) =>
        (await residency.api.buildingIdsOfAccounts([accountId])).map((row) => row.buildingId),
    },
    staffNames: {
      names: async (ids) =>
        Object.fromEntries(
          (await identity.api.getStaff([...ids])).map((row) => [row.staffId, row.fullName]),
        ),
    },
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
    publicConfig: {
      resident: {
        minVersion: http.MIN_APP_VERSION_RESIDENT,
        storeUrl: {
          ios: http.STORE_URL_RESIDENT_IOS ?? null,
          android: http.STORE_URL_RESIDENT_ANDROID ?? null,
        },
      },
      staff: {
        minVersion: http.MIN_APP_VERSION_STAFF,
        storeUrl: {
          ios: http.STORE_URL_STAFF_IOS ?? null,
          android: http.STORE_URL_STAFF_ANDROID ?? null,
        },
      },
    },
    settingsCacheSeconds: http.SETTINGS_CACHE_SECONDS,
    uploadRatePerHour: filesConfig.UPLOAD_RATE_PER_HOUR,
    outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
    features: { ticketDeadlines: http.FEATURE_TICKET_DEADLINES },
    metrics: metrics.port,
    // The seed is data (DOC-36 §9.1); the modules that own demo rows are installed after `building`, hence the function.
    demo: {
      source: { plan: demoPlan, password: secrets.DEMO_STAFF_PASSWORD },
      modules: () => [identity.demo, residency.demo, notification.demo],
      graceMinutes: jobsConfig.JOB_DEMO_RESET_GRACE_MINUTES,
    },
  })
  installed.push(building)

  const { identity: identityConfig } = config
  const identity = installIdentity({
    logger,
    clock,
    ids,
    database,
    mailer: overrides.mailer ?? createMailerFor(config, logger),
    sms: overrides.sms ?? createSmsSenderFor(config, logger),
    // `residency` is installed after `identity` (it asks for accounts), so the sign-in answer is forwarded to it.
    memberships: overrides.memberships ?? {
      listActive: (accountId) => residency.api.listActiveMemberships(accountId),
    },
    secretBox,
    building: building.api,
    files: building.files,
    audited: audit.audited,
    guards,
    idempotent,
    metrics: metrics.port,
    // `tickets` joins with P3 (DOC-28); until then no staff member has an open ticket, so nothing blocks a lock (DOC-26 §2.1).
    tickets: overrides.tickets ?? noTicketsYet,
    config: {
      accessTtlSeconds: identityConfig.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDaysStaff: identityConfig.REFRESH_TTL_DAYS_STAFF,
      refreshTtlDaysResident: identityConfig.REFRESH_TTL_DAYS_RESIDENT,
      familyMaxDaysResident: identityConfig.FAMILY_MAX_DAYS_RESIDENT,
      familyMaxDaysStaff: identityConfig.FAMILY_MAX_DAYS_STAFF,
      maxFamilies: identityConfig.MAX_FAMILIES_PER_ACCOUNT,
      refreshGraceSeconds: identityConfig.REFRESH_GRACE_SECONDS,
      inviteTtlHours: identityConfig.INVITE_TTL_HOURS,
      resetTtlMinutes: identityConfig.RESET_TTL_MINUTES,
      stepUpTtlMinutes: identityConfig.STEPUP_TTL_MINUTES,
      stepUpMaxAttempts: identityConfig.STEPUP_MAX_ATTEMPTS,
      stepUpRequestsPerHour: identityConfig.STEPUP_REQUESTS_PER_HOUR,
      staffLoginPerIp: identityConfig.STAFF_LOGIN_PER_IP,
      resetPerEmailPerHour: identityConfig.RESET_PER_EMAIL_PER_HOUR,
      resetPerIpPerHour: identityConfig.RESET_PER_IP_PER_HOUR,
      resetMinResponseMs: identityConfig.RESET_MIN_RESPONSE_MS,
      otpTtlSeconds: identityConfig.OTP_TTL_SECONDS,
      otpResendAfterSeconds: identityConfig.OTP_RESEND_AFTER_SECONDS,
      otpMaxAttempts: identityConfig.OTP_MAX_ATTEMPTS,
      otpPerPhonePerHour: identityConfig.OTP_PER_PHONE_PER_HOUR,
      otpPerIpPerHour: identityConfig.OTP_PER_IP_PER_HOUR,
      clientErrorsPerMinutePerIp: http.CLIENT_ERRORS_PER_MINUTE_PER_IP,
      clientErrorsPerHourPerAccount: http.CLIENT_ERRORS_PER_HOUR_PER_ACCOUNT,
      otpDailyCap: identityConfig.OTP_DAILY_CAP,
      smsDownFailures: identityConfig.SMS_DOWN_FAILURES,
      smsBrand: config.drivers.SMS_BRAND ?? 'RMS',
      appDownloadUrl: http.APP_DOWNLOAD_URL ?? '',
      adminBaseUrl: http.ADMIN_BASE_URL,
    },
    argon2: {
      memoryKib: identityConfig.ARGON2_MEMORY_KIB,
      timeCost: identityConfig.ARGON2_TIME_COST,
    },
    // A `worker` process holds neither: it only sends mail, and the ring is read on first use.
    jwtKeys: secrets.JWT_KEYS ?? {},
    otpHmacKey: secrets.OTP_HMAC_KEY ?? '',
    outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
  })
  installed.push(identity)

  // The PII ring (DR-65) is required by the `api` role only: a `worker` clears profiles and never seals, so the box is built on first use.
  let piiBox: SecretBox | undefined
  const residency = installResidency({
    logger,
    clock,
    ids,
    database,
    building: building.api,
    files: building.files,
    identity: identity.api,
    guards,
    idempotent,
    pii: () => {
      if (!secrets.PII_ENCRYPTION_KEYS) throw new Error('PII_ENCRYPTION_KEYS is required')
      piiBox ??= createSecretBox(keyRingFromBase64(secrets.PII_ENCRYPTION_KEYS))
      return piiBox
    },
    audited: audit.audited,
    metrics: metrics.port,
    outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
    // DR-149: `/staff/imports` dispatches `fee_batch` to `finance`, installed below (it reads `residency.api`); read per request.
    importHandlers: () => [feeImportHandler(finance.feeImports)],
  })
  installed.push(residency)

  // P2-01…P2-04: the schema, the active-intent probe of `building`, the draft batches and the fee import; routes and jobs join with
  // P2-05…P2-15. Units are found through `ResidencyApi.findUnitsByCodes` (DOC-21 §2.1, DR-265).
  const finance = installFinance({
    logger,
    clock,
    ids,
    database,
    audited: audit.audited,
    units: residency.api,
    files: building.files,
    metrics: metrics.port,
    outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
    invariantCheckGraceMinutes: jobsConfig.JOB_INVARIANT_CHECK_GRACE_MINUTES,
    ...financePorts({ building: building.api, identity: identity.api, residency: residency.api }),
  })
  installed.push(finance)

  // P2-12 (DOC-31, DOC-52): the inbox, the push and the staff event stream. Both are consumers: the producers hand them their
  // `integrations/*` definitions here, and neither imports a producer (DOC-12 §4.4).
  const { later } = config
  const notification = installNotification({
    logger,
    clock,
    ids,
    database,
    building: building.api,
    guards,
    integrations: [financeNotifications, identityNotifications, residencyNotifications],
    residency: residency.api,
    identity: identity.api,
    config: {
      pushDriver: later.PUSH_DRIVER,
      expoPushBaseUrl: later.EXPO_PUSH_BASE_URL,
      expoAccessToken: secrets.EXPO_ACCESS_TOKEN ?? null,
      chunkSize: later.PUSH_CHUNK_SIZE,
      requestTimeoutMs: later.PUSH_REQUEST_TIMEOUT_MS,
      maxAgeMinutes: later.PUSH_MAX_AGE_MINUTES,
      receiptDelayMinutes: later.PUSH_RECEIPT_DELAY_MINUTES,
      ticketRetentionDays: later.PUSH_TICKET_RETENTION_DAYS,
      inboxRetentionDays: later.INBOX_RETENTION_DAYS,
      inboxPurgeGraceMinutes: jobsConfig.JOB_INBOX_PURGE_GRACE_MINUTES,
      outboxMaxPayloadBytes: jobsConfig.OUTBOX_MAX_PAYLOAD_BYTES,
    },
    metrics: metrics.port,
  })
  installed.push(notification)

  const realtime = installRealtime({
    logger,
    clock,
    ids,
    database,
    guards,
    mappings: [...financeRealtime, ...identityRealtime, ...notificationRealtime],
    config: {
      maxStreamsPerAccount: later.SSE_MAX_STREAMS_PER_ACCOUNT,
      heartbeatSeconds: later.SSE_HEARTBEAT_SECONDS,
    },
    metrics: metrics.port,
  })
  installed.push(realtime)
  // `sse_streams_open` (DOC-40 §4.1, SE-24): read at every scrape, so a stream that closed is not counted for a cache period.
  metrics.metrics.pulled(
    'sse_streams_open',
    'Open streams of the staff event stream on this process.',
    [],
    async () => [{ labels: {}, value: realtime.streams.openCount() }],
    { cacheSeconds: 0 },
  )

  // A leaf (DR-279): nothing calls it. It asks `building` whether the building of a batch is the demo one.
  const { usage: usageConfig } = config
  const analytics = installAnalytics({
    logger,
    clock,
    ids,
    database,
    building: building.api,
    guards,
    config: {
      enabled: usageConfig.USAGE_ENABLED,
      rawRetentionDays: usageConfig.USAGE_RAW_RETENTION_DAYS,
      dailyRetentionDays: usageConfig.USAGE_DAILY_RETENTION_DAYS,
      eventsPerMinutePerIp: http.USAGE_EVENTS_PER_MINUTE_PER_IP,
      eventsPerHourPerSession: http.USAGE_EVENTS_PER_HOUR_PER_SESSION,
      timeZone: core.JOBS_TIME_ZONE,
      rollupGraceMinutes: jobsConfig.JOB_USAGE_ROLLUP_GRACE_MINUTES,
    },
    metrics: metrics.port,
  })
  installed.push(analytics)

  const jobRunStore = new SqlJobRunStore(database)
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
      store: jobRunStore,
      buildings: async () =>
        (await building.api.listBuildings()).map(({ buildingId }) => ({ buildingId })),
      timeZone: core.JOBS_TIME_ZONE,
      tickSeconds: jobsConfig.JOBS_SCHEDULER_TICK_SECONDS,
      onRun: metrics.jobRun,
    },
    dbPoolMax: db.DB_POOL_MAX,
    onHandler: metrics.handler,
    maintenance: {
      pollIntervalMs: core.MAINTENANCE_POLL_INTERVAL_MS,
      store: overrides.maintenanceStore,
    },
  })
  const lifecycle: Lifecycle = { stopping: false }

  const isWorker = core.APP_ROLES.includes('worker')
  // The gauges the modules define from their own tables (`otp_challenges_24h`, `units_without_owner`, …).
  for (const gauge of installed.flatMap((module) => module.gauges ?? []))
    metrics.metrics.pulled(gauge.name, gauge.help, gauge.labelNames ?? [], gauge.read)
  registerPulledMetrics(
    metrics,
    {
      database,
      jobRuns: jobRunStore,
      outboxes: new OutboxStats(database, outboxSourcesOf(MODULE_CATALOG)),
      // The same answer as `/health/ready` on the ops port, so `ReadinessFailing` and the probe never disagree.
      ready: async () => {
        if (lifecycle.stopping) return false
        await database.ping()
        if (isWorker) await runtime.relayCheck.ping()
        return true
      },
      worker: isWorker
        ? {
            relayLastPassAt: () => runtime.relay.lastPassAt,
            jobLastSuccess: () => runtime.jobs.lastSuccess,
          }
        : undefined,
    },
    metricsSettings,
  )

  // The idempotency sweep of DOC-38 §4.2: hourly, in the process that answers requests; `token_purge` is the second net.
  const sweep = setInterval(() => {
    idempotencyStore
      .purge(new Date(clock.now().getTime() - IDEMPOTENCY_RETENTION_MS))
      .catch((error) => logger.warn({ err: error }, 'idempotency_sweep_failed'))
  }, IDEMPOTENCY_SWEEP_MS)
  sweep.unref()

  return {
    config,
    logger,
    clock,
    ids,
    database,
    metrics,
    building,
    identity,
    residency,
    finance,
    notification,
    realtime,
    analytics,
    /** The seed of the demo building (DOC-36 §9.1). */
    demoPlan,
    guards,
    termsGate,
    /** What `bootGuard` reads (DOC-36 §10.1). */
    bootGuard: {
      identity: identity.api,
      accountBuildings: overrides.accountBuildings ?? {
        buildingIdsOfAccounts: async (accountIds) =>
          (await residency.api.buildingIdsOfAccounts([...accountIds])).map((row) => row.buildingId),
      },
      building: building.api,
      piiKeyIds: () => residency.api.piiKeyIds(),
      rings: {
        settings: Object.keys(secrets.SETTINGS_ENCRYPTION_KEYS),
        pii: secrets.PII_ENCRYPTION_KEYS ? Object.keys(secrets.PII_ENCRYPTION_KEYS) : null,
      },
      // A stand-in is right until the module that answers for the port is installed (check 5, DOC-36 §10.1): then it must be bound.
      standIns: [
        // `ActiveIntentProbe` is no longer listed: `finance` is installed and answers it (P2-01).
        ...(overrides.tickets === undefined && MODULE_NAMES.includes('tickets')
          ? ['OpenTicketsProbe']
          : []),
      ],
    },
    /** The installed modules, in install order. */
    modules: installed as readonly AppModule[],
    runtime,
    maintenance: runtime.maintenance,
    lifecycle,
    /** Stops the timers and closes the pool. The HTTP servers and the worker are stopped first by the caller. */
    close: () => {
      clearInterval(sweep)
      return runtime.close()
    },
  }
}

export type Container = ReturnType<typeof createContainer>
