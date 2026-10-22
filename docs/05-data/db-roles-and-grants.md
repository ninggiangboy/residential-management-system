# Database roles and grants

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-21 (P1-06: the scripts exist, the grants exceptions are guarded, §9 ran in the repository, DR-250) · 2026-10-19 · DOC-19
> Depends on: original SDD §19.1, [DR](../00-decision-register.md) (DR-12, 57, 65, 66, 67, 83, 85, 105, 110, 112, 113), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [ADR-0017](../04-adr/0017-backup-with-point-in-time-recovery.md), [ADR-0018](../04-adr/0018-audit-in-the-mutation-transaction.md), [ADR-0022](../04-adr/0022-personal-data-protection.md), [DOC-14](data-conventions.md) §2, §5, §12, [DOC-16](identity-and-residency-model.md), [DOC-17](operations-model.md), [DOC-07](../03-architecture/system-context-and-containers.md) §6.1, [DOC-10](../03-architecture/quality-attributes.md) §6.3, [DOC-06](../02-glossary.md)
> Main readers: P1-06 (roles and migrations), P1-08 (append-only audit), P1-20 (the VPS), CI (the permission tests), DOC-41, DOC-70, DOC-72, RB-12

This document says which database role does what: the four roles, how they are created, what each may do in each schema, how the runtime role is kept from changing the schema or the audit log, how the credentials are provisioned, and the tests that prove all of it on a fresh database. It does not hold the tables (DOC-14 to DOC-17), the deploy script (DOC-70), the backup procedure (DOC-72) or the secret rotation steps (RB-12).

**Tested on PostgreSQL 18.6 (`postgres:18.6`, aarch64) on 2026-10-19.** The two scripts of §3 and §4 were run as written on an empty cluster, then the tables of DOC-14 §2.2, DOC-16 and DOC-17 were created as `rms_migrator`, then the 97 tests of §9 were run. If a script is edited, §9 is run again.

## 1. Scope and principles

| Principle | Consequence |
| --- | --- |
| One application role, not one per module (DR-67) | Isolation between modules is by convention and dependency-cruiser (DOC-12 §6), not by privileges. `rms_app` can read and write every module's tables. |
| The runtime role cannot change the schema | `rms_app` owns nothing and has no `CREATE` anywhere. A SQL injection or a bug cannot add a table, drop a trigger or disable a constraint. |
| The role that migrates is not the role that serves | `rms_migrator` owns every object and is used only by the migration step and the deploy script. Its URL is not mounted in the `api` or `worker` containers. |
| Fail closed | The grants are computed from nothing by one script that runs after every migration. A table added by a migration and not yet covered is unreadable, not readable by everyone. |
| Least privilege where the damage is large | `audit.audit_log` is append-only for `rms_app`; `platform.maintenance` is read-only for `rms_app`; the support role cannot read hashes, encrypted values, one-time codes or sessions. |
| No row-level security | The building scope is a repository rule enforced by a lint (DR-12, DOC-14 §5.2); the database does not repeat it. |

## 2. The roles

| Role | Purpose | Used by | Authentication | Connection limit | Role settings |
| --- | --- | --- | --- | --- | --- |
| `rms_migrator` | Owns the database, every schema and every object. Runs the bootstrap step, the module migrations, the grants step, and writes the maintenance flag. | The migration step of the deploy, `db:migrate`, the deploy script | Password (SCRAM) | 3 | `search_path = public`, `lock_timeout = 10s` |
| `rms_app` | Serves the product: DML on every module schema. | `api` and `worker` | Password (SCRAM) | 45 on staging, 80 on production (§2.1) | `search_path = public`, `statement_timeout = 30s`, `lock_timeout = 10s`, `idle_in_transaction_session_timeout = 60s` |
| `rms_readonly` | Support and reporting by an operator, and the metrics exporter (`postgres_exporter`, a member of `pg_monitor`). | An operator over SSH, the exporter container | Password (SCRAM) | 5 | `search_path = public`, `default_transaction_read_only = on`, `statement_timeout = 60s`, `idle_in_transaction_session_timeout = 5min` |
| `rms_backup` | The weekly logical `pg_dump` and, when it works, the pgBackRest connection (§8). | Host cron and pgBackRest, as the OS user `postgres` | `peer` through a user map; no password | 3 | — |

None of the four is a superuser or has `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`. The cluster superuser `postgres` is used by the operator for provisioning (§3) and for nothing else.

The role settings are planned values; P1-06 confirms them and EXP-07 tunes `statement_timeout` for the heaviest request. A job that needs longer (the nightly invariant check, 5 minutes, NFR-09) runs `SET LOCAL statement_timeout = '5min'` in its own transaction, which any role may do for itself.

`rms_app` has **no `TEMP` privilege** on the database: the application uses no temporary table, and sort or hash spill files do not need it. A feature that needs it asks for a grant here.

### 2.1 Connection limits

The limit of `rms_app` is the sum of the pools plus the rolling-restart overlap, inside the headroom of `max_connections` (DOC-10 §6.3):

| | Staging (`max_connections` 60) | Production (`max_connections` 100) |
| --- | --- | --- |
| `api` pools, `LISTEN` connections, `worker` pool and `LISTEN` | 15 + 1 + 10 + 1 = 27 | 40 + 2 + 15 + 1 = 58 |
| Rolling-restart overlap (the new `api` opens its pool before the old one closes) | +15 = 42 | +20 = 78 |
| Other roles: exporter 2, migration 1, operators 3, superuser reserve 3 (production also 2 for archiving) | 9 | 11 |
| `rms_app` `CONNECTION LIMIT` | **45** | **80** |
| Room left for other roles under the limit | 60 − 45 = 15 ≥ 9 | 100 − 80 = 20 ≥ 11 |

