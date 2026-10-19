# Quality attributes

> Status: **Review** · Updated: 2026-10-19 · DOC-10
> Depends on: original SDD §3.4, §19, §20, [DR](../00-decision-register.md) (DR-05, 06, 21, 30, 52, 56, 57, 61…64, 66, 67, 75, 77, 78, 80, 83, 85), [DOC-01](../01-product/vision-and-scope.md) §4, [DOC-03](../01-product/requirements.md) §2, [DOC-06](../02-glossary.md), [DOC-07](system-context-and-containers.md) §3–§4
> Main readers: DOC-38, DOC-40, DOC-70, DOC-72, DOC-96 (EXP-07), DOC-97 (EXP-08), P1-03, P1-18, P1-20, P6-05, P6-07

This document says how each non-functional requirement (NFR-01…14) is met: the tactic, the mechanism, where it lives and how it is verified. It adds what the requirements leave open: the latency budget of a payment confirmation, the capacity estimate, and the resource budget of every container and host. It holds no table definition (DOC-14…17), no job catalog (DOC-38), no alert rule (DOC-40), no version (DOC-11) and no restore procedure (DOC-72).

**Every figure here is *planned*** (a design value or a model output). No figure is *measured* until a dated result file exists under `docs/10-testing/experiments/results/` (§2).

## 1. Scope and reading guide

| Question | Section |
| --- | --- |
| What is *planned*, what is *measured*, and what recalibrates what? | §2, §9 |
| How is each NFR met and proven? | §3 |
| Where do the 5 seconds of NFR-02 go? | §4.1 |
| What do NFR-03, 04, 05, 09, 12 cost per request, batch or file? | §4.2 |
| How many rows and GB per day, month and year? | §5 |
| How much memory, CPU, connections and disk per container and host? | §6 |
| What do 99.5% and RTO 4 h mean on one VPS? | §7 |
| What does the system do when a limit is reached? | §8 |

| Not in this document | Lives in |
| --- | --- |
| Test procedures, result file format, the 12 experiments | DOC-88, DOC-89, DOC-90…101 |
| Metric and alert definitions | DOC-40 |
| Job schedules and grace windows | DOC-38 |
| Configuration keys with defaults | DOC-41 |
| Restore steps | DOC-72, RB-10 |
| Table columns and indexes | DOC-14…17 |

## 2. Planned and measured numbers

| Rule | Source |
| --- | --- |
| A number is **planned** until a result file with commit, machine and date exists; then it is **measured** and the planned value is replaced by a link to the file | DR-77, DR-78 |
| Every experiment runs 5 times and reports min, median, max. Correctness criteria (0 double settlement, 0 stale QR codes…) must hold in every run; latency criteria hold in the median | DR-78 |
| All experiments except EXP-03 and EXP-04 run on the staging host of DR-06 (2 vCPU, 4 GB, API, worker and PostgreSQL co-located, api ×1). EXP-03 and EXP-04 are database-only and may run on a developer machine that the result file describes | DR-78 |
| NFR-02 is measured from "webhook request accepted" to "first `GET /payments/intents/{id}` response showing `paid`"; the server part is accept → commit. NFR-04 ends at the last `POST` to Expo having returned. NFR-10 uses the external probe of `/api/v1/health/ready` every 60 s minus announced maintenance. NFR-12 ends at the response carrying the validated preview | DR-80 |
| Coverage numbers are reported by CI as warnings and never fail a build | DR-77 |
| Load numbers are design targets for the phase 1 machine and are recalibrated when EXP-07 first runs | original SDD §3.4, DR-06 |

The capacity model of §5 is a script, `docs/03-architecture/capacity/capacity.py` (run on 2026-10-19, Python 3, no dependencies). Its inputs are assumptions written at the top of the file; change them there and rerun, then update §5.

## 3. NFR → tactic → mechanism → where → verification

