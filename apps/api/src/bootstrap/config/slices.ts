import { defineSlice } from '@core/config'
import { z } from 'zod'
import { bool, csvList, enumOf, int, secret, semver, str, timeZone, url } from './fields'
import { hmacKey, jwtRing, keyRing32 } from './rings'

/**
 * The configuration of `api` and `worker`, one slice per section of DOC-41 (§4 to §14). A key is added here in the same change
 * that adds it to the document (DOC-12 §14 rule 13); test CF-01 compares the two. A slice moves into its module's `./config`
 * export when the module is created (DOC-12 §2.3).
 */

export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const
export const APP_ROLES = ['api', 'worker'] as const

const processConfig = defineSlice({
  title: 'Process and runtime (DOC-41 §4)',
  example: { APP_ENV: 'local' },
  schema: z.object({
    APP_ENV: z
      .enum(APP_ENVS)
      .describe('The profile: local, test, staging or production. Never NODE_ENV.'),
    APP_ROLES: z
      .string()
      .default('api,worker')
      .transform((value) => value.split(',').map((item) => item.trim()))
      .pipe(z.array(z.enum(APP_ROLES)).min(1))
      .describe('Which parts start: `api` serves HTTP, `worker` runs the relay and the jobs.'),
    APP_PROCESSES: int(1, { min: 1 }).describe(
      'Kept from the vendored slice; the scaling unit is the container, so it stays 1.',
    ),
    PORT: int(3000, { min: 1, max: 65535 }).describe('HTTP port of `api`.'),
    OPS_PORT: int(3001, { min: 1, max: 65535 }).describe(
      '`/health/*` and `/metrics`; never routed by Caddy or the Tunnel.',
    ),
    LOG_LEVEL: enumOf(
      ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      'info',
    ).describe('pino level.'),
    TRUSTED_PROXY_HOPS: int(0, { max: 3 }).describe(
      'Proxies between the socket and the client (the client-IP rule of DOC-39 §5.3).',
    ),
    TRUSTED_PROXY_CIDRS: csvList('').describe('Peers whose forwarding headers are believed.'),
    MAINTENANCE_POLL_INTERVAL_MS: int(1000, { min: 1 }).describe('Poll of `platform.maintenance`.'),
    READINESS_DB_TIMEOUT_MS: int(2000, { min: 1 }).describe(
      'The database ping of `/health/ready`.',
    ),
    WORKER_STOP_TIMEOUT_SECONDS: int(40, { min: 1 }).describe(
      'Wait for running jobs at shutdown (`worker`).',
    ),
    SHUTDOWN_DRAIN_SECONDS: int(0, { min: 0, max: 30 }).describe(
      'Wait at shutdown, after `/health/ready` answers 503 and before the HTTP port closes, so that the proxy stops routing here (`api`).',
    ),
    JOBS_TIME_ZONE: timeZone('Asia/Ho_Chi_Minh').describe(
      'Zone of the clock jobs (`worker`); the process itself runs in UTC.',
    ),
  }),
})

const databaseConfig = defineSlice({
  title: 'Database (DOC-41 §5)',
  notes: 'Each URL has a `_FILE` form; in staging and production only that form is accepted.',
  schema: z.object({
    DATABASE_URL: secret.pipe(url).describe('Role `rms_app`, DML only.'),
    MIGRATION_DATABASE_URL: secret
      .pipe(url)
      .optional()
      .describe(
        'Role `rms_migrator`; read only by the migration step, never mounted in `api` or `worker`.',
      ),
    READONLY_DATABASE_URL: secret
      .pipe(url)
      .optional()
      .describe('Role `rms_readonly`; read only by the exporter container.'),
    DB_POOL_MAX: int(10, { min: 4 }).describe(
      'Connections per process; `OUTBOX_CONCURRENCY` is capped at this minus 4.',
    ),
    DB_PREPARE: bool('false').describe('Prepared statements; off keeps the code PgBouncer-safe.'),
  }),
})

