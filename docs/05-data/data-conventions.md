# Data conventions

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-22 (P1-07 and P1-08: the first `schema.ts` files, `drizzle.config.ts` and migrations, §14.1, §16.1) · 2026-10-21 (P1-06: the bootstrap and the migration command exist, checks 1, 9 and 13 of §16 run, DR-250) · 2026-10-19 (DR-110, DR-112, DR-113) · DOC-14
> Depends on: original SDD §16, [DR](../00-decision-register.md) (DR-09, 10, 11, 12, 14, 21, 41, 42, 55, 62, 71, 74, 85, 87, 100, 101), [ADR-0013](../04-adr/0013-time-zones-and-calendar-day-semantics.md), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [DOC-07](../03-architecture/system-context-and-containers.md) §5–§6, [DOC-11](../03-architecture/tech-stack-and-versions.md), [DOC-12](../03-architecture/code-architecture.md) §7–§9, [DOC-06](../02-glossary.md)
> Main readers: P1-06 (roles, bootstrap and migrations), P1-05, P1-07, P1-08 (first migrations), P2-01, P2-02 (finance tables and counters), DOC-15, DOC-16, DOC-17, DOC-18, DOC-19 (every table document follows this one), every task that writes a migration

This document fixes the rules that every table of the system follows: identifiers, standard columns, deletion, building scope, money, time, bilingual content, status columns, counters, naming, keys, triggers, search and migrations. It also holds the DDL of the pieces that belong to no single module: the schemas, the shared SQL helpers and `document_counter`. It does not define the tables of a module: finance is DOC-15, identity and residency DOC-16, the remaining schemas DOC-17.

**DDL tested on PostgreSQL 18.6 (`postgres:18.6`, aarch64) on 2026-10-19.** Every block in §2, §10, §15 and §14.3 was run in this order on an empty database with `psql -v ON_ERROR_STOP=1`, then the checks of §16 were run (12 expected errors, 0 unexpected). The blocks are the files the checks ran; if a block is edited, §16 is run again.

## 1. Scope and reading guide

| Question | Answer lives in |
| --- | --- |
| How is a column named, typed and constrained? | This document |
| Which tables does `finance` have and with what DDL? | DOC-15 |
| Which tables do `identity` and `residency` have? | DOC-16 |
| Building, audit, platform, tickets, notices, notification, access, vehicles, wiki, reporting, realtime tables | DOC-17 |
| Import and data-quality rules (`DQ-xx`) | DOC-18 |
| Roles, grants and the permission tests | DOC-19 |
| Retention and purge jobs | DOC-20 |
| Which module reads which table | DOC-07 §6 |

The sample tables in §15 live in a schema named `example`. They are an illustration that exercises every rule; no migration creates them. Rules are stated as "must"; a table that breaks one says so and cites the decision that allows it.

## 2. Schemas and the bootstrap step

The database holds fourteen schemas. Thirteen belong to a module (DR-03) and `platform` belongs to the vendored core packages (DR-85). A module writes only its own schema (DOC-07 §6.1).

| Schema | Owner | Tables defined in |
| --- | --- | --- |
| `identity` | module `identity` | DOC-16 |
| `building` | module `building` | DOC-17 §1 and §3 (`file_object`, `job_run`) |
| `residency` | module `residency` | DOC-16 |
| `finance` | module `finance` | DOC-15 |
| `tickets` | module `tickets` | DOC-17 §4 |
| `access` | module `access` | DOC-17 §5 |
| `vehicles` | module `vehicles` | DOC-17 §7 |
| `notices` | module `notices` | DOC-17 §6 |
| `notification` | module `notification` | DOC-17 §6 |
| `wiki` | module `wiki` | DOC-17 §8 |
| `audit` | module `audit` | DOC-17 §2 |
| `reporting` | module `reporting` | DOC-17 §9 |
| `realtime` | module `realtime` | DOC-17 §9 |
| `platform` | core packages | DOC-17 §3 (`maintenance`, `idempotency_key`, `rate_bucket`) and this document (helper functions) |

Each module that migrates also has a **history schema** `drizzle_<module>` with the table `__migrations` (§14). These schemas hold nothing else and are not part of the table above.

### 2.1 Who creates what

| Object | Created by | When |
| --- | --- | --- |
| Extensions, the fourteen schemas, the helper functions of `platform` | `0000-bootstrap.sql`, run by `rms_migrator` | Once per database, before any module migration (P1-06). Idempotent for schemas and extensions |
| Tables of `platform` | The same bootstrap step (`CREATE TABLE IF NOT EXISTS`), because the maintenance flag must exist before and while migrations run (reference, DR-03) | Once per database; DOC-17 §3 holds the DDL |
| Tables of a module, `outbox_messages` and `inbox` of that module, its counter | That module's Drizzle migrations | `db:migrate` in catalog order (§14) |
| History schema `drizzle_<module>` | `drizzle-kit migrate` | First migration of the module |
| Privileges of `rms_app`, `rms_readonly` | `0900-grants.sql`, run by `rms_migrator` | At the end of every `db:migrate`; idempotent; a table not yet covered is closed (DOC-19 §4, DR-113) |

The application role `rms_app` has no `CREATE` privilege on any schema (DOC-19).

### 2.2 Bootstrap DDL

```sql
-- 0000-bootstrap.sql: run once per database by rms_migrator, before any module migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS building;
CREATE SCHEMA IF NOT EXISTS residency;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS tickets;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS vehicles;
CREATE SCHEMA IF NOT EXISTS notices;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS wiki;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS realtime;

-- Shared helpers (belong to platform, i.e. to the core packages)
CREATE FUNCTION platform.immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE FUNCTION platform.is_bilingual(v jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT coalesce(
         jsonb_typeof(v) = 'object'
         AND jsonb_typeof(v -> 'vi') = 'string' AND btrim(v ->> 'vi') <> ''
         AND (v -> 'en' IS NULL OR jsonb_typeof(v -> 'en') = 'string')
         AND (v - 'vi' - 'en') = '{}'::jsonb,
       false)   -- a CHECK passes on NULL: the coalesce makes "vi missing" fail
  $$;
```