A limit hit shows as `FATAL: too many connections for role "rms_app"` and as `db_pool_waiting` > 0 (DOC-10 §6.3, DOC-40).

## 3. Provisioning (`0001-provision.sql`)

Run **once per cluster** by the operator as the superuser (P1-20 on the VPS, the container entry point in CI). Passwords come from `psql` variables, so they never appear in a file, in the shell history of a script or in a CI log (§7). The script creates the roles, the database owned by `rms_migrator`, the database-level grants and the few grants only a superuser can make.

```sql
-- 0001-provision.sql: run once per cluster by a superuser; passwords come from psql variables, never from this file
--   psql -v ON_ERROR_STOP=1 -v db=rms -v app_conn_limit=80 \
--        -v migrator_password="$(cat /etc/rms/secrets/db-migrator-password)" \
--        -v app_password="$(cat /etc/rms/secrets/db-app-password)" \
--        -v readonly_password="$(cat /etc/rms/secrets/db-readonly-password)" -f 0001-provision.sql

CREATE ROLE rms_migrator LOGIN PASSWORD :'migrator_password' CONNECTION LIMIT 3
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_app      LOGIN PASSWORD :'app_password'      CONNECTION LIMIT :app_conn_limit
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_readonly LOGIN PASSWORD :'readonly_password' CONNECTION LIMIT 5
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
CREATE ROLE rms_backup   LOGIN                               CONNECTION LIMIT 3     -- no password: peer map from the OS user postgres
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- per-role defaults (planned values, confirmed in P1-06 and EXP-07)
ALTER ROLE rms_migrator SET search_path = public;
ALTER ROLE rms_migrator SET lock_timeout = '10s';
ALTER ROLE rms_app SET search_path = public;
ALTER ROLE rms_app SET statement_timeout = '30s';
ALTER ROLE rms_app SET lock_timeout = '10s';
ALTER ROLE rms_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE rms_readonly SET search_path = public;
ALTER ROLE rms_readonly SET default_transaction_read_only = on;
ALTER ROLE rms_readonly SET statement_timeout = '60s';
ALTER ROLE rms_readonly SET idle_in_transaction_session_timeout = '5min';

CREATE DATABASE :"db" OWNER rms_migrator ENCODING 'UTF8';
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO rms_app, rms_readonly, rms_backup;      -- rms_migrator connects as the owner

-- cluster-level grants that only a superuser can make
GRANT pg_monitor TO rms_readonly;                          -- postgres_exporter connects as rms_readonly
GRANT pg_read_all_data TO rms_backup;                      -- pg_dump
GRANT pg_read_all_settings, pg_checkpoint TO rms_backup;   -- pgBackRest (start-fast)

-- function privileges live in the catalog of each database: connect to the application database first
\connect :"db"
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_start(text, boolean) TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_stop(boolean)        TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_switch_wal()                TO rms_backup;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_create_restore_point(text)  TO rms_backup;
```

Notes:

- `CREATE DATABASE … OWNER rms_migrator` makes the migrator the owner of the database and of schema `public`, so it can create the schemas and the trusted extensions (`pg_trgm`, `unaccent`, `citext`) of the bootstrap step without being a superuser. The bootstrap of DOC-14 §2.2 ran unchanged as `rms_migrator` in the test (GRT-59 and the setup).
- `REVOKE ALL ON DATABASE … FROM PUBLIC` removes the default `CONNECT` and `TEMP` of every role. A role that is not listed cannot even connect (GRT-85).
- The locale of the database is the template's (`ENCODING 'UTF8'`); P1-20 fixes the locale with the VPS and records it in DOC-70. Vietnamese sorting is done in the application, and text search uses `unaccent` and trigrams (DOC-14 §13).
- The `\connect` line matters: the `GRANT EXECUTE ON FUNCTION pg_catalog.…` statements change the catalog of the database they run in. Run in the `postgres` database they would not reach `rms` (found in the first test run, in which the `pg_switch_wal()` and `pg_create_restore_point` tests failed until the line was added).

### 3.1 Order of operations

| Step | Who | What | When |
| --- | --- | --- | --- |
| 1 | Operator as `postgres` | `0001-provision.sql` | Once per cluster (P1-20; in CI before the tests) |
| 2 | `rms_migrator` | `0000-bootstrap.sql` (extensions, schemas, `platform` tables and helper functions, DOC-14 §2.2) | Every `db:migrate`; idempotent |
| 3 | `rms_migrator` | The migrations of each module in catalog order (DOC-14 §14) | Every `db:migrate` |
| 4 | `rms_migrator` | `0900-grants.sql` (§4) | Every `db:migrate`, last; idempotent |
| 5 | `rms_app` | `api` and `worker` start | After step 4 |

During a deploy the maintenance flag is on from before step 2 until the new version is ready; the deploy script writes it as `rms_migrator` (DOC-17 §3.4). Steps 2 to 4 are one command, `bun run db:migrate` (`scripts/migrate.ts`, built in P1-06); the grants step cannot be forgotten because it is not a separate command. The files are `ops/postgres/0000-bootstrap.sql` and `ops/postgres/0900-grants.sql`; the migration step reads them next to the repository (the image copies `ops/postgres`, DOC-71 §6.1).

## 4. The grants step (`0900-grants.sql`)