const secretsConfig = defineSlice({
  title: 'Secrets and key rings (DOC-41 §6)',
  notes:
    'Each has a `_FILE` form. A ring is `{"<kid>": "<key>"}`: the newest kid signs, all verify.',
  schema: z.object({
    JWT_KEYS: jwtRing()
      .optional()
      .describe('ES256 private keys (PEM) by kid; signs and verifies access tokens (`api`).'),
    QR_KEYS: keyRing32()
      .optional()
      .describe('Base64 32-byte keys by kid; signs and verifies QR tokens (`api`).'),
    OTP_HMAC_KEY: hmacKey()
      .optional()
      .describe('Base64 of at least 32 bytes; HMAC of OTP and step-up codes (`api`).'),
    SETTINGS_ENCRYPTION_KEYS: keyRing32()
      .optional()
      .describe('AES-256-GCM ring of `gateway_config.secrets_enc` and command secrets.'),
    PII_ENCRYPTION_KEYS: keyRing32()
      .optional()
      .describe('AES-256-GCM ring of `resident_profile.cccd_enc` (`api`).'),
    S3_ACCESS_KEY_ID: secret.optional().describe('Files bucket access key.'),
    S3_SECRET_ACCESS_KEY: secret.optional().describe('Files bucket secret key.'),
    SMTP_PASSWORD: secret
      .optional()
      .describe('Mail relay password (`worker` in staging and production).'),
    EXPO_ACCESS_TOKEN: secret
      .optional()
      .describe('Expo push access token (`worker` in staging and production).'),
    DEMO_STAFF_PASSWORD: secret
      .min(12, 'must be at least 12 characters')
      .optional()
      .describe('Password of the seeded demo staff; at least 12 characters.'),
  }),
})

const httpConfig = defineSlice({
  title: 'HTTP and API (DOC-41 §7)',
  example: { CORS_ORIGINS: 'http://localhost:5173' },
  schema: z.object({
    CORS_ORIGINS: csvList('http://localhost:5173').describe(
      'Origins allowed to call the API from a browser.',
    ),
    ADMIN_BASE_URL: url
      .default('http://localhost:5173')
      .describe('Base of invite and reset links.'),
    APP_DOWNLOAD_URL: url.optional().describe('Link in the invitation SMS.'),
    MIN_APP_VERSION_RESIDENT: semver('1.0.0').describe(
      'Below it the API answers 426 `upgrade_required` (resident app).',
    ),
    MIN_APP_VERSION_STAFF: semver('1.0.0').describe(
      'Below it the API answers 426 `upgrade_required` (staff app).',
    ),
    STORE_URL_RESIDENT_IOS: url.optional().describe('Store link of the resident app on iOS.'),
    STORE_URL_RESIDENT_ANDROID: url
      .optional()
      .describe('Store link of the resident app on Android.'),
    STORE_URL_STAFF_IOS: url.optional().describe('Store link of the staff app on iOS.'),
    STORE_URL_STAFF_ANDROID: url.optional().describe('Store link of the staff app on Android.'),
    IDEMPOTENCY_TTL_HOURS: int(24, { min: 1 }).describe('Retention of `platform.idempotency_key`.'),
    API_BODY_LIMIT_BYTES: int(2097152, { min: 1 }).describe(
      'Body limit when Caddy is absent (local, test).',
    ),
    OPENAPI_ENABLED: bool('true').describe(
      'OpenAPI and Scalar at `/api/v1/openapi.json` and `/api/v1/docs`; refused in production.',
    ),
    SETTINGS_CACHE_SECONDS: int(60).describe('Process cache of the building settings.'),
    FEATURE_TICKET_DEADLINES: bool('false').describe('Ticket deadlines.'),
    CLIENT_ERRORS_PER_MINUTE_PER_IP: int(10, { min: 1 }).describe('`POST /client-errors` per IP.'),
    CLIENT_ERRORS_PER_HOUR_PER_ACCOUNT: int(30, { min: 1 }).describe(
      '`POST /client-errors` per account.',
    ),
    USAGE_EVENTS_PER_MINUTE_PER_IP: int(30, { min: 1, max: 600 }).describe(
      '`POST /me/usage-events` and `POST /staff/usage-events` per IP (DR-279).',
    ),
    USAGE_EVENTS_PER_HOUR_PER_SESSION: int(120, { min: 1, max: 3600 }).describe(
      'The same routes, per random session id of the client (DR-279).',
    ),
  }),
})

