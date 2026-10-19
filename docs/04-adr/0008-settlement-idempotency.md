# ADR-0008: Settle each confirmation once through `gateway_event`, then the intent claim; failed calls go to a rejection log

- Status: Accepted
- Date: 2026-10-19 · Related: DR-29, DR-32, DR-84, FR-08.2, FR-08.3, FR-08.5, FR-08.6, FR-09, NFR-01, NFR-02, EXP-01, EXP-02, DOC-23, DOC-24

## Context

One transfer can reach the system three ways: the signed webhook (retried by the gateway), the server's own re-query, and the bank-statement path. The webhook can arrive five times, in any order, while the re-query runs. The process can die after commit and before the answer. A confirmation must settle exactly once, and a forged call must never block a genuine one.

The original SDD §6.4 stored an invalid-signature call in `gateway_event` with `signature_ok = false`, but that table is `UNIQUE (provider, reference)`. A forged body with a real-looking `reference` posted before the genuine webhook would occupy the key; the genuine confirmation would then be read as "already processed" and the payment lost. A table that accepts unauthenticated inserts is also a flood target (DR-32).

## Options considered

1. **Idempotency by intent status only.** Update the intent to `paid` and ignore later calls. A duplicate transfer or a statement path for a different reference cannot be told apart from a retry, and there is no record of what came in. Rejected.
2. **Idempotency key in memory or in a cache.** Lost on restart; webhook retries arrive after deploys. Rejected.
3. **Store every call, signed or not, in `gateway_event`** (the original design). Lets a forger occupy a real transfer's key. Rejected (DR-32).
4. **One authenticated-only `gateway_event` unique on `(provider, reference)`, then an intent claim, with a separate rejection table.** Chosen.

## Decision

Option **4** (DR-29, DR-32). `settle(confirmation)` is the one function for the webhook, the re-query and the statement path; the confirmation is already authenticated by its source. It runs in one transaction at READ COMMITTED:

1. `INSERT INTO finance.gateway_event (…, outcome) VALUES (…, 'pending') ON CONFLICT (provider, reference) DO NOTHING RETURNING id`. No row means the transfer was already processed: commit and answer 200. A concurrent second insert waits for the first to commit, then returns zero rows. **This row is the first arbiter.**
2. Resolve the intent from the order code; none gives `unknown_order`.
3. Classify without writing money (savepoint): `duplicate_transfer`, `amount_short`, `amount_over`. Any of these sets the outcome and commits; the intent keeps its status.
4. Exact amount: **claim the intent** with `UPDATE payment_intent SET status = 'paid' … WHERE order_code = :c AND status IN ('creating','pending','cancelling','expired','cancelled') RETURNING …` (a late exact confirmation of an expired or cancelled link is still posted), then run the allocation statement of ADR-0006 per charge. **The intent row is the second arbiter.**
5. All charges updated: payment, allocations, receipts, `gateway_event.outcome = 'posted'`, outbox `finance.payment_posted.v1`, commit.

**Authentication failures never touch `gateway_event`.** The webhook endpoint checks, in order: body size, gateway configuration exists and is active (else 404, no row), HMAC-SHA256 in constant time, `data.accountNumber` equal to the configured account, a paid-transfer code. A failed check writes `finance.webhook_rejection (reason, ip, body_sha256, 2 KB excerpt)`, purged after 30 days and rate limited to 60/min/IP in the application. The HMAC is the only gate; a call from an unknown IP is logged and never blocked (Owner, 2026-10-18). The endpoint answers 200 only after commit, so a crash before commit leaves the gateway to retry and the re-query to catch up (FR-08.6).

On SQLSTATE `40001` or `40P01` the whole transaction is retried up to 3 times with jitter. A payOS registration test payload is answered 200 and writes nothing.

## Consequences

**Positive**

- Duplicates, reordering and webhook-against-re-query are no-ops by construction: five deliveries of one confirmation give one payment (FR-08.2, FR-08.3).
- A forged call cannot hide or block a genuine one (FR-08.5); the `gateway_event` contract stays "only authenticated confirmations" and doubles as the money log of ADR-0005.
- The same function serves three sources, so one test set covers them.

**Negative**

- A forged flood now fills `webhook_rejection` instead of `gateway_event`; it is bounded by the 2 KB excerpt, the 30-day purge and the rate limit, not eliminated.
- Two arbiters (event row, then intent row) add a second place a race can end; the intent claim must stay in the same transaction as the event insert or a crash could leave an event with no outcome (DOC-23 specifies the savepoints).
- The HMAC as the only gate means a leaked checksum key lets anyone forge a valid confirmation; rotation and step-up protect it (DR-33, DR-39, RB-12, RB-13).
- Behavior of the real gateway (retry policy, test payload, late transfers to a cancelled link) is unverified until the Owner reports a sandbox (DR-25).

**Follow-up work**

- DOC-23 (`settle()` step by step), DOC-24 (signature and test vectors), DOC-39 (rate limits) and DOC-40 ("signature errors" alert counts `webhook_rejection`).
- EXP-01 (duplicates, delays, forged-first, kill after commit) and EXP-02 (webhook against re-query over 1,000 intents, 10 rounds); `IN-` and `PX-` tests.
