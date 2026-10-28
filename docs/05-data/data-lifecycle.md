# Data lifecycle

> Status: **Approved** (Owner, 2026-10-21, as the skeleton (gate P1); final before P6) · Updated: 2026-10-28 (P1-26: device tokens of a dead session, DR-300; PDF keys, DR-293, DR-295; a replaced logo kept, DR-296) · 2026-10-28 (P1-29: DLC-16…18 re-run as `rms_app` through the job, §10.1; DR-279: `analytics` rows in §2.5, the job `usage_rollup` in §5, DLC-16…18) · 2026-10-26 (DR-268: files and backups in SeaweedFS on the VPS in `vn`; the whole-VPS loss is outside RPO/RTO) · 2026-10-22 (DOC-15 written: §2.4 points to it, `fee_notice_job` added, DR-245; earlier DR-154: label `job_name`; DR-120, DR-123) · DOC-20
> Depends on: original SDD §15, §19.1, §19.5, [DR](../00-decision-register.md) (DR-12, 21, 22, 32, 34, 40, 48, 52, 53, 54, 55, 57, 58, 59, 61, 62, 63, 66, 74, 83, 87, 101, 108, 114, 115, 268), [ADR-0027](../04-adr/0027-seaweedfs-on-the-vps-for-files-and-backups-in-vietnam.md), [ADR-0017](../04-adr/0017-backup-with-point-in-time-recovery.md), [ADR-0018](../04-adr/0018-audit-in-the-mutation-transaction.md), [ADR-0022](../04-adr/0022-personal-data-protection.md), [DOC-07](../03-architecture/system-context-and-containers.md) §6, [DOC-10](../03-architecture/quality-attributes.md) §5, [DOC-14](data-conventions.md) §4.2, [DOC-16](identity-and-residency-model.md) §7, [DOC-17](operations-model.md) §11, [DOC-19](db-roles-and-grants.md), [DOC-06](../02-glossary.md)
> Main readers: P1-08, P1-13, P1-14, P1-20 (the jobs and the VPS), DOC-35, DOC-37, DOC-38, DOC-72, RB-10, the legal dossier (P0-06)

This document says how long each kind of data lives and how it leaves: what is never deleted, what is purged by age and by which job, what is cleared but kept, what a restore brings back, and what the system does when a resident's account is deleted. **This is the skeleton the plan asks for in Phase 1** (P0-25): the schemas whose tables are written (`identity`, `residency`, `building`, `audit`, `platform`, the outbox and inbox) are complete, with purge statements run on PostgreSQL 18.6; the tables of the documents not yet written appear with the period the decisions already give, and the Owner has decided that tickets, vehicles, notices and the library are never deleted (DR-115). **The tables still marked "DDL pending" are confirmed when their documents are written; the final version is due before Phase 6.** The periods marked "default" are the defaults of DR-115 until the legal dossier (P0-06) confirms them. The document does not hold the table definitions (DOC-14 to DOC-17), the job runtime (DOC-38), the privacy workflow and the `pii.read` rules (DOC-35) or the backup procedures (DOC-72).

## 1. Principles

| Kind of removal | Meaning | Examples |
| --- | --- | --- |
| **Never deleted** | The row stays for the life of the system. A mistake is voided or logged, not removed (DR-12, DR-57). | The ledger: `charge`, `charge_line`, `payment`, `allocation`, `receipt`, `payment_intent`, `gateway_event`, the statement lines of the money log; `unit`, `membership`, `unit_history` |
| **Purged by age** | A job deletes rows older than a period. | `otp_challenge` after 24 h; `audit_log` after 5 or 2 years |
| **Cleared, row kept** | The personal fields are overwritten and the row stays, because other rows point to it. | `resident_account`, `resident_profile` at account deletion |
| **Follows its owner** | The row or file lives and dies with the object it belongs to. | A ticket's photos, a notice's attachments, `qr_credential` with its membership |

Rules that hold everywhere:

1. **Retention is a default, not a promise.** The periods are what the code does until the legal dossier says otherwise; changing one is a new DR and a change to the purge statement (§5), nothing else.
2. **A purge job writes a `job_run` row** when it deleted something or failed, and updates the gauge `job_last_success_timestamp{job_name}` otherwise (DR-101). A purge that has not succeeded for twice its interval alerts (DOC-40).
3. **A purge deletes in batches of at most 1,000 rows** when a table can be large (`audit_log`, `inbox_entry`, `file_object`); at the sizes of §9 a single statement is fine for the small tables, and the statements of §5 are written that way.
4. **Personal data is removed with the object that holds it** wherever the object may go (a profile at deletion, an import file at commit); a table that keeps a personal field for a legal reason says so in §7.

## 2. Retention per table

