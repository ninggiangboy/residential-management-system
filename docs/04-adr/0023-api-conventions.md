# ADR-0023: Keep the design's error shape, store idempotency keys in PostgreSQL for every create, and page with opaque cursors

- Status: Accepted
- Date: 2026-10-19 · Related: DR-74, DR-85, FR-05.4, FR-17.2, NFR-03, DOC-07, DOC-12

## Context

Three API conventions were open after the original SDD. First, the SDD §17.3 error shape is `{ "error": { "code", "message", "details" } }`, while the documentation catalog expected RFC 9457 Problem Details. Second, the SDD says "creates that can be retried take `Idempotency-Key`" but stores keys only for manual payments (`payment.client_key`); a double-tapped ticket, notice, member or payment intent has nothing to catch it. Third, the cursor format and the error codes of the new cases (`charge_changed`, `terms_required`, `idempotency_key_reuse`…) were not fixed. Mobile clients retry on a flaky network, so a retried create must not create twice. The idempotency table belongs to the `platform` schema owned by the core packages (DR-85).

## Options considered

1. **RFC 9457 Problem Details now.** Standard, and generic clients understand it. But the SDD, the client code design and every requirement already use `error.code`; switching would rewrite the contract for no consumer that needs it. Rejected; DOC-50 documents the mapping should it ever be needed.
2. **Unique business keys only** (as `payment.client_key` for manual payments). Cheap, but each create needs its own column and constraint, and a ticket or intent has no natural key. Rejected as the general mechanism; the manual payment keeps its key as a second net.
3. **A cache or Redis for idempotency keys.** Fast, but another component to run, and a lost cache loses the guarantee on a money-adjacent path. Rejected.
4. **A PostgreSQL table with a stored response.** One more table, the same transaction guarantees as the data. Chosen.
5. **Offset pagination everywhere.** Simple, but unstable under inserts and slow deep in a long list such as the money log. Rejected except for small lists.
6. **Opaque keyset cursors.** Stable and indexed. Chosen.

## Decision

Options **4** and **6**, keeping the SDD error shape (DR-74).

- **Error shape.** `{ "error": { "code", "message", "details" } }`. Validation failures carry `details: [{path, code, message}]`. `code` is the stable part clients branch on; how `message` is localized is in DOC-50. New codes include `terms_required` (403), `upgrade_required` (426), `charge_changed` (409), `staff_has_open_tickets` (409), `phone_in_use` (409), `allocation_mismatch` (422), `import_not_ready` (409), `import_expired` (409), `already_rated` (409), `idempotency_key_reuse` (422), `file_not_verified` (422), `quota_exceeded` (413), `intent_not_cancellable` (409), `owner_must_transfer` (409), `sms_unavailable` (503). The exception-to-code table is in DOC-42 and [DOC-12](../03-architecture/code-architecture.md) §12.
- **Idempotency store.** `platform.idempotency_key (account_kind, account_id, key, request_hash, status, response_status, response_body, created_at)`, retained 24 hours, used by the `POST` creates of tickets, vehicles, notices, members, intents, uploads, manual payments and exports. The key is inserted first with `ON CONFLICT DO NOTHING`.
  - Same key and same body: the stored response is replayed with `Idempotent-Replayed: true`.
  - Same key and a different body: 422 `idempotency_key_reuse`.
  - An in-flight duplicate waits on the row lock and then replays.
- **Cursors.** Opaque base64url of `(sortKey, id)`; page-number lists are limited to 10,000 rows.
- **Concurrency and headers.** `If-Match: "<version>"` on edits and `ETag` on single resources (409 `version_conflict` on mismatch); `X-Request-Id` on every response; `Retry-After` on 429 and 503.

## Consequences

**Positive**

- A retried create after a timeout, a double tap or a lost response returns the first answer instead of creating twice.
- One error shape, one set of codes, all in one catalog (DOC-42); screens map codes to localized strings.
- Cursors stay stable while rows are inserted, and use the indexes that start with `building_id`.

**Negative**

- The error shape is not RFC 9457; a third-party client expecting `application/problem+json` needs an adapter.
- Every create takes an extra insert and, for in-flight duplicates, a held row lock and connection; a 24-hour purge job is needed.
- The stored response body duplicates data for 24 hours, including any personal data in it, and must follow the retention table.
- Opaque cursors cannot jump to page N; exports and reports that need random access use their own mechanism.
- A client that reuses one key for different requests gets a 422 it must understand.

**Follow-up work**

- DOC-50 (guidelines, the RFC 9457 mapping note), DOC-51 (per-endpoint codes) and DOC-42 (catalog); DDL of `platform.idempotency_key` in DOC-17 §3; purge in DOC-38 and DOC-20.
- Tests: run-twice, same key with a different body, concurrent duplicates and a kill after commit (LG-, IN-); cursor stability under inserts.
- A note for P1 clients: generate the key once per user intent and keep it across retries.
