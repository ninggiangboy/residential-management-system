# Configuration reference

> Status: **Approved** (Owner, 2026-10-21, as the skeleton (gate P1)) · Updated: 2026-10-21 (P1-04: the schema is written, CF-01…18 run, the `_FILE` and prefix rules as built, DR-235; earlier: DR-68, DR-228: `SMS_*` names fixed at P1-22, `STORE_URL_*` placeholders; earlier: skeleton, P0-30; DR-151…156) · DOC-41
> Depends on: original SDD §6.5, §7.3, §19.1, [DR](../00-decision-register.md) (DR-07, 37, 39, 62, 64, 65, 69, 83, 101, 113, 156, DR-68, DR-228), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §7.2, [DOC-10](../03-architecture/quality-attributes.md) §6, [DOC-11](../03-architecture/tech-stack-and-versions.md) §3, §6.4, [DOC-12](../03-architecture/code-architecture.md) §2.3, [DOC-17](../05-data/operations-model.md) §1.2, [DOC-26](identity-and-sessions.md) §9, [DOC-27](residency-and-memberships.md) §14, [DOC-36](building-configuration-and-demo.md) §11, [DOC-37](files-and-uploads.md) §11.1, [DOC-38](jobs-and-outbox-runtime.md) §2.6, §3.6, [DOC-50](../07-api/api-guidelines.md) §16
> Main readers: P1-03, P1-04 (the configuration slices and the boot check), P1-07, P1-10, P1-11, P1-22, P1-20 (the VPS), DOC-39, DOC-40, DOC-69, DOC-70, DOC-71, DOC-73, every task that adds a key

This document lists every configuration key of the system: the environment variables of `api` and `worker`, the build-time variables of the web CMS and the two mobile apps, the secrets, and their defaults per profile. It also lists the building settings, only to say they are **not** environment. It does not explain what a key does beyond one sentence: the behavior lives in the document named in the *Source* column. It does not hold infrastructure configuration (the Caddyfile, `docker-compose.yml`, the Prometheus and Alertmanager files): those are DOC-70 and DOC-40.

**State of this skeleton.** Every key that a phase 1 task reads is listed with its final default (§4 to §13). Keys of later phases are listed in §14 with the default their decision gives; their rows say which document will confirm them. A key is added here in the same change that introduces it (DOC-12 §14 rule 13).

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| Environment of `api` and `worker` (the same image, `APP_ROLES` decides, DOC-07 §4) | §4 to §14 |
| Secrets and key rings | §6 |
| Variables of the web CMS (build time) and of the mobile apps (build profile) | §15 |
| Which key differs between `local`, `test`, `staging` and `production` | §16 |
| What the boot check refuses | §17 |
| Building settings (a row in the database, edited by the Admin) | §18 |
| Tests (`CF-`) | §19 |

## 2. How configuration is read

1. **One schema, many slices.** `@core/config` (vendored, DOC-12 §13) parses `process.env` once at boot with a schema (zod, as in the reference) and hands each module a typed slice (`FinanceConfig`, `IdentityConfig`; DOC-12 §2.3). A module never reads `process.env`. The schema is the source of the generated `.env.example`; this document is the source of the *meaning*. Test CF-01 compares the two. **As built (P1-04, DR-235):** the slices are in `apps/api/src/bootstrap/config/slices.ts`, one per section of this document (`core`, `db`, `secrets`, `http`, `identity`, `drivers`, `files`, `jobs`, `concurrency`, `observability`, `later`); a slice moves into its module's `./config` export when the module is created. `loadAppConfig` (`load.ts`) reads the `_FILE` form, applies §17 and returns the typed slices or throws `ConfigError`; `main.ts` turns that into the `config_invalid` line and exit 78. An empty variable counts as unset (a compose `${VAR:-}`). `.env.example` is written by `bun run config:example`.
2. **Names.** `UPPER_SNAKE`. A unit is the suffix: `_SECONDS`, `_MS`, `_MINUTES`, `_HOURS`, `_DAYS`, `_BYTES`, `_KIB`, `_PER_HOUR`. A boolean is `true` or `false` (nothing else; `1` and `yes` are refused). An enumeration lists its values in the *Type* column.
3. **Types.** `int` (decimal, no separators), `bool`, `enum`, `string`, `url`, `semver`, `csv` (comma separated, items trimmed, empty items refused), `json` (one JSON document on one line), `secret` (never logged, never echoed by a boot error).
4. **Secrets are files.** A `secret` key `K` is read from the file named by `K_FILE` (Docker secret under `/etc/rms/secrets`, DR-65). In `staging` and `production` the plain `K` is **refused** when `K_FILE` is absent (a plain variable shows in `docker inspect`); in `local` and `test` either is accepted. A file is read once at boot, trailing newline removed.
5. **Defaults are for `local`.** The *Default* column is the value when the key is unset and the profile is `local`. A key that is required in `staging` and `production` says so in *Profiles*. A default that differs per profile is in §16.
6. **A key has one reader.** The *Read by* column is `api`, `worker` or both. A key that a role does not read may be absent from that role's environment; a key it reads and lacks stops the boot (§17).
7. **No key is changed at run time.** A change needs a restart (a rolling restart, DOC-07 §4.3). The only values changed while running are the building settings (§18) and the maintenance flag (`platform.maintenance`, DOC-38 §5.3).
8. **A threshold is a key** (master plan §1 principle). A number that is a constant of the code (a column width, a page limit, a lookup cap) is listed in §18 so nobody looks for a key that does not exist.