"Default" means DR-115. A row marked "pending" belongs to a document not yet written; its period comes from the decision cited, and the table is confirmed when its DDL is written.

### 2.1 `identity`

| Table | What is kept | Removal | Period | Job | Source |
| --- | --- | --- | --- | --- | --- |
| `staff_account` | The account of every staff member, including `disabled` ones; the email stays reserved | Never deleted | — | — | DR-36, DOC-16 §7 |
| `resident_account` | The account | Cleared at deletion execution: `display_name` and `avatar_key` nulled, `phone` becomes `deleted:<id>`, status `deleted` | Row kept | `account_deletion` (§8) | DR-59, DR-108 |
| `otp_challenge` | One SMS code sent | Deleted by age | 24 hours after `created_at` (default) | `otp_purge`, daily 03:45 | DR-62, DR-115 |
| `password_token` | A reset link, invite link or step-up code | Deleted by age | 7 days after `consumed_at`, or after `expires_at` when never consumed (default) | `token_purge`, daily 03:45 | DR-62, DR-115 |
| `refresh_family`, `refresh_token` | A session and its tokens | Deleted by age; the tokens cascade | 30 days after `revoked_at`, or after `absolute_expires_at` when never revoked (default) | `token_purge` | DR-38, DR-62, DR-115 |
| `rate_bucket` | Sign-in, OTP and reset buckets | Deleted when idle | 24 hours since `updated_at` (default) | `token_purge` | DR-62, DR-115 |
| `outbox_messages`, `inbox` | Events and handled messages | Deleted by age | 7 days after publication or delivery | the relay cleanup, every 10 minutes | DR-101 |

### 2.2 `building`, `audit`, `platform`

| Table | What is kept | Removal | Period | Job | Source |
| --- | --- | --- | --- | --- | --- |
| `building`, `building_setting`, `gateway_config` | The building, its settings, the gateway configuration | Never deleted | — | — | DR-60, DR-33 |
| `terms_version` | Every published text | Never deleted; write-once | — | — | DR-59 |
| `terms_acceptance` | Who accepted which version, when | Never deleted; the `ip` is set to null when the account is deleted (default) | — | the `building` handler of `identity.account_deletion_executed.v1` | DR-59, DR-115 |
| `file_object` | The ledger of stored files | Live rows follow their owner; unattached rows are marked `deleted` after 24 h; `deleted` rows are deleted by age | `pending` and `verified` for 24 hours; `deleted` rows for 90 days (default) | `orphan_uploads`, hourly, per building | DR-61, DR-112, DR-115 |
| `job_run` | Runs of jobs that worked, failed, or run hourly or less often | Deleted by age | 30 days after `started_at` | `token_purge` slot | DR-101 |
| `audit.audit_log` | One row per staff mutation and `pii.read` | Deleted by age through `audit.purge` | `finance` class 5 years, `standard` class 2 years (default until P0-06); the purge cannot go below these floors | `audit_purge`, monthly day 1, 04:30 | DR-57, DR-110 |
| `platform.idempotency_key` | A key and the stored response | Deleted by age | 24 hours | the idempotency plugin's sweep and `token_purge` | DR-74 |
| `platform.rate_bucket` | Webhook, QR, intent, reminder, upload buckets | Deleted when idle | 24 hours since `updated_at` (default) | `token_purge` | DR-64, DR-115 |
| `platform.maintenance` | The one flag row | Never deleted | — | — | DR-85 |
| `outbox_messages`, `inbox` (every schema) | Events and handled messages | Deleted by age; dead letters stay until requeued or removed by an operator | 7 days | the relay cleanup | DR-101 |

### 2.3 `residency`

| Table | What is kept | Removal | Period | Job | Source |
| --- | --- | --- | --- | --- | --- |
| `unit` | Every apartment | Never deleted | — | — | DR-12 |
| `membership` | Every membership, `removed` ones included | Never deleted | — | — | DR-12, DR-40 |
| `unit_history` | Every change of a unit | Never deleted | — | — | FR-18.6 |
| `resident_profile` | Name, email, CCCD (encrypted), date of birth of a person in a building | Cleared at deletion execution: all personal fields null, `cleared_at` set | Row kept | `account_deletion` (§8), residency handler | DR-59, DR-108 |
| `import_job` | The validated preview of an import | Rows and files deleted by age; the units-and-owners file is deleted at commit or expiry (it holds CCCD numbers) | 30 days after `created_at`; the file immediately (below) | `import_purge`, weekly Sunday 04:00; `import_expire`, hourly | DR-21, DR-22, DR-114 |

### 2.4 `finance` (DDL in DOC-15; guards refuse ledger deletes, DOC-15 §11)