- The three extensions come from the PostgreSQL contrib package; P1-20 confirms the apt package carries them on the VPS (DOC-11 §1). They live in `public`; all application SQL is schema-qualified and the connection sets `search_path = public`.
- `platform.immutable_unaccent` is the only way SQL removes diacritics in an index or a predicate (§13). `unaccent` is `STABLE` in PostgreSQL, so an index on it is refused; the wrapper pins the dictionary and is declared `IMMUTABLE` (DR-41).
- `platform.is_bilingual` is the CHECK of every bilingual column (§8). The `coalesce(…, false)` matters: a `CHECK` passes when its expression is `NULL`, and `{"en": "x"}` makes `jsonb_typeof(v -> 'vi')` `NULL`. The first version of this function without it accepted a value with no Vietnamese text; check 4 in §16 pins the fix.

## 3. Identifiers

| Rule | Detail |
| --- | --- |
| Primary key | `id uuid NOT NULL`, UUIDv7, generated **in the application** (`Bun.randomUUIDv7()` or the core helper, DR-10). Time-ordered, so inserts append to the right of the index |
| No database default | A table has no `DEFAULT` on `id`: a missing id is a bug, and `NOT NULL` reports it. PostgreSQL 18 has `uuidv7()`; it is allowed only in seeds, migrations that backfill and tests |
| Type | `uuid` for every id and every reference to an id, including references to another module's row (§12) |
| Human codes | Separate from the id: `BL-YYMM-NNNN` (receipt), `PH-YYMM-NN` (batch), `TT-YYMMDD-NNNN` (intent), `YC-YYMMDD-NNN` (ticket). Built from `document_counter` (§10). Unit codes (`A-1508`) are data entered by the Manager, unique per building |
| Natural keys | A natural key is a `UNIQUE` constraint next to the surrogate `id`, never the primary key (`UNIQUE (building_id, code)`) |
| Composite primary keys | Only for pure association tables with no state: `notice_recipient (notice_id, account_kind, account_id)`, `inbox (message_id, handler)`, `document_counter` |
| Order codes | The gateway order code is a number from a sequence (`finance.order_code_seq`, DR-27), not a UUID and not a counter row |

Ordering by `id` is ordering by creation time to within a millisecond. List endpoints that need a stable order use the cursor `(sort_key, id)` (DR-74); `id` is the tie-breaker.

## 4. Standard columns, versions and deletion (DR-12)

### 4.1 Columns

| Column | Type | Where | Rule |
| --- | --- | --- | --- |
| `id` | `uuid NOT NULL` | Every table except pure association tables | §3 |
| `building_id` | `uuid NOT NULL` | Every business table, including `allocation`, `charge_line`, `payment_intent_item`, `receipt`, `ticket_message`, `ticket_attachment`, `page_version`… | The first column after `id`. No foreign key (§12). Tables without it are on the allow-list (§5.3) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Every table | Set by the database |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Every table whose rows are ever updated | Set **by the `UPDATE` statement** (`updated_at = now()`), not by a trigger. An append-only table has no `updated_at` and says so in its document |
| `version` | `integer NOT NULL DEFAULT 1 CHECK (version >= 1)` | Aggregates edited by several actors: `fee_batch`, `charge`, `ticket`, `notice`, `page`, `vehicle`, `unit`, and the accounts (`staff_account`, `resident_account`, DR-36) | Incremented by the `UPDATE` statement; the guard `WHERE version = :expected` is the optimistic lock (DOC-12 §9.2) |
| `status` | `text NOT NULL DEFAULT '<initial>'` + `CHECK` | Every table with a lifecycle | §9 |

The shape of a guarded update, used by every aggregate (the predicate, not the table, is the arbiter, DOC-12 §9.1):

```sql
UPDATE example.fee_batch
SET status = 'published', version = version + 1, updated_at = now()
WHERE id = :id AND building_id = :building_id AND status = 'draft' AND version = :expected_version
RETURNING id;   -- 0 rows: someone else won; the use case turns it into a typed 409
```

### 4.2 Deletion

| Kind of row | Rule |
| --- | --- |
| Units | Never deleted (DR-12) |
| Ledger rows: `payment`, `allocation`, `receipt`, `gateway_event`, the statement lines that belong to the money log, and a `charge` that is not `draft` | Never deleted. A mistake is voided or logged; an undone row has `status = 'void'` |
| Drafts: `fee_batch`, `charge`, `charge_line` while `draft`; `notice` while `draft` | Hard-deleted. Their children cascade (`ON DELETE CASCADE`, §12) |
| Everything else | Changes `status` (`retired`, `removed`, `cancelled`, `disabled`, `deleted`…). Purge jobs delete expired rows by retention (DOC-20) |
| Personal data on account deletion | Fields are cleared, the row stays (`resident_account.phone` becomes `deleted:<id>`, FR-39.3) |
| `audit.audit_log` (append-only) | No `UPDATE` or `DELETE` by the runtime role; the monthly purge is a `SECURITY DEFINER` function (DOC-07 §6.2, DOC-19). Other tables that are written once (`access.qr_scan`, `access.lookup_log`, `unit_history`, `page_version`) say in their document whether the purge job deletes them (DOC-17, DOC-20) |

## 5. Building scope

### 5.1 Indexes and uniqueness

1. **`building_id` is the first column of every index and unique constraint** on a scoped table, so one building's rows are contiguous and a query without the building cannot use the index by accident. Example: `ix_charge_building_unit_open (building_id, unit_id) WHERE status = 'open'`.
2. **Uniqueness is per building**: `UNIQUE (building_id, code)`, `UNIQUE (building_id, number)`, `UNIQUE (building_id, plate_key) WHERE status IN ('pending','approved')`. The exceptions are keys that are global by nature: `resident_account.phone`, `staff_account.email` (DR-36), gateway references `(provider, reference)` and the order code.
3. **Every index carries a reason**: the table document names the query (endpoint, job or constraint) that uses it. An index with no reason is removed.
4. **Partial indexes** serve the live state of a lifecycle (`WHERE status = 'open'`); a partial `UNIQUE` expresses "at most one live row" (`allocation UNIQUE (charge_id) WHERE status = 'live'`).
5. **A foreign key column is indexed** on the child side when the parent can be deleted or when the child is read by parent (`ix_charge_line_building_charge`).
6. **One exception to rule 1:** `residency.membership_one_per_account_unit` does not start with `building_id`, because the request guard looks a membership up by `(account_id, unit_id)` before the building is known; unit ids are globally unique (DOC-16 §5.3).

### 5.2 The scope guard