## 3. Profiles

| Profile | Where | `APP_ENV` | Notes |
| --- | --- | --- | --- |
| `local` | A developer machine (`bun run dev`, one process with `APP_ROLES=api,worker`) | `local` | Console drivers, OpenAPI on, secrets from `.env.local` made by `bun run keys:generate` |
| `test` | `bun test`, CI | `test` | Console drivers, logger silent, a throw-away database per run |
| `staging` | The staging VPS (DR-83) | `staging` | The `allowlist` drivers; the demo building only; OpenAPI on |
| `production` | The production VPS | `production` | Provider drivers; the boot guard refuses unsafe values (DOC-36 §10.1); OpenAPI off |

`NODE_ENV` is not used for this: it stays `production` in every image and Expo overrides it (DOC-11 §6.4).

## 4. Process and runtime

Read by `api` and `worker` unless the column says otherwise.

| Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- |
| `APP_ENV` | enum `local`, `test`, `staging`, `production` | none | **required** everywhere | The profile of §3; the boot guard and the drivers read it (DOC-36 §10.1) |
| `APP_ROLES` | csv of `api`, `worker` | `api,worker` | compose: `api` on `api-1`, `api-2`; `worker` on `worker` | Which parts start (DOC-07 §4, ADR-0015) |
| `APP_PROCESSES` | int ≥ 1 | 1 | 1 everywhere | Kept from the vendored slice; the scaling unit is the container, so the value stays 1 (DOC-10 §6.3) |
| `PORT` | int | 3000 | | HTTP port of `api` (DOC-07 §4.3) |
| `OPS_PORT` | int | 3001 | | `/health/live`, `/health/ready`, `/metrics`; bound to the Docker network, never routed by Caddy or the Tunnel (DR-07, DR-156) |
| `LOG_LEVEL` | enum `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info` | `local` `debug`; `test` `silent` | pino level (DOC-42 §8) |
| `TRUSTED_PROXY_HOPS` | int 0…3 | 0 | `staging`, `production` 1 | Proxies between the socket and the client; the client-IP rule is DOC-39 §5.3 |
| `TRUSTED_PROXY_CIDRS` | csv of CIDR | empty | `staging`, `production`: `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128,fc00::/7` | Peers whose forwarding headers are believed (DOC-39 §5.3) |
| `MAINTENANCE_POLL_INTERVAL_MS` | int | 1000 | | Poll of `platform.maintenance` (DOC-38 §3.7, DOC-17 §3.4) |
| `READINESS_DB_TIMEOUT_MS` | int | 2000 | | The database ping of `/health/ready` (DOC-38 §5.2, DOC-10 §6.3) |
| `WORKER_STOP_TIMEOUT_SECONDS` | int | 40 | | Wait for running jobs at shutdown; read by `worker` (DOC-38 §5.4) |
| `JOBS_TIME_ZONE` | string (IANA) | `Asia/Ho_Chi_Minh` | | Zone of the clock jobs; read by `worker` (DOC-38 §3.3, ADR-0013). The process itself runs in UTC |

## 5. Database

| Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | secret url | none | **required** (`api`, `worker`) | Role `rms_app`, DML only (DOC-19 §2, DR-65) |
| `MIGRATION_DATABASE_URL` | secret url | none | read only by the migration step; **never mounted** in `api` or `worker` | Role `rms_migrator` (DR-113) |
| `READONLY_DATABASE_URL` | secret url | none | read only by the exporter container | Role `rms_readonly`, also the `postgres_exporter` user (DR-113) |
| `DB_POOL_MAX` | int ≥ 4 | 10 | `api`: staging 15, production 20; `worker`: staging 10, production 15 | Connections per process; there is no PgBouncer in phase 1 (DOC-10 §6.3). `OUTBOX_CONCURRENCY` is capped at `DB_POOL_MAX − 4` (DOC-38 §2.2) |
| `DB_PREPARE` | bool | `false` | | Prepared statements off keeps the code PgBouncer-safe (DOC-11 §3) |

Each `*_URL` has the `_FILE` form of §2 rule 4.

## 6. Secrets and key rings

Rotation and loss impact are DOC-39 §7 and RB-12; this table says the format.

