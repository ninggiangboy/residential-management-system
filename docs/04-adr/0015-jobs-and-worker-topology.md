# ADR-0015: Run jobs in a separate worker role with in-process timers and transaction-level advisory locks

- Status: Accepted
- Date: 2026-10-19 · Related: DR-62, DR-101, DR-05, DR-09, ADR-0009, ADR-0013, FR-10, FR-27.2, FR-29.2, NFR-09, DOC-07, DOC-12 §8.2

## Context

The original SDD lists the worker's duties and gives times and intervals in prose (notice scheduler, payment re-query, invariant check, purges, push receipts). It has no catalog, no rule for jobs that must not run twice at once, no policy for a run missed while the worker was down, and it plans a connection pooler (PgBouncer) in front of PostgreSQL, which breaks session-level advisory locks (DR-62). The settlement path depends on two of these jobs: the re-query job that settles a payment whose webhook was lost, and the nightly invariant check. Jobs must stay off the request path: the webhook route lives only on `api`, so a worker restart never drops a webhook (DR-05).

## Options considered

1. **Jobs inside every `api` instance.** No extra process — but a deploy that restarts an `api` also restarts a job, a slow job competes with requests, and two instances need an election anyway. Rejected (DR-05).
2. **An external scheduler** (host cron for everything, or a scheduler container). One more moving part, and a job would call the API or reach into the database from outside the module code. Only the backup stays on the host cron, because it is not application code (DR-62).
3. **A job queue with its own broker.** A new component to run and back up, when commands that need delivery already go through the outbox with retries and a dead letter (ADR-0009). Rejected.
4. **Session-level advisory locks** held for the length of a job. They survive across statements, but are lost or leaked behind a pooler in transaction mode and hold a connection while the job runs. Rejected.
5. **A lease row per job** with a heartbeat. Works behind a pooler, but is more code than a lock the database already provides and needs its own expiry rule. Rejected for jobs; the notice fan-out uses a heartbeat on the notice row for its own reasons (ADR-0025).
6. **A `worker` role of the same image, with timers in the process and transaction-scoped advisory locks for singleton jobs.** Chosen.

## Decision

Option **6** (DR-62, DR-05).

- **One image, two roles.** `APP_ROLES=worker` starts the outbox relay, the inbox handlers and the job timers; it serves no HTTP except `/health/*` and `/metrics` on the ops port (DOC-07 §4.3).
- **Timers never overlap.** Each job uses the reference pattern `running ??= job().finally(…)`: a slow pass delays the next tick instead of running beside it.
- **Singleton jobs** take `pg_try_advisory_xact_lock(hashtext('job:<name>'))` in a short transaction. The lock is released at commit or rollback, so it is safe behind a pooler in transaction mode and cannot leak when a process dies. A second worker is safe by design but is not deployed in phase 1.
- **Jobs open their own short transactions** (claim, then work); they do not hold the lock for the whole run (DOC-12 §8.2).
- **Schedules are evaluated in building time** (ADR-0013). A missed run executes once at start-up when it is within its grace window; beyond the window it is skipped and the next slot runs.
- **`job_run` rows** are written when a schedule is one hour or longer, or when the run did work or failed; an idle tick only updates the gauge `job_last_success_timestamp{job}`. Rows are kept 30 days; published outbox rows and delivered inbox rows are deleted after 7 days by the relay cleanup (DR-101).
- **Relay defaults** (poll 500 ms when idle, batch 50, lease 60 s, 8 attempts, backoff 5 s doubling to 15 min, then dead letter) and the per-event overrides are in DR-62 and DOC-38.
- Realtime (`LISTEN`) and the relay use a direct database connection; request traffic may use a pooler later with `DB_PREPARE=false`. There is no pooler in phase 1 (DOC-07 §3).

## Consequences

**Positive**

- A worker restart never touches a webhook or a request; a deploy restarts `api-1`, then `api-2`, then `worker`.
- Singleton safety needs no extra component and works if a pooler is added.
- The "last success" metrics give the alerts of DOC-40 something to measure.

**Negative**

- One worker is a single point of work: while it is down, re-query, notice sending and purges wait; only the grace window and the later catch-up limit the damage.
- A lock guarantees one run at a time, not exactly-once work; every job must be idempotent and has a run-twice test.
- A run missed beyond its grace window is skipped, so a long outage can leave a purge or a check undone until the next slot.
- The gauge resets when the worker restarts and shows a value again only after the next tick (60 s at most).

**Follow-up work**

- DOC-38 holds the job catalog, schedules, grace windows and relay settings; DOC-41 the keys per job; DOC-40 the metrics and alerts on `job_last_success_timestamp`.
- `JB-` tests: two workers racing for one singleton job, a kill in the middle of a run, a missed run within and beyond its window.
- RB-04 (outbox lag) and RB-05 (dead letters) cover the relay.
