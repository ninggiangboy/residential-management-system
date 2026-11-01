# EXP-04: A recall racing payments never leaves a payment on a recalled charge

> Status: **Draft** · Updated: 2026-11-01 (P1-27: first version, DR-319) · DOC-93 / EXP-04
> Depends on: [common protocol](README.md) (DOC-89), [EXP-03](EXP-03-online-vs-manual-baseline.md) (the ledger oracle), original SDD §5.8, §20.2, [DR](../../00-decision-register.md) (DR-14, 16, 19, 20, 29, 31, 78, 97, 243, 318, 319), [ADR-0005](../../04-adr/0005-ledger-charges-and-allocations-paid-in-full.md), [ADR-0008](../../04-adr/0008-settlement-idempotency.md), [DOC-21](../../06-design/fee-batches-and-import.md) §3.5, §3.9, §5, [DOC-22](../../06-design/ledger-and-allocation.md) §10, §12, [DOC-23](../../06-design/payment-intents-and-settlement.md) §5.4, §6, §7.2, §16.3, [DOC-03](../../01-product/requirements.md) (NFR-01, FR-04.1…04.3), [DOC-88](../test-strategy.md) §10
> Main readers: P2-14 (the harness and the baseline), P2-07 (the code under test: recall and `cancelHolding`), P2-06 (`settle()`); the evaluation of NFR-01; the review of M2

A Manager recalls a published batch of 50 charges at the moment the bank confirms a transfer for some of them. The design lets the charge row decide: the recall voids all 50 `open` charges in one statement and rolls back if the count differs (a paid charge exists), while `settle()` pays a charge only if it is still `open` (DOC-21 §3.5, DOC-22 §10). This experiment runs 200 such races and looks for the one state that must never exist: **a recalled charge that carries a payment**, and for the other one: **a confirmed transfer that is neither a payment nor a row in the money log**. It does not test a recall without any payment (LG-70), the cancel handler at the gateway (P3), or the race of recall with a manual payment (LG-81).

## 1. Hypothesis

| ID | Statement | Source | Measured by |
| --- | --- | --- | --- |
| H1 | Over 200 batches of 50 charges, each recalled while 1 to 5 confirmations for its charges arrive, **0 recalled batches carry a live allocation**, and 0 `void` charges carry one | NFR-01, FR-04.3, DR-14 | C1, C2 |
| H2 | **Every confirmed transfer is accounted for:** it ended as a posted payment or as a money-log row (`charge_recalled`, `charge_already_paid`, …); 0 are neither | NFR-01, FR-09.5, DR-29 | C3 |
| H3 | The outcome is all-or-nothing per batch: a recall that succeeds leaves **all 50 charges `void`**; one that fails (a paid charge exists) leaves **none changed**, and the batch stays `published` | FR-04.2, DR-97 | C4 |
| H4 | A 409 `batch_has_payments` is never spurious: the batch it names holds at least one `paid` charge | FR-04.2 | C5 |
| H5 | Every intent that held a recalled charge is `cancelling` (or already `paid` before the recall) and no active hold remains on a `void` charge | FR-04.1, DR-31 | C6 |
| H6 | The lock orders of the recall (charges, then intents) and of `settle()` (intent, then charges) may meet in a deadlock; **every one is retried to a correct outcome**, none reaches the caller as an error | DOC-23 §7.2 | C7 |
| H7 | The nightly check Q01…Q19 is clean on the database after the run | DOC-22 §12 | C8 |
| H8 | **The baseline can fail:** a recall without `status = 'open'` and without the count check leaves a void charge with a live allocation | DR-78 | C9 |
| H9 | The race really happened (both sides in flight within 5 ms in at least 90 % of the batches) | DOC-89 §13 | C10 |

## 2. Variables

| Kind | Variable | Values |
| --- | --- | --- |
| Independent | Batch | 200 published batches of 50 charges (10,000 charges, 240 units of the `sample` building; each unit holds charges of many batches) |
| Independent | Confirmations per batch | `k` drawn per batch from the seeded `Rng`: 1, 2, 3, 4 or 5 (each equally likely) |
| Independent | Which charges are paid | `k` charges of the batch on `k` different units; for 30 % of them the intent also holds a second charge of the same unit from **another** batch (so a recall must cancel an intent as a whole, FR-04.1) |
| Independent | Start offsets | The recall and each of the `k` `settle()` calls are released from a barrier after a seeded offset of −3…+3 ms |
| Independent | Concurrency | 10 batches in flight at a time (so recalls of different batches interleave and the pool of 20 connections is under pressure) |
| Independent | Design | `chosen` (the real `RecallFeeBatch` and `settle()`) and `baseline` (§3) |
| Dependent | The metrics of §6 | |
| Controlled | `sample` clone per run and design, `fake` driver, `FakeClock` fixed at 2026-12-03T03:00:00Z, READ COMMITTED, the same seed for both designs in a run | |