Every repository method on a scoped table takes a `BuildingScope` and every query carries `building_id = :scope` (DOC-12 §7). The scope lint is a merge gate from P1 (DR-12). This document owns the two lists the lint reads.

- **Scoped list**: generated from the schemas — every table with a `building_id` column. Nothing to maintain by hand.
- **Allow-list** (§5.3): tables that the lint does not require a predicate on, kept by hand and reviewed by CODEOWNERS.

### 5.3 The allow-list

A table is on the allow-list only for one of three reasons: it is **looked up before a building is known** (sign-in, refresh, links in an email, rate limits by IP or phone); it **belongs to an account that spans buildings**; or it is **infrastructure** with no business reads. Everything else is scoped. A table on the list keeps a comment in its schema file with the reason.

| Table | Reason | Note |
| --- | --- | --- |
| `platform.maintenance`, `platform.idempotency_key`, `platform.rate_bucket` | Infrastructure of the core packages, keyed by account, IP or nothing (DR-85) | `idempotency_key` is keyed by `(account_kind, account_id, key)` |
| `identity.rate_bucket`, `identity.otp_challenge` | Looked up by phone, email or IP before any account is known | |
| `identity.password_token` | Reset and invite links are public routes: found by `token_hash` before a staff identity exists | DOC-16 confirms the column list |
| `identity.refresh_family`, `identity.refresh_token` | Found by token hash at refresh; a resident session has no building (DR-38) | |
| `identity.resident_account` | A resident account spans buildings and has no `building_id` (DR-36) | |
| `identity.staff_account` | Carries `building_id` as data, but sign-in finds the row by email before a building is known. Guards read it by `id` and compare `building_id` with the token claim in the repository | The one table that is both on the list and has the column |
| `building.building` | The scope root: its `id` is the building id | |
| `<schema>.outbox_messages`, `<schema>.inbox` (every schema that publishes or consumes) | Core-package tables read only by the relay; the event payload carries `buildingId` (DOC-12 §7.1) | |
| `building.job_run` | Infrastructure: one row per run of a job, with no business reads and no building (DR-112, DOC-17 §3.2) | Added by DOC-17 |

Rules for the list:

- The document that defines a global table adds it here **in the same change** as its DDL. DOC-17 does this for `notification.device_token` and `notification.push_ticket`, which belong to a device of an account.
- A table on the list that has no `building_id` is exempt from the "scope argument" check; its repository still states how it narrows (by token hash, by phone, by account id).
- `realtime.events` is **scoped**: each replay row carries `building_id`, and a stream replays only its own building. It is not on the list (DR-104; DOC-12 §7.3 and DOC-07 §6.1 rule 4 listed different sets; this table is the reconciled one).

## 6. Money and quantity (DR-11)

| Item | Column | Rule |
| --- | --- | --- |
| Amount in đồng | `bigint NOT NULL` (`amount`, `unit_price`, `*_amount`) | Integer đồng. Never `numeric`, never `real`. Currency is the constant `VND`; there is no currency column |
| Sign | `CHECK (amount > 0)` on `charge`; `CHECK (unit_price >= 0)` on lines | Only an `adjustment` line may carry a negative `amount` (DR-19). A table that allows another sign says why |
| Quantity | `quantity numeric(12,3) NOT NULL CHECK (quantity >= 0)` | Three decimals. In code the same value is `qty_milli`, an integer of thousandths (`QtyMilli`, DR-100) |
| Line amount | `amount = ((quantity × 1000)::bigint × unit_price + 500) / 1000` | Half up, integer division. Enforced by `CHECK` on `kind = 'fee'` lines; an `adjustment` amount is entered by hand |
| JSON | Integer number, never a string | Asserted `<= 2^53 − 1` at the edge |

Test table for the line amount (run in §16, check 8 and the query in §16.2):

| Quantity | Unit price (đ) | Amount (đ) | Why |
| --- | --- | --- | --- |
| 12.345 | 15,000 | 185,175 | `(12345 × 15000 + 500) / 1000`; FR-01.5 |
| 0.5 | 1 | 1 | exactly half rounds up |
| 0.499 | 1 | 0 | below half rounds down |
| 0.001 | 500 | 1 | 0.5 đ rounds up |
| 0.001 | 499 | 0 | 0.499 đ rounds down |
| 1 | 2,488,000 | 2,488,000 | whole quantity |
| 2.5 | 350,000 | 875,000 | exact |
| 1.5 | 1 | 2 | 1.5 rounds up |
| 0 | 100,000 | 0 | zero quantity |

There is no pro-rata and no credit (DR-84): item totals of reports add up exactly, so no rounding rule exists beyond the line amount.

## 7. Time (DR-09, ADR-0013)

| Item | Column | Rule |
| --- | --- | --- |
| Instant | `timestamptz`, named `*_at` (`created_at`, `received_at`, `expires_at`) | Servers and PostgreSQL run in UTC. Every instant is stored with its zone |
| Calendar day | `date`, named `*_date` or `*_month` (`due_date`, `fee_month`) | Carries no zone. `fee_month` is the first day of the month: `CHECK (fee_month = date_trunc('month', fee_month)::date)` |
| Building zone | `building.time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'` | Validated in code against the IANA list; a `CHECK` cannot read `pg_timezone_names` |
| "Today" in SQL | `(now() AT TIME ZONE b.time_zone)::date` | Never `now()::date`, never `CURRENT_DATE` in a business query |
| "Today" in code | `buildingToday(clock.now(), tz)` | Never `Date.now()` (DOC-12 §9.4) |
| `receivedOn` of a manual payment | `received_at timestamptz` | `now()` when the day is today, otherwise 12:00 local of that day |
| Period of a number | Building time | The `YYMM` of a receipt number is the issue month in building time (DR-10) |
| JSON | `date` as `YYYY-MM-DD`; instants in UTC ISO 8601 | One format (DOC-50) |

A charge is payable through the end of its due day and overdue when `buildingToday > due_date`. Test table (run in §16, check 9; the session zone is UTC, so the third column is what a careless `::date` gives):

| Instant (building time) | `building_today` | `now()::date` in UTC | Days past due of a charge due 2026-10-15 |
| --- | --- | --- | --- |
| 2026-10-15 23:30 | 2026-10-15 | 2026-10-15 | 0 |
| 2026-10-16 00:30 | 2026-10-16 | 2026-10-15 ✗ | 1 |
| 2026-10-16 06:59 | 2026-10-16 | 2026-10-15 ✗ | 1 |