| Key | Type · format | Required | Read by | Description (source) |
| --- | --- | --- | --- | --- |
| `JWT_KEYS` | secret json `{"k1": "<PEM>"}` (kid → ES256 private key) | `api` | `api` | Signs and verifies access tokens; the newest kid signs, all verify (DR-65, DOC-26 §8) |
| `QR_KEYS` | secret json `{"v1": "<base64, 32 bytes>"}` | `api` | `api` | Signs and verifies QR tokens; two valid during a rotation (DR-48, DR-65) |
| `OTP_HMAC_KEY` | secret string, base64 of ≥ 32 bytes | `api` | `api` | HMAC of OTP codes and step-up codes (DR-65) |
| `SETTINGS_ENCRYPTION_KEYS` | secret json `{"k1": "<base64, 32 bytes>"}` | `api`, `worker` | both | AES-256-GCM of `gateway_config.secrets_enc` and of command secrets (DR-33, DR-117) |
| `PII_ENCRYPTION_KEYS` | secret json, same shape | `api` | `api`; the re-encrypt job | `resident_profile.cccd_enc`; the sealed offline copy is mandatory (DR-58, DR-65) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | secret string | `api`, `worker` | both | Files bucket credentials (DOC-37 §11.1) |
| `SMS_*` | secret | `worker` in `staging`, `production` | `worker` | Provider credentials; the names are fixed in P1-22 after DR-68 records the provider |
| `SMTP_PASSWORD` | secret string | `worker` in `staging`, `production` | `worker` | Mail relay password (DR-65) |
| `EXPO_ACCESS_TOKEN` | secret string | `worker` in `staging`, `production` | `worker` | Expo push (DR-52) |
| `DEMO_STAFF_PASSWORD` | secret string ≥ 12 characters | `production` and `staging` when a demo building exists | `api`, `worker` | Password of the seeded demo staff (DOC-36 §11) |

A ring is refused when it is empty, when a value has the wrong length or encoding, or when a kid repeats (§17). A ring whose key is missing for a stored blob stops the boot (DOC-36 §10.1 check 6).

## 7. HTTP and API

| Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- |
| `CORS_ORIGINS` | csv of origins | `http://localhost:5173` | **required** in `staging` (`https://admin-staging.<domain>`) and `production` (`https://admin.<domain>`) | Origins allowed by DOC-50 §5.3 |
| `ADMIN_BASE_URL` | url | `http://localhost:5173` | **required** in `staging`, `production` | Base of invite and reset links (DOC-26 §9) |
| `APP_DOWNLOAD_URL` | url | none | **required** in `staging`, `production` | Link in the invitation SMS (DOC-26 §9, DR-137) |
| `MIN_APP_VERSION_RESIDENT`, `MIN_APP_VERSION_STAFF` | semver | `1.0.0` | | Below it the API answers 426 `upgrade_required` (DR-69, DR-145, DOC-50 §16) |
| `STORE_URL_RESIDENT_IOS`, `STORE_URL_RESIDENT_ANDROID`, `STORE_URL_STAFF_IOS`, `STORE_URL_STAFF_ANDROID` | url | none | **required** in `production` (the final links are Owner input, placeholders until P6-10, DR-228) | `details.storeUrl` of 426 and `GET /public/config` (DR-145) |
| `IDEMPOTENCY_TTL_HOURS` | int | 24 | | Retention of `platform.idempotency_key` (DR-74, DOC-50 §8) |
| `API_BODY_LIMIT_BYTES` | int | 2097152 | | Body limit when Caddy is absent (local, test); Caddy enforces 2 MB in staging and production (DOC-50 §16) |
| `OPENAPI_ENABLED` | bool | `true` | `test` `false`; `staging` `true`; `production` `false` (the boot guard refuses `true`) | OpenAPI and Scalar at `/api/v1/openapi.json`, `/api/v1/docs` (DR-64, AG-03) |
| `SETTINGS_CACHE_SECONDS` | int | 60 | | Process cache of `BuildingApi.getSettings` (DOC-36 §3.1) |
| `FEATURE_TICKET_DEADLINES` | bool | `false` | | Ticket deadlines (DOC-36 §3.3, DR-47) |
| `CLIENT_ERRORS_PER_MINUTE_PER_IP` | int | 10 | | `POST /client-errors` (DOC-42 §10) |
| `CLIENT_ERRORS_PER_HOUR_PER_ACCOUNT` | int | 30 | | The same, per account |

## 8. Identity and sessions

