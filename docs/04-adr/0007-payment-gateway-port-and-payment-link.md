# ADR-0007: Take online payments through a gateway port with one payOS payment link per intent

- Status: Accepted (2026-11-02, its source DRs decided by the Owner) · Superseded in part by [ADR-0029](0029-stripe-as-the-first-payment-driver-behind-the-gateway-port.md) for the first version: the first driver is Stripe, not payOS; the port, the three paths into one `settle()`, the fake driver and the boot rule stand (DR-325, DR-326)
- Date: 2026-10-19 · Extended by ADR-0029 (2026-11-01: Stripe is the first driver; the port gains presentations) · Related: DR-25, DR-26, DR-27, DR-28, DR-30, DR-31, DR-32, DR-84, FR-07…10, NFR-01, NFR-02, EXP-01, EXP-02

## Context

Residents pay fees by bank transfer. The system must learn exactly which unit paid which charges, at a cost per transaction that suits fees of a few million đồng a month, with a flow that works in every Vietnamese bank app (original SDD §6.6). A charge is paid whole or not at all (DR-84), so a confirmation is useful only when it can be tied to one intent with an exact amount.

This ADR was **Proposed** until its source decisions were made: DR-25 (the gateway facts the design does not know), DR-26 (fake driver and simulator), DR-27 (order code and transfer content), DR-28 (intent lifecycle), DR-30 (re-query job) and DR-31 (cancel at the gateway). The Owner decided them on 2026-11-02, and it became Accepted. The payOS facts of DR-25 are still verified when a payOS driver is built; a fact that overturns the choice needs a new ADR that supersedes this one.

## Options considered

1. **A: static account and transfer-content parsing.** The resident types `A1508 T10`; a bank-feed service forwards every incoming transfer and the system parses the content. Catches transfers made outside the app — but matching depends on what the resident typed, amounts are free so partial and rounded payments are common, and every mismatch becomes Manager work. Rejected as the main path; the idea survives as the bank-statement reconciliation (DOC-25), which can only settle after the gateway itself reports `PAID`.
2. **B: one payOS payment link per intent.** The QR carries the account, the exact amount and a short order code. Matching is exact; a signed webhook and a query API give two independent confirmation paths. Cons: the description is limited to 9 characters on an unlinked account, and fees, retry policy and quotas are external facts to confirm.
3. **C: VNPay redirect.** Cards and wallets, a mature IPN with a query API. Needs a merchant contract, has higher per-transaction fees and a browser redirect inside a mobile app; the proposal asks for one gateway in the first version. Kept as a possible second adapter.

## Decision

Option **B** is chosen, behind a `PaymentGateway` port so that C (or a VietQR driver) is an adapter, not a rewrite.

- **Port** (original SDD §6.6): `createLink`, `getStatus(orderCode)`, `cancel(orderCode, reason)`, `verifyWebhook(rawBody, configId)`. The gateway module code in `finance` depends on the port only; the drivers live in `infrastructure`.
- **Two drivers** selected per gateway configuration: `payos` and `fake`. `fake` stores links in a table, lets a test set a link `PAID`, `CANCELLED` or `EXPIRED`, and answers `getStatus`. It is allowed only for a building flagged `is_demo`, in `local` and `staging`; production refuses to boot if a non-demo building has a `fake` configuration (DR-26, DR-60). A CLI `payos:sim` signs payloads and posts them to the real webhook route with repeat, shuffle, delay, wrong-signature and amount flags.
- **Order code and content** (DR-27): `order_code` comes from a sequence starting at 1,000,000; the transfer content is `TT` plus Crockford base-32 of it, at most 9 characters. Matching never depends on the typed content.
- **Three paths, one function.** The signed webhook, the server re-query (DR-30) and a staff entry all end in the same `settle()` contract; "I have transferred" only brings the next re-query forward. Settlement idempotency and the rejection log are ADR-0008. Cancelling a link is best effort (DR-31): correctness never depends on it, because a late confirmation is posted or logged.
- **Defaults until the sandbox:** 2,000 to 500,000,000 đ per intent, 30 min QR validity, 60 min hold (DR-28). Until a sandbox exists the fake driver is the contract, plus one real minimum-amount payment before go-live (P6-09).

## Consequences

**Positive**

- Exact matching by order code; a lost webhook is recovered by the re-query, a lost re-query by the statement.
- Every automated test, staging and the demo run without a bank or a merchant account.
- A second gateway costs one adapter.

**Negative**

- The design rests on payOS facts that nobody has verified (webhook retry, behavior of a transfer to an expired link, whether a different amount marks the link `PAID`). DR-27 to DR-33 may change when they are.
- The 9-character description limit makes the transfer content useless for humans; the statement fallback reads it only as a hint.
- One more provider credential to protect (encrypted `secrets_enc`, step-up to change it: DR-33, DR-39), and one more outage to survive (RB-13).
- The fake driver can drift from the real gateway; it is trusted only as far as the recorded fixtures.

**Follow-up work**

- Owner reports a payOS sandbox (P0-04); record real requests and responses as fixtures in DOC-24 and decide DR-25…28, 30, 31.
- Write DOC-23 (intents and settlement) and DOC-24 (adapter, signature test vectors); update this ADR to Accepted.
- Architecture: [DOC-07](../03-architecture/system-context-and-containers.md) (webhook route, trust boundary TB7); requirements FR-07…10 in [DOC-03](../01-product/requirements.md).