## 8. Bilingual content and JSON columns (DR-71)

**Bilingual text** is `jsonb` of the form `{"vi": "…", "en": "…"}`. `vi` is required and non-empty; `en` is optional; no other key is allowed. The check is `platform.is_bilingual(col)` (§2.2); an optional bilingual column is `col IS NULL OR platform.is_bilingual(col)`.

```sql
-- read in the caller's language, falling back to Vietnamese
SELECT coalesce(name ->> :lang, name ->> 'vi') FROM example.fee_batch;
```

The bilingual columns are the ones the Manager or Admin writes and the residents read: `fee_batch.name`, `charge_line.item_name`, `notice.title/body`, `ticket_type.name`, `wiki.folder.name`, `wiki.page.title/body`. System messages (inbox entries, push, errors) are not stored as text: they store a template key and parameters (DR-53).

**Other JSON columns** (`payload`, `headers`, `changes`, `snapshot`, `params`, `details`):

- Type `jsonb`. A column that holds an object has `CHECK (jsonb_typeof(col) = 'object')`.
- JSON holds documents that are written once and read whole (event payloads, receipt snapshots, audit changes, import previews). It does not hold state that is queried or constrained: that is a column.
- Every JSON column has its shape documented in the table document and validated in code (zod); the database does not validate it beyond `jsonb_typeof`.
- Arrays of simple values (`visibility text[]`, DR-54) use PostgreSQL arrays, not JSON.

## 9. Status and enumerated columns (DR-105)

An enumerated column is `text` with a named `CHECK (col IN (…))`, not a PostgreSQL `ENUM`.

- The set of values changes over time; adding to a `CHECK` is a metadata change, while an `ENUM` value cannot be removed or reordered and needs `ALTER TYPE`, which complicates expand/contract (§14).
- The code mirrors the set in one TypeScript union per column; the schema file builds the `CHECK` from the same constant so they cannot drift.
- The first value is the `DEFAULT` when a row has an initial state.
- Every status column has a `stateDiagram-v2` and a transition table in its table document (from → to · by whom · when), and the transition is a guarded `UPDATE` (§4.1).

```sql
CONSTRAINT ck_fee_batch_status CHECK (status IN ('draft', 'published', 'recalled', 'closed'))
```

Adding a value is a migration that drops and re-adds the `CHECK` in one transaction (instant on tables of this size); removing a value first needs the code to stop writing it (§14).

## 10. Counters (DR-10)

`GaplessCounter` (DOC-12 §9.5) creates one `document_counter` table in each schema that needs a series. Two schemas do: `finance` (receipt, batch, intent) and `tickets` (ticket).

| Series | Schema | Format | `period` | Gapless |
| --- | --- | --- | --- | --- |
| `receipt` | `finance` | `BL-YYMM-NNNN` | `YYMM` of the **issue month** in building time | Yes |
| `batch` | `finance` | `PH-YYMM-NN` | `YYMM` of the batch's fee month | No |
| `intent` | `finance` | `TT-YYMMDD-NNNN` | `YYMMDD` of the creation date | No |
| `ticket` | `tickets` | `YC-YYMMDD-NNN` | `YYMMDD` of the creation date | No |

Widths are minimum widths: the 10,000th receipt of a month prints `BL-2610-10000`. `UNIQUE (building_id, number)` on `receipt` is the last guard.

```sql
-- GaplessCounter: one table per schema that needs one (finance, tickets)
CREATE TABLE finance.document_counter (
  building_id uuid        NOT NULL,
  series      text        NOT NULL,
  period      text        NOT NULL,
  last        integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_document_counter PRIMARY KEY (building_id, series, period),
  CONSTRAINT ck_document_counter_series CHECK (series IN ('receipt', 'batch', 'intent')),
  CONSTRAINT ck_document_counter_period CHECK (period ~ '^[0-9]{4}([0-9]{2})?$'),
  CONSTRAINT ck_document_counter_last   CHECK (last >= 0)
);

CREATE TABLE tickets.document_counter (
  building_id uuid        NOT NULL,
  series      text        NOT NULL,
  period      text        NOT NULL,
  last        integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_document_counter PRIMARY KEY (building_id, series, period),
  CONSTRAINT ck_document_counter_series CHECK (series IN ('ticket')),
  CONSTRAINT ck_document_counter_period CHECK (period ~ '^[0-9]{6}$'),
  CONSTRAINT ck_document_counter_last   CHECK (last >= 0)
);
```

