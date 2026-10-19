# ADR-0013: Store everything in UTC and compute every business day in the building's time zone

- Status: Accepted
- Date: 2026-10-19 · Related: DR-09, DR-10, DR-62, FR-12.1, FR-12.2, FR-44.3, NFR-09, DOC-14, DOC-22

## Context

The original SDD §16.3 says "today" is `Asia/Ho_Chi_Minh`, but its aging query (§5.10) uses `now()::date`, which follows the database session zone. On a UTC server that date is wrong between 00:00 and 07:00 local time: a charge due on the 15th would be counted one day early or late, and the debt moves to the wrong bucket (DR-09). The same ambiguity hides in "payable through the due date", in the month of a receipt number (DR-10), and in the schedule of jobs ("backup at 02:00"). Money screens and the nightly invariant check depend on one answer to "what day is it for this building".

## Options considered

1. **Run servers and PostgreSQL in the local zone.** One less conversion — but the day becomes an environment setting that differs between a developer laptop, CI, a container and a restore host, and it breaks silently when a second zone appears. Rejected.
2. **Store local timestamps (`timestamp` without zone).** Readable in a SQL console — but ambiguous across clock changes and impossible to compare with gateway or provider times. Rejected.
3. **Compute days in UTC.** What the SDD's `now()::date` does today: wrong for seven hours of every local day. Rejected.
4. **One zone per user.** The calendar of a fee, a due date or a receipt belongs to the building, not to who looks at it; two viewers would see different debt. Rejected.
5. **UTC storage plus one zone per building for every business calendar computation.** Chosen.

## Decision

Option **5** (DR-09).

- Servers and PostgreSQL run in UTC; every instant is `timestamptz`.
- `building.time_zone` (default `Asia/Ho_Chi_Minh`, UTC+7, no daylight saving) drives every business-calendar computation. SQL uses `(now() AT TIME ZONE b.time_zone)::date`; code uses the single helper `buildingToday(now, timeZone)` and a `Clock` port, never `Date.now()` or `now()::date` (DOC-12 §9.4 and §14 item 10; the helper lives in `@rms/shared-types`, DR-100).
- A charge is payable through the end of its due day. It is overdue when `buildingToday > due_date`; `days_past_due = buildingToday − due_date`.
- `fee_month` and `due_date` are `date`; JSON carries them as `YYYY-MM-DD` (`LocalDate`).
- `receivedOn` (a date from the manual-payment form) becomes `received_at = now()` when it is today and 12:00 local of that date otherwise.
- Numbering periods use building time: a receipt number's `YYMM` is the **issue month** in building time (DR-10).
- Scheduled jobs run at fixed local times (invariant check 03:00, demo reset 04:00, and so on, DR-62); the host backup runs at 02:00 local on the host's cron.
- The aging query is corrected to the building-date expression; the bucket test table of FR-12.1 and the zone test of FR-12.2 (23:30, 00:30 and 06:59 local) are required `LG-` tests.

## Consequences

**Positive**

- One definition of "today" for debt, aging, due-date checks, numbering and jobs; no dependency on the zone of any server.
- A second building in another zone needs only a different `building.time_zone` value.

**Negative**

- Every query that needs a day must reach the building's zone (a join or a parameter). A query that forgets it silently uses the UTC date and is wrong only at night; the review checklist and the 06:59 test case are the only guard.
- `received_at` for a past `receivedOn` is a synthetic 12:00, not a real instant.
- Fixed local job times assume one zone per deployment; several zones would need per-building scheduling in the worker.

**Follow-up work**

- DOC-14 §time states the conventions and the column types; DOC-22 holds the corrected aging SQL and the bucket and zone test tables.
- DOC-38 gives each job its local time; DOC-41 holds the default zone key.
- Confirm the building's time zone with the client (P0-03).