Run by `rms_migrator` after the last module migration of every release. It is **idempotent** and **atomic**: it revokes what `rms_app` and `rms_readonly` hold on the tables and sequences of the fourteen schemas and grants the final state again, in one transaction, so the result does not depend on what was granted before and no request sees the half-way state. Nobody grants by hand; the script is edited instead. *As built in P1-06 (DR-250):* the three exceptions that name an object of a module (`audit.audit_log`, `audit.purge`) are applied only when that object exists, and a table whose every column is excluded stays closed, so the script also runs on a database that holds the platform only; `platform.maintenance` exists from the bootstrap.

```sql
-- 0900-grants.sql: run by rms_migrator after the last module migration of every release (db:migrate does it).
-- Idempotent and atomic: it computes the final state from nothing, so a table added by a migration is covered by the next run
-- and a table that was not covered is closed, not open.
BEGIN;
DO $grants$
DECLARE
  schemas       text[] := ARRAY['identity', 'building', 'residency', 'finance', 'tickets', 'access', 'vehicles',
                                'notices', 'notification', 'wiki', 'audit', 'reporting', 'realtime', 'platform'];
  denied_tables text[] := ARRAY['identity.otp_challenge', 'identity.password_token', 'identity.refresh_family',
                                'identity.refresh_token', 'identity.rate_bucket', 'platform.idempotency_key',
                                'platform.rate_bucket', 'notification.device_token'];
  denied_cols   text[] := ARRAY['residency.resident_profile.date_of_birth'];
  s text;
  r record;
  cols text;
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO rms_app, rms_readonly', s);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM rms_app, rms_readonly', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM rms_app, rms_readonly', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO rms_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO rms_app', s);
  END LOOP;

  -- exceptions of rms_app
  REVOKE UPDATE, DELETE ON audit.audit_log FROM rms_app;                  -- append-only (DR-57)
  REVOKE INSERT, UPDATE, DELETE ON platform.maintenance FROM rms_app;     -- read by every process, written by the deploy script (rms_migrator)
  GRANT EXECUTE ON FUNCTION audit.purge(timestamptz, text) TO rms_app;    -- the monthly purge, clamped inside the function

  -- rms_readonly: SELECT on every table except the denied ones; column-level when a column is sensitive
  FOR r IN
    SELECT n.nspname, c.relname, c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY (schemas)
  LOOP
    IF r.nspname || '.' || r.relname = ANY (denied_tables) OR r.relname = 'outbox_messages' THEN
      CONTINUE;
    END IF;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
      FROM pg_attribute a
     WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname !~ '(_hash|_enc)$'
       AND r.nspname || '.' || r.relname || '.' || a.attname <> ALL (denied_cols);
    IF cols = (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
                 FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('GRANT SELECT ON %I.%I TO rms_readonly', r.nspname, r.relname);
    ELSE
      EXECUTE format('GRANT SELECT (%s) ON %I.%I TO rms_readonly', cols, r.nspname, r.relname);
    END IF;
  END LOOP;
END
$grants$;
COMMIT;
```

### 4.1 What `rms_app` gets

- `USAGE` on the fourteen schemas; `SELECT`, `INSERT`, `UPDATE`, `DELETE` on every table; `USAGE` and `SELECT` on every sequence (`finance.order_code_seq`, DR-27).
- Never `TRUNCATE`, `REFERENCES`, `TRIGGER` or `CREATE` (GRT-89, GRT-96). Disabling or dropping a trigger needs ownership (GRT-08, GRT-09).
- Two exceptions: `audit.audit_log` is `SELECT` and `INSERT` only; `platform.maintenance` is `SELECT` only.
- `EXECUTE` on `audit.purge`, the only `SECURITY DEFINER` function (GRT-97). The helper functions of `platform` (`is_bilingual`, `immutable_unaccent`) are executable by `PUBLIC` by default, and `USAGE` on schema `platform` is what lets a role reach them: the `CHECK` constraints and the trigram index of `resident_profile` call them as the inserting role (GRT-11, GRT-24).
- No access to the history schemas `drizzle_<module>` (GRT-75).

### 4.2 What `rms_readonly` gets

`SELECT` on every table of the fourteen schemas, **except**:

| Rule | Reason |
| --- | --- |
| Denied tables: `identity.otp_challenge`, `identity.password_token`, `identity.refresh_family`, `identity.refresh_token`, `identity.rate_bucket`, `platform.idempotency_key`, `platform.rate_bucket`, `notification.device_token` | Codes, link hashes, sessions, phone and IP keys, stored responses and push tokens: nothing a support query needs and every one a risk if the role leaks |
| Every table called `outbox_messages` | The payload of `identity.sms_requested.v1` and `identity.mail_requested.v1` holds a one-time code until the relay cleanup (DOC-17 §3.3) |
| Columns whose name ends in `_hash` or `_enc` | Password hashes (`staff_account.password_hash`), token hashes, encrypted CCCD (`cccd_enc`) and gateway secrets (`secrets_enc`) |
| `residency.resident_profile.date_of_birth` | Personal data that only the Manager and Admin read, and every read is logged (DR-58); a SQL query would not be |

Where a column is excluded the grant is column-level, so a query must name its columns: `SELECT *` on `identity.staff_account` fails with `42501` (GRT-31). That is deliberate and costs the operator one `\d` to learn the column names. `cccd_last4` is not excluded: it is the masked form that the screens show.