const identityConfig = defineSlice({
  title: 'Identity and sessions (DOC-41 §8)',
  schema: z.object({
    ACCESS_TOKEN_TTL_SECONDS: int(900, { min: 1 }).describe('Access token lifetime.'),
    REFRESH_TTL_DAYS_STAFF: int(30, { min: 1 }).describe(
      'Sliding refresh lifetime of a staff session.',
    ),
    REFRESH_TTL_DAYS_RESIDENT: int(180, { min: 1 }).describe(
      'Sliding refresh lifetime of a resident session.',
    ),
    FAMILY_MAX_DAYS_STAFF: int(90, { min: 1 }).describe(
      'Absolute lifetime of a staff refresh family.',
    ),
    FAMILY_MAX_DAYS_RESIDENT: int(365, { min: 1 }).describe(
      'Absolute lifetime of a resident refresh family.',
    ),
    MAX_FAMILIES_PER_ACCOUNT: int(10, { min: 1 }).describe(
      'Live sessions per account; the oldest is evicted.',
    ),
    REFRESH_GRACE_SECONDS: int(10).describe(
      'Window in which a rotated token is accepted once more.',
    ),
    ARGON2_MEMORY_KIB: int(19456, { min: 8 }).describe('Argon2id memory cost.'),
    ARGON2_TIME_COST: int(2, { min: 1 }).describe('Argon2id time cost.'),
    INVITE_TTL_HOURS: int(24, { min: 1 }).describe('Invitation link lifetime.'),
    RESET_TTL_MINUTES: int(30, { min: 1 }).describe('Password reset link lifetime.'),
    STEPUP_TTL_MINUTES: int(10, { min: 1 }).describe('Step-up code lifetime.'),
    STEPUP_MAX_ATTEMPTS: int(5, { min: 1 }).describe('Wrong step-up codes before the code dies.'),
    STEPUP_REQUESTS_PER_HOUR: int(5, { min: 1 }).describe(
      'Step-up code requests per staff member.',
    ),
    OTP_TTL_SECONDS: int(300, { min: 1 }).describe('OTP lifetime.'),
    OTP_RESEND_AFTER_SECONDS: int(45).describe('Earliest resend of an OTP.'),
    OTP_MAX_ATTEMPTS: int(5, { min: 1 }).describe('Wrong OTP codes before the challenge ends.'),
    OTP_PER_PHONE_PER_HOUR: int(5, { min: 1 }).describe('OTP requests per phone per hour.'),
    OTP_PER_IP_PER_HOUR: int(20, { min: 1 }).describe('OTP requests per IP per hour.'),
    OTP_DAILY_CAP: int(3000, { min: 1 }).describe('SMS per day for the whole deployment.'),
    STAFF_LOGIN_PER_IP: int(30, { min: 1 }).describe(
      'Staff sign-in attempts per IP per 15 minutes.',
    ),
    RESET_PER_EMAIL_PER_HOUR: int(3, { min: 1 }).describe(
      'Password reset requests per email per hour.',
    ),
    RESET_PER_IP_PER_HOUR: int(10, { min: 1 }).describe('Password reset requests per IP per hour.'),
    RESET_MIN_RESPONSE_MS: int(150).describe('Floor of the reset-request answer time.'),
    SMS_DOWN_FAILURES: int(3, { min: 1 }).describe(
      'Failing commands that mark the SMS provider down.',
    ),
    MEMBER_INVITES_PER_DAY: int(10, { min: 1, max: 100 }).describe(
      'Invitations an owner may send per building day.',
    ),
  }),
})