| NFR | Tactic | Mechanism | Where | Verification |
| --- | --- | --- | --- | --- |
| NFR-01 No double settlement, no transfer lost | One arbiter row per race; the database decides, the code asks; every confirmed transfer ends in a payment or a log row | `INSERT … ON CONFLICT DO NOTHING` on `gateway_event (provider, reference)` then the intent claim; the all-or-nothing allocation statement in ascending `charge.id` order (DR-14); `UNIQUE (charge_id) WHERE status = 'live'` on `allocation`; retry the whole transaction on SQLSTATE `40001`/`40P01` up to 3 times with 20–60 ms jitter; no network call inside the transaction; outbox rows written in the same commit | `finance` module: `settle()` (DOC-23), allocation write path (DOC-22), constraints (DOC-15) | EXP-01, EXP-02, EXP-03 (with the naive baseline), EXP-04; nightly invariant check |
| NFR-02 Confirmation latency | Short settlement transaction; heavy work deferred to the outbox; client polls a cheap indexed read | Receipt PDF rendering and push are commands and events handled by the worker, never inside `settle()`; `GET /payments/intents/{id}` reads one row by primary key; poll every 2 s for the first 60 s of the QR screen, then every 3 s (DR-80) | `finance` (`settle()`), `api` route, resident app polling; budget in §4.1 | EXP-01 (timestamps in the harness) |
| NFR-03 API latency | Stay inside the process; one round trip to the database per read where possible; no N+1; keyset pagination; indexes start with `building_id` | Drizzle queries written per use case with the index named next to the query in the design document; list endpoints use cursors (DR-74); the membership check is one indexed read per resident request | every module's repositories; `api` | EXP-07 (k6, 50 req/s, 15 min, 60/25/15 mix) |
| NFR-04 Notice fan-out | Batch reads and writes; push in groups; resumable claim | Recipients read in batches of 500, inserted with `ON CONFLICT DO NOTHING`; pushes in requests of 100 (DR-52); the notice is claimed with a heartbeat and reclaimed after 5 min (DR-51) | `notices` fan-out job, `notification` Expo sender (DOC-31) | EXP-06 (fake Expo, 200 ms, kill at batch 6 of 10) |
| NFR-05 Bulk PDF | Background job with bounded concurrency and bounded memory; cache by logical key | One PDF per unit rendered by the worker (`PDF_CONCURRENCY`), written to R2, then zipped by streaming; worker `mem_limit` 1.5 GB (DR-06) | `worker`, DOC-34 | EXP-08 (240 and 5,000 notices, duration and RSS) |
| NFR-06 QR revocation | No cached credential; the credential is checked against live state on every scan | Signed token with nonce and `membership.credential_version`; the scan reads the membership row; every lock, unlock, removal and new code bumps the version in the same transaction (DR-48) | `access` scan use case; `residency` writes the version | EXP-05 (1,000 rounds) |
| NFR-07 OTP abuse | Bound every guess and every SMS at the database | PostgreSQL token buckets, one atomic statement per bucket (phone 5/h, IP 20/h); at most 5 attempts per challenge; code hashed with an HMAC key; 3,000-SMS daily circuit breaker (FR-15.5; DR-36) | `identity` (`identity.rate_bucket`) | EXP-09 |
| NFR-08 Isolation | Deny by default; scope in the type system; 404 outside the scope | `BuildingScope` argument on every repository and a lint rule that rejects a business query without it (DR-12); every route declares its audience in route metadata, no default-allow; membership read on every resident request (no cached permissions, FR-16.3); resident and staff tokens are different kinds | `core-*` guards, `identity`, `residency` policy table (DOC-27, DOC-39) | EXP-10 (matrix generated from route metadata) |
| NFR-09 Ledger self-check | Independent recomputation at night; report, never repair | One set of SQL queries (the 20 corruptions of DR-78 are their spec) run at 03:00 building time under a transaction-level advisory lock; any row fires a Critical alert; **planned run budget ≤ 5 min at 5,000 units** (partial indexes on live allocations and open charges) | `finance` job `invariant_check` (DOC-22, DOC-38) | EXP-11 (20 injected corruptions, 0 false positives on clean data) |
| NFR-10 Availability | Redundant stateless tier, fast rollback, no single deploy downtime; honest about the single VPS | `api-1` and `api-2` behind Caddy with active health checks; rolling restart waits for `/health/ready`; backward-compatible migrations (expand, then contract); rollback ≤ 10 min (DR-08, DR-83). Arithmetic and limits in §7 | Compose, `deploy.sh` (DOC-70, DOC-71) | External probe, first month in production |
| NFR-11 Backup and restore | Continuous archive plus periodic full copies; rehearsed restore | pgBackRest: weekly full, daily differential at 02:00, WAL archive with `archive_timeout` 60 s to the R2 backup bucket, encrypted repository, 4 full + 7 differential retained; weekly `pg_dump` (DR-66, DR-83) | Host cron, DOC-72, RB-10 | EXP-12 each quarter; P1-20 first PITR restore |
| NFR-12 Import | Validate in the request; stream the file; set-based lookups | `exceljs` streaming reader; units and fee items looked up with one `= ANY($1)` query per kind; the preview is one `import_job` row (DR-21). Budget in §4.2 | `building`/`residency`/`finance` import use cases (DOC-21, DOC-27) | Timed integration test (P1-13) |
| NFR-13 Languages | Store keys and templates, not text | One shared catalog with ICU messages; notification entries store `template_key` and `params`; parity test fails the build on a missing key or placeholder (DR-71, DR-53) | `@rms/i18n-catalog`, `notification` | Catalog parity test in CI |
| NFR-14 Personal data | Least privilege by field; log reads; mask for Guards | CCCD stored in an encrypted column, phone masked to `090••••123` for Guards, `pii.read` rows for profile views and exports (one row per export with the record count), push payloads carry no personal text (DR-48, DR-52, DR-58) | `residency` DTOs per role, `audit`, `notification` | `AD-` and `RM-` tests, EXP-10 field-level assertions |

