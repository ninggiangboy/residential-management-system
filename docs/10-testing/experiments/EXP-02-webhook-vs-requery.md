# EXP-02: A webhook and a re-query that confirm the same payment at the same instant make one payment

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-01) · Updated: 2026-11-01 (P1-27: first version; Stripe first, DR-325, DR-330) · DOC-91 / EXP-02
> Depends on: [common protocol](README.md) (DOC-89), original SDD §20.2, [DR](../../00-decision-register.md) (DR-29, 30, 78, 80, 318, 325, 326, 330), [ADR-0008](../../04-adr/0008-settlement-idempotency.md), [DOC-23](../../06-design/payment-intents-and-settlement.md) §6, §7.1, §8, §16.3 (IN-37), [DOC-24](../../06-design/payment-gateway-drivers.md) §4.4, §4.5, [DOC-03](../../01-product/requirements.md) (NFR-01, FR-08.3), [DOC-88](../test-strategy.md) §10
> Main readers: P2-27 (the run), P2-24 (the re-query job), P2-06 (`settle()`); the evaluation of NFR-01; the review of M2

Two independent paths learn that a payment succeeded: the provider's webhook and our own re-query job. Normally one arrives first; sometimes both arrive within a millisecond. Both end in `settle()`, and the unique key `(provider, reference)` of `gateway_event` decides: the second insert waits for the first commit and becomes `already_processed` (DOC-23 §7.1). This experiment releases both paths together for 1,000 intents, ten times, and looks for the states that must not appear: two payments for one intent, a deadlock, or an error answered to the provider. It does not test duplicate webhook deliveries (EXP-01) or races on the charge (EXP-03, EXP-04).

## 1. Hypothesis

| ID | Statement | Source | Measured by |
| --- | --- | --- | --- |
| H1 | For each intent, with the webhook and the re-query released at the same instant, **exactly one payment exists**, in every one of 10 rounds | NFR-01, FR-08.3 | C1 |
| H2 | **0 deadlocks**: neither path takes a lock the other holds in the opposite order (both start with the `gateway_event` insert) | FR-08.3, DOC-23 §7.1 | C2 |
| H3 | **0 errors reach the provider**: every webhook answer is 200 | FR-08.3, FR-08.6 | C3 |
| H4 | The loser is a no-op: its call ends `already_processed`, writes no row, and the receipts are issued once | ADR-0008 | C4 |
| H5 | The nightly check Q01…Q19 is clean after each round | DOC-22 §12 | C5 |
| H6 | The race happened and both orders occurred | DOC-89 §13 | C6, C7 |

## 2. Variables

| Kind | Variable | Values |
| --- | --- | --- |
| Independent | Round | 10 rounds per run, each with 1,000 fresh intents (10,000 intents per run) |
| Independent | Which path starts first | Each path is released after a seeded offset of −3…+3 ms from a barrier |
| Independent | Concurrency | 50 intents in flight at a time |
| Dependent | Metrics of §6 | |
| Controlled | The staging host, the `fake` driver (a test sets the session `PAID`, so `getStatus` returns the confirmation), the Stripe signature format for the webhook, one API container and the worker in the same host, the real clock | |

## 3. Baseline

None (DOC-89 §6). The experiment has two checks of its own that it can fail: C6 and C7 fail when the paths did not really meet or one order never occurred, so a pass cannot come from two paths that never overlapped.

## 4. Environment

