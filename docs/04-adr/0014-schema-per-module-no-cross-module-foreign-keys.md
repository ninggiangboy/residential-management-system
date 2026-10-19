# ADR-0014: Give each module its own schema, with no cross-module foreign keys, per-module counters and reports composed through contracts

- Status: Accepted
- Date: 2026-10-19 · Related: DR-03, DR-10, DR-42, DR-55, DR-85, DR-87, DR-12, DR-67, ADR-0002, ADR-0009, NFR-01, DOC-07, DOC-12

## Context

The modular monolith (ADR-0002) is only as modular as its data. The original SDD §4.1 says modules call each other through `contracts/` only, but §5.6 has batch and ticket codes share one counter table `finance.document_counter`, §14 has reports read across modules, and §16 does not say whether a table may point to another module's row. If a module can read or reference another's tables, the contract rule is decoration, and an extraction later would cost a rewrite. At the same time the money path needs real transactions: a state change, its outbox event and its audit row commit together (ADR-0009, ADR-0018).

## Options considered

1. **One shared schema; joins wherever convenient.** Fastest to write; every module depends on every table, and no boundary can be checked. Rejected.
2. **A schema per module with foreign keys across schemas.** Integrity enforced by PostgreSQL — but migrations of one module now block another, a table cannot move out, and the dependency graph of the code and of the data diverge. Rejected (DOC-07 §6.1 rule 2).
3. **A database per module.** Strongest isolation, but no transaction can span a state change and its outbox row of another module, and one VPS would run many databases. Rejected.
4. **A shared counter table in `finance`** (the SDD's §5.6). Breaks the rule the moment `tickets` takes a number. Rejected for a `GaplessCounter` helper that creates a `document_counter` table in each schema that needs one.
5. **A reporting copy (read model or nightly extract).** Fast dashboards, but a second source of truth that can disagree with the ledger; the SDD §14 says no copy. Rejected for read contracts.
6. **One PostgreSQL role per schema.** Enforces isolation in the database — thirteen roles and grants for a single-person project with dependency-cruiser already failing the build on a forbidden import. Rejected (DR-67, DOC-07 §6.1 rule 5).
7. **One schema per module, plain `uuid` references checked through contracts, per-schema counters, reports composed from read contracts.** Chosen.

## Decision

Option **7**.

- **Schemas.** Every module owns the schema of its name: `identity`, `building`, `residency`, `finance`, `tickets`, `access`, `vehicles`, `notices`, `notification`, `wiki`, `audit`, `reporting`, `realtime` (DR-03). The schema `platform` belongs to the vendored core packages: `maintenance`, `idempotency_key` and the shared `rate_bucket` (DR-85). Each schema has its own `outbox_messages`, `inbox` and migration history.
- **One writer per table.** Only the owning module writes a table. Another module acts through a contract or an event. The single exception is `audit.audit_log`, written through `AuditApi.record` inside the caller's transaction (DR-57).
- **No cross-schema foreign keys.** A reference to another module's row is a plain `uuid` column validated through a contract (DR-42). Foreign keys exist only inside one schema.
- **Reads cross a module only through `contracts/`.** The contract list and the event catalog are in DOC-09 (DR-42, DR-87). Contract calls run in the caller's ambient transaction but never take a transaction argument.
- **Counters.** `GaplessCounter` creates `document_counter` in each schema that needs one; the series are `receipt` (gapless, issue month), `batch`, `intent` in `finance` and `ticket` in `tickets` (DR-10). The DDL is in DOC-14.
- **Reports.** The `reporting` module owns `export_job` and composes the dashboard and reports from the read contracts of finance, tickets, vehicles and notices; it never joins another schema (DR-55).
- **One database role for the application** (`rms_app`); isolation between modules is by convention and by the dependency-cruiser rules and the building-scope lint (ADR-0004).

## Consequences

**Positive**

- A module can be read, tested and, if ever needed, extracted with its schema; the data graph matches the code graph.
- Migrations are per module (`drizzle_<module>`), so one module's migration does not block another's.
- The boundary is checkable in CI instead of by habit.

**Negative**

- PostgreSQL no longer guarantees that a referenced unit, account or file exists; an orphan `uuid` is possible after a bug. The weekly integrity job (DR-62, `integrity_weekly`) and contract checks are the only net.
- A dashboard is several contract calls composed in parallel, not one join; each page needs its own indexed query and a page of ids resolved through `ResidencyApi.getUnits`.
- Two counter tables instead of one, and the same helper code in two schemas.
- Database roles do not stop a module from reading another's table; only the CI rules do.

**Follow-up work**

- DOC-14 lists the schemas, the scope-lint allow-list and the `document_counter` DDL; DOC-15, 16, 17 hold the tables of each schema.
- DOC-09 lists the contracts and events; DOC-07 §6 holds the data ownership table; DOC-12 §7 and §8.4 hold `BuildingScope` and the counters in code.
- DOC-19 gives the roles and grants, including `platform`.