const driversConfig = defineSlice({
  title: 'Notification drivers (DOC-41 §9)',
  schema: z.object({
    SMS_DRIVER: enumOf(['console', 'allowlist', 'provider'], 'console').describe(
      '`provider` is required in production.',
    ),
    MAIL_DRIVER: enumOf(['console', 'allowlist', 'smtp'], 'console').describe(
      '`smtp` is required in production.',
    ),
    SMS_ALLOWLIST: csvList('').describe('Phones that may receive a real SMS (staging).'),
    MAIL_ALLOWLIST: csvList('').describe('Addresses that may receive a real mail (staging).'),
    SMS_BRAND: z
      .string()
      .min(1)
      .max(11, 'must be at most 11 characters')
      .optional()
      .describe('Registered sender text; required in production.'),
    SMTP_HOST: z
      .string()
      .min(1)
      .optional()
      .describe('Mail relay host; required when `MAIL_DRIVER=smtp`.'),
    SMTP_PORT: int(587, { min: 1, max: 65535 }).describe('Mail relay port.'),
    SMTP_USER: z
      .string()
      .min(1)
      .optional()
      .describe('Mail relay user; required when `MAIL_DRIVER=smtp`.'),
    MAIL_FROM: z
      .string()
      .min(1)
      .optional()
      .describe('From address of every mail; required when `MAIL_DRIVER=smtp`.'),
  }),
})

const filesConfig = defineSlice({
  title: 'Files: S3 and uploads (DOC-41 §10)',
  schema: z.object({
    S3_ENDPOINT: url
      .optional()
      .describe(
        'Where the API reaches the bucket (the SeaweedFS S3 gateway in `vn` and locally; the R2 account endpoint in `global`, DR-268).',
      ),
    S3_PUBLIC_ENDPOINT: url
      .optional()
      .describe('What clients are told; defaults to `S3_ENDPOINT`.'),
    S3_REGION: str('auto').describe('Bucket region.'),
    S3_BUCKET: z
      .string()
      .min(1)
      .optional()
      .describe('Bucket name; defaults to `rms-<APP_ENV>-files`.'),
    S3_FORCE_PATH_STYLE: bool('false').describe('`true` for the local object store.'),
    FILES_UPLOAD_URL_TTL_SECONDS: int(900, { min: 1 }).describe('Presigned PUT lifetime.'),
    FILES_DOWNLOAD_URL_TTL_SECONDS: int(900, { min: 1 }).describe('Presigned GET lifetime.'),
    FILES_PAPER_URL_TTL_SECONDS: int(300, { min: 1 }).describe(
      'Presigned GET lifetime of a vehicle paper.',
    ),
    FILES_MAX_IMAGE_BYTES: int(10485760, { min: 1 }).describe('Maximum image upload.'),
    FILES_MAX_VIDEO_BYTES: int(52428800, { min: 1 }).describe('Maximum video upload.'),
    FILES_MAX_ATTACHMENT_BYTES: int(20971520, { min: 1 }).describe('Maximum attachment upload.'),
    FILES_MAX_IMPORT_BYTES: int(5242880, { min: 1 }).describe('Maximum import file.'),
    FILES_MAX_LOGO_BYTES: int(1048576, { min: 1 }).describe('Maximum building logo.'),
    FILES_GENERATED_MAX_BYTES: int(1073741824, { min: 1 }).describe('Ceiling of a generated file.'),
    FILES_THUMBNAIL_WIDTH: int(480, { min: 1 }).describe('Thumbnail width in pixels.'),
    FILES_LOGO_WIDTH: int(512, { min: 1 }).describe('Logo width in pixels.'),
    FILES_ORPHAN_AFTER_HOURS: int(24, { min: 1 }).describe(
      'Age at which an unattached upload is deleted.',
    ),
    FILES_DELETED_ROW_RETENTION_DAYS: int(90, { min: 1 }).describe(
      'How long a deleted file row is kept.',
    ),
    FILES_BULK_ZIP_DAYS: int(7, { min: 1 }).describe('How long a bulk zip is kept.'),
    UPLOAD_RATE_PER_HOUR: int(60, { min: 1 }).describe('Bucket `upload:account:<id>`.'),
  }),
})

/** The clock jobs that have a catch-up window (DOC-38 §4.1); the hourly jobs have none. */
export const CLOCK_JOB_GRACE_MINUTES = {
  INVARIANT_CHECK: 720,
  USAGE_ROLLUP: 720,
  QR_SCAN_PURGE: 720,
  OTP_PURGE: 720,
  TOKEN_PURGE: 720,
  ACCOUNT_DELETION: 720,
  DEMO_RESET: 120,
  INTEGRITY_WEEKLY: 1440,
  INTEGRITY_NOTICES: 1440,
  INBOX_PURGE: 1440,
  IMPORT_PURGE: 1440,
  FINANCE_PURGE: 1440,
  AUDIT_PURGE: 10080,
} as const