| Table | What is kept | Removal | Period | Job | Source |
| --- | --- | --- | --- | --- | --- |
| `fee_batch`, `charge`, `charge_line`; drafts excepted | The fee history | Never deleted; drafts are hard-deleted while `draft` | — | — | DR-12, DOC-14 §4.2 |
| `payment`, `allocation`, `receipt`, `payment_intent`, `payment_intent_item` | The money history and the receipts, with the payer-name snapshot | Never deleted | — | — | DR-57, SDD §19.5 |
| `gateway_event`, `statement_line` (the money log) | Every incoming transfer that was seen | Never deleted | — | — | DR-57, DR-84 |
| `webhook_rejection` | A rejected webhook with a 2 KB excerpt | Deleted by age | 30 days after `received_at` | `finance_purge`, weekly Sunday 04:00 | DR-32, DR-120 |
| `statement_import` | The statement file's metadata and period | Never deleted (the lines are the money log); the uploaded file is deleted by age | File 1 year | `finance_purge`, DOC-25 | DR-34, DR-120 |
| `import_job` (fee batches) | The preview | Deleted by age | 30 days | `finance_purge` | DR-21, DR-120 |
| `document_counter` | The counters | Never deleted | — | — | DR-10 |
| `debt_reminder` | One row per unit per building day | Deleted by age | 30 days (default) | `finance_purge` | DR-87, DR-115, DR-120 |
| `fee_notice_job` | One bulk fee-notice request per row (*added 2026-10-22, DR-245*) | Rows kept (about 15 a year); the ZIP file is deleted by age | ZIP 7 days | `finance_purge` | DR-56, DR-123, DR-245 |
| `fake_gateway_link` | Links of the `fake` driver | Reset with the demo building; on `local` and `staging` kept until the database is rebuilt | — | `demo_reset` | DR-26, DR-60 |

### 2.5 Other schemas (DDL pending in DOC-17 §4–§9; §9A is written)