Source: DOC-26 §9, DOC-26 §6 (buckets), DOC-27 §14, DR-150. Read by `api` unless noted.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `ACCESS_TOKEN_TTL_SECONDS` | int | 900 | Access token lifetime |
| `REFRESH_TTL_DAYS_STAFF`, `REFRESH_TTL_DAYS_RESIDENT` | int | 30, 180 | Sliding refresh lifetime |
| `FAMILY_MAX_DAYS_STAFF`, `FAMILY_MAX_DAYS_RESIDENT` | int | 90, 365 | Absolute lifetime of a refresh family |
| `MAX_FAMILIES_PER_ACCOUNT` | int | 10 | Live sessions per account; the oldest is evicted |
| `REFRESH_GRACE_SECONDS` | int | 10 | Window in which a rotated token is accepted once more |
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` | int | 19456, 2 | Argon2id parameters (DR-39) |
| `INVITE_TTL_HOURS`, `RESET_TTL_MINUTES`, `STEPUP_TTL_MINUTES` | int | 24, 30, 10 | Link and code lifetimes |
| `STEPUP_MAX_ATTEMPTS`, `STEPUP_REQUESTS_PER_HOUR` | int | 5, 5 | Wrong codes before the code dies; code requests per staff member |
| `OTP_TTL_SECONDS`, `OTP_RESEND_AFTER_SECONDS`, `OTP_MAX_ATTEMPTS` | int | 300, 45, 5 | OTP parameters (original SDD §7.3) |
| `OTP_PER_PHONE_PER_HOUR`, `OTP_PER_IP_PER_HOUR`, `OTP_DAILY_CAP` | int | 5, 20, 3000 | OTP limits (DR-37) |
| `STAFF_LOGIN_PER_IP` | int | 30 | Sign-in attempts per IP per 15 minutes |
| `RESET_PER_EMAIL_PER_HOUR`, `RESET_PER_IP_PER_HOUR` | int | 3, 10 | Reset requests (DR-39) |
| `RESET_MIN_RESPONSE_MS` | int | 150 | Floor of the reset-request answer time (DR-150) |
| `SMS_DOWN_FAILURES` | int | 3 | Failing commands that mark the SMS provider down (DOC-26 §5.4) |
| `MEMBER_INVITES_PER_DAY` | int 1…100 | 10 | Invitations an owner may send per building day (DR-40); a deployment constant, not a building setting |

## 9. Notification drivers

| Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- |
| `SMS_DRIVER` | enum `console`, `allowlist`, `provider` | `console` | `staging` `allowlist`; `production` `provider` (the boot guard refuses the others) | DOC-26 §5.5 |
| `MAIL_DRIVER` | enum `console`, `allowlist`, `smtp` | `console` | `staging` `allowlist`; `production` `smtp` | DOC-26 §5.5 |
| `SMS_ALLOWLIST`, `MAIL_ALLOWLIST` | csv | empty | `staging` | Recipients that may receive a real message |
| `SMS_BRAND` | string ≤ 11 characters | none | **required** in `production` | Registered sender text (DR-68) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM` | string, int, string, string | none, 587, none, none | **required** when `MAIL_DRIVER=smtp` | The mail relay; the names are confirmed in P1-22 |

## 10. Files (S3 and uploads)

Source: DOC-37 §11.1. Read by `api` and `worker`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `S3_ENDPOINT` | url | the R2 account endpoint; `local` the local object store | Where the API reaches the bucket |
| `S3_PUBLIC_ENDPOINT` | url | `S3_ENDPOINT` | What clients are told; its host is `<files-host>` in the CSP (DOC-39 §5.1) |
| `S3_REGION`, `S3_BUCKET` | string | `auto`, `rms-<env>-files` | |
| `S3_FORCE_PATH_STYLE` | bool | `false` | `true` for the local store |
| `FILES_UPLOAD_URL_TTL_SECONDS` | int | 900 | Presigned `PUT` |
| `FILES_DOWNLOAD_URL_TTL_SECONDS`, `FILES_PAPER_URL_TTL_SECONDS` | int | 900, 300 | Presigned `GET` |
| `FILES_MAX_IMAGE_BYTES`, `FILES_MAX_VIDEO_BYTES`, `FILES_MAX_ATTACHMENT_BYTES`, `FILES_MAX_IMPORT_BYTES`, `FILES_MAX_LOGO_BYTES` | int | 10485760, 52428800, 20971520, 5242880, 1048576 | Per-purpose maxima (DOC-37 §4) |
| `FILES_GENERATED_MAX_BYTES` | int | 1073741824 | Ceiling of a generated file |
| `FILES_THUMBNAIL_WIDTH`, `FILES_LOGO_WIDTH` | int | 480, 512 | |
| `FILES_ORPHAN_AFTER_HOURS`, `FILES_DELETED_ROW_RETENTION_DAYS`, `FILES_BULK_ZIP_DAYS` | int | 24, 90, 7 | DOC-37 §14 |
| `UPLOAD_RATE_PER_HOUR` | int | 60 | Bucket `upload:account:<id>` (DR-64) |

## 11. Jobs and outbox