type ClockJob = keyof typeof CLOCK_JOB_GRACE_MINUTES
type JobGraceShape = { [J in ClockJob as `JOB_${J}_GRACE_MINUTES`]: ReturnType<typeof int> }

const jobGraceKeys = Object.fromEntries(
  Object.entries(CLOCK_JOB_GRACE_MINUTES).map(([job, minutes]) => [
    `JOB_${job}_GRACE_MINUTES`,
    int(minutes).describe(`Catch-up window of the \`${job.toLowerCase()}\` clock job; 0 = none.`),
  ]),
) as JobGraceShape

const jobsConfig = defineSlice({
  title: 'Jobs and outbox (DOC-41 §11)',
  schema: z.object({
    OUTBOX_POLL_INTERVAL_MS: int(500, { min: 1 }).describe('Sleep when a pass found nothing.'),
    OUTBOX_BATCH_SIZE: int(50, { min: 1 }).describe('Rows claimed per source per pass.'),
    OUTBOX_CONCURRENCY: int(4, { min: 1 }).describe(
      'Aggregate groups in parallel; at most `DB_POOL_MAX` minus 4.',
    ),
    OUTBOX_LEASE_SECONDS: int(60, { min: 1 }).describe('Lease of a claim.'),
    OUTBOX_MAX_ATTEMPTS: int(8, { min: 1 }).describe('Attempts of an ordinary message.'),
    OUTBOX_SMS_MAX_ATTEMPTS: int(3, { min: 1 }).describe('Attempts of an SMS command.'),
    OUTBOX_PUSH_MAX_ATTEMPTS: int(3, { min: 1 }).describe('Attempts of a push command.'),
    OUTBOX_INTENT_CANCEL_MAX_ATTEMPTS: int(8, { min: 1 }).describe(
      'Attempts of an intent cancellation.',
    ),
    OUTBOX_BACKOFF_BASE_SECONDS: int(5, { min: 1 }).describe(
      '`min(base × 2^(attempts − 1), max)`.',
    ),
    OUTBOX_BACKOFF_MAX_SECONDS: int(900, { min: 1 }).describe('Ceiling of the back-off.'),
    OUTBOX_DEFER_BUDGET_HOURS: int(24, { min: 1 }).describe(
      'How long a `RetryLaterError` may defer a message.',
    ),
    OUTBOX_RETENTION_DAYS: int(7, { min: 1 }).describe(
      'Published outbox rows and delivered inbox rows are kept this long.',
    ),
    OUTBOX_CLEANUP_INTERVAL_MINUTES: int(10, { min: 1 }).describe('Cleanup pass.'),
    OUTBOX_MAX_PAYLOAD_BYTES: int(65536, { min: 1 }).describe('Writer wrapper limit.'),
    JOBS_SCHEDULER_TICK_SECONDS: int(15, { min: 1 }).describe(
      'Wake-up of the scheduler; "on time" is two ticks.',
    ),
    JOB_RUN_RETENTION_DAYS: int(30, { min: 1 }).describe(
      'Age at which `token_purge` deletes `job_run` rows.',
    ),
    ...jobGraceKeys,
  }),
})

const concurrencyConfig = defineSlice({
  title: 'Concurrency of the worker (DOC-41 §12)',
  schema: z.object({
    PDF_CONCURRENCY: int(1, { min: 1 }).describe('PDFs rendered at once.'),
    EXPORT_CONCURRENCY: int(2, { min: 1 }).describe('Exports streamed at once.'),
  }),
})

const observabilityConfig = defineSlice({
  title: 'Observability (DOC-41 §13)',
  schema: z.object({
    METRICS_QUERY_TIMEOUT_MS: int(1500, { min: 1 }).describe(
      'Time a database-derived gauge may take at a scrape.',
    ),
    METRICS_CACHE_SECONDS: int(10).describe('A gauge computed less than this long ago is reused.'),
  }),
})

