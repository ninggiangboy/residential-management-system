# EXP-01: Duplicate, late and forged webhooks make one payment each, and the payer sees it fast

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-01) · Updated: 2026-11-01 (P1-27: first version; Stripe first, DR-325, DR-330) · DOC-90 / EXP-01
> Depends on: [common protocol](README.md) (DOC-89), original SDD §20.2, [DR](../../00-decision-register.md) (DR-29, 32, 78, 80, 281, 318, 325, 326, 330), [ADR-0008](../../04-adr/0008-settlement-idempotency.md), [DOC-23](../../06-design/payment-intents-and-settlement.md) §6, §7, §16.3, [DOC-24](../../06-design/payment-gateway-drivers.md) §4.4, §5, [DOC-52](../../07-api/sse-and-webhooks.md) §12, [DOC-03](../../01-product/requirements.md) (NFR-01, NFR-02, FR-08), [DOC-10](../../03-architecture/quality-attributes.md) §4.1
> Main readers: P2-27 (the run), P2-23 (the webhook route), P2-06 (`settle()`), the evaluation of NFR-01 and NFR-02; the review of M2

A payment provider delivers the same confirmation more than once, out of order, late, and sometimes someone forges a call. The design says the signed webhook, the re-query and a late delivery all end in one `settle()` that keys on `(provider, reference)`, so one transfer is one payment (ADR-0008, DOC-23 §6). This experiment sends 1,000 payments through the real webhook route in that hostile way and counts what is left. It also measures how long the payer waits before the app shows the receipt (NFR-02). It does not test a webhook racing the re-query (EXP-02), a recall racing a payment (EXP-04), or the provider itself: the confirmations are signed by the simulator, not sent by Stripe.

## 1. Hypothesis

| ID | Statement | Source | Measured by |
| --- | --- | --- | --- |
| H1 | For 1,000 paid intents, each confirmation delivered 1 to 5 times in random order, **exactly one payment exists per reference** | NFR-01, FR-08.2 | C1 |
| H2 | **0 duplicate receipts**: one receipt per allocation, numbers unique and gapless | NFR-01, DOC-22 I-4, I-5 | C2 |
| H3 | A forged call that arrives **before** the genuine one (real-looking reference, wrong signature) never blocks it: the genuine one is posted and every forged call is one `webhook_rejection` row | FR-08.5, DR-32 | C3 |
| H4 | A genuine confirmation that arrives **after** the intent expired or was cancelled, with its charges still open, is posted (DR-281, IN-32); one whose charges were paid meanwhile is a log row | FR-09.1, FR-09.7 | C4 |
| H5 | The webhook always answers 200 after commit for a genuine or duplicate delivery and 401 for a forged one; **0 answers 5xx** | FR-08.6, DR-32 | C5 |
| H6 | **Latency:** from "webhook request accepted" to the first poll showing `paid`, p95 ≤ 5 s, with the app polling every 2 s for the first minute and then every 3 s; the server part (accept to commit) p95 ≤ 1 s | NFR-02, DR-80 | C6, C7 |
| H7 | The nightly check Q01…Q19 is clean after the run | DOC-22 §12 | C8 |
| H8 | The deliveries really overlapped: in at least 90 % of the intents two deliveries were in flight within 5 ms | DOC-89 §13 | C9 |

## 2. Variables