## 3. Baseline

The baseline is a recall written the quick way: **void the batch's charges without asking whether they are still open, and without comparing the count**.

```ts
// baseline.ts (same file as EXP-03's naive allocation, DR-78): naive recall
async function naiveRecall(tx: Tx, batchId: string) {
  await tx`UPDATE finance.fee_batch SET status = 'recalled' WHERE id = ${batchId}`
  await tx`UPDATE finance.charge SET status = 'void', void_kind = 'recall' WHERE batch_id = ${batchId}`   // no AND status = 'open'
  /* cancelHolding as the real path */
}
```

A charge that `settle()` paid a moment earlier is overwritten to `void`: the charge is void and its allocation, payment and receipt stay live. The chosen path cannot do this, because its recall counts the open charges after locking the batch row and rolls back when the update changes fewer rows (DOC-21 §3.5 steps 2 and 3). The baseline uses the same `settle()` as the chosen design, so the difference comes from the recall only.

## 4. Environment

| Item | Value |
| --- | --- |
| Where | **Database-only** (DOC-89 §2): a developer machine or the `nightly` stage. The machine is described in the result |
| Database | A clone of the `sample` template per run and per design, connected as `rms_app`, PostgreSQL 18.6, READ COMMITTED, pool of 20; `deadlock_timeout` at its default of 1 s, so a deadlock costs about a second and is counted |
| Software | Commit, Bun, PostgreSQL versions in the file; a clean tree |
| Drivers | `fake` payment driver; the confirmation is built by the test (DR-76) |
| Seed | `baseSeed = 40000`; `seed = 40000 + run` |

## 5. Steps

```bash
bun run infra:up
bun run exp:04                 # five runs × two designs; results/EXP-04-<utc>-run1…5.json and -summary.json
EXP_RUNS=1 bun run exp:04      # a smoke run (not of record)
```

One run, for each design in the order `chosen`, `baseline`:

1. Clone the `sample` template. Create 200 batches of 50 charges (a batch per month-sequence code `PH-yymm-nn`) and publish them with the real `PublishFeeBatch`.
2. For each batch draw `k` and the paid charges; create the intents with the real `CreatePaymentIntent` (`fake` driver); build the exact confirmations.
3. Run the batches 10 at a time. For each batch: a barrier; release the recall (`RecallFeeBatch` with the reason "EXP-04") and the `k` calls of `settle(confirmation)` after their seeded offsets. A deadlock (`40P01`) is retried by the transaction wrapper, at most 3 times; the harness counts it.
4. Record per batch: the recall result (`recalled` or 409 `batch_has_payments` with `paidCount`), each confirmation's outcome (`posted`, `charge_recalled`, `charge_already_paid`, an exception), the start times, and the deadlocks.
5. After all 200, deliver one **late** confirmation per recalled batch for a charge that was in an intent: the outcome must be `charge_recalled`.
6. Read the metrics of §6 with the oracle queries, then run Q01…Q19 of DOC-22 §12 once. Write the run file; after run 5 the summary.

## 6. Metrics and formulas

Observed by independent SQL as `rms_migrator` in `apps/api/tests/exp/oracle/ledger.ts`; expected counts come from the generator.

| Name | Definition |
| --- | --- |
| `batches` | 200 |
| `recalled`, `refused` | Batches whose final status is `recalled` / still `published` (the recall answered 409) |
| `recalledWithLive` | Recalled batches with at least one charge that has a **live allocation** |
| `voidWithLive` | `void` charges with a live allocation (Q03) |
| `partialRecall` | Batches where the number of `void` charges with `void_kind = 'recall'` is neither 0 nor 50 minus the charges voided alone before the race (0 in this experiment) |
| `confirmations` | The sum of `k` over the batches, plus the 200 late ones |
| `posted` | Confirmations that ended `posted` (a payment exists) |
| `logRows` | `gateway_event` rows with an outcome other than `pending` and `posted`, by outcome |
| `unaccounted` | `confirmations − posted − logRows − already_processed` (a confirmation that is neither) |
| `refusedJustified` | Refused batches with `paidCount >= 1` and a `paid` charge in the batch |
| `holdersLeft` | Active intent items on a `void` charge (Q13 form with a `void` join) |
| `intentsNotCancelled` | Intents that held a recalled charge and are neither `cancelling`/`cancelled` nor `paid` before the recall |
| `deadlocks`, `deadlocksRetried` | `40P01` seen / retried to a final outcome |
| `retriesExhausted` | Calls that threw after the third retry (the webhook would answer 503) |
| `unexpectedErrors` | Exceptions and 5xx other than the typed outcomes |
| `overlapRate` | Batches in which the recall's start and the first `settle()` start differ by at most 5 ms ÷ 200 |
| `invariantRows` | The sum of the rows returned by Q01…Q19 |