/** Usage analytics (DR-279, DOC-104): the module `analytics` reads these. */
const usageConfig = defineSlice({
  title: 'Usage analytics (DOC-41 §13A)',
  schema: z.object({
    USAGE_ENABLED: bool('true').describe(
      'false discards every usage event (204) and counts it as dropped `disabled`.',
    ),
    USAGE_RAW_RETENTION_DAYS: int(90, { min: 7, max: 365 }).describe(
      'Age at which `analytics.usage_event` rows are deleted by `usage_rollup`.',
    ),
    USAGE_DAILY_RETENTION_DAYS: int(730, { min: 90, max: 3650 }).describe(
      'Age at which `analytics.usage_daily` rows are deleted by `usage_rollup`.',
    ),
  }),
})

/** Rows of DOC-41 §14: final names and defaults, read by a later phase. Listed so that a typo of one is refused too. */
const laterConfig = defineSlice({
  title: 'Keys of later phases (DOC-41 §14)',
  schema: z.object({
    WEBHOOK_KNOWN_IPS: csvList('').describe(
      'Source ranges of the payment gateway; empty = no check.',
    ),
    WEBHOOK_PER_MINUTE_PER_IP: int(60, { min: 1 }).describe(
      'Rate of inserts into `finance.webhook_rejection` per IP.',
    ),
    WEBHOOK_MAX_BODY_BYTES: int(16384, { min: 1 }).describe('Body limit of the webhook route.'),
    WEBHOOK_REJECTION_EXCERPT_BYTES: int(2048, { min: 1 }).describe(
      'Excerpt stored with a rejection.',
    ),
    INTENT_TTL_MINUTES: int(60, { min: 1 }).describe('Life of a payment intent.'),
    INTENT_REQUERY_BATCH: int(20, { min: 1 }).describe(
      'Intents claimed per tick of `intent_requery`.',
    ),
    INTENT_CREATING_STALE_SECONDS: int(120, { min: 1 }).describe(
      'A `creating` intent older than this is cleaned.',
    ),
    GATEWAY_CALLS_IN_FLIGHT: int(5, { min: 1 }).describe(
      'Concurrent gateway calls of the re-query job.',
    ),
    INTENT_CREATE_PER_MINUTE: int(10, { min: 1 }).describe('Bucket `intent:account:<id>`.'),
    DEBT_REMINDER_PER_HOUR: int(10, { min: 1 }).describe('Bucket `reminder:account:<id>`.'),
    QR_ISSUE_PER_MINUTE: int(30, { min: 1 }).describe('Bucket `qr:account:<id>`.'),
    QR_TTL_SECONDS: int(900, { min: 1 }).describe('Lifetime of a QR token.'),
    NOTICE_FANOUT_BATCH: int(500, { min: 1 }).describe('Recipients per fan-out transaction.'),
    NOTICE_RECLAIM_AFTER_MINUTES: int(5, { min: 1 }).describe(
      'Age of a `sending` heartbeat before a notice is reclaimed.',
    ),
    PUSH_CHUNK_SIZE: int(100, { min: 1 }).describe('Messages per Expo request.'),
    PUSH_RECEIPT_DELAY_MINUTES: int(15, { min: 1 }).describe(
      'Age of a ticket before its receipt is read.',
    ),
    PUSH_TICKET_RETENTION_DAYS: int(3, { min: 1 }).describe(
      'Age at which `push_receipts` deletes tickets.',
    ),
    SSE_MAX_STREAMS_PER_ACCOUNT: int(3, { min: 1 }).describe(
      'Concurrent `GET /staff/events` streams per account.',
    ),
    SSE_HEARTBEAT_SECONDS: int(25, { min: 1 }).describe(
      'Must stay below 30 (Cloudflare closes a silent request after 100 s).',
    ),
    STATEMENT_MAX_BYTES: int(5242880, { min: 1 }).describe('Bank statement file.'),
  }),
})

/** The slices in the order of `.env.example`. */
export const CONFIG_SLICES = {
  core: processConfig,
  db: databaseConfig,
  secrets: secretsConfig,
  http: httpConfig,
  identity: identityConfig,
  drivers: driversConfig,
  files: filesConfig,
  jobs: jobsConfig,
  concurrency: concurrencyConfig,
  observability: observabilityConfig,
  usage: usageConfig,
  later: laterConfig,
} as const