A table with a secret that the rules above miss is added to `denied_tables` (or a column to `denied_cols`) in the same pull request that creates it; the review checklist asks (DOC-12 §14), and GRT-92 and GRT-93 fail when a denied table or a column matching the patterns is readable.

### 4.3 What `rms_backup` and `rms_migrator` get

- `rms_backup` holds `pg_read_all_data` (read of every table and sequence; no write), `pg_read_all_settings`, `pg_checkpoint` and `EXECUTE` on the four backup functions (§8).
- `rms_migrator` owns the objects, so it needs no grants. It cannot create a role or a database (GRT-62, GRT-82) and cannot read `pg_authid` (GRT-64).

## 5. The matrix: role × schema × privilege

`S` select, `I` insert, `U` update, `D` delete, `X` execute, `—` none. "All tables" means every table of the schema, including the ones DOC-15 and DOC-17 §4–§9 add later. The counts at the foot were produced by the catalog query of GRT-97 on the tables that exist today.

| Schema | `rms_migrator` | `rms_app` | `rms_readonly` | `rms_backup` |
| --- | --- | --- | --- | --- |
| `identity` | owner | USAGE; SIUD all tables; sequences | USAGE; S `resident_account`; S `staff_account` except `password_hash`; nothing on `otp_challenge`, `password_token`, `refresh_family`, `refresh_token`, `rate_bucket`, `outbox_messages` | S all (`pg_read_all_data`) |
| `building` | owner | USAGE; SIUD all tables | USAGE; S all except `gateway_config.secrets_enc` | S all |
| `residency` | owner | USAGE; SIUD all tables | USAGE; S all except `resident_profile.cccd_enc` and `date_of_birth` | S all |
| `finance` | owner | USAGE; SIUD all tables; USAGE on `order_code_seq` | USAGE; S all except `outbox_messages` | S all |
| `tickets`, `access`, `vehicles`, `notices`, `wiki`, `reporting`, `realtime` | owner | USAGE; SIUD all tables | USAGE; S all except `outbox_messages` | S all |
| `notification` | owner | USAGE; SIUD all tables | USAGE; S all except `device_token` and `outbox_messages` | S all |
| `audit` | owner; `UPDATE` and `DELETE` are refused by the trigger even for the owner | USAGE; **S, I only** on `audit_log`; X `audit.purge` | USAGE; S `audit_log` | S |
| `platform` | owner; writes `maintenance` | USAGE; SIUD `idempotency_key`, `rate_bucket`; **S only** on `maintenance`; the helper functions | USAGE; S `maintenance`; nothing on `idempotency_key`, `rate_bucket` | S all |
| `drizzle_<module>` | owner | — | — | S (dump) |
| `public` (extensions) | owner | USAGE (default); no `CREATE` | USAGE; no `CREATE` | USAGE; no `CREATE` |
| Database | owner; no `CREATEDB` | `CONNECT` only | `CONNECT` only | `CONNECT` only |
| Cluster | no `CREATEROLE`, not superuser | none | `pg_monitor` | `pg_read_all_data`, `pg_read_all_settings`, `pg_checkpoint`, `EXECUTE` on four backup functions |

The tables that exist after DOC-14, DOC-16 and DOC-17 §1–§3, counted on the test database (`finance` holds only the outbox and inbox here; the probe table of GRT-68 makes the query print 3):

| Schema | Tables | `rms_app` S / I / U / D | `rms_readonly` table-level S / column-level S | `rms_backup` S / I |
| --- | --- | --- | --- | --- |
| `audit` | 1 | 1 / 1 / 0 / 0 | 1 / 0 | 1 / 0 |
| `building` | 7 | 7 / 7 / 7 / 7 | 6 / 1 (`gateway_config`) | 7 / 0 |
| `finance` | 2 (outbox, inbox) | 2 / 2 / 2 / 2 | 1 / 0 | 2 / 0 |
| `identity` | 7 | 7 / 7 / 7 / 7 | 1 (`resident_account`) / 1 (`staff_account`) | 7 / 0 |
| `platform` | 3 | 3 / 2 / 2 / 2 | 1 (`maintenance`) / 0 | 3 / 0 |
| `residency` | 5 | 5 / 5 / 5 / 5 | 4 / 1 (`resident_profile`) | 5 / 0 |

## 6. Append-only audit and the maintenance flag

| Object | `rms_app` | Why |
| --- | --- | --- |
| `audit.audit_log` | `SELECT`, `INSERT` | A compromised application cannot rewrite the evidence (FR-37.4, ADR-0018). The trigger of DOC-17 §2 is a second layer for the owner. |
| `audit.purge(timestamptz, text)` | `EXECUTE` | The monthly purge runs in the worker as `rms_app`. The function is `SECURITY DEFINER`, pins its `search_path` to `pg_catalog, audit`, is revoked from `PUBLIC`, and raises the cut-off to the 5-year and 2-year floors itself, so calling it with any argument deletes nothing newer (GRT-19; DOC-17 §13.3, OPM-S09…S11). |
| `platform.maintenance` | `SELECT` | Every process polls it. Only the deploy script, running as `rms_migrator`, switches it; the application cannot put the building into maintenance (GRT-21, GRT-22, GRT-63). |

`rms_app` can change **its own password** (any role can); it cannot change any other attribute (GRT-28). That is accepted: it needs the old connection, and the new password is lost on the next provisioning.

## 7. Credentials