| Table | What is kept | Removal | Period | Job | Source |
| --- | --- | --- | --- | --- | --- |
| `tickets.*` and the ticket media | Tickets, events, messages, ratings, photos and videos | Never deleted | — | — | DR-43, DR-115 |
| `access.qr_credential` | One credential per membership | Follows the membership | Kept | — | DR-48 |
| `access.qr_scan`, `access.lookup_log` | Scan results and Guard lookups, with the guard id | Deleted by age | 90 days (`lookup_log` is the default) | `qr_scan_purge`, daily 03:45 | DR-48, DR-62, DR-115 |
| `vehicles.*` and the plate photos and papers | Vehicles and revisions | Never deleted | — | — | DR-49, DR-115 |
| `notices.*` | Notices, attachments, recipients | Never deleted | — | — | DR-50, DR-115 |
| `notification.inbox_entry` | A resident's inbox entries | Deleted by age | 180 days after `created_at` | `inbox_purge`, weekly Sunday 04:00 | DR-53, DR-62 |
| `notification.push_ticket` | Expo push tickets | Deleted by age | 3 days (DR-52; DOC-10's estimate uses 7, an upper bound) | `push_receipts`, every 5 minutes | DR-52 |
| `notification.device_token` | A device's push token | Deleted at sign-out, session revocation, `DeviceNotRegistered` and account deletion. *Revised 2026-10-28 (DR-300):* also when the push sender finds its session dead (expired without an event, `IdentityApi.liveSessionIds`); one token per session | — | the sign-out and deletion paths; `notification.send_expo_push` | DR-52, DR-87, DR-300 |
| `wiki.page_version` | The last 50 versions of a page and the published one | The 51st oldest is dropped on save | 50 versions | the save use case | DR-54 |
| `wiki.*`, other | Folders, pages, attachments | Follows the page or folder | Kept | — | DR-54 |
| `reporting.export_job` and the export file | The request and the file | Row and file deleted by age | 7 days after the request finished (default for the row) | `export_purge`, hourly | DR-55, DR-115 |
| `realtime.events` | The replay buffer for `Last-Event-ID` | Deleted by age | 24 hours (default) | the realtime module, hourly (DOC-17 §9 confirms) | DR-75, DR-115 |
| `analytics.usage_event` | Screen views, taps, opening and closing of the app without an account or device id (DOC-17 §9A.1) | Deleted by age, only up to the newest rolled-up day | 90 days (`USAGE_RAW_RETENTION_DAYS`) | `usage_rollup`, daily 02:30 | DR-279 |
| `analytics.usage_daily` | The daily rollup: events and sessions per app, platform, audience, event and name (DOC-17 §9A.2) | Deleted by age | 730 days (`USAGE_DAILY_RETENTION_DAYS`) | `usage_rollup`, daily 02:30 | DR-279 |

## 3. Object storage

Keys are `{env}/{building_id}/{module}/{yyyy}/{mm}/{uuid}.{ext}` (DR-61, DR-86). Every object has a `file_object` row; the lifetime is that of the row (§2.2).

| Bucket / prefix | Contents | Lifetime |
| --- | --- | --- |
| `rms-<env>-files` / `identity/` | Avatars | Until replaced or the account is cleared |
| `building/` | Company logo | Until replaced. *Revised 2026-10-28 (DR-296):* a replaced logo is kept (`attached`), because receipt snapshots name it by id |
| `residency/` | Units-and-owners import files (CCCD numbers) | Deleted at commit; at expiry within one hour of `expires_at` (DR-22, DR-114) |
| `finance/` | Fee import files; statement files; receipt PDFs; fee-notice PDFs and bulk ZIPs | Imports 30 days; statements 1 year (DR-34); PDFs cached by content hash, kept with the ledger row they document (DR-56); a bulk ZIP 7 days (DR-123). *Revised 2026-10-28 (DR-293, DR-295):* a fee-notice PDF's logical key is `batch/<b>/unit/<u>/<lang>/<hash16>.pdf` and superseded variants stay with the batch; a draft is never stored; a receipt has at most `issued.pdf` and `void.pdf`, the old one removed after the swap (DOC-34 §8) |
| `tickets/`, `vehicles/`, `notices/`, `wiki/` | Photos, videos, papers, attachments | Follows the owner, which is never deleted (DR-115) |
| `reporting/` | Export files | 7 days (DR-55) |
| `rms-<env>-backup` / `pgbackrest/` | The encrypted repository | 4 full + 7 differential backups and the WAL they need (DR-66, DR-268) |
| `rms-<env>-backup` / `pg_dump/` | Weekly logical dump | 4 weeks (DR-66) |

Object versioning is not used for the files bucket (SeaweedFS in `vn`; R2 in `global`, DR-268). The quota is 50 GiB per building and counts every row that is not `deleted` (DOC-17 §3.1).

## 4. What a restore brings back

A restore (RB-10) returns the database to a point in time, so it also returns rows that a purge or a deletion removed after that point. After any restore the operator runs the checks of DR-66 and **repeats the purge and deletion jobs**; `account_deletion` is idempotent (§8), so an account whose deletion was executed after the restore point is executed again on the next run. The exposure of a deleted person's data in backups is bounded by the backup retention (§6).

## 5. The purge jobs and their statements

The job names, schedules and owners are those of DR-62 (and DR-101), with the two jobs that DR-114 and DR-115 add. Every statement below was run as `rms_app` on PostgreSQL 18.6 against seeded rows (§10); the periods are the defaults of §2.

| Job | Schedule | Module | What it does |
| --- | --- | --- | --- |
| `otp_purge` | daily 03:45 | identity | Deletes old challenges |
| `token_purge` | daily 03:45 | identity | Deletes old reset/invite/step-up tokens, sessions, idle buckets (identity and platform), `job_run` rows, and stored idempotency responses |
| `qr_scan_purge` | daily 03:45 | access | Deletes old scans and Guard lookups (statement written with DOC-17 §5) |
| `account_deletion` | daily 03:45 | identity | Executes approved deletions after the cooling-off (§8); new, DR-115 |
| `orphan_uploads` | hourly | building | Marks unattached files `deleted` after 24 h and deletes `deleted` rows after 90 days, one building at a time |
| `import_expire` | hourly | residency | Expires validated jobs past `expires_at` and removes their file; new, DR-114 |
| `export_purge` | hourly | reporting | Deletes export files and rows after 7 days |
| `inbox_purge` | weekly Sunday 04:00 | notification | Deletes inbox entries after 180 days |
| `push_receipts` | every 5 minutes | notification | Fetches Expo receipts and also deletes push tickets older than 3 days (DR-52) |
| `import_purge` | weekly Sunday 04:00 | residency | Deletes `residency.import_job` rows after 30 days (DR-120: DR-62 named `building`; each module owns its `import_job`, DR-21) |
| `finance_purge` | weekly Sunday 04:00 | finance | Deletes fee-batch `import_job` rows, `webhook_rejection` and `debt_reminder` rows after 30 days, statement files after 1 year and `bulk_zip` files after 7 days (DR-120, DR-123) |
| `usage_rollup` | daily 02:30 | analytics | Folds the last 3 complete local days into `usage_daily`, then deletes raw events past the retention (only up to the newest rolled-up day) and rollup rows past theirs; new, DR-279 (the rollup statement is DOC-104 §7.1) |
| `realtime_purge` | hourly at :45 | realtime | Deletes `realtime.events` older than 24 hours (DR-115, DR-120) |
| `audit_purge` | monthly day 1, 04:30 | audit | `audit.purge` for each class |
| relay cleanup | every 10 minutes | every module's outbox | Deletes published outbox rows and delivered inbox rows after 7 days |

```sql
-- otp_purge (identity)
DELETE FROM identity.otp_challenge WHERE created_at < now() - interval '24 hours';

-- token_purge (identity); the refresh tokens of a family cascade
DELETE FROM identity.password_token WHERE coalesce(consumed_at, expires_at) < now() - interval '7 days';
DELETE FROM identity.refresh_family WHERE revoked_at < now() - interval '30 days' OR absolute_expires_at < now() - interval '30 days';
DELETE FROM identity.rate_bucket WHERE updated_at < now() - interval '24 hours';
DELETE FROM platform.rate_bucket WHERE updated_at < now() - interval '24 hours';
DELETE FROM platform.idempotency_key WHERE created_at < now() - interval '24 hours';
DELETE FROM building.job_run WHERE started_at < now() - interval '30 days';

-- import_expire (residency): the file keys go to FilesApi.remove
UPDATE residency.import_job SET status = 'expired'
 WHERE building_id = :building_id AND status = 'validated' AND expires_at < now()
RETURNING file_key;
-- import_purge (residency); finance_purge deletes finance.import_job the same way, with the other tables of its row above
DELETE FROM residency.import_job WHERE building_id = :building_id AND created_at < now() - interval '30 days';

-- orphan_uploads (building), per building
UPDATE building.file_object SET status = 'deleted', deleted_at = now(), updated_at = now()
 WHERE building_id = :building_id AND status IN ('pending', 'verified') AND created_at < now() - interval '24 hours'
RETURNING id, object_key;
DELETE FROM building.file_object WHERE building_id = :building_id AND status = 'deleted' AND deleted_at < now() - interval '90 days';

-- relay cleanup (every module that has an outbox)
DELETE FROM finance.outbox_messages WHERE published_at < now() - interval '7 days';
DELETE FROM finance.inbox WHERE processed_at < now() - interval '7 days';

-- usage_rollup (analytics), per building: the rollup statement is DOC-104 §7.1; then the two purges
DELETE FROM analytics.usage_event e
 WHERE e.building_id = :building_id AND e.occurred_at < :raw_cutoff            -- now() minus USAGE_RAW_RETENTION_DAYS
   AND e.occurred_at < ((SELECT max(d.day) FROM analytics.usage_daily d WHERE d.building_id = :building_id) + 1)::timestamp AT TIME ZONE :tz;
DELETE FROM analytics.usage_daily WHERE building_id = :building_id AND day < :daily_cutoff;   -- today minus USAGE_DAILY_RETENTION_DAYS

-- audit_purge (audit): the function raises the cut-off to the retention floor itself (DOC-17 §2)
SELECT audit.purge(now(), 'finance');
SELECT audit.purge(now(), 'standard');
```

The scope lint (DOC-14 §5.2) applies to the statements on scoped tables (`file_object`, `import_job`, `usage_event`, `usage_daily`): the job loops over the buildings, as the `:building_id` shows. `refresh_family` is read with a sequential scan: its predicate is an `OR` over two columns, and at 30,000 live sessions (design scale) the daily scan is a few milliseconds, so no index on `revoked_at` is added.

## 6. Backups

| Item | Schedule and retention | Source |
| --- | --- | --- |
| pgBackRest full backup | Weekly; the last **4** full backups are kept | DR-66, DR-83 |
| pgBackRest differential backup | Daily at 02:00; the last **7** are kept | DR-66 |
| WAL archive | Continuous, `archive_timeout` 60 s, kept as far back as the oldest kept full backup needs | DR-66 |
| Repository | Bucket `rms-<env>-backup` in SeaweedFS on the same VPS (`vn`; R2 in `global`), on a separate data volume, encrypted by pgBackRest with the key kept off the VPS; its own S3 identity, which the files identity cannot read | DR-268, DR-83 |
| Logical dump | Weekly `pg_dump` by `rms_backup` (DOC-19 §8), encrypted before it leaves the host, **4 weeks** | DR-66 |
| Objects in the files bucket | Not backed up a second time: in `vn` the files live in SeaweedFS on the one VPS, with no off-VPS copy until the replica on another server exists; a lost VPS loses them (in `global` they live in R2 only, DR-66) | DR-268, DR-66 |
| RPO, RTO | RPO ≤ 5 minutes, RTO ≤ 4 hours **for a PostgreSQL fault** (bad migration, dropped table); **not for the loss of the whole VPS** in `vn`, where the backups are on the same host until the replica exists; a restore drill every quarter that includes the backup bucket (NFR-11, EXP-12) | DR-66, DR-268 |

**What this means for deleted data.** Personal data removed from the database (a purge, an account deletion) remains in the backups until the last backup that contains it expires. With 4 weekly full backups and a weekly dump kept 4 weeks, that is **about 5 weeks** after the deletion (a full backup taken just before it, plus the retention). The privacy notice states this period (DOC-35); ADR-0022 keeps the backup repository encrypted with a key that is not on the VPS or in the backup store. Computed from the schedule above; not measured.

## 7. Personal data

The classes are those of DR-58 and ADR-0022. This table says where each class lives and how it leaves; the privacy workflow (consent text, requests, the `pii.read` rows) is DOC-35's.

| Data | Class | Where it lives | Leaves when | Residue |
| --- | --- | --- | --- | --- |
| CCCD number | sensitive | `resident_profile.cccd_enc` (AES-256-GCM, PII key); `cccd_last4` for the masked display | The profile is cleared at account deletion; a Manager may also clear or replace it | The import file with CCCD numbers is deleted at commit or expiry; the preview never holds the number (DR-114); backups (§6) |
| Date of birth | personal | `resident_profile.date_of_birth` | Cleared with the profile | Backups |
| Phone, email, name | personal | `resident_account.phone`, `display_name`; `resident_profile.full_name`, `email`; `staff_account.email`, `full_name` | Resident: cleared at account deletion (the phone becomes `deleted:<id>`, which frees the number). Staff: never deleted; a former staff member is `disabled` | The payer name on a receipt and in a payment snapshot stays (accounting record, SDD §19.5); audit rows keep ids only |
| IP address and user agent | personal | `audit_log.ip`, `user_agent`; `terms_acceptance.ip`; `otp_challenge.ip`; `refresh_family.user_agent` | Audit: with the row (5 or 2 years). Terms acceptance: nulled at account deletion. OTP and sessions: with the row (24 h and 30 days after revocation) | Logs (below) |
| Vehicle papers and plate photos | personal | Files bucket, private prefix, signed URLs of 5 minutes (DR-61) | Never deleted (DR-115); the files stay private and are shown only by signed URL | — |
| Ticket text and media | operational | `tickets.*`, files bucket | Never deleted (DR-115) | — |
| Push tokens | personal | `notification.device_token` | Sign-out, session revocation, `DeviceNotRegistered`, account deletion, a dead session found at send time (DR-300) | — |
| Logs | personal, masked | Loki, 14 days, collected by Alloy (DR-63) | 14 days | Phones are masked (`+84•••••123`); OTP, tokens, passwords, CCCD and QR tokens are never logged (DR-58) |

## 8. Account deletion execution

The workflow is DR-59's and FR-39: a resident requests, a Manager approves, the account stays usable, and `accountDeletionDays` after the approval the system executes. This section fixes what execution does, in order, and which module does it. The orchestration is the daily job `account_deletion` of `identity` (DR-115); the other modules act on the event `identity.account_deletion_executed.v1` (DR-87).

| Step | Module | What happens | Stays |
| --- | --- | --- | --- |
| 0 | identity | Select accounts with `status = 'deletion_requested'`, `deletion_approved_at` set and `deletion_approved_at + accountDeletionDays` reached (index `resident_account_deletion_idx`); refuse an account that is the active owner of a unit (`ResidencyApi.ownedUnitIds` is not empty: `owner_must_transfer`, FR-39.4, DOC-35 §10) and leave it requested | — |
| 1 | identity | In one transaction: revoke every refresh family (`revoked_reason = 'deleted'`), set `display_name` and `avatar_key` to null, replace `phone` with `deleted:<id>`, set `status = 'deleted'` and `deleted_at`, `version + 1`; write an audit row (`actor_kind = 'system'`); write the event to the outbox | The account row and its id |
| 2 | notification | Delete the account's device tokens; the inbox entries age out by §2.5 | Nothing personal |
| 3 | residency | Remove the memberships (`status = 'removed'`, `removed_at`, `credential_version + 1`); clear the profile with the statement of DOC-16 §5.2 (`full_name`, `email`, `cccd_enc`, `cccd_last4`, `date_of_birth`, `note` to null, `cleared_at = now()`) | Removed memberships and `unit_history` (ids) |
| 4 | building | Set `terms_acceptance.ip` to null for the account | The acceptance (account id, version, time) |
| 5 | finance, tickets, vehicles, audit | Nothing is changed: ledger rows keep the payer-name snapshot; ticket and vehicle rows keep the account id; audit rows keep ids | Ids; payer-name snapshots |
| 6 | the files | The avatar object is marked `deleted` by identity through `FilesApi.remove` | — |

Properties:

- **Idempotent.** Every step is a conditional update or a clear of already-null fields, so running the job again, after a crash between steps or after a restore (§4), changes nothing that is already done.
- **Each step is its own transaction** in its own module, driven by the event (DR-42); the identity step commits first, so an account marked `deleted` whose later steps are still pending is a normal, brief state. A handler that fails retries by the outbox rules (DR-62); a dead letter alerts.
- **The phone is free** from step 1: a new account can use the number at once (IDM-14).
- **Cooling-off.** The delay is the building setting `accountDeletionDays` (DOC-17 §1.2). One deployment serves one building (a second building would be a second deployment, DR-115), so there is one value; the demo building has its own accounts and its own setting.

## 9. Storage growth

DOC-10 §5 holds the estimate (computed by `docs/03-architecture/capacity/capacity.py` on 2026-10-19); this document uses it and does not repeat the model. All numbers are **planned**.

| Quantity | Value | Where |
| --- | --- | --- |
| Rows per day, sample building (240 units), steady month | 655 | DOC-10 §5.3 |
| Rows per day, design scale (5,000 units, 20 buildings) | 13,609 | DOC-10 §5.3 |
| Database size retained after purges, design scale | 0.92 GB at 1 year, 2.33 GB at 3, 3.74 GB at 5 | DOC-10 §5.3 |
| Same, if every job tick wrote a `job_run` row and none were purged (what DR-101 prevents) | 6.57 GB at 5 years | DOC-10 §5.3 |
| Files (SeaweedFS volume in `vn`) | About 4.6 GB per building per year; the 50 GiB quota is reached after about 10.8 years and the 80% alert after about 8.7 years | DOC-10 §5.3 |
| WAL | Up to 1,440 objects per day of 16 MB before compression; measured in P1-20 | DOC-10 §5.5 |
| Logs and metrics | About 42 MB per day of raw logs for the sample building (8 MB in Loki, 14 days); Prometheus about 25 MB per day | DOC-10 §5.4 |
| `analytics.usage_event` | About 23,000 rows a day for the sample building, 2.1 million at 90 days, about 450 MB with its index (planned, not measured: 650 accounts at 36 events a day, 100 bytes a row; DOC-104 §7.2); bounded by the 90 days, so it does not grow with the years. `usage_daily` is a few hundred rows a day | DR-279 |

What the retention rules of §2 change in that estimate: the outbox, inbox, `job_run`, idempotency keys, OTP and token rows are bounded by days, so none grows with the years; `audit_log` is bounded by 5 years (the upper bound DOC-10 uses); the ledger, tickets, notices and the library grow without a purge. They stay unbounded by decision (DR-115); the quota (50 GiB per building) is the limit, and the Admin sees the alert at 80%.

## 10. Statements tested

Tested on PostgreSQL 18.6 on 2026-10-19 on a database built from the DDL of DOC-14, DOC-16 and DOC-17, with the grants of DOC-19, by seeding rows around each cut-off and running every statement of §5 as `rms_app` (so the privileges are exercised too). The prefix `DLC-` (data lifecycle) is new; DOC-88 indexes it. The business tests of the jobs are DOC-38's (`JB-`).

| ID | Statement | Seeded rows | Result |
| --- | --- | --- | --- |
| DLC-01 | `otp_purge` | 3 challenges: 25 h old consumed, 30 h old unconsumed, 1 minute old live | 2 deleted, the live one stays |
| DLC-02 | `password_token` purge | 4 tokens: consumed 8 days ago, consumed 2 days ago, never consumed and expired 8 days ago, live invite | 2 deleted |
| DLC-03 | `refresh_family` purge | 4 families: revoked 31 days ago (2 tokens in a `replaced_by_id` chain), revoked 5 days ago, never revoked and 31 days past the absolute limit, live | 2 families deleted; their 2 tokens cascade without an error from the deferred foreign key; the token of the 5-day family stays |
| DLC-04 | `identity.rate_bucket` purge | 1 idle 2 days, 1 fresh | 1 deleted |
| DLC-05 | `platform.rate_bucket` purge | 1 idle 2 days, 1 fresh | 1 deleted |
| DLC-06 | `idempotency_key` purge | 1 at 25 h, 1 fresh | 1 deleted |
| DLC-07 | `job_run` purge | 1 at 31 days, 1 at 1 hour | 1 deleted |
| DLC-08 | `import_expire` | 2 validated jobs: expired 2 h ago, expiring in 23 h | 1 set to `expired`, its key returned |
| DLC-09 | `import_purge` | 3 jobs: committed 31 days ago, created 26 h ago and expired, validated 1 h ago | 1 deleted |
| DLC-10 | `orphan_uploads`, first statement | pending 30 h, verified 25 h, pending 1 h | 2 marked `deleted` |
| DLC-11 | `orphan_uploads`, second statement | `deleted` rows: 91 days, 10 days, and the 2 just marked | 1 deleted (the 91-day row) |
| DLC-12 | Outbox cleanup | published 8 days ago, published 2 days ago, unpublished 9 days old | 1 deleted; the unpublished row stays |
| DLC-13 | Inbox cleanup | processed 8 days ago, 1 day ago | 1 deleted |
| DLC-14 | `audit.purge(now(), …)` | a `finance` row 5 years and 1 day old, a `standard` row 2 years and 1 day old | 1 deleted in each class |
| DLC-15 | Plans with sequential scans disabled | — | `otp_challenge_created_idx`, `ix_job_run_started`, `ix_idempotency_key_created`, `import_job_building_idx`; `ix_file_object_building_deleted` on a table of 20,200 rows; `refresh_family` by sequential scan (§5) |
| DLC-16 | `usage_rollup`, raw purge (2026-10-28, as `postgres` in a scratch database, without the grants) | 7 events of the days 10-26 and 10-27 rolled up, 1 event of 10-28 not rolled up | cut-off in 2027: 7 deleted, the unrolled one stays; with `usage_daily` empty: 0 deleted |
| DLC-17 | `usage_rollup`, rollup purge (same run) | rows of 2024-10-01 and 2024-10-29, daily cut-off 2024-10-29 | 1 deleted |
| DLC-18 | The rollup statement twice (same run) | the 7 events above, zone `Asia/Ho_Chi_Minh` | 5 rows both times, 7 events; the event at 23:30 local is in the earlier day |

### 10.1 Not run

| Item | Why | Done in |
| --- | --- | --- |
| ~~DLC-16…18 as `rms_app` (the grants of `analytics`), and the job itself~~ | Done in P1-29: UA-16…20 and UA-34 (`apps/api/tests/integration/usage-events.integration.test.ts`) run the rollup and both purges as `rms_app` on the migrated template, and the job through the runtime with its lock; GRT-98…100 | P1-29 |
| The statements of the tables not yet written (`qr_scan`, `lookup_log`, `export_job`, `webhook_rejection`, `debt_reminder`) | No DDL yet | When DOC-15 and DOC-17 §5, §9 are written. *Revised 2026-10-28 (P1-26):* the purges of `inbox_entry` and `push_ticket` ran as OPM-S24 (DOC-17 §6) and that of `realtime.events` with DOC-52 §19 (SE-21) |
| `account_deletion` end to end (events, handlers, idempotency) | Needs the modules | P1-14 (`AD-`, `RM-` tests) |
| The job runtime: locks, `job_run` rows, missed-run policy | Needs the worker | P1-05 (`JB-`) |
| Batches of 1,000 on `inbox_entry` and `audit_log` | Tables are small at the design scale; confirmed with real volumes | P5 / P6 |
| A restore followed by the purge and deletion jobs | Needs the restore procedure | P6 (EXP-12, RB-10) |

## 11. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-115 | Default periods for the tables with none: `otp_challenge` 24 h; `password_token` 7 days; `refresh_family` 30 days; idle buckets 24 h; `file_object` `deleted` rows 90 days; `debt_reminder` 30 days; `lookup_log` 90 days; `export_job` rows 7 days; `realtime.events` 24 h. `terms_acceptance` kept with its IP nulled at account deletion. A daily `account_deletion` job. Tickets, vehicles, notices and the library are never deleted (Owner, 2026-10-19) | §2, §5, §8 |

## 12. Not in this document

| Topic | Lives in |
| --- | --- |
| Table definitions and indexes | DOC-14 to DOC-17 |
| The job runtime, locks, missed runs | DOC-38, ADR-0015 |
| The privacy workflow: consent, requests, `pii.read` | DOC-35 |
| Backup and restore procedures, drills | DOC-72, RB-10, EXP-12 |
| Upload flow and the object delete command | DOC-37 |
| Metrics and alerts of the purge jobs | DOC-40 |
| The legal basis and the confirmed periods | The legal dossier (P0-06) |

## 13. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| §2 retention per table | DR-12, DR-57, DR-62, DR-101, DR-115 | FR-37.6, FR-40.3; DLC-01…14 |
| §3 object storage | DR-61, DR-86, DR-114 | FR-18.2, FR-40.3 |
| §5 purge statements | DR-62, DR-101, DR-114 | NFR-09 (job health); DLC-01…15 |
| §6 backups | DR-66, DR-83, ADR-0017 | NFR-11 |
| §7 personal data | DR-58, ADR-0022 | NFR-14 |
| §8 account deletion | DR-59, DR-87, DR-108 | FR-39.2, FR-39.3, FR-39.4 |
| §9 storage growth | DR-81, DR-101 | — (DOC-10 §5) |

## Open questions

None. The Owner decided on 2026-10-19 that tickets, vehicles, notices and the library are never deleted, that one deployment serves one building, and that the retention defaults of DR-115 stand; the legal dossier (P0-06) may confirm or change a period later, which is a new DR and a change to one statement of §5. A device token that is never opened again stays until the next sign-out or an Expo `DeviceNotRegistered` receipt: no age purge in phase 1.