## 4. Budgets

### 4.1 Latency budget of a payment confirmation (NFR-02)

The target is **p95 ≤ 5 s** from "webhook request accepted" to "first poll response showing `paid`", with the server part (accept → commit) **p95 ≤ 1 s** (DR-80). The transit from payOS through Cloudflare, the Tunnel and Caddy to the API is before "accepted" and is not counted.

```mermaid
flowchart LR
  A["Webhook request accepted by api"] --> B["Verify HMAC, parse body"]
  B --> C["Read gateway config and intent"]
  C --> D["settle(): one transaction"]
  D --> E["COMMIT: payment, allocations, receipts, outbox"]
  E --> F["Next poll of the resident app"]
  F --> G["GET intent: paid"]
```

| Hop | Planned p50 | Planned p95 budget | Notes |
| --- | --- | --- | --- |
| Verify HMAC-SHA256 and parse the body | 1 ms | 10 ms | Constant-time compare (DR-32) |
| Read gateway configuration (decrypt `secrets_enc`) and the intent by order code | 3 ms | 30 ms | Configuration cached per process for 60 s; the decrypted secrets are not logged |
| `settle()` transaction: `gateway_event` claim, intent claim, 1–10 conditional `UPDATE`s on charges, `payment`, `allocation`s, receipt counter upsert, `receipt`s, outbox rows, audit row | 25 ms | 250 ms | About 12 + 3×(charges) statements on the local PostgreSQL; the receipt counter row is the only serialization point (DR-10) |
| Retry reserve for one deadlock or serialization failure (3 attempts, 20–60 ms jitter) | 0 | 400 ms | Kept as a reserve, not an expected cost |
| `COMMIT` and WAL flush (`synchronous_commit = on`) | 2 ms | 40 ms | Local SSD of the VPS |
| **Server part (accept → commit)** | **≈ 31 ms** | **≈ 730 ms, budget 1,000 ms** | Margin 270 ms |
| Wait for the next poll | 1,000 ms | 2,000 ms (3,000 ms after the first 60 s) | Mean wait is half the interval; the worst case is the full interval (DR-80 chose 2 s for the first minute to keep margin) |
| Poll request round trip: phone → Cloudflare → Tunnel → Caddy → `api` → one primary-key read → back | 120 ms | 300 ms | Mobile network 150 ms is the largest part |
| **Total** | **≈ 1.2 s** | **≈ 3.0 s in the first minute, ≈ 4.0 s after (limit 5.0 s)** | Margin 1.0–2.0 s |

Three consequences:

1. Nothing slow may enter `settle()`: no HTTP call, no PDF, no push. The receipt PDF is rendered after commit by a command (DR-17, DR-56); the app shows the receipt record at once and the PDF when ready.
2. The poll interval is the largest term. Lowering it to 1 s would cut 1 s from the total but doubles the polling load of §5.4; it is not done without an EXP-07 result.
3. A webhook that arrives late is not a latency failure: the clock starts when the request is accepted. A lost webhook is settled by the re-query job within one cycle of 5 min plus jitter (FR-10.1, DR-30), outside this budget.

### 4.2 Budgets of the other measured paths