| Credential | Role | Stored in | Read by | Rotation |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `rms_app` | `/etc/rms/secrets/db-app-url`, read through `DATABASE_URL_FILE` (DR-65) | `api` and `worker` at boot | On suspicion or when staff change: `ALTER ROLE rms_app PASSWORD …`, new file, rolling restart (RB-12) |
| `MIGRATION_DATABASE_URL` | `rms_migrator` | `/etc/rms/secrets/db-migrator-url` | The migration step and the deploy script only; **not mounted in `api` or `worker`** | Same, with no restart |
| `READONLY_DATABASE_URL` | `rms_readonly` | `/etc/rms/secrets/db-readonly-url` | The `postgres_exporter` container only; the operator keeps a copy in a password manager | Same; the exporter restarts |
| (none) | `rms_backup` | Nothing: `peer` authentication through a user map | pgBackRest and the `pg_dump` cron job, running as the OS user `postgres` | Not applicable |

- Passwords are 32 random bytes in base64url from `bun run keys:generate` (DR-65); the provisioning script receives them as `psql` variables. PostgreSQL stores a SCRAM-SHA-256 verifier (`password_encryption` is `scram-sha-256` by default in 18), never the password.
- Files are root-owned `0400` under `/etc/rms/secrets` and are never in the image, the repository, a CI log or the `/metrics` page (DR-65). CI uses throwaway passwords for a throwaway database.
- `READONLY_DATABASE_URL` is new in the inventory of DR-65 (DR-113); it is added to DOC-41 and to the inventory of DOC-39.

**`pg_hba.conf` and `pg_ident.conf`** (a proposal for P1-20; **not run** in this document's tests, which used the container's own `pg_hba.conf` and checked SCRAM over a non-loopback address, GRT-77 and GRT-78). PostgreSQL listens on localhost and the Docker bridge only (DR-83):

```
# TYPE  DATABASE  USER                                ADDRESS             METHOD
local   all       postgres                                                peer
local   rms       rms_backup                                              peer map=backup
local   rms       rms_readonly,rms_migrator                               scram-sha-256
host    rms       rms_app,rms_migrator,rms_readonly   <docker-subnet>     scram-sha-256
host    all       all                                 0.0.0.0/0           reject

# pg_ident.conf
# MAPNAME  SYSTEM-USERNAME  DATABASE-USERNAME
backup     postgres         rms_backup
```

## 8. Backups and the role `rms_backup`