| Kind | Variable | Values |
| --- | --- | --- |
| Independent | Intents | 1,000, each with one open charge of its own unit in a scratch building of 1,000 units (generated like EXP-08's, DOC-97 §4) |
| Independent | Deliveries per confirmation | `d` drawn per intent from the seeded `Rng`: 1, 2, 3, 4 or 5 |
| Independent | Order and spacing | The `d` deliveries are shuffled and spaced by draws of 0 to 2,000 ms; a third of the intents send their deliveries in parallel (barrier) |
| Independent | Forged first | 10 % of the intents: before the genuine delivery, 1 to 3 forged calls carry the same `client_reference_id` and PaymentIntent id with a wrong signature |
| Independent | Late | 10 % of the intents: the intent is `expired` or `cancelled` (half each) when the first genuine delivery arrives; 2 % of the intents have their charge paid in cash first |
| Dependent | Metrics of §6 | |
| Controlled | The staging host (DOC-89 §2), the `fake` driver for the session and the Stripe signature format for the webhook (a test signing secret, DOC-24 §5, §4.4), one API container, the app simulated by a poller that reads E-86, a real clock | |

## 3. Baseline

None as a second implementation (DOC-89 §6). The negative cases are inside the run: the forged calls (must be rejected), the late deliveries (must be posted or logged by rule), and the duplicate deliveries (must be no-ops). The harness is shown able to fail by its own unit test: with the inbox and the unique key of `gateway_event` disabled in a test double, the same input produces duplicate payments (`XP-05` style check in the harness tests).

## 4. Environment

| Item | Value |
| --- | --- |
| Where | The staging host (DOC-89 §2); the API restarted before run 1; no other job running |
| Software | Commit, Bun, PostgreSQL versions and the image digest in every file |
| Sender | `apps/api/tests/exp/exp01-webhooks.ts` using `bun run pay:sim` signing (DOC-24 §5): it signs the body of `checkout.session.completed` events with the test `whsec_` and posts them to `POST /api/v1/payments/webhooks/stripe/{gatewayConfigId}` |
| Poller | One simulated app per intent: `GET /me/payments/intents/{id}` every 2 s for the first 60 s and every 3 s after, starting at a random offset in [0, 2 s) after the intent is created |
| Seed | `baseSeed = 10000`; `seed = 10000 + run` |

## 5. Steps

```bash
bun run exp:01 --seed-only     # once per host: the scratch building, 1,000 units, 1,000 open charges
bun run exp:01                 # one warm-up pass, five runs, result files, summary
```

One run:

1. Create 1,000 intents with the real `CreatePaymentIntent` against the `fake` driver; record `order_code`, the expected amount and a reference `pi_<seed>_<n>`.
2. Build, for each intent, the genuine `checkout.session.completed` body and its `d` deliveries, the forged ones, and the late flag; schedule all deliveries on a monotonic clock.
3. Start the pollers. Run the schedule: each delivery is an HTTP POST to the real route; record `t_accept` (the route's response time) and the status.
4. A poller records `t_visible`: the first poll whose answer shows `status = paid` with its receipts.
5. When the schedule and the pollers finish, read the metrics of §6 with the oracle queries (DOC-89 §5), then run Q01…Q19.
6. Write the run file; after run 5 the summary.

## 6. Metrics and formulas

| Name | Definition |
| --- | --- |
| `paymentsPerReference` | For each genuine reference, the number of `payment` rows with it; the histogram `{0, 1, 2+}` |
| `duplicateReceipts` | Allocations with more than one receipt, plus receipt numbers used twice (Q06, Q05) |
| `forgedCalls`, `rejections` | Forged calls sent; `webhook_rejection` rows written; `rejections == forgedCalls` |
| `blockedGenuine` | Genuine references whose payment is missing although a genuine delivery was accepted: 0 expected |
| `lateExpected`, `latePosted`, `lateLogged` | Late deliveries by expected outcome (posted or log row `charge_already_paid`) and the outcomes found |
| `status5xx` | Webhook responses with a 5xx |
| `webhookToVisibleMs` | Per intent: `t_visible − t_accept(first genuine delivery)`; the run reduces it to p50, p95, p99 (nearest rank, DOC-89 §7) |
| `serverMs` | Accept to commit, from the histogram `payment_settle_duration_seconds` (DOC-40) for the run |
| `duplicatesBlocked` | Deliveries that ended `already_processed`; equals `Σ (d − 1)` over the genuine references that settled once |
| `invariantRows` | Rows of Q01…Q19 |
| `overlapRate` | Intents in which two deliveries' start times differ by at most 5 ms ÷ 1,000 |

## 7. Pass criteria

| ID | Criterion | Kind |
| --- | --- | --- |
| C1 | `paymentsPerReference[1] == 1000 − lateLogged` and `[0] == lateLogged` and `[2+] == 0` | correctness |
| C2 | `duplicateReceipts == 0` | correctness |
| C3 | `rejections == forgedCalls` and `blockedGenuine == 0` | correctness |
| C4 | `latePosted == lateExpected.posted` and `lateLogged == lateExpected.logged` | correctness |
| C5 | `status5xx == 0` | correctness |
| C6 | `webhookToVisibleMs.p95 <= 5000` | latency (median of runs) |
| C7 | `serverMs.p95 <= 1000` | latency (median of runs) |
| C8 | `invariantRows == 0` | correctness |
| C9 | `overlapRate >= 0.90` | correctness |

The summary shows `duplicatesBlocked` ("duplicates blocked: n", the figure the demo of master plan §5 quotes) and warns when `max` of C6 or C7 is above 1.5 × its limit.

**Worked reading.** A run in which 20 of the 1,000 intents were late and logged (their charge was paid in cash first), 142 forged calls were sent and 1,986 genuine deliveries were duplicates passes when C1 reads `[1] 980, [0] 20, [2+] 0`, `rejections` is 142, `duplicatesBlocked` is 1,986 and p95 of `webhookToVisibleMs` is below 5,000 ms. The numbers are illustrative, not measured.

## 8. Analysis

- A histogram of `webhookToVisibleMs` in 250 ms buckets (≤ 20 buckets) in the summary; the dominant term is the poll interval (DOC-10 §4.1), so p95 is expected near 2 s + the server part.
- The run lists the five slowest intents with their delivery schedule when C6 fails.
- Scripts: `apps/api/tests/exp/exp01-webhooks.ts`, `apps/api/tests/exp/oracle/ledger.ts`, `apps/api/tests/exp/lib/`.

## 9. Result table template

| Run | Commit | Machine | Payments = 1 | Payments 2+ | Duplicate receipts | Forged / rejected | Blocked genuine | 5xx | p95 visible (ms) | p95 server (ms) | Duplicates blocked | Overlap | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1…5 | | | | | | | | | | | | | |

## 10. Threats to validity

| Threat | Handling |
| --- | --- |
| The sender is the simulator, not Stripe | The route, the signature check, `settle()` and the database are the real ones; Stripe's own delivery behaviour is read from its documentation and checked in P2-29 with a real sandbox payment |
| The poller runs on the same host as the API | The client part is a few hundred requests per second at most; its CPU is recorded |
| Poll offsets are random, so p95 depends on the seed | Five runs and the median of p95 (DOC-89 §3) |
| The scratch building is not the demo building | It only has to have 1,000 chargeable units |
| A fake clock would hide real latency | The run uses the real clock; only the expiry of the late cases is set by the intent row |

## 11. Results

None yet; the run is P2-27.

## 12. Open questions

None. DR-330 (sizes, the late and forged shares, the poller) is decided under the Owner's delegation.