## 7. Pass criteria

`correctness` criteria hold in every one of the five runs (DOC-89 §3); `baseline` criteria must hold in every run too.

| ID | Design | Criterion | Kind |
| --- | --- | --- | --- |
| C1 | chosen | `recalledWithLive == 0` | correctness |
| C2 | chosen | `voidWithLive == 0` | correctness |
| C3 | chosen | `unaccounted == 0` | correctness |
| C4 | chosen | `partialRecall == 0` and `recalled + refused == 200` | correctness |
| C5 | chosen | `refusedJustified == refused` | correctness |
| C6 | chosen | `holdersLeft == 0` and `intentsNotCancelled == 0` | correctness |
| C7 | chosen | `deadlocksRetried == deadlocks` and `retriesExhausted == 0` and `unexpectedErrors == 0` | correctness |
| C8 | chosen | `invariantRows == 0` | correctness |
| C9 | baseline | `voidWithLive >= 1` (else the run is `invalid`, DOC-89 §6) | baseline |
| C10 | both | `overlapRate >= 0.90` | correctness |

`deadlocks` is reported with `min`, `median` and `max`; a deadlock is a cost of two lock orders meeting, not a defect, as long as C7 holds (DOC-23 §7.2). Of the 200 batches the experiment expects a mix: some recalled, some refused. A set where all 200 ended the same way (all recalled or all refused) is a **warning** that the offsets did not explore both orders.

**Worked reading.** A run with 200 batches, 117 recalled and 83 refused, 604 confirmations plus 117 late ones, of which 255 posted and 466 log rows (`charge_recalled` 441, `charge_already_paid` 25), 0 unaccounted, 4 deadlocks all retried, Q01…Q19 clean, passes. The same run's baseline with 9 void charges carrying a live allocation passes C9; with 0 it is `invalid`.

## 8. Analysis

- The summary shows, per design and metric, `min`, `median`, `max`, the recalled/refused split and the distribution of `k` against the outcome (recalled share for `k = 1…5`; informational).
- On any failure of C1…C8 in the chosen design, the harness writes to the job artifact the batch id, the charge ids, the allocation and payment ids, the order of commits (by `xmin` / `pg_xact_commit_timestamp`) and the deadlock log lines.
- Scripts: `apps/api/tests/exp/exp04-recall-vs-payment.ts`, `apps/api/tests/exp/baseline.ts`, `apps/api/tests/exp/oracle/ledger.ts` and the shared `lib/` (DOC-89 §12).

## 9. Result table template

| Run | Commit | Machine | Design | Batches | Recalled | Refused | Recalled with live | Void with live | Unaccounted | Holders left | Deadlocks (retried) | Overlap | Q01…Q19 rows | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1…5 | | | chosen | 200 | | | | | | | | | | |
| 1…5 | | | baseline | 200 | | | | | | | | | | |

## 10. Threats to validity

| Threat | Handling |
| --- | --- |
| Few batches (200) and `k` ≤ 5 may not reach the rare interleaving | 5 runs × 200 batches = 1,000 races, with seeded offsets; the nightly profile repeats them each night (DOC-88 §11) |
| Locks of a recall (50 rows) are held longer than those of one settlement, so the recall always wins | The refused share is reported; a set where all 200 ended the same way warns |
| The `fake` driver replaces the gateway cancel call | The recall writes a cancel command to the outbox and no network call happens inside the transaction (DR-31); the cancel handler is P3 |
| Deadlocks cost a second each, so the run is slow and a timeout hides a failure | `deadlock_timeout` is the default; the harness timeout per batch is 30 s and a timeout is an `unexpectedError` |
| The recall and the settlement cannot be separated in time by the harness more precisely than a few ms | `overlapRate` makes this visible and C10 fails a set that did not overlap |

## 11. Results

None yet; the run is P2-14 (after P2-06 `settle()` and P2-07 the recall). Planned: 200 batches per design per run, 5 runs.

## 12. Open questions

None. DR-319 (the designs, the seeded offsets, the late confirmation and the experiment sizes) is decided under the Owner's delegation.