Source: DOC-38 §2.6, §3.6, §4.1. Read by `worker` (the outbox keys are also read by the `api` writer wrapper).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `OUTBOX_POLL_INTERVAL_MS` | int | 500 | Sleep when a pass found nothing |
| `OUTBOX_BATCH_SIZE` | int | 50 | Rows claimed per source per pass |
| `OUTBOX_CONCURRENCY` | int | 4 | Aggregate groups in parallel (≤ `DB_POOL_MAX − 4`) |
| `OUTBOX_LEASE_SECONDS` | int | 60 | Lease of a claim |
| `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_SMS_MAX_ATTEMPTS`, `OUTBOX_PUSH_MAX_ATTEMPTS`, `OUTBOX_INTENT_CANCEL_MAX_ATTEMPTS` | int | 8, 3, 3, 8 | Attempts per class |
| `OUTBOX_BACKOFF_BASE_SECONDS`, `OUTBOX_BACKOFF_MAX_SECONDS` | int | 5, 900 | `min(base × 2^(attempts − 1), max)` |
| `OUTBOX_DEFER_BUDGET_HOURS` | int | 24 | How long a `RetryLaterError` may defer a message |
| `OUTBOX_RETENTION_DAYS` | int | 7 | Published outbox rows and delivered inbox rows (DR-101) |
| `OUTBOX_CLEANUP_INTERVAL_MINUTES` | int | 10 | Cleanup pass |
| `OUTBOX_MAX_PAYLOAD_BYTES` | int | 65536 | Writer wrapper limit (DOC-09 §3.4) |
| `JOBS_SCHEDULER_TICK_SECONDS` | int | 15 | Wake-up of the scheduler; "on time" is two ticks |
| `JOB_RUN_RETENTION_DAYS` | int | 30 | Age at which `token_purge` deletes `job_run` rows |
| `JOB_<NAME>_GRACE_MINUTES` | int ≥ 0 | the table below | Catch-up window of one clock job; `<NAME>` is the job name in upper case; 0 = none |

Grace defaults (DOC-38 §4.1). The hourly jobs (`storage_quota`, `orphan_uploads`, `import_expire`, `export_purge`, `realtime_purge`) have 0 and the interval jobs have no key.

| Key | Default (minutes) | | Key | Default (minutes) |
| --- | --- | --- | --- | --- |
| `JOB_INVARIANT_CHECK_GRACE_MINUTES` | 720 | | `JOB_INTEGRITY_WEEKLY_GRACE_MINUTES` | 1440 |
| `JOB_QR_SCAN_PURGE_GRACE_MINUTES` | 720 | | `JOB_INTEGRITY_NOTICES_GRACE_MINUTES` | 1440 |
| `JOB_OTP_PURGE_GRACE_MINUTES` | 720 | | `JOB_INBOX_PURGE_GRACE_MINUTES` | 1440 |
| `JOB_TOKEN_PURGE_GRACE_MINUTES` | 720 | | `JOB_IMPORT_PURGE_GRACE_MINUTES` | 1440 |
| `JOB_ACCOUNT_DELETION_GRACE_MINUTES` | 720 | | `JOB_FINANCE_PURGE_GRACE_MINUTES` | 1440 |
| `JOB_DEMO_RESET_GRACE_MINUTES` | 120 | | `JOB_AUDIT_PURGE_GRACE_MINUTES` | 10080 |

## 12. Concurrency of the worker's own work

| Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- |
| `PDF_CONCURRENCY` | int ≥ 1 | 1 | `production` 2 | PDFs rendered at once; set from EXP-08 (DOC-10 §6.2, DOC-38 §4.2) |
| `EXPORT_CONCURRENCY` | int ≥ 1 | 2 | | Exports streamed at once (DR-64 "exports 2 concurrent", DOC-38 §4.2); DOC-33 may revise |

## 13. Observability

| Key | Type | Default | Description (source) |
| --- | --- | --- | --- |
| `METRICS_QUERY_TIMEOUT_MS` | int | 1500 | Time a database-derived gauge may take at a scrape; on timeout the last value is kept and `metrics_collection_errors_total` rises (DOC-40 §4.1, DR-154) |
| `METRICS_CACHE_SECONDS` | int | 10 | A gauge computed less than this long ago is reused, so two scrapers or a manual `curl` do not multiply the queries (DOC-40 §4.1) |

`LOG_LEVEL` and `OPS_PORT` are in §4. Prometheus, Alertmanager, Loki and Alloy are configured in DOC-40 and DOC-70, not here.

## 14. Keys of later phases

These rows are final names and defaults taken from the decisions; the document in the last column confirms them when it is written. A row is a requirement on that document, not a promise that the code reads the key before its phase.