- **Logical dump (weekly, DR-66).** `pg_dump -U rms_backup -d rms` over the local socket as the OS user `postgres`. `pg_read_all_data` is enough: the dump of the test database (all 14 schemas, 72,935 bytes) completed with exit code 0 and the data of one table came out as `INSERT` statements (GRT-87). The dump holds every column, including hashes and encrypted values, so it is encrypted on the host before it leaves it (DOC-72, ADR-0022).
- **Physical backup and WAL (pgBackRest, DR-66).** pgBackRest connects to PostgreSQL to call the backup functions. The grants of §3 are the ones listed for a non-superuser pgBackRest user on PostgreSQL 15 and later (`pg_backup_start`, `pg_backup_stop`, `pg_switch_wal`, `pg_create_restore_point`, `pg_read_all_settings`, `pg_checkpoint`; third-party documentation of the pgBackRest non-superuser setup, [EnterpriseDB](https://www.enterprisedb.com/docs/supported-open-source/pgbackrest/10-non-superuser/), read on 2026-10-19). The functions ran correctly as `rms_backup` in one session (`pg_backup_start(…, true)`, `pg_backup_stop(false)`, GRT-86). pgBackRest needs `pg1-database=rms` in its configuration, because `rms_backup` can connect to that database only.
- **Not proven here.** A full pgBackRest backup and a restore need the pgBackRest binary and the repository on R2. P1-20 proves them against pgBackRest 2.60. **Fallback:** if pgBackRest asks for more than the grants above, it connects as the OS user `postgres` (its default) and `rms_backup` keeps the `pg_dump` job only; nothing else in this document changes.

## 9. Permission tests

### 9.1 Method

Tested on PostgreSQL 18.6 on 2026-10-19: `0001-provision.sql`, then `0000-bootstrap.sql`, the DDL of DOC-16 and DOC-17 §1–§3 and `0900-grants.sql` as `rms_migrator`, on an empty cluster. Result: **97 of 97 passed.** Three kinds of test:

- **Statement tests** (GRT-01…76) run one statement as a role (`SET LOCAL ROLE`) and compare the SQLSTATE: `42501` insufficient privilege, `23000` raised by a trigger, or success. Privilege is checked before the rows are looked at, so `UPDATE … WHERE false` is a valid test of `UPDATE`.
- **Login tests** (GRT-77…88) open a real connection: SCRAM over a non-loopback address for the roles with a password (the image's loopback is `trust`, which would hide a wrong password), the local socket for `rms_backup`.
- **Catalog checks** (GRT-89…97) are queries over `pg_class`, `pg_attribute`, `pg_namespace` and `has_*_privilege` that must return **no rows**. They cover every table that exists, including the ones later documents add, which is what makes "every role × schema" true without listing tables.

**In CI (P1-06).** A job `db-grants` starts a `postgres:18.6` service container, runs `0001-provision.sql` with random passwords, then `bun run db:migrate`, then the test files `apps/api/tests/grants/grants.test.ts` and `migrate.test.ts` (`bun run test:grants`; DR-250 moved them from `packages/testing/`), which holds the matrix of §5 as data, runs GRT-01…88 as written and runs the queries of GRT-89…97 expecting no rows. It runs on every pull request that touches a migration, a `schema.ts` or `0900-grants.sql`, and on `main`. A failing test blocks the merge.

The seed rows the tests touch are inserted by the superuser first (a building, a staff account with a password hash, a resident profile with an encrypted CCCD and a date of birth, a gateway configuration with a secret, a maintenance row, an outbox message with an SMS code, an audit row).

**As run in P1-06 (2026-10-21, PostgreSQL 18.6, `apps/api/tests/grants`); updated in P1-07 and P1-08 (2026-10-22): the stand-ins of `building.*` and `audit.*` are gone from `fixtures.ts` because the migrations of those modules create the real tables, trigger and function, and the seed rows and the statements use their real columns (GRT-14 inserts a full audit row; GRT-44 inserts `building_setting (building_id)`; GRT-45 updates `address`, because a text literal for the `jsonb` column `name` fails at parse time before the privilege is checked). All 90 tests still pass and GRT-86 and GRT-87 are skipped. `migrate.test.ts` computes the number of pending migrations from the catalog.** The modules that own the tables of the matrix do not exist yet, so `fixtures.ts` creates **stand-ins** with the same schema, table and sensitive columns (`identity.staff_account` with `password_hash`, `building.gateway_config` with `secrets_enc`, `residency.resident_profile` with `cccd_enc` and `date_of_birth`, the outbox, the inbox, `audit.audit_log` with its append-only trigger and `audit.purge`, a terms table with a trigger) on a clone of the migrated template, and the grants step runs again over them; the statements run as the role (`SET LOCAL ROLE`, rolled back) from a superuser connection. **86 of 87 passed and 1 is skipped**: GRT-01…76 as the table says (GRT-55 and GRT-56 need the four `GRANT EXECUTE` of the provisioning script in the cloned database, which the template builder applies), the login tests GRT-77…85 and GRT-88 over real SCRAM connections, the catalog checks GRT-89…97 on every table that exists, and the bootstrap checks of DOC-14 §16 (1, 9, 13, unaccent and trigram search, idempotency). GRT-86 and GRT-87 (`rms_backup` over the local socket with peer authentication) are skipped with a reason: they need the OS user `postgres` and run on the host in P1-20. When a module is written its migration creates the real table and its stand-in is deleted from `fixtures.ts`; the catalog checks already cover it.

### 9.2 Statement tests

| ID | Role | Operation | Expected |
| --- | --- | --- | --- |
| GRT-01 | `rms_app` | `CREATE TABLE finance.evil` | 42501 |
| GRT-02 | `rms_app` | `CREATE SCHEMA evil` | 42501 |
| GRT-03 | `rms_app` | `DROP TABLE building.building` | 42501 |
| GRT-04 | `rms_app` | `ALTER TABLE finance.inbox ADD COLUMN` | 42501 |
| GRT-05 | `rms_app` | `TRUNCATE finance.inbox` | 42501 |
| GRT-06 | `rms_app` | `CREATE EXTENSION hstore` | 42501 |
| GRT-07 | `rms_app` | `CREATE ROLE evil` | 42501 |
| GRT-08 | `rms_app` | `ALTER TABLE … DISABLE TRIGGER trg_terms_version_freeze` | 42501 |
| GRT-09 | `rms_app` | `DROP FUNCTION audit.audit_log_append_only() CASCADE` | 42501 |
| GRT-10 | `rms_app` | `UPDATE identity.staff_account … WHERE false` | ok |
| GRT-11 | `rms_app` | Insert a unit and a resident profile (trigram index through `platform.immutable_unaccent`) | ok |
| GRT-12 | `rms_app` | `DELETE FROM finance.inbox WHERE false` | ok |
| GRT-13 | `rms_app` | `SELECT` from `building.file_object` | ok |
| GRT-14 | `rms_app` | Insert an `audit_log` row | ok |
| GRT-15 | `rms_app` | `SELECT` from `audit.audit_log` | ok |
| GRT-16 | `rms_app` | `UPDATE audit.audit_log` | 42501 |
| GRT-17 | `rms_app` | `DELETE FROM audit.audit_log` | 42501 |
| GRT-18 | `rms_app` | `TRUNCATE audit.audit_log` | 42501 |
| GRT-19 | `rms_app` | `SELECT audit.purge(now() - 1000 years, 'standard')` | ok (deletes nothing newer than the floor) |
| GRT-20 | `rms_app` | Read `platform.maintenance` | ok |
| GRT-21 | `rms_app` | `UPDATE platform.maintenance` | 42501 |
| GRT-22 | `rms_app` | `DELETE FROM platform.maintenance` | 42501 |
| GRT-23 | `rms_app` | Insert a `platform.rate_bucket` row | ok |
| GRT-24 | `rms_app` | Call `platform.is_bilingual` and `platform.immutable_unaccent` | ok |
| GRT-25 | `rms_app` | `SELECT * FROM pg_authid` | 42501 |
| GRT-26 | `rms_app` | `COPY … TO PROGRAM` | 42501 |
| GRT-27 | `rms_app` | `pg_read_file('/etc/passwd')` | 42501 |
| GRT-28 | `rms_app` | `ALTER ROLE rms_app SUPERUSER` | 42501 |
| GRT-29 | `rms_readonly` | `SELECT email, role, status` from `staff_account` | ok |
| GRT-30 | `rms_readonly` | `SELECT password_hash` | 42501 |
| GRT-31 | `rms_readonly` | `SELECT *` from `staff_account` | 42501 |
| GRT-32 | `rms_readonly` | `SELECT` from `identity.refresh_token` | 42501 |
| GRT-33 | `rms_readonly` | `SELECT` from `identity.password_token` | 42501 |
| GRT-34 | `rms_readonly` | `SELECT` from `identity.otp_challenge` | 42501 |
| GRT-35 | `rms_readonly` | `SELECT` from `identity.rate_bucket` | 42501 |
| GRT-36 | `rms_readonly` | `SELECT payload` from `finance.outbox_messages` | 42501 |
| GRT-37 | `rms_readonly` | `SELECT secrets_enc` from `gateway_config` | 42501 |
| GRT-38 | `rms_readonly` | `SELECT provider, driver, receiving_account, status` from `gateway_config` | ok |
| GRT-39 | `rms_readonly` | `SELECT date_of_birth` from `resident_profile` | 42501 |
| GRT-40 | `rms_readonly` | `SELECT cccd_enc` from `resident_profile` | 42501 |
| GRT-41 | `rms_readonly` | `SELECT full_name, cccd_last4` from `resident_profile` | ok |
| GRT-42 | `rms_readonly` | `SELECT` from `platform.idempotency_key` | 42501 |
| GRT-43 | `rms_readonly` | `SELECT *` from `audit.audit_log` | ok |
| GRT-44 | `rms_readonly` | `INSERT` into `building_setting` | 42501 |
| GRT-45 | `rms_readonly` | `UPDATE building.building` | 42501 |
| GRT-46 | `rms_readonly` | `DELETE FROM finance.inbox` | 42501 |
| GRT-47 | `rms_readonly` | `TRUNCATE finance.inbox` | 42501 |
| GRT-48 | `rms_readonly` | `SELECT audit.purge(now(), 'standard')` | 42501 |
| GRT-49 | `rms_readonly` | Read `pg_stat_activity` (`pg_monitor`) | ok |
| GRT-50 | `rms_readonly` | `CREATE TABLE public.x` | 42501 |
| GRT-51 | `rms_backup` | `SELECT` from `identity.staff_account` | ok |
| GRT-52 | `rms_backup` | `SELECT password_hash, secrets_enc` (the dump holds everything) | ok |
| GRT-53 | `rms_backup` | `INSERT` into `finance.inbox` | 42501 |
| GRT-54 | `rms_backup` | `CREATE TABLE public.x` | 42501 |
| GRT-55 | `rms_backup` | `pg_switch_wal()` | ok |
| GRT-56 | `rms_backup` | `pg_create_restore_point('…')` | ok |
| GRT-57 | `rms_backup` | `current_setting('archive_command')`, `current_setting('data_directory')` (`pg_read_all_settings`) | ok |
| GRT-58 | `rms_backup` | `audit.purge(now(), 'standard')` | 42501 |
| GRT-59 | `rms_migrator` | `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` in `finance` | ok |
| GRT-60 | `rms_migrator` | `UPDATE audit.audit_log` (a data-fix migration) | 23000 (trigger) |
| GRT-61 | `rms_migrator` | `DELETE FROM audit.audit_log` | 23000 (trigger) |
| GRT-62 | `rms_migrator` | `CREATE ROLE evil` | 42501 |
| GRT-63 | `rms_migrator` | Switch `platform.maintenance` on, then off | ok |
| GRT-64 | `rms_migrator` | `SELECT * FROM pg_authid` | 42501 |
| GRT-65 | `rms_stranger` (no grants) | `SELECT` from `building.building` | 42501 |
| GRT-66 | `rms_stranger` | `CREATE TABLE public.x` | 42501 |
| GRT-67 | `rms_stranger` | `platform.immutable_unaccent('x')` | 42501 |
| GRT-68 | `rms_app` | `SELECT` from `finance.late_table`, created by a migration, before the grants step | 42501 (fail closed) |
| GRT-69 | `rms_app` | `nextval('finance.order_code_seq')` before the grants step | 42501 |
| GRT-70 | `rms_readonly` | `SELECT` from `finance.late_table` before the grants step | 42501 |
| GRT-71 | `rms_app` | Insert into `finance.late_table` after `0900-grants.sql` ran twice | ok |
| GRT-72 | `rms_app` | `nextval('finance.order_code_seq')` after the grants step | ok |
| GRT-73 | `rms_readonly` | `SELECT id, note` from `late_table` after the grants step | ok |
| GRT-74 | `rms_readonly` | `SELECT token_hash` from `late_table` (a column named `_hash` on a new table) | 42501 |
| GRT-75 | `rms_app` | `SELECT` from `drizzle_finance.__migrations` | 42501 |
| GRT-76 | `rms_readonly` | `SELECT` from `drizzle_finance.__migrations` | 42501 |

GRT-68 to GRT-76 create the probe table, the sequence and the history schema as `rms_migrator`, then run the grants script twice. The hash of the ACLs of all tables and sequences was `1ebe4903…` before the first run and `c46e0fb8…` after both the first and the second run, so the script is idempotent.

### 9.3 Login tests

| ID | Connection | Check | Expected |
| --- | --- | --- | --- |
| GRT-77 | `rms_app`, password, SCRAM | Sign in and read `platform.maintenance` | ok |
| GRT-78 | `rms_app`, wrong password | Sign in | refused: `password authentication failed` |
| GRT-79 | `rms_app` | `SET ROLE rms_migrator` | 42501 `permission denied to set role` |
| GRT-80 | `rms_app` | `search_path`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` | `public`, 30s, 10s, 1min |
| GRT-81 | `rms_app` | `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, `rolbypassrls`, `rolconnlimit` | all false; 80 |
| GRT-82 | `rms_migrator` | `CREATE DATABASE evil` | 42501 `permission denied to create database` |
| GRT-83 | `rms_readonly` | `INSERT` | 25006 `cannot execute INSERT in a read-only transaction` |
| GRT-84 | `rms_readonly` | `default_transaction_read_only`, `statement_timeout` | on, 1min |
| GRT-85 | `rms_stranger` | Connect to `rms` | refused: `permission denied for database "rms"` |
| GRT-86 | `rms_backup`, local socket | `pg_backup_start('…', true)` and `pg_backup_stop(false)` in one session | both succeed |
| GRT-87 | `rms_backup`, local socket | `pg_dump` of one table's data, and of the whole database | 1 `INSERT` line; whole dump exit 0, 72,935 bytes |
| GRT-88 | `rms_readonly` | Read `pg_stat_database` (the exporter) | ok |

`GRT-80` shows `1min` for `idle_in_transaction_session_timeout` because PostgreSQL prints 60 s that way.

### 9.4 Catalog checks (each must return no rows)

| ID | Question | Result |
| --- | --- | --- |
| GRT-89 | Does `rms_app` hold `TRUNCATE`, `REFERENCES` or `TRIGGER` on any table of the fourteen schemas? | none |
| GRT-90 | Does a table lack `SELECT`, `INSERT`, `UPDATE` or `DELETE` for `rms_app`, apart from `audit.audit_log` (U, D) and `platform.maintenance` (I, U, D)? | none |
| GRT-91 | Does `rms_readonly` hold a write privilege, `REFERENCES` or `TRIGGER` on any table? | none |
| GRT-92 | Can `rms_readonly` read any denied table or any `outbox_messages`, even one column? | none |
| GRT-93 | Can `rms_readonly` read a column named `*_hash`, `*_enc` or `date_of_birth`? | none |
| GRT-94 | Is a table or schema of the fourteen not owned by `rms_migrator`? | none |
| GRT-95 | Does `PUBLIC` hold a privilege on one of the fourteen schemas? | none |
| GRT-96 | Can `rms_app`, `rms_readonly`, `rms_backup` or a stranger `CREATE` in any schema or in the database? | none |
| GRT-97 | Which `SECURITY DEFINER` functions exist outside `pg_catalog`, and who can execute them? | one: `audit.purge(timestamptz, text)`, executable by `rms_app` and `rms_migrator` only |

GRT-97 also prints the table-count matrix of §5 (the second table there).

### 9.5 Not run

| Item | Why | Done in |
| --- | --- | --- |
| `pg_hba.conf` and `pg_ident.conf` of §7 | The container has its own; the VPS file does not exist yet | P1-20 |
| A full pgBackRest backup and restore as `rms_backup` | Needs the binary and the R2 repository | P1-20 (DOC-72, EXP-12) |
| `postgres_exporter` connecting as `rms_readonly` | Needs the exporter container | P1-21 (DOC-40) |
| The `CONNECTION LIMIT` and timeouts under load | Planned values | EXP-07 (P1-06 confirms the settings are applied) |
| Behaviour when the grants step runs while requests are in flight | Needs the deploy flow; the deploy runs it in maintenance mode, and the script is one transaction | P1-20 (DOC-70) |

## 10. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-250 | As built in P1-06: guarded exceptions in the grants step, the migration script and its output, `db:reset` as a schema drop by the migrator, the permission tests in `apps/api/tests/grants` with stand-ins for the tables of modules not written yet | §3.1, §4, §9 |
| DR-113 | The four roles' attributes and settings; the grants step as one idempotent script computed from nothing (fail-closed) instead of default privileges; the denied tables and column rules of `rms_readonly`; `rms_readonly` also serves the exporter (`pg_monitor`); `rms_backup` is a non-superuser with `pg_read_all_data` and the backup functions, with a fallback; `READONLY_DATABASE_URL` joins the secret inventory | §2–§8 |

## 11. Not in this document

| Topic | Lives in |
| --- | --- |
| Table definitions and conventions | DOC-14, DOC-15, DOC-16, DOC-17 |
| The append-only table's DDL, trigger and purge function | DOC-17 §2 |
| The deploy script and the VPS setup (`pg_hba.conf`, locale, memory) | DOC-70, P1-20 |
| Backup and restore procedures | DOC-72, RB-10 |
| Rotation steps for the database passwords and the encryption keys | RB-12 |
| Configuration keys (`DATABASE_URL_FILE`, `MIGRATION_DATABASE_URL_FILE`, `READONLY_DATABASE_URL_FILE`) | DOC-41 |
| The authorization of requests (roles of people, not of the database) | DOC-39, DOC-12 §11 |

## 12. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| §2 roles | DR-67, DR-113 | NFR-08; GRT-77…85 |
| §3 provisioning | DR-67, DR-65 | GRT-59, GRT-85 |
| §4 grants step | DR-113, DR-105 | NFR-08; GRT-68…76, GRT-89…97 |
| §4.2 support role | DR-58, DR-113, ADR-0022 | NFR-14; GRT-29…50, GRT-92, GRT-93 |
| §6 audit and maintenance | DR-57, DR-110, DR-112 | FR-37.4; GRT-14…22, GRT-60, GRT-61, GRT-63 |
| §8 backups | DR-66, ADR-0017 | NFR-11; GRT-51…58, GRT-86, GRT-87 |

## Open questions

None. The decision made while writing (DR-113) is decided and does not block Phase 1. The pgBackRest behaviour as a non-superuser is verified in P1-20, with the fallback of §8.
