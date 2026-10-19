# ADR-0009: Deliver events through a per-module transactional outbox and inbox; modules talk through contracts only

- Status: Accepted
- Date: 2026-10-19 · Related: DR-42, DR-62, DR-87, DR-101, DR-48, FR-03, FR-08, FR-23.2, FR-29, NFR-01, NFR-04

## Context

The system is a modular monolith (ADR-0002). A single state change often has side effects in other modules: publishing a batch notifies residents, posting a payment renders receipts and pushes a message, locking a member must stop a QR code. Push, SMS, mail, PDF and the cancellation of a gateway link are slow or external and must never run inside a user request or hold a database lock. The money invariant also forbids a state change whose notification is lost, or a notification of a change that rolled back (FR-23.2). Original SDD §4.1 says modules call each other only through `contracts/`, but lists neither the contracts nor the events, and §7.7 rotates a QR credential "in the same transaction" across modules (DR-42).

## Options considered

1. **Direct calls and reads of another module's tables.** Simplest — but breaks the boundary the whole structure rests on, and a slow provider would hold a lock.
2. **In-process events after commit, no outbox.** No new tables — but a crash between commit and publish loses the side effect; "payment received" would depend on luck.
3. **An external broker (Kafka, NATS, RabbitMQ).** Durable and scalable — but a new stateful service for a load of a few requests a second, and it still needs an outbox to avoid the dual write.
4. **Transactional outbox and inbox in PostgreSQL, in-process bus, plus synchronous contracts of plain DTOs.** One database, one commit.

## Decision

Option **4** is chosen, using the vendored `@core/messaging` (DR-02; the vendored copy drops the privacy-participant dependency: DR-98).

- **Events.** Named `<module>.<name>.v1`, written to the producer's own `outbox_messages` (one pair of `outbox` and `inbox` tables per module schema) **in the state-change transaction**. The relay runs only in the `worker` role, claims rows with `FOR UPDATE SKIP LOCKED` and publishes to an in-process bus. Handlers are idempotent through the inbox, keyed by message id and handler: at-least-once delivery, effectively once.
- **Relay settings** (DR-62): poll 500 ms when idle and immediately while busy, batch 50, lease 60 s, 8 attempts, backoff 5 s doubling to 15 min, then dead letter and an alert. Overrides: `sms` 3 attempts and a 5-minute expiry, `push` 3 attempts, `intent_cancel` 8. Published outbox rows and delivered inbox rows are deleted after 7 days (DR-101).
- **Sync contracts.** Plain DTOs in and out, run in the caller's ambient transaction but never take a transaction argument; list calls are keyset-paginated with `limit` at most 500. The contract list and event catalog are owned by DOC-09, with the additions of DR-87 (`BuildingApi.getGatewayConfig`, `BuildingApi.hasAcceptedLatestTerms`, `IdentityApi.verifyStepUp`, the reporting read contracts and the event `identity.account_deletion_executed.v1`).
- **No cross-module transaction.** The QR rotation uses `membership.credential_version` incremented inside `residency` (DR-48), not a shared transaction.
- **Enforcement.** dependency-cruiser rules and the building-scope lint are merge gates from P1 ([DOC-12](../03-architecture/code-architecture.md) §6); ownership of every table and topic is in [DOC-07](../03-architecture/system-context-and-containers.md) §6.

## Consequences

**Positive**

- A side effect exists if and only if its state change committed; a crash mid-fan-out is resumed by the relay and the inbox.
- A slow SMS, push or gateway call never holds a user request or a lock.
- Modules can be tested, and later extracted, behind their contracts.

**Negative**

- Delivery is at least once: every handler must be idempotent and has a run-twice test; that is a standing cost on every new event.
- Latency: up to 500 ms of polling plus handler time between commit and effect. Acceptable for notifications, not used for anything that must be in the same commit (that is a sync contract or the same module).
- One worker is a single point of work. A second worker is safe by design (SKIP LOCKED, advisory locks: ADR-0015) but not deployed in phase 1.
- An outbox payload that holds a one-time code (`identity.sms_requested.v1`) stays in the database up to 7 days; whether it is stored encrypted is decided in DOC-09 and DOC-26.
- Sync contracts run in the caller's transaction, so a slow contract call lengthens it.

**Follow-up work**

- Write DOC-09 (catalog, JSON Schema per version, retry class, compatibility rules) and DOC-38 (relay and job runtime).
- Every event added later gets a row in DOC-09 and a handler idempotency test.
