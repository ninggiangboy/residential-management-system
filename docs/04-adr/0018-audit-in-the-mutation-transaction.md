# ADR-0018: Write the audit row in the same transaction as the mutation, append-only for the runtime role

- Status: Accepted
- Date: 2026-10-19 · Related: DR-57, DR-19, DR-24, DR-67, FR-37, FR-06.1, FR-49.1, NFR-14, DOC-35, DOC-17, DOC-19, DOC-12

## Context

The original SDD §15 says every staff use case "writes one `audit_log` row in its own transaction", while its payment algorithm (§5.4, step 3) writes the audit row inside the payment transaction. The two cannot both hold. If the audit commit is separate, a crash between the two commits loses the audit of money that moved; if the mutation rolls back and the audit stays, the log records something that never happened. The audit log is also personal-data evidence (who read a CCCD, who exported residents) and must not be editable by the application that writes it.

## Options considered

1. **Audit in its own transaction, as written in SDD §15.** Isolates audit failures from the mutation. A crash after the mutation commit loses the audit row; a failed mutation may leave an audit row. Rejected.
2. **Audit through the outbox, written by a handler.** The audit row would be eventually consistent: committed money without an audit row for seconds, or for ever when the handler dead-letters. Rejected for staff mutations; the outbox suits side effects, not evidence.
3. **Database triggers writing audit rows.** Catch every change, but record columns, not intent (a void with its reason), and cannot see the actor, IP or request id. Rejected.
4. **An audit row in the mutation's transaction, written by a contract call.** Intent, actor and request context come from the application; atomic with the change.

## Decision

Option **4** (DR-57).

- `AuditApi.record(entry)` runs inside the caller's transaction through a small application wrapper around use cases; it never opens its own transaction. Actor, role, IP, user agent and request id come from the request context, not from each use case ([DOC-12](../03-architecture/code-architecture.md) §8.3).
- A failed audit insert fails the mutation; a rolled-back mutation leaves no audit row (FR-37.1).
- Table `audit.audit_log` (`actor_kind`, `actor_id`, `actor_role`, `ip`, `user_agent`, `request_id`, `action`, `object_type`, `object_id`, `changes` as `[{field, before, after}]`, `reason`, `at`); DDL and indexes in DOC-17. Secrets and CCCD are masked in `changes`.
- A settlement posted by the webhook, the re-query or the statement path writes its audit row with `actor_kind = 'system'` and no actor id (FR-37.3).
- A read of CCCD or date of birth is a `pii.read` row: one per detail view and **one per export** with the record count, never one per record (FR-37.5).
- The runtime role cannot `UPDATE` or `DELETE` the table (trigger and `REVOKE`, tested in CI, DOC-19); only a `SECURITY DEFINER` function `audit.purge(before, scope)` deletes, monthly: finance objects after 5 years, others after 2 years. These periods are defaults until the legal dossier P0-06 confirms them. The ledger tables themselves are never deleted.
- Failed authorization attempts are not audited here; they go to logs and metrics.

## Consequences

**Positive**

- Money that moved always has its audit row, and an audit row always has its change.
- The log cannot be altered by a compromised application role.

**Negative**

- An audit insert failure blocks a legitimate mutation (accepted: for staff mutations the evidence matters more than availability).
- Every use case must go through the wrapper; one that bypasses it writes no audit row and no compiler notices, so the review checklist asks for the audit row (DOC-12 §14) and EXP-10 and `AD-` tests check the sensitive actions.
- The audit row adds a write to every staff transaction, including the settlement hot path (counted in the row estimates of [DOC-10](../03-architecture/quality-attributes.md) §5).
- Audit rows hold personal data (IP, actor) and are retained for years, which the privacy design must cover (DOC-35).

**Follow-up work**

- DOC-35 (writer, table, retention purge, `pii.read` rules, `AD-` tests), DOC-17 (DDL), DOC-19 (append-only permission test).
- Confirm the retention periods in P0-06 and record any change as a new DR.