**The upsert** (one statement, in the caller's transaction, as late as possible, right before the insert that uses the number):

```sql
INSERT INTO finance.document_counter (building_id, series, period, last)
VALUES (:building_id, 'receipt', :yymm, 1)
ON CONFLICT (building_id, series, period)
DO UPDATE SET last = document_counter.last + 1, updated_at = now()
RETURNING last;   -- number = 'BL-' || :yymm || '-' || lpad(last::text, 4, '0')
```

The first call for a new period inserts `last = 1`; every later call increments. The row lock taken by the upsert is held until commit, so two issuers of the same building and series queue; a rollback undoes the increment, so a rolled-back settlement leaves no gap. If the document already exists (a retried settlement), the use case finds it **before** taking a number, so a retry does not consume one.

**Worked example** (run in §16, checks 2 and 15). Building `018f…0001`, series `receipt`, period `2610`, empty table:

| Step | Session | Statement | Result |
| --- | --- | --- | --- |
| 1 | A | `BEGIN`; upsert | `BL-2610-0001` |
| 2 | A | `ROLLBACK` | the row is undone: `last` is back to no row |
| 3 | A | `BEGIN`; upsert; `COMMIT` | `BL-2610-0001` again: no gap |
| 4 | A | upsert | `BL-2610-0002` |
| 5 | A | `BEGIN`; upsert | `BL-2610-0003`, transaction kept open for 2 s |
| 6 | B | 0.7 s later: `BEGIN`; upsert | **waits** on A's row lock |
| 7 | A | `COMMIT` | B continues and gets `BL-2610-0004` |

Measured on 2026-10-19 (`postgres:18.6` in Docker on a laptop): B waited 1,269 ms for A's 2,000 ms hold started 0.7 s earlier, and the final `last` was 4. At the design volume (about 150 receipts an hour at publication) the lock is held for the few milliseconds the settlement transaction needs after the upsert.

## 11. Naming

| Object | Rule | Example |
| --- | --- | --- |
| Schema | Module name, singular noun or plural as the module is named | `finance`, `notification` |
| Table | `snake_case`, singular, no schema prefix | `fee_batch`, `charge_line`, `gateway_event` |
| Column | `snake_case`; id of another row `<name>_id`; instant `<name>_at`; day `<name>_date`; month `<name>_month`; boolean a true statement (`is_demo`, `push_enabled`); hash `<name>_hash`; encrypted value `<name>_enc`; stored file `<name>_file` (a `file_object` id) | `unit_id`, `locked_until`, `plate_photo_file` |
| Primary key | `pk_<table>` | `pk_fee_batch` |
| Unique | `uq_<table>_<columns>` (columns abbreviated to the meaning) | `uq_fee_batch_building_code` |
| Check | `ck_<table>_<rule>` | `ck_charge_line_amount` |
| Foreign key | `fk_<table>_<referenced>` | `fk_charge_line_charge` |
| Index | `ix_<table>_<columns>[_<qualifier>]` | `ix_charge_building_unit_open` |
| Trigger / function | `trg_<table>_<purpose>` / `<table>_<purpose>()` in the table's schema | `trg_charge_freeze`, `charge_freeze()` |
| Sequence | `<name>_seq` | `order_code_seq` |

Constraint and index names are written explicitly in the Drizzle schema (`primaryKey({ name })`, `unique(name)`, `check(name, …)`, `index(name)`). PostgreSQL truncates names over 63 bytes; the longest name in §15 is 37 bytes, and a name that approaches 50 is shortened by hand. Constraint names are unique within a table; the same short name (`pk_document_counter`) may appear in two schemas.

## 12. Keys, references and triggers

**Foreign keys** (ADR-0014):

- A foreign key exists **only inside one schema**. A reference to another module's row — `building_id`, `unit_id`, `account_id`, `file_id`, `created_by` — is a plain `uuid NOT NULL`/`NULL` column, validated through a contract when it is written and re-read through a contract when it is shown. Check 12 in §16 pins that such a column accepts a value that exists nowhere.
- `ON DELETE CASCADE` is used only for children of a **draft** (`charge` → `charge_line`, `fee_batch` → `charge`); the code deletes drafts only (§4.2). Every other foreign key is the default `NO ACTION`.
- `building_id` never has a foreign key, even to `building.building`: the scope comes from the token or the membership, not from the database.
- A weekly integrity job (`integrity_weekly`, DR-62) looks for orphans of the references it can check.

**Triggers** are rare and exist only for invariants that the application must not be trusted with:

- Immutable amounts: `charge.amount` and `charge_line` cannot change unless the charge is `draft` (original SDD §16.2). The template is `example.charge_freeze()` in §15; DOC-15 defines the real ones.
- Append-only tables (`audit.audit_log`) are protected by privileges (DOC-19). *Revised 2026-10-19 (DR-110):* `audit.audit_log` also has a trigger as a second layer, as DR-57 says; the privileges stay the control.
- A trigger is `BEFORE UPDATE … FOR EACH ROW`, raises `integrity_constraint_violation`, writes nothing else, calls nothing outside its schema and never sets `version` or `updated_at`. Business rules, notifications and audit rows are the application's job.
- Each trigger has a test row in its table document: the statement that must fail and the one that must succeed (checks 6 and 7 show the pattern).

## 13. Text search (DR-41)

| Search | Column expression and index | Notes |
| --- | --- | --- |
| Unit code | `code`; `btree (building_id, code)` unique; `ILIKE 'q%'` after an exact match | |
| Resident name | `lower(platform.immutable_unaccent(full_name))` with `gin_trgm_ops` | "Đặng Thị" is found by `dang thi` (checks 10 and the query plan below) |
| Phone | Suffix of at least 4 digits in `identity.resident_account`; residency asks identity (`IdentityApi.findResidentAccountsByPhoneFragment`) | Not indexed in residency |
| Plate | `plate_key` with `gin_trgm_ops`, minimum 3 characters, **contains** match | |
| Library | Full text over `platform.immutable_unaccent(title/body)` with the `simple` configuration (DR-54, DOC-32) | Defined in DOC-32 |
| Email | `citext`, unique | `Nhung@Example.COM` equals `nhung@example.com` (check 11) |

The query plan with `enable_seqscan = off` on a small table uses `ix_resident_profile_name_trgm` (a bitmap index scan on the trigram index); the planner chooses a sequential scan on a table of a few rows by itself, which is correct. Search terms are normalized in code the same way before the query: `lower(unaccent(q))`, whitespace collapsed.

## 14. Migrations

### 14.1 Layout and commands (DR-08, ADR-0014)

- Each module carries its own `drizzle.config.ts` and `migrations/` folder, reads the module's `infrastructure/persistence/schema.ts`, filters on its schema, and keeps its history in schema `drizzle_<module>`, table `__migrations` (the reference layout, DR-03).
- `bun run db:generate` runs drizzle-kit inside each module; `bun run db:migrate` applies each module's pending migrations **in catalog order on one connection** with `prepare: false`, so it also works behind PgBouncer in transaction mode (DR-67), then runs the grants step (DOC-19 §4). Migrations are a separate step of the deploy (a one-shot service or step 4 of the deploy script, DOC-70), never run by the app at boot.
- Versions: Drizzle 0.45 and drizzle-kit 0.31, as pinned in DOC-11 §3. The options below were checked against the drizzle-kit configuration reference on 2026-10-19. A move to Drizzle 1.0 changes casing, relational queries and the migrations layout and needs a DR (DR-82).

```ts
// modules/finance/drizzle.config.ts  (illustrative: compiled and run in P1-06)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['finance'],
  migrations: { schema: 'drizzle_finance', table: '__migrations' },
})
```

```ts
// modules/finance/src/infrastructure/persistence/schema.ts  (excerpt, illustrative)
import { bigint, check, date, index, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const finance = pgSchema('finance')

export const feeBatch = finance.table('fee_batch', {
  id: uuid('id').notNull(),
  buildingId: uuid('building_id').notNull(),
  code: text('code').notNull(),
  feeMonth: date('fee_month', { mode: 'string' }).notNull(),
  name: jsonb('name').$type<{ vi: string; en?: string }>().notNull(),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /* pk_fee_batch, uq_fee_batch_building_code, ck_fee_batch_status, ck_fee_batch_name … named as in §11 */
  check('ck_fee_batch_name', sql`platform.is_bilingual(${t.name})`),
  index('ix_fee_batch_building_fee_month').on(t.buildingId, t.feeMonth.desc()),
])
```

### 14.2 Rules

| Rule | Detail |
| --- | --- |
| One module per migration | A migration touches only the schema of its module |
| Never edit an applied migration | A mistake is fixed by a new migration |
| No down migrations | Rollback is the previous image and the previous Pages build (DR-83); it is safe because every migration is backward compatible for one release (below) |
| Hand-written SQL is allowed | For what drizzle-kit cannot express (`CHECK` with a function, partial indexes with expressions, triggers); the file is named `NNNN_<slug>.sql` and reviewed like code |
| Every constraint and index is named | §11 |
| Big backfills in batches | 1,000 rows per `UPDATE … WHERE … LIMIT`-style batch, outside the DDL transaction when the table is large; at design scale (5,000 units) a single statement is fine |
| `CREATE INDEX CONCURRENTLY` | Not used: it cannot run inside the migration transaction and no table here is large enough to need it. A table that grows past that needs a DR |
| Seeds | Demo data are seeds (`seed:demo`), not migrations (DOC-36) |

### 14.3 Expand, then contract (original SDD §16.3)

A change that a running old version would break is split over releases so that the old and new code both work against the schema in between. Worked example: rename `charge.due_date` to `pay_by`.

| Release | Schema | Code | Safe for the previous release? |
| --- | --- | --- | --- |
| N (expand) | `ADD COLUMN pay_by date` (nullable); backfill from `due_date` | Writes both columns, reads `coalesce(pay_by, due_date)` | Yes: the old code still inserts `due_date` only |
| N+1 (switch) | `ALTER COLUMN due_date DROP NOT NULL`; backfill the gap; `ADD CONSTRAINT ck_charge_pay_by_set CHECK (pay_by IS NOT NULL) NOT VALID`; `VALIDATE CONSTRAINT` | Reads and writes `pay_by` only | Yes: N still writes both |
| N+2 (contract) | `DROP COLUMN due_date`; `SET NOT NULL` on `pay_by`; drop the helper `CHECK` | Unchanged | Yes: N+1 no longer touches `due_date` |

An earlier version of this example added the `NOT VALID` check in release N; it broke the old code, which does not write `pay_by`. The constraint belongs to the switch, after no running code omits the column. The statements are in the block below and ran as check 14.

```sql
-- release N (expand): add the new column, nullable; code writes both and reads coalesce(pay_by, due_date)
ALTER TABLE example.charge ADD COLUMN pay_by date;
-- backfill (in batches of 1,000 on a big table)
UPDATE example.charge SET pay_by = due_date WHERE pay_by IS NULL;
-- the old code of release N-1 still inserts without pay_by: it must keep working
INSERT INTO example.charge (id, building_id, batch_id, unit_id, amount, due_date)
VALUES (uuidv7(), '018f0000-0000-7000-8000-000000000001', '018f0000-0000-7000-8000-0000000000b1', uuidv7(), 10, '2026-11-05');
-- release N+1 (switch): code reads and writes pay_by only
ALTER TABLE example.charge ALTER COLUMN due_date DROP NOT NULL;
UPDATE example.charge SET pay_by = due_date WHERE pay_by IS NULL;
ALTER TABLE example.charge ADD CONSTRAINT ck_charge_pay_by_set CHECK (pay_by IS NOT NULL) NOT VALID;
ALTER TABLE example.charge VALIDATE CONSTRAINT ck_charge_pay_by_set;
INSERT INTO example.charge (id, building_id, batch_id, unit_id, amount, pay_by)
VALUES (uuidv7(), '018f0000-0000-7000-8000-000000000001', '018f0000-0000-7000-8000-0000000000b1', uuidv7(), 10, '2026-11-06');
-- release N+2 (contract): nothing reads due_date any more
ALTER TABLE example.charge DROP COLUMN due_date;
ALTER TABLE example.charge ALTER COLUMN pay_by SET NOT NULL;
ALTER TABLE example.charge DROP CONSTRAINT ck_charge_pay_by_set;
SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'example' AND table_name = 'charge' AND column_name IN ('due_date','pay_by') ORDER BY 1;
SELECT count(*) FROM example.charge WHERE pay_by IS NULL;
```

Other changes: adding a nullable column or a table is one release; adding a value to a `CHECK` is one release; removing a value, dropping a column or table, tightening a constraint and changing a type are two or three. A destructive change needs the Owner's attention in the pull request description.

## 15. Reference DDL

The DDL below is the reference: a small fee aggregate with every rule applied. DOC-15 builds the real tables from it. It lives in schema `example`, which no migration creates.

```sql
-- Illustrative aggregate: shows every convention. Not created by any migration.
CREATE SCHEMA example;

CREATE TABLE example.fee_batch (
  id          uuid        NOT NULL,                                  -- UUIDv7 from the application
  building_id uuid        NOT NULL,
  code        text        NOT NULL,                                  -- human code from document_counter
  fee_month   date        NOT NULL,
  due_date    date        NOT NULL,
  name        jsonb       NOT NULL,                                  -- bilingual
  status      text        NOT NULL DEFAULT 'draft',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_fee_batch PRIMARY KEY (id),
  CONSTRAINT uq_fee_batch_building_code UNIQUE (building_id, code),
  CONSTRAINT ck_fee_batch_status    CHECK (status IN ('draft', 'published', 'recalled', 'closed')),
  CONSTRAINT ck_fee_batch_fee_month CHECK (fee_month = date_trunc('month', fee_month)::date),
  CONSTRAINT ck_fee_batch_name      CHECK (platform.is_bilingual(name)),
  CONSTRAINT ck_fee_batch_version   CHECK (version >= 1)
);
CREATE INDEX ix_fee_batch_building_fee_month ON example.fee_batch (building_id, fee_month DESC);

CREATE TABLE example.charge (
  id          uuid        NOT NULL,
  building_id uuid        NOT NULL,
  batch_id    uuid        NOT NULL,
  unit_id     uuid        NOT NULL,                                  -- other module: plain uuid, no FK
  amount      bigint      NOT NULL,                                  -- đồng
  due_date    date        NOT NULL,
  status      text        NOT NULL DEFAULT 'draft',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_charge PRIMARY KEY (id),
  CONSTRAINT fk_charge_batch FOREIGN KEY (batch_id) REFERENCES example.fee_batch (id) ON DELETE CASCADE,
  CONSTRAINT uq_charge_batch_unit UNIQUE (batch_id, unit_id),
  CONSTRAINT ck_charge_status CHECK (status IN ('draft', 'open', 'paid', 'void')),
  CONSTRAINT ck_charge_amount CHECK (amount > 0)
);
-- main access path of the debt query: building first, partial on the live state
CREATE INDEX ix_charge_building_unit_open ON example.charge (building_id, unit_id) WHERE status = 'open';

CREATE TABLE example.charge_line (
  id          uuid         NOT NULL,
  building_id uuid         NOT NULL,
  charge_id   uuid         NOT NULL,
  position    smallint     NOT NULL,
  kind        text         NOT NULL DEFAULT 'fee',
  item_name   jsonb        NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1,
  unit_price  bigint       NOT NULL,
  amount      bigint       NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_charge_line PRIMARY KEY (id),
  CONSTRAINT fk_charge_line_charge FOREIGN KEY (charge_id) REFERENCES example.charge (id) ON DELETE CASCADE,
  CONSTRAINT uq_charge_line_charge_position UNIQUE (charge_id, position),
  CONSTRAINT ck_charge_line_kind CHECK (kind IN ('fee', 'adjustment')),
  CONSTRAINT ck_charge_line_item_name CHECK (platform.is_bilingual(item_name)),
  CONSTRAINT ck_charge_line_quantity  CHECK (quantity >= 0),
  CONSTRAINT ck_charge_line_unit_price CHECK (unit_price >= 0),
  -- DR-11: half up, integer arithmetic on thousandths; adjustments are entered by hand
  CONSTRAINT ck_charge_line_amount CHECK (kind = 'adjustment'
    OR amount = (((quantity * 1000)::bigint * unit_price) + 500) / 1000)
);
CREATE INDEX ix_charge_line_building_charge ON example.charge_line (building_id, charge_id);

-- Immutable amounts: a template used by DOC-15 for charge and charge_line
CREATE FUNCTION example.charge_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'charge % amount is immutable once %', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_charge_freeze BEFORE UPDATE ON example.charge
  FOR EACH ROW EXECUTE FUNCTION example.charge_freeze();

-- Search conventions (DR-41)
CREATE TABLE example.resident_profile (
  id          uuid        NOT NULL,
  building_id uuid        NOT NULL,
  full_name   text        NOT NULL,
  email       citext,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_resident_profile PRIMARY KEY (id),
  CONSTRAINT uq_resident_profile_building_email UNIQUE (building_id, email)
);
CREATE INDEX ix_resident_profile_name_trgm ON example.resident_profile
  USING gin (lower(platform.immutable_unaccent(full_name)) gin_trgm_ops);
```

What each part demonstrates:

| Part | Rule |
| --- | --- |
| `fee_batch.id` without default, `building_id` second | §3, §4.1 |
| `uq_fee_batch_building_code` | §5.1 rule 2 |
| `ck_fee_batch_fee_month`, `due_date date` | §7 |
| `name jsonb` with `platform.is_bilingual` | §8 |
| `status` with `ck_*_status`, `version` | §4.1, §9 |
| `charge.unit_id` with no foreign key; `fk_charge_batch ON DELETE CASCADE` | §12 |
| `ix_charge_building_unit_open` partial index | §5.1 rule 4 |
| `charge_line.amount` check with half-up formula; negative adjustment allowed by `kind` | §6 |
| `charge_freeze` trigger | §12 |
| `ix_resident_profile_name_trgm`, `citext` email | §13 |

## 16. Required tests

The checks ran on 2026-10-19 on PostgreSQL 18.6 after the DDL of §2.2, §10 and §15, each as a `psql` statement; a failing statement is expected where the table says so. The table is the specification of what P1-06 turns into `bun test` cases against a template database; each row is one statement or a short sequence.

| # | Statement | Expected | Result |
| --- | --- | --- | --- |
| 1 | `uuid_extract_version(uuidv7())` | `7` | Pass |
| 2 | Upsert `receipt`/`2610` in a transaction, `ROLLBACK`, then twice committed | `BL-2610-0001`, `BL-2610-0001`, `BL-2610-0002`; a ticket upsert gives `YC-261019-001` | Pass |
| 3 | Insert a `ticket` series into `finance.document_counter`; a period `26-10` | 2 errors: `ck_document_counter_series`, `ck_document_counter_period` | Pass |
| 4 | `fee_batch` with `fee_month` 2026-10-15; name `{"en": …}` only; name with a third key `fr`; status `archived` | 4 errors: `ck_fee_batch_fee_month`, `ck_fee_batch_name` ×2, `ck_fee_batch_status`; a valid row inserts | Pass |
| 5 | Same `(building_id, code)` twice; same code in another building | 1 error `uq_fee_batch_building_code`; the other building's row inserts | Pass |
| 6 | `charge` with `amount` 0; amount 2,838,000 then `UPDATE amount` while `draft`; `status = 'open'`; `UPDATE amount` again | 1 error `ck_charge_amount`; the draft update succeeds (`version` 2); the open update fails with `amount is immutable once open` (trigger) | Pass |
| 7 | A second charge for the same `(batch_id, unit_id)` | 1 error `uq_charge_batch_unit` | Pass |
| 8 | Lines: 12.345 × 15,000 with amount 185,000; with 185,175; 0.5 × 1 with amount 1; an `adjustment` of −200,000 | 1 error `ck_charge_line_amount`; the other three insert | Pass |
| 9 | Building day of 23:30, 00:30, 06:59 local with the session in UTC | `2026-10-15`, `2026-10-16`, `2026-10-16`; days past due 0, 1, 1 | Pass |
| 10 | Search `dang thi` and `van an` on the unaccented names; plan with `enable_seqscan = off` | Both residents found; a bitmap index scan on `ix_resident_profile_name_trgm` | Pass |
| 11 | Insert `nhung@example.com` where `Nhung@Example.COM` exists in the same building | 1 error `uq_resident_profile_building_email` | Pass |
| 12 | `charge.unit_id` holds a uuid that exists in no table | The row exists (no cross-module foreign key) | Pass |
| 13 | `platform.is_bilingual` on `{"vi":"a"}`, `{"vi":"a","en":"b"}`, `{"vi":""}`, `{"en":"b"}`, `{"vi":1}`, `"vi"`, `{"vi":"a","en":null}`, `NULL` | `true, true, false, false, false, false, false, false` | Pass |
| 14 | Expand/contract of §14.3: old-style insert in N, new-style insert in N+1, end state | Both inserts succeed; at the end `due_date` is gone and `pay_by` is `NOT NULL` with 0 nulls | Pass |
| 15 | Two sessions on the same counter row (§10 worked example) | B waits for A and gets the next number | Pass: B waited 1,269 ms and got `BL-2610-0004` after A's `BL-2610-0003` |

### 16.1 Not run

| Item | Why | Done in |
| --- | --- | --- |
| The Drizzle schema and config of §14.1 | **Done in P1-07 and P1-08** (2026-10-22): `modules/audit` and `modules/building` have their `drizzle.config.ts`, `schema.ts` and migrations; `bun run db:generate` made `0000_init.sql` of each, and a custom file holds what drizzle-kit cannot say. drizzle-kit writes `CREATE SCHEMA` (removed: the bootstrap owns the schemas) and `DESC NULLS LAST` for `.desc()` (use `.desc().nullsFirst()`, which is the order `ORDER BY … DESC` asks for and the index can serve). `CHECK`s with a function and partial indexes with `WHERE` come out as written; `INCLUDE` and triggers do not | P1-07 (`db:generate` on a real schema) |
| Checks 2 to 8, 10 to 12, 14 and 15 of the table above | They need the tables of `finance` and `residency`, which DOC-15 and DOC-16 define and P1-12 and P2-01 create. Checks 1, 9 and 13 and the unaccent and trigram behaviour ran in P1-06 (`apps/api/tests/grants/grants.test.ts`) | P1-12, P2-01 |
| Unaccent and trigram behaviour with the real `unaccent` rules on the VPS packages | The container image carries the same contrib modules; the VPS packages are not checked | P1-20 |
| The full set of constraints of `finance` | Defined in DOC-15 | DOC-15 and P2-01 |

### 16.2 Rounding query

```sql
SELECT q || ' x ' || p || ' = ' || (((q * 1000)::bigint * p) + 500) / 1000
FROM (VALUES (12.345::numeric(12,3), 15000::bigint), (0.5, 1), (0.499, 1), (0.001, 500), (0.001, 499),
             (1, 2488000), (2.5, 350000), (1.5, 1), (0, 100000)) AS t(q, p);
```

Output on 2026-10-19: `185175, 1, 0, 1, 0, 2488000, 875000, 2, 0`, matching §6.

## 17. Not in this document

| Topic | Lives in |
| --- | --- |
| Tables, columns and DDL of a module | DOC-15, DOC-16, DOC-17 |
| Data-quality rules, Excel aliases | DOC-18 |
| Roles, grants, permission tests | DOC-19 |
| Retention, purge, backup retention, deletion execution | DOC-20 |
| Event envelope and `outbox_messages`/`inbox` columns | DOC-09 (core helper) |
| API formats for money, time and cursors | DOC-50 |
| `BuildingScope` in code, the scope lint implementation | DOC-12 §7 |
| Which module writes which table | DOC-07 §6.2 |

## 18. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| §2 schemas, bootstrap | DR-03, DR-85, ADR-0014 | NFR-08 |
| §3 identifiers, §10 counters | DR-10 | FR-03.4, FR-05.1 (receipt numbers); checks 1, 2, 15 |
| §4 columns, versions, deletion | DR-12 | FR-02.2, FR-02.4; check 6 |
| §5 scope | DR-12, DR-85 | NFR-08, FR-34.4; EXP-10 |
| §6 money | DR-11, DR-84 | FR-01.5; checks 6, 8 |
| §7 time | DR-09, ADR-0013 | FR-12.1, FR-12.2; check 9 |
| §8 bilingual | DR-71 | NFR-13; checks 4, 13 |
| §12 references, triggers | ADR-0014, original SDD §16.2 | FR-02.3, FR-49; checks 6, 7, 12 |
| §13 search | DR-41 | FR-18.5, FR-31, FR-33.1; checks 10, 11 |
| §14 migrations | DR-08, DR-67, original SDD §16.3 | NFR-10; check 14 |

## Open questions

Decisions made while writing, decided by Claude (delegated by the Owner): DR-104 and DR-105. They are applied in the text above.

- **DR-104 · The allow-list of the scope lint, its meaning and its reconciled content.**
  - *Problem:* DOC-12 §7.3 lists seven allow-list entries and DOC-07 §6.1 rule 4 lists two (`platform.*`, `identity.rate_bucket`); neither lists `outbox_messages`/`inbox` (no `building_id`), `identity.staff_account` (found by email at sign-in), `identity.password_token` (public links) or `building.building` (the root), and DOC-12 lists `realtime.events`, whose rows are building-specific.
  - *Decision:* the allow-list is the table of §5.3: a table is on it only if it is looked up before a building is known, belongs to an account spanning buildings, or is infrastructure. `realtime.events` is scoped (carries `building_id`) and leaves the list. The document that defines a global table adds it in the same change. DOC-12 §7.3 and DOC-07 §6.1 are brought in line.
  - *Consequences:* a few more entries to review; no runtime change. EXP-10 remains the check.
  - *Write to:* DOC-12 §7.3, DOC-07 §6.1 and §6.2, DOC-17.
- **DR-105 · DDL mechanics: enumerations as `text` + `CHECK`; `updated_at` and `version` set by the statement; platform tables created by the bootstrap step; helper functions in `platform`; no down migrations.**
  - *Problem:* DR-12 names the columns but not how they are kept; the original SDD does not say how enumerations are typed, where shared SQL functions live, how `platform` tables are created, or what a rollback is.
  - *Decision:* §9 (text + `CHECK`), §4.1 (the guarded `UPDATE` sets `updated_at` and `version`; no trigger), §2.1 (bootstrap creates the extensions, schemas, `platform` tables and helper functions), §14.2 (no down migrations: rollback is the previous image, backward compatible for one release, DR-08).
  - *Consequences:* a forgotten `updated_at` or `version` increment is a review finding (DOC-12 §14 checklist) and an integration-test finding, not a database guarantee.
  - *Write to:* DOC-12 §14, DOC-17 §3, DOC-19 (execute privilege on `platform` functions), ADR-0014.