| Item | Value |
| --- | --- |
| Where | The staging host (DOC-89 §2), quiet, the API restarted before run 1 |
| Software | Commit, Bun, PostgreSQL versions and the image digest in every file |
| Paths under test | The webhook through the real route `POST /api/v1/payments/webhooks/stripe/{gatewayConfigId}` with a signed body; the re-query through the real `RequeryIntent` use case called by the harness (the job's claim is bypassed so the release is exact; the claim itself is tested by `IN-` tests) |
| Seed | `baseSeed = 20000`; `seed = 20000 + run` |

## 5. Steps

```bash
bun run exp:02 --seed-only     # once per host: the scratch building (as EXP-01)
bun run exp:02                 # one warm-up pass, five runs, result files, summary
```

One round:

1. Create 1,000 intents (real `CreatePaymentIntent`, `fake` driver); set each session `PAID` in the fake driver; build the signed webhook body per intent.
2. For each intent, arm a barrier with two waiters: the webhook POST and the `RequeryIntent` call.
3. Release the barrier in groups of 50; each waiter proceeds after its seeded offset; record start and end times, the webhook status, and the use case's outcome (`posted` or `already_processed`).
4. Count `deadlocks` from `pg_stat_database.deadlocks` before and after, and from the log lines `40P01`.
5. After the round, read the metrics of §6, then Q01…Q19.

A run is ten rounds; the summary is written after run 5.

## 6. Metrics and formulas

| Name | Definition |
| --- | --- |
| `intents` | 10,000 per run |
| `paymentsPerIntent` | The histogram `{0, 1, 2+}` of `payment` rows with `intent_id` |
| `receiptsPerAllocation` | Allocations with more than one receipt |
| `deadlocks` | The rise of `pg_stat_database.deadlocks` over the run, plus `40P01` seen by the use cases |
| `webhookNon200` | Webhook responses other than 200 |
| `loserNoop` | Intents in which exactly one path ended `posted` and the other `already_processed` |
| `webhookFirst`, `requeryFirst` | Intents in which the webhook's / the re-query's `gateway_event` insert committed first (from the row's `source`) |
| `overlapRate` | Intents in which the two starts differ by at most 5 ms ÷ 10,000 |
| `invariantRows` | Rows of Q01…Q19 after each round, summed |

## 7. Pass criteria

| ID | Criterion | Kind |
| --- | --- | --- |
| C1 | `paymentsPerIntent[1] == 10000` and `[0] == 0` and `[2+] == 0` | correctness |
| C2 | `deadlocks == 0` | correctness |
| C3 | `webhookNon200 == 0` | correctness |
| C4 | `loserNoop == 10000` and `receiptsPerAllocation == 0` | correctness |
| C5 | `invariantRows == 0` | correctness |
| C6 | `overlapRate >= 0.90` | correctness |
| C7 | `webhookFirst >= 500` and `requeryFirst >= 500` (each order at least 5 %) | correctness |

**Worked reading.** A run with `webhookFirst 5,213` and `requeryFirst 4,787`, 10,000 payments, 0 deadlocks, 0 non-200 answers passes. Illustrative, not measured. A run in which every intent was settled by the webhook (`requeryFirst 0`) fails C7: the re-query always lost, so the race was not tested.

## 8. Analysis

- The summary shows per round the split `webhookFirst` / `requeryFirst` and the median time between the two inserts.
- A failure of C1 writes the intent ids, both `gateway_event` rows, the payments and the lock waits from `pg_locks` snapshots to the job artifact.
- Scripts: `apps/api/tests/exp/exp02-webhook-requery.ts`, `oracle/ledger.ts`, `lib/`.

## 9. Result table template

| Run | Commit | Machine | Intents | Payments = 1 | 2+ | Deadlocks | Non-200 | Loser no-op | Webhook first | Re-query first | Overlap | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1…5 | | | 10,000 | | | | | | | | | |

## 10. Threats to validity

| Threat | Handling |
| --- | --- |
| The harness calls the re-query use case, not the job's claim | The claim and its lease are tested by `IN-` tests (DOC-23 §16.4); the race of this experiment starts at `settle()` |
| 50 in flight on 2 vCPU makes the scheduler, not the database, the limit | The overlap rate (C6) says whether the paths met |
| `fake` returns the confirmation instantly, unlike a provider | The latency of the provider is not the subject; the order of the two inserts is |
| The database is shared with the worker | By design (DOC-89 §2) |

## 11. Results

None yet; the run is P2-27.

## 12. Open questions

None. DR-330 (ten rounds, 50 in flight, the exact release, the order check) is decided under the Owner's delegation.