| Key | Type | Default | Phase · source | Description |
| --- | --- | --- | --- | --- |
| `WEBHOOK_KNOWN_IPS` | csv of CIDR | empty | P3 · DOC-24, DR-32, DR-153 | Source ranges of the gateway; a call from outside is logged `webhook.unknown_ip`, never blocked. Empty = no check |
| `WEBHOOK_PER_MINUTE_PER_IP` | int | 60 | P3 · DR-32 | Rate of inserts into `finance.webhook_rejection` per IP |
| `WEBHOOK_MAX_BODY_BYTES` | int | 16384 | P3 · DR-32 | Body limit of the webhook route |
| `WEBHOOK_REJECTION_EXCERPT_BYTES` | int | 2048 | P3 · DR-32 | Excerpt stored with a rejection |
| `INTENT_TTL_MINUTES` | int | 60 | P3 · DR-28, DOC-23 | Life of a payment intent |
| `INTENT_REQUERY_BATCH` | int | 20 | P3 · DR-30, DOC-23 | Intents claimed per tick of `intent_requery` |
| `INTENT_CREATING_STALE_SECONDS` | int | 120 | P3 · DR-30, DOC-23 | A `creating` intent older than this is cleaned |
| `GATEWAY_CALLS_IN_FLIGHT` | int | 5 | P3 · DR-30, DOC-24 | Concurrent gateway calls of the re-query job |
| `INTENT_CREATE_PER_MINUTE` | int | 10 | P3 · DR-64 | Bucket `intent:account:<id>` |
| `DEBT_REMINDER_PER_HOUR` | int | 10 | P3 · DR-64 | Bucket `reminder:account:<id>` |
| `QR_ISSUE_PER_MINUTE` | int | 30 | P4 · DR-64 | Bucket `qr:account:<id>` |
| `QR_TTL_SECONDS` | int | 900 | P4 · DR-48, DOC-29 | Lifetime of a QR token (`exp − iat`) |
| `NOTICE_FANOUT_BATCH` | int | 500 | P3 · DR-51, DOC-31 | Recipients per fan-out transaction |
| `NOTICE_RECLAIM_AFTER_MINUTES` | int | 5 | P3 · DR-51, DOC-31 | Age of a `sending` heartbeat before a notice is reclaimed |
| `PUSH_CHUNK_SIZE` | int | 100 | P3 · DR-52, DOC-31 | Messages per Expo request |
| `PUSH_RECEIPT_DELAY_MINUTES` | int | 15 | P3 · DR-52, DOC-31 | Age of a ticket before its receipt is read |
| `PUSH_TICKET_RETENTION_DAYS` | int | 3 | P3 · DR-52, DOC-20 | Age at which `push_receipts` deletes tickets |
| `SSE_MAX_STREAMS_PER_ACCOUNT` | int | 3 | P1 · DR-75, DOC-52 | Concurrent `GET /staff/events` streams per account |
| `SSE_HEARTBEAT_SECONDS` | int | 25 | P1 · DR-75, DOC-52 | Must stay below 30 (Cloudflare closes a silent request after 100 s, DR-83) |
| `STATEMENT_MAX_BYTES` | int | 5242880 | P3 · DR-34, DOC-25 | Bank statement file; confirmed with the bank sample |

## 15. Web CMS and mobile apps

These variables are read at build time and baked into the bundle. They hold no secret (a bundle is public).

| App | Key | Type | Default | Profiles | Description (source) |
| --- | --- | --- | --- | --- | --- |
| Web CMS (Vite) | `VITE_API_BASE_URL` | url | `http://localhost:3000/api/v1` | `staging` `https://api-staging.<domain>/api/v1`; `production` `https://api.<domain>/api/v1` | API base (DR-07, DR-83) |
| Web CMS | `VITE_APP_ENV` | enum as `APP_ENV` | `local` | by the Pages build | Shown in the footer of non-production builds |
| Resident app, staff app (Expo) | `API_BASE_URL` | url | `http://localhost:3000/api/v1` | EAS profile `staging`, `production` as above | Read in `app.config.ts`, exposed as `extra` (DR-69, DOC-73) |
| Resident app, staff app | `APP_ENV` | enum | `local` | EAS profile `development`, `staging`, `production` | Never `NODE_ENV` (DOC-11 §6.4) |

The way the variables reach the bundle (`.env` files, EAS profile `env`, Pages build variables) is DOC-69, DOC-71 and DOC-73. `X-App-Id` and `X-App-Version` are derived from the app's identity, not configured (DOC-50 §5.1).

## 16. What differs per profile

| Key | `local` | `test` | `staging` | `production` |
| --- | --- | --- | --- | --- |
| `LOG_LEVEL` | `debug` | `silent` | `info` | `info` |
| `SMS_DRIVER` | `console` | `console` | `allowlist` | `provider` |
| `MAIL_DRIVER` | `console` | `console` | `allowlist` | `smtp` |
| `OPENAPI_ENABLED` | `true` | `false` | `true` | `false` |
| `TRUSTED_PROXY_HOPS` | 0 | 0 | 1 | 1 |
| `DB_POOL_MAX` (`api` / `worker`) | 10 / 10 | 5 / 5 | 15 / 10 | 20 / 15 |
| `PDF_CONCURRENCY` | 1 | 1 | 1 | 2 |
| `CORS_ORIGINS` | `http://localhost:5173` | empty | `https://admin-staging.<domain>` | `https://admin.<domain>` |
| `S3_ENDPOINT` | local store | local store | R2 staging bucket | R2 production bucket |
| `S3_FORCE_PATH_STYLE` | `true` | `true` | `false` | `false` |
| The gateway driver (a row of `gateway_config`, not a key) | `fake` | `fake` | `fake` on the demo building, `payos` on a real one | `payos` |