| NFR | Path | Budget (planned) | Where the time goes |
| --- | --- | --- | --- |
| NFR-03 | Mixed API traffic at 50 req/s on 2 vCPU | p95 ≤ 300 ms, p99 ≤ 800 ms. CPU per request ≈ 2 vCPU ÷ 50 = **40 ms of CPU for everything** (Caddy, `cloudflared`, `api`, PostgreSQL, worker background): `api` 15 ms, PostgreSQL 10 ms, proxies 5 ms, monitoring and worker 10 ms | A read of home or fees is 2–4 indexed queries of 0.3–2 ms each; the membership check is one primary-key read; JSON serialization dominates the `api` share |
| NFR-04 | Notice to 5,000 recipients | ≤ 60 s. Planned ≈ 13 s: 10 batches of 500 recipients × (read + insert recipients and inbox entries ≈ 300 ms) = 3 s, plus 50 push requests of 100 × 200 ms (fake Expo) = 10 s sequentially | A sequential sender is enough (4.6× margin), so no push concurrency key is introduced; add concurrency only if EXP-06 shows less than 2× margin |
| NFR-05 | Bulk PDF | 240 notices ≤ 2 min → ≤ 500 ms per PDF; 5,000 ≤ 30 min → ≤ 360 ms per PDF; worker memory ≤ 1 GB | Render, upload to R2 (≈ 100 ms), insert `file_object`. `PDF_CONCURRENCY` = 1 on staging and 2 on production until EXP-08 measures it; an unmet budget is the trigger for a second worker (original SDD §19.6) |
| NFR-09 | Nightly check | ≤ 5 min at 5,000 units (`statement_timeout` 5 min on the job's transaction) | One query per invariant, each a single pass over live allocations or open charges |
| NFR-12 | 2,000-row import | ≤ 10 s. Planned ≈ 2 s: read object from R2 0.3 s, stream-parse 1.0 s, validate with set-based lookups 0.4 s, insert the preview row 0.1 s, response 0.1 s | A 5,000-row, 5 MB file (the limit) is planned at ≈ 5 s |

## 5. Capacity estimate

Computed by `docs/03-architecture/capacity/capacity.py` on 2026-10-19. **All numbers are planned.** Row sizes are bytes per row including indexes, without bloat; WAL is modelled as 3 × the heap and index bytes (full-page images and index updates).

### 5.1 Inputs

| Input | Value | Source |
| --- | --- | --- |
| Sample building | 240 units, 650 accounts (2.7 per unit) | DOC-01 |
| Design scale | 5,000 units, 20 buildings (250 per building) | DOC-01 |
| Charges per unit per month | 1.2 (one batch plus an occasional second) | assumption |
| Charges per payment | 1.5 (select two charges, often one) | FR-05.1 example |
| Members who see fees | 2.2 per unit (owner, family, tenants) | FR-03.3 |
| Online share of payments | 70% in the steady month; 100% in the stress days | assumption |
| Stress rates | 150 payments/h for the first 6 h after publish; 100 payments in the 2 h before the due date; ×10 for ten times the size | master plan DOC-10 |
| Tickets | 0.15 per unit per month, 6 messages, 4 `file_object` rows | assumption |
| Notices | 4 per building per month, to all accounts | assumption |
| QR scans | 0.5 per unit per day | assumption |
| Staff audit rows | 40 per building per day | assumption |
| Retention | outbox and inbox 7 days (DR-101), idempotency keys 24 h, inbox entries 180 days, QR scans 90 days, push tickets 7 days, `job_run` 30 days (DR-101), audit 5 years (upper bound), ledger never | DR-57, DR-58, DR-62, DR-74 |

### 5.2 Rows written by one online payment

| Table | Rows | Bytes per row |
| --- | --- | --- |
| `finance.payment` | 1.0 | 380 |
| `finance.allocation` | 1.5 | 260 |
| `finance.receipt` (complete snapshot, reserved `external_invoice`) | 1.5 | 1,800 |
| `finance.payment_intent` | 1.0 | 420 |
| `finance.payment_intent_item` | 1.5 | 200 |
| `finance.gateway_event` (with payload) | 1.1 | 900 |
| `platform.idempotency_key` | 1.0 | 1,200 |
| `audit.audit_log` (`actor_kind = 'system'`) | 1.0 | 700 |
| `outbox_messages` (`payment_posted`, 2 × `receipt_issued`, 2 × render command) | 4.0 | 600 |
| `inbox` (one handler per message) | 4.0 | 160 |
| `notification.inbox_entry` | 2.2 | 420 |
| `notification.push_ticket` | 2.0 | 220 |
| **Total** | **21.8 rows** | **≈ 11.5 KB (≈ 34 KB of WAL)** |

### 5.3 Rows per day and GB per day

**Stress days** (upper bounds; every payment online; more payments than a 240-unit building can generate in a month, on purpose):

| Scale | Day | Payments | Rows/day | GB/day | WAL GB/day |
| --- | --- | --- | --- | --- | --- |
| ×1 | publish day (150/h × 6 h + 5/h × 18 h) | 990 | 21,562 | 0.011 | 0.032 |
| ×1 | due-date eve (50/h × 2 h + 5/h × 22 h) | 210 | 4,574 | 0.002 | 0.007 |
| ×10 | publish day | 9,900 | 215,622 | 0.106 | 0.318 |
| ×10 | due-date eve | 2,100 | 45,738 | 0.022 | 0.067 |

**Steady month** (all tables, including fee batches, notices, tickets, scans and audit):

| Scale | Payments/month | Rows/month | Rows/day | GB/month |
| --- | --- | --- | --- | --- |
| Sample, 240 units | 192 | 19,645 | 655 | 0.006 |
| ×10, 2,400 units (10 buildings) | 1,920 | 196,447 | 6,548 | 0.063 |
| Design scale, 5,000 units (20 buildings) | 4,000 | 408,264 | 13,609 | 0.130 |

**Database size retained** (heap and indexes, purges applied, no bloat, no WAL):

| Scale | 1 year | 3 years | 5 years | 5 years if every job tick wrote a `job_run` row and none were purged |
| --- | --- | --- | --- | --- |
| Sample | 0.04 GB | 0.11 GB | 0.18 GB | 3.01 GB |
| ×10 | 0.45 GB | 1.13 GB | 1.82 GB | 4.64 GB |
| Design scale | 0.92 GB | 2.33 GB | 3.74 GB | 6.57 GB |

The last column is the reason for DR-101: the worker's 30 s and 60 s ticks (7,566 ticks per day) would write 0.57 GB of `job_run` rows per year, more than the whole sample building (§10).

**Object storage** (R2 files bucket, GB per year; quota 50 GB per building, alert at 40 GB, DR-61): about **4.6 GB per building per year** (tickets with photos and some videos 3.4 GB, PDFs 0.4 GB, vehicle papers and notice attachments the rest), so the quota is reached after about 10.8 years and the alert after about 8.7 years. 45.5 GB/year for ten buildings and 94.7 GB/year at design scale.

### 5.4 Request load

| Scale | Payments/h | Open `Pay-VietQR` screens (4 min each) | Polls/s |
| --- | --- | --- | --- |
| ×1 | 150 | 10 | 4.5 |
| ×10 | 1,500 | 100 | 45.5 |

The polling of open payment screens is the real request load of a payment peak (a payment itself is 0.04 requests/s). The ×10 case is 45 req/s, which is why EXP-07 uses 50 req/s as its target (NFR-03). A normal day for the sample building is about 49,000 requests (650 accounts × 6 opens × 12 requests, plus staff and jobs); the original SDD §19.6 expects about 20 req/s right after a publish.

Logs and metrics: about 42 MB/day of raw JSON logs for the sample building (8 MB/day in Loki, 0.11 GB for 14 days) and 402 MB/day raw for ten buildings (80 MB/day in Loki, 1.1 GB for 14 days). Prometheus, 3,000 series at a 15 s scrape: about 25 MB/day, 0.36 GB at its default 15-day retention.

### 5.5 What the estimate says

1. **The database is small.** Five years at design scale is under 4 GB; it fits in the 1 GB `shared_buffers` plus the operating system cache. Capacity is not what limits phase 1.
2. **What limits phase 1 is, in order:** database connections (§6.3), the memory ceilings of §6.1 on the 4 GB staging host, PDF rendering CPU (§4.2), and the polling load of a payment peak (§5.4).
3. **Disk is dominated by things other than rows:** local WAL awaiting archive, container logs, the images, Loki and Prometheus (§6.4). Files grow in R2, not on the VPS.
4. **The WAL archive makes up to 1,440 objects per day** (`archive_timeout` 60 s while there is any write activity; 22 GB per day of 16 MB segments before compression, mostly empty). The compressed size per segment is unknown and is measured in P1-20; R2 object counts and storage for 28 days of retention are then added to DOC-72. The same figure sizes the local `pg_wal` allowance of §6.4: a stopped archive is the fastest way to fill the disk.

## 6. Resource budget

Ceilings are container `mem_limit` values (DR-06), except PostgreSQL, which is not a container. A ceiling is not an expectation: *typical* is the planned working set.

### 6.1 Memory

| Item | Staging VPS, 4 GB: ceiling | typical | Production VPS, 8 GB: ceiling | typical |
| --- | --- | --- | --- | --- |
| Operating system, Docker daemon, `sshd` | 0.5 GB | 0.5 GB | 0.6 GB | 0.6 GB |
| PostgreSQL 18 (`shared_buffers`, work memory, backends) | 1.2 GB (`shared_buffers` 512 MB) | 0.8 GB | 3.0 GB (`shared_buffers` 1 GB, DR-06) | 1.6 GB |
| `api` | 1.0 GB × 1 | 0.25 GB | 1.0 GB × 2 | 0.25 GB × 2 |
| `worker` | 1.5 GB | 0.35 GB (1.0 GB during bulk PDF) | 1.5 GB | 0.35 GB (1.0 GB during bulk PDF) |
| Caddy | 0.128 GB | 0.03 GB | 0.128 GB | 0.03 GB |
| `cloudflared` | 0.128 GB (placeholder until EXP-07 measures it) | 0.05 GB | 0.128 GB (placeholder) | 0.05 GB |
| Monitoring (Prometheus, Alertmanager, Grafana, Loki, Alloy, `postgres_exporter`) | 0.6 GB (no Loki on staging, DR-06) | 0.5 GB | 1.0 GB (DR-06) | 0.7 GB |
| **Sum of ceilings** | **5.1 GB** (1.1 GB over the host) | **≈ 2.5 GB** | **8.4 GB** (0.4 GB over the host) | **≈ 3.8 GB** |

The ceilings add up to more than the hosts have. The overcommit is deliberate and bounded: the `api` and the worker reach their ceilings only in different situations (the worker at bulk PDF, the `api` at a request peak), and the monitoring stack is far below its ceiling. The rules that keep an overshoot from taking the database down are DR-102: PostgreSQL gets `OOMScoreAdjust=-900`, containers get `memswap_limit` equal to `mem_limit` (no swap for containers), the host has 2 GB of swap, and EXP-07 and EXP-08 never run together on staging. The `cloudflared` limit and the real worker need are set from EXP-07 and EXP-08.

### 6.2 CPU

| Host | Plan |
| --- | --- |
| Staging, 2 vCPU | `api` and PostgreSQL share both vCPUs at 50 req/s (≈ 40 ms CPU per request, §4.2). The worker is capped at `cpus: 1.0` and `PDF_CONCURRENCY` = 1, so a bulk PDF job takes at most one vCPU. EXP-07 and EXP-08 run on staging at different times |
| Production, 4 vCPU | PostgreSQL and two `api` containers about 2 vCPU at peak; the worker `cpus: 2.0`, `PDF_CONCURRENCY` = 2 |
| Rule | A job that needs more CPU than the worker's share is a second worker, never a bigger `api` (jobs are claimed with `SKIP LOCKED`, DR-62) |

### 6.3 Database connections

`DB_POOL_MAX` is per process (reference: `APP_PROCESSES × DB_POOL_MAX` per container). There is no PgBouncer in phase 1 (DOC-07 §3), so every connection is a direct PostgreSQL backend, including the `LISTEN` connection of `realtime` (on each `api`) and of the relay (on the worker) (DR-62, DR-75).

| Consumer | Staging (`max_connections` 60) | Production (`max_connections` 100, DR-06) |
| --- | --- | --- |
| `api` pools | 1 × 15 = 15 | 2 × 20 = 40 |
| `api` `LISTEN` (realtime) | 1 | 2 |
| `worker` pool | 10 | 15 |
| `worker` relay `LISTEN` | 1 (reserved; unused, the relay polls, DOC-38 §2) | 1 (reserved) |
| `postgres_exporter` | 2 | 2 |
| pgBackRest `archive-push` (asynchronous) | 2 | 2 |
| Migration step during a deploy | 1 | 1 |
| Operators (`psql`) | 3 | 3 |
| `superuser_reserved_connections` (default) | 3 | 3 |
| **Total** | **38** | **69** |
| Headroom | 22 (37%) | 31 (31%) |
| Rolling restart overlap (the new `api` opens a pool before the old one closes) | +15 → 53 ≤ 60 | +20 → 89 ≤ 100 |

Sizing check by Little's law: at 50 req/s, with about 3 queries of 3 ms per request, about 0.5 connections are busy on average and about 5 at peak (bursts of 100 ms), so a pool of 15 does not queue. The pool size is raised only when `db_pool_waiting` is non-zero in EXP-07; PgBouncer is added before adding `api` replicas (original SDD §19.6).

### 6.4 Disk

| Item | Staging 60 GB | Production 100 GB | Basis |
| --- | --- | --- | --- |
| Operating system, Docker images, Docker logs (`max-size` 10 MB × 5 per container) | 12 GB | 15 GB | images ≈ 1 GB each, logs bounded by rotation |
| PostgreSQL data | 1 GB | 6 GB | 3.7 GB at design scale after 5 years × 1.5 for bloat (§5.3) |
| `pg_wal` (`max_wal_size` 2 GB plus an allowance for a stalled archive: 4 GB staging ≈ 4 h, 8 GB production ≈ 8 h) | 6 GB | 10 GB | With `archive_timeout` 60 s and any write activity PostgreSQL switches a 16 MB segment every minute: 1,440 segments, **about 22 GB per day**, if the archive stops taking them (compressed in R2, uncompressed in `pg_wal`). A stalled `archive-push` fills this first (§8) |
| Loki (14 days) | — | 3 GB reserved | 1.1 GB at ×10 (§5.4) |
| Prometheus (15 days) | 2 GB reserved | 2 GB reserved | 0.36 GB (§5.4) |
| pgBackRest spool and log | 1 GB | 1 GB | |
| **Reserved** | **≈ 22 GB** | **≈ 37 GB** | |
| **Free** | **≈ 38 GB (63%)** | **≈ 63 GB (63%)** | Alert at 80% used (DOC-40) |

The weekly `pg_dump` streams to R2 and keeps no local copy. Files are in R2 (§5.3) and use no VPS disk.

## 7. Availability and recovery (NFR-10, NFR-11)

99.5% per month is **3.6 h of downtime in a 30-day month** (0.5% of 720 h), after removing announced maintenance (DR-80).

| Event | Expected downtime | Fits the monthly budget? |
| --- | --- | --- |
| Deploy: rolling restart `api-1` → ready → `api-2` → `worker` | 0 for requests (one `api` is always ready); the worker is down for seconds | Yes |
| A bad deployment, rollback to the previous image tag | ≤ 10 min (DR-08) | Yes, up to 20 times |
| A migration that cannot be backward compatible (maintenance flag, announced) | Announced, subtracted | Yes |
| Container crash | Restart in seconds; the other `api` serves meanwhile | Yes |
| PostgreSQL restart (minor upgrade) | ≈ 1 min, announced | Yes |
| Tunnel or Cloudflare outage | Outside the Owner's control; the re-query and statement paths catch up (DR-30, DR-35) | Depends on the provider |
| **Loss of the VPS** | **RTO ≤ 4 h** (rebuild from compose files, restore pgBackRest, RB-10) | **No: one such event exceeds 3.6 h** |

The last row is stated plainly. With one VPS per environment (DR-83) the 99.5% target and the 4 h RTO cannot both hold in a month in which the VPS is lost; the Owner accepted the single-VPS risk and the single-provider risk (DR-66, DR-83). What the design does guarantee in that case is **no loss of a confirmed payment beyond the 5-minute RPO**, and a defined catch-up: re-query the intents of the gap, import the statement for it, review the `unknown_order` rows (DR-66). NFR-10 is measured in the first production month; a second host is a decision for after that month's result, not a phase 1 task.

## 8. Behavior at the limits (degraded mode)

| Limit reached | Detected by | System behavior | Recovery |
| --- | --- | --- | --- |
| Database connections exhausted (pool waits longer than the request timeout) | `db_pool_waiting` > 0 for 1 min; readiness fails when no connection can be taken in 2 s | The affected `api` answers 503 `service_unavailable` with `Retry-After`; Caddy's active health check removes it while the other `api` serves; the webhook answers 5xx so payOS retries (original SDD §19.3) | Pool drains by itself; if it repeats, raise `DB_POOL_MAX` after checking §6.3 |
| Request rate over a bucket | 429 with `Retry-After` (DR-64: intents 10/min/account, QR 30/min/account, reminders 10/h, uploads 60/h/account, exports 2 concurrent) | The caller waits; other callers are unaffected (buckets are per account or IP) | Automatic |
| SSE streams over 3 per account | New stream refused with 429 (DR-75) | The oldest stream continues; the web CMS falls back to refetch on focus | The user closes a tab |
| Container memory ceiling hit | Docker OOM kill; restart count rises | The container restarts; an `api` in flight is retried by clients with the same `Idempotency-Key`; a worker batch is reclaimed (lease 60 s, heartbeat 5 min) | Raise the ceiling after EXP-07 or EXP-08 shows the real need |
| Host memory exhausted | Host `MemAvailable` alert | The kernel kills a container first (PostgreSQL has `OOMScoreAdjust=-900`, §6.1) | Find the container that overshot; do not run a bulk PDF during a peak |
| Outbox backlog (worker down or slow) | Oldest unpublished message older than 2 min (Warning) | Requests still succeed; push, SMS, PDF, re-query and scheduled notices wait; an OTP SMS older than 5 min is dropped (DR-62) | Restart the worker; the backlog drains in order |
| Bulk PDF during a peak | CPU on the worker's `cpus` share | Interactive requests are unaffected because the worker is capped (§6.2); the job takes longer | Automatic |
| File quota 50 GB per building | Hourly `storage_quota` job | Alert at 40 GB; at 50 GB uploads are refused with 413 `quota_exceeded`; text-only actions continue (DR-61) | Delete old files or raise `storageQuotaBytes` |
| Local disk over 80% | Host disk metric (Warning) | None until full | Check `pg_wal` first |
| WAL archive failing (R2 unreachable or token expired) | `pg_stat_archiver.failed_count` rising for 15 min (Critical, proposed for DOC-40) | PostgreSQL keeps accepting writes and keeps WAL in `pg_wal` at about 1 GB per hour (§6.4); RPO grows beyond 5 min; when `pg_wal` fills the disk, PostgreSQL stops | Fix the archive within the allowance (≈ 4 h staging, ≈ 8 h production); the Critical alert at 15 min leaves hours to act; RB-07 |
| Gateway errors | More than half of the calls in 10 min fail (FR-10.5) | Retry back-off 30 s, 60 s, 2 min, 5 min; at most 5 calls at once; link creation answers "try later or pay at the office" | Automatic; RB-13 |
| Expo, SMS or SMTP down | Send errors | Inbox still holds every entry; push retried 3 times; OTP answers 503 `sms_unavailable` | Automatic |

## 9. What EXP-07 and the first production month recalibrate

| Number | Recalibrated by | Rule |
| --- | --- | --- |
| NFR-03 targets (300 ms, 800 ms, 50 req/s) | EXP-07 first run on staging, 5 runs | If the median misses, fix the slowest route first; change the target only by a `Changed` DR (DR-06) |
| `DB_POOL_MAX`, `max_connections` | EXP-07 `db_pool_waiting` and `pg_stat_activity` peak | Raise only with evidence; keep headroom ≥ 25% (§6.3) |
| Memory ceilings of `api`, `worker`, `cloudflared` | EXP-07 and EXP-08 container stats (separately) | Ceiling = observed peak + 30%; update §6.1 and DOC-70 compose files |
| `PDF_CONCURRENCY` | EXP-08 | Highest value that keeps worker RSS ≤ 1 GB and API p95 unchanged |
| Row sizes and the WAL factor of §5 | After P2: `pg_total_relation_size` per table and WAL bytes per payment from `pg_stat_wal` | Replace the model input, rerun the script, update §5 |
| WAL segment compressed size, R2 operations | P1-20 | Add to DOC-72 |
| NFR-10 | First month in production | Report the real percentage; decide on a second host from it |

Result files go to `docs/10-testing/experiments/results/` as JSON with commit, machine and date (DR-77). A recalibrated number replaces the planned one in this document with a link to the file; the planned value is kept in the Updated line.

## 10. Decisions made while writing

Every new decision in this document is recorded as a proposed DR below and summarized here.

- **DR-101 · Job rows and processed messages are bounded.** Decided.
- **DR-102 · Memory-overcommit rules and the staging database settings.** Decided.

## 11. Traceability

| Section | Other documents |
| --- | --- |
| §3 mechanisms | DOC-22, DOC-23 (NFR-01, 02), DOC-31 (NFR-04), DOC-34 (NFR-05), DOC-29 (NFR-06), DOC-26 (NFR-07), DOC-27, DOC-39 (NFR-08), DOC-72 (NFR-11) |
| §4 budgets | DOC-96 (EXP-07), DOC-95 (EXP-06), DOC-97 (EXP-08), DOC-90 (EXP-01) |
| §5 capacity | DOC-20 (retention, growth), DOC-72 (backup storage), DOC-37 (quota) |
| §6 resources | DOC-70 (compose limits, PostgreSQL tuning), DOC-41 (`DB_POOL_MAX`, `PDF_CONCURRENCY`), DOC-40 (metrics, alerts) |
| §7, §8 | DOC-72, RB-07, RB-09, RB-10, RB-13 |

## Open questions

Decisions made while writing, decided by Claude (delegated by the Owner):

- **DR-101 · Job rows and processed messages are bounded.**
  - *Problem:* DR-62 says every run of a job writes a `building.job_run` row. The worker's ticks (`notice_scheduler` and `intent_requery` every 30 s, `notice_reclaim` every 60 s, `push_receipts` every 5 min) are 7,566 rows per day, 0.57 GB per year, more than all other data of the sample building (§5.3). DR-62 also has no purge for `job_run`, and none for processed `outbox_messages` and `inbox` rows (the reference deletes published rows after 7 days, `retentionDays`).
  - *Decision:* A run writes a `job_run` row when its schedule is one hour or longer, or when it did work or failed; a tick that found nothing to do only updates the gauge `job_last_success_timestamp{job}` (no row). `job_run` rows older than `JOB_RUN_RETENTION_DAYS` = 30 are deleted by the daily `token_purge` slot. Published outbox rows and the inbox rows of delivered messages are deleted after `OUTBOX_RETENTION_DAYS` = 7 by the relay cleanup (at most every 10 minutes, one instance, the lock of DR-62).
  - *Consequences:* The "last success" metric survives a worker restart only after the next tick (≤ 60 s). Outbox payloads that hold a one-time code leave the database after 7 days.
  - *Write to:* DOC-38, DOC-41, DOC-20, DOC-40.
- **DR-102 · Memory-overcommit rules and the staging database settings.**
  - *Problem:* The ceilings of DR-06 add up to 5.1 GB on the 4 GB staging host and 8.4 GB on the 8 GB production host (§6.1), and DR-06 gives PostgreSQL settings for production only.
  - *Decision:* (1) PostgreSQL runs with `OOMScoreAdjust=-900`; (2) containers have `memswap_limit` equal to `mem_limit`; (3) each host has a 2 GB swap file for the host only; (4) staging PostgreSQL uses `shared_buffers` 512 MB and `max_connections` 60; (5) `DB_POOL_MAX` is 15 (`api`) and 10 (`worker`) on staging, 20 and 15 on production; (6) EXP-07 and EXP-08 never run together; (7) the worker is capped at `cpus: 1.0` on staging and `cpus: 2.0` on production.
  - *Consequences:* A runaway container dies before the database does; the overcommit is not removed, only made safe. The values are recalibrated by §9.
  - *Write to:* DOC-70, DOC-41, DOC-10 (this document, §6).