## 17. Boot validation

`loadConfig` runs before anything else in `api` and in `worker`. A failure writes **one** `error` line `config_invalid` that names every failing key and the rule, never a value of a `secret`, and exits with code 78 (the code of the boot guard, DOC-36 §10.1). In `local` and `test` a cross-key rule is a `warn`; a missing required key and a malformed value are errors in every profile.

| # | Rule | Profiles that refuse |
| --- | --- | --- |
| 1 | A required key is present (the *Profiles* column) | per column |
| 2 | Every value parses as its type; an `enum` value is one of the list; an `int` is within its stated range | all |
| 3 | A `secret` has a `_FILE` form and no plain form | `staging`, `production` |
| 4 | A key ring is not empty, has no repeated kid, and every value has the stated length and encoding | all |
| 5 | `MIGRATION_DATABASE_URL` is absent from the environment of `api` and `worker` | `staging`, `production` |
| 6 | `OUTBOX_CONCURRENCY ≤ DB_POOL_MAX − 4` | all |
| 7 | `OTP_RESEND_AFTER_SECONDS < OTP_TTL_SECONDS`; `REFRESH_TTL_DAYS_* ≤ FAMILY_MAX_DAYS_*` | all |
| 8 | `SSE_HEARTBEAT_SECONDS < 30` | all |
| 9 | `SMS_DRIVER` is `provider` and `MAIL_DRIVER` is `smtp` | `production` |
| 10 | `OPENAPI_ENABLED` is `false` | `production` |
| 11 | `CORS_ORIGINS` holds no `*` and every item is an origin without a path | all |
| 12 | `TRUSTED_PROXY_HOPS` is 0 when `TRUSTED_PROXY_CIDRS` is empty | all |
| 13 | A key that is not in this document is refused when its name starts with a prefix this document owns (`OUTBOX_`, `JOB_`, `FILES_`, `OTP_`, …): a typo must not silently fall back to a default | all |

## 18. Not configuration

**Building settings** are one JSON document per building, edited by the Admin through `PATCH /staff/settings`, audited, cached `SETTINGS_CACHE_SECONDS` (DOC-17 §1.2, DOC-36 §4). They are listed so that nobody adds them as environment:

| Setting | Default | Meaning |
| --- | --- | --- |
| `defaultLanguage` | `vi` | Language of a new resident account |
| `defaultDueDays` | 10 | Proposed due date of a batch |
| `accountDeletionDays` | 30 | Cooling-off before an approved deletion is executed |
| `lockout.maxAttempts`, `lockout.minutes` | 5, 15 | Staff lock |
| `maxCarsPerUnit` | 2 | Warning at the vehicle review |
| `storageQuotaBytes` | 53687091200 | File quota of the building |
| `feeNoticeLanguage` | `vi` | Language of fee notices and receipts |
| `reportColumns` | `{}` | Columns of each report |

**Constants of the code**, not configuration (a change is a code change and a test): the audit limits (string 500 characters, entry 32,768 bytes; DOC-35 §11), the lookup cap of 20 and the minimum search lengths (DOC-27 §14), the page limits (DOC-50 §10), `listActiveMemberships` ≤ 500, the 16 KB webhook-log line cut, the 15-minute QR renewal margin of the apps.

**Infrastructure configuration** (Caddyfile, compose files, `pg_hba.conf`, the `_headers` file, Prometheus and Alertmanager files, the Tunnel, the pgBackRest passphrase): DOC-70, DOC-39 §5, DOC-40, DOC-72.

## 19. Required tests

Prefix `CF-` (configuration; unused before this document; master plan §0.2, DR-156; DOC-88 indexes it). Written and **run in P1-04 (2026-10-21)**: CF-01, 02 and 17 in `apps/api/src/bootstrap/config/config.test.ts` read this document; CF-03, 04 and 14 also run `main.ts` as a process (`apps/api/src/main.test.ts`: exit 78, one `config_invalid` line, no secret in stdout or stderr); CF-16 is run on the script by P1-20 (`keys:generate --out`).

| ID | Scenario | Expected |
| --- | --- | --- |
| CF-01 | Parse every table of §4 to §14 (the first backticked word of the first column, plus the `JOB_*` grace table) and compare with the keys of the schema | The sets are equal: no key in the schema is missing here, no key here is missing in the schema |
| CF-02 | For each row, the *Default* of this document equals the schema default (types converted) | Equal; a difference fails with the key name |
| CF-03 | Boot with `DATABASE_URL` unset | Exit 78; one `config_invalid` line naming `DATABASE_URL` |
| CF-04 | Boot with `OUTBOX_BATCH_SIZE=fifty` and `OPENAPI_ENABLED=1` | Exit 78; both keys named, once each |
| CF-05 | Boot in `production` with `JWT_KEYS` set and no `JWT_KEYS_FILE` | Exit 78, rule 3; the value is not in the line |
| CF-06 | The same in `local` | Boots |
| CF-07 | `QR_KEYS={}`; a ring with a 16-byte key; a ring with a repeated kid (`{"v1":…,"v1":…}`) | Exit 78 each, rule 4 |
| CF-08 | `production` with `SMS_DRIVER=console`; with `MAIL_DRIVER=allowlist`; with `OPENAPI_ENABLED=true` | Exit 78 each (rules 9, 10; DOC-36 check 4; AG-03) |
| CF-09 | `OUTBOX_CONCURRENCY=8` with `DB_POOL_MAX=10` | Exit 78, rule 6 |
| CF-10 | `OTP_RESEND_AFTER_SECONDS=400`, `OTP_TTL_SECONDS=300` | Exit 78, rule 7 |
| CF-11 | `OUTBOX_BACHT_SIZE=50` (a typo) | Exit 78, rule 13 |
| CF-12 | `CORS_ORIGINS=*`; `https://admin.example.vn/app` | Exit 78, rule 11, each |
| CF-13 | `TRUSTED_PROXY_HOPS=1` with `TRUSTED_PROXY_CIDRS` empty | Exit 78, rule 12 |
| CF-14 | A boot error caused by a `secret` of 40 characters | The line names the key and the rule; the 40 characters appear nowhere in stdout, stderr or the log |
| CF-15 | `MIGRATION_DATABASE_URL_FILE` set in the `worker` environment in `staging` | Exit 78, rule 5 |
| CF-16 | `bun run keys:generate` in an empty directory | Every `secret` of §6 that `local` needs exists with the stated format; running it again changes nothing. *Run by hand in P1-04 on the existing `.env.local`: the five application keys were appended, the second run printed `kept .env.local`; the empty-directory form needs `--out` (P1-20)* |
| CF-17 | The generated `.env.example` | Holds every key of §4 to §13 with its default and no `secret` value |
| CF-18 | A job grace key for each of the 12 clock jobs of §11 | The schema has it; an hourly job has none; `JOB_INVARIANT_CHECK_GRACE_MINUTES=0` turns the catch-up off |

## 20. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-156 | Conventions of this reference: `csv`/`json` forms, plain secrets refused outside `local`/`test`, the profile table, the boot validation rules and exit 78, `OPS_PORT` 3001, `APP_ENV` required, the `METRICS_*` keys, `CF-` | §2, §4, §13, §17 |
| DR-152 | `TRUSTED_PROXY_CIDRS` and the client-IP rule | §4 |
| DR-153 | `WEBHOOK_KNOWN_IPS` | §14 |

## 21. Not in this document

| Topic | Lives in |
| --- | --- |
| What a key does in detail | The document in each row's source |
| Secret inventory, rotation, loss impact | DOC-39 §7, RB-12 |
| Metric names, alert thresholds | DOC-40 |
| Compose files, Caddyfile, Docker secrets mounting, Pages variables | DOC-70, DOC-71 |
| Mobile build profiles and the way variables reach the bundle | DOC-73, DOC-69 |
| Building settings (the columns and the screen) | DOC-17 §1.2, DOC-36 |

## 22. Traceability

| Section | Decisions | Requirements and checks |
| --- | --- | --- |
| §2, §17 boot | DR-65, DR-156, DR-60 | NFR-08, NFR-14; CF-01…18 |
| §6 secrets | DR-65, DR-113 | NFR-14; CF-05, CF-07, CF-16 |
| §8 identity | DR-37, DR-39, DR-150 | FR-13, FR-45, NFR-07; AU- |
| §10 files | DR-61 | FR-40; FS- |
| §11 jobs | DR-62, DR-101, DR-120, DR-121 | NFR-09; JB- |
| §14 later phases | DR-28, 30, 32, 48, 51, 52, 64, 75 | NFR-01, NFR-06 |

## Open questions

- **Names of the `SMS_*` keys.** They depend on the provider the Owner picks (DR-68, Owner decision 2026-10-21: not chosen yet, ports and `console`/`allowlist` drivers first); the names are fixed in P1-22 and `SMS_*` stays a pattern until then. Decided by DR-68; not blocking the skeleton.
- **`WEBHOOK_KNOWN_IPS` needs the gateway documentation or sandbox** (DR-25). Empty until then.
- **Which prefixes rule 13 owns** is a list in `load.ts` (`OWNED_PREFIXES`), not every first segment of this document: a developer machine has `APP_`, `LOG_` and `DB_` variables of other tools. A new key with a new prefix adds the prefix there (P1-04, DR-235).
- **Final `STORE_URL_*` values** are Owner input, a placeholder until the store build of P6-10 (DR-228, Owner, 2026-10-21; DOC-70 §2).
