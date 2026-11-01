# EXP-03: Online and manual payment of one charge: exactly one wins, and the naive design does not

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-01) · Updated: 2026-11-01 (P1-27: first version, DR-319) · DOC-92 / EXP-03
> Depends on: [common protocol](README.md) (DOC-89), original SDD §5.9, §20.2, [DR](../../00-decision-register.md) (DR-14, 16, 19, 23, 29, 78, 84, 243, 318), [ADR-0005](../../04-adr/0005-ledger-charges-and-allocations-paid-in-full.md), [ADR-0006](../../04-adr/0006-allocation-write-path-all-or-nothing.md), [DOC-22](../../06-design/ledger-and-allocation.md) §4, §10, §12, §16.2, [DOC-23](../../06-design/payment-intents-and-settlement.md) §6, §7.2, [DOC-03](../../01-product/requirements.md) (NFR-01, FR-05.8), [DOC-10](../../03-architecture/quality-attributes.md) §2, [DOC-88](../test-strategy.md) §10
> Main readers: P2-14 (the harness and the baseline), P2-03, P2-06 (`settle()`) and P2-08 (manual payment): the code under test, the evaluation of NFR-01; the review of M2

A charge can be paid in cash by a Manager and by a bank transfer at the same instant. The design says the charge row arbitrates: one conditional `UPDATE … WHERE status = 'open'` wins and the other reads zero rows (DOC-22 §4.1, §10). This experiment puts the real code and a naive version of the same logic under the same race, 500 charges at a time, and counts what each leaves behind. It proves the money invariant for this pair of actors; it does not test the other races (recall: EXP-04; webhook and re-query: EXP-02; duplicates: EXP-01) or the gateway adapter, which does not exist yet and is replaced by confirmations built by the test (DR-76).

## 1. Hypothesis

| ID | Statement | Source | Measured by |
| --- | --- | --- | --- |
| H1 | **Chosen design:** for each of 500 charges paid in cash and online at the same instant, **exactly one payment wins**; no charge ever has two live allocations | NFR-01, FR-05.8, DR-14 | C1, C2 |
| H2 | Every payment equals the sum of its live allocations; every live allocation has one issued receipt; receipt numbers are gapless | NFR-01, DOC-22 I-3, I-4, I-5 | C3, C4 |
| H3 | **The loser is never lost:** a manual loser is a 409 `charge_changed`; an online loser is exactly one `gateway_event` with outcome `charge_already_paid`. A confirmed transfer that is neither a payment nor a log row is 0 | NFR-01, FR-05.8, DR-29 step 5 | C5, C6 |
| H4 | **The baseline can fail:** the naive design (read the status, decide in code, write back without the predicate, on a table without `uq_allocation_charge_live`) leaves **at least one** charge with two live allocations. This is what justifies the conditional update | DR-78, DOC-22 §4.4 | C7 |
| H5 | **The last net holds:** the same naive code on the real schema, with the unique index, never commits a second live allocation; it fails with `23505` instead | DOC-22 §4.1 | C8 |
| H6 | The race really happened: in at least 90 % of the rounds both sides were in flight within 5 ms | DOC-89 §13 | C9 |

## 2. Variables

| Kind | Variable | Values |
| --- | --- | --- |
| Independent | Design | `chosen` (the real `RecordManualPayment` and `settle()`); `baseline` (naive, no index); `baseline+index` (naive, real schema) |
| Independent | Start offset between the two sides | Drawn per charge from the seeded `Rng`: −2, −1, 0, +1, +2 ms (manual later or earlier), after a barrier release |
| Independent | Charge | 500 open charges: 100 units × 5 charges, amounts from 350,000 to 4,800,000 đ, in 2 batches |
| Independent | Concurrency | 25 races in flight at a time (so the pool of 20 connections is under pressure), each on its own charge |
| Dependent | The metrics of §6 per design | |
| Controlled | The `sample` template clone per run, `fake` payment driver, `FakeClock` fixed at 2026-12-03T03:00:00Z (building 10:00), READ COMMITTED, the same seed for the three designs inside one run | |

One charge is paid by **one** manual entry (a Manager, E-104, the charge alone) and **one** online confirmation (an intent that holds only that charge, an exact-amount confirmation delivered to `settle()`). Charges are not shared between races, so a race decides one charge only; the A,B against B,A deadlock case is LG-15, not here.

## 3. Baseline

The baseline is the question "does the guarded design matter?" answered with code. It lives in `apps/api/tests/exp/baseline.ts` (DR-78), is imported only by the experiment, and does exactly what the SDD describes: **read the charge status, decide in code, write back without the conditional predicate**.

```ts
// baseline.ts: the naive allocation, one charge, one transaction at READ COMMITTED
async function naivePay(tx: Tx, chargeId: string, paymentId: string, expected: bigint) {
  const [c] = await tx`SELECT status, amount FROM finance.charge WHERE id = ${chargeId}`   // no lock, no FOR UPDATE
  if (c.status !== 'open' || c.amount !== expected) return { ok: false }                   // decided in code
  await tx`UPDATE finance.charge SET status = 'paid' WHERE id = ${chargeId}`               // no WHERE status = 'open'
  await tx`INSERT INTO finance.allocation (id, building_id, payment_id, charge_id, amount, status)
           VALUES (${uuid()}, ${b}, ${paymentId}, ${chargeId}, ${expected}, 'live')`
  /* receipt as the real path does it */
  return { ok: true }
}
```

Two variants run the same code:

| Variant | Schema | Expected outcome |
| --- | --- | --- |
| `baseline` | A copy of the schema **without** `uq_allocation_charge_live` (created in the run's database clone by `DROP INDEX`) | Some charges with two live allocations, two receipts, and two payments that each look complete: the double settlement the design exists to prevent |
| `baseline+index` | The real schema | No second live allocation (the index refuses it with `23505`), and an error returned to the loser instead of a clean 409: the index is a net, not a design |

The chosen design and the baseline use the same payment, receipt and counter code below the allocation step, so a difference in the result comes from the allocation statement only.

## 4. Environment

| Item | Value |
| --- | --- |
| Where | **Database-only** (DOC-89 §2): a developer machine or the `nightly` stage; the staging host is not needed (DR-78). The machine is described in the result file |
| Database | A clone of the `sample` template (DOC-88 §6) per run and per design, connected as `rms_app`, PostgreSQL 18.6, READ COMMITTED, pool of 20 |
| Software | Commit, `bun --version`, `postgres` version in every file; the working tree clean |
| Drivers | `fake` payment driver (no gateway call: the confirmation is built by the test, DR-76), `console` mail and SMS |
| Seed | `baseSeed = 30000`; `seed = 30000 + run` |

## 5. Steps

```bash
bun run infra:up
bun run exp:03                 # five runs × three designs; writes results/EXP-03-<utc>-run1…5.json and -summary.json
EXP_RUNS=1 bun run exp:03      # a smoke run (not of record)
```

One run, for each design in the order `chosen`, `baseline`, `baseline+index`:

1. Clone the `sample` template; for `baseline` drop `uq_allocation_charge_live`.
2. Generate the 500 charges, publish their batches, and create for each charge an intent in `pending` that holds it alone (the real `CreatePaymentIntent` against the `fake` driver). Record the expected amounts.
3. For each charge, build the exact confirmation `{provider: 'fake', reference: 'FT<seed><index>', orderCode, amount, paidAt}`.
4. Run the races 25 at a time. Each race: a barrier; release; the manual side calls `RecordManualPayment` (E-104 path, cash, the charge alone) and the online side calls `settle(confirmation)`, the later one after its drawn offset. Record for each side the start and end `performance.now()` and the outcome (`posted`, 201, 409 `charge_changed`, `charge_already_paid`, an exception).
5. When all 500 are done, read the metrics of §6 by the oracle queries (independent SQL, DOC-89 §5), then run the nightly queries Q01…Q19 of DOC-22 §12 once on the database.
6. Write the run file. After run 5, the summary.

## 6. Metrics and formulas

Observed by SQL as `rms_migrator` in `apps/api/tests/exp/oracle/ledger.ts`; the expected values come from the generator (500 charges, one payment per charge).

| Name | Definition |
| --- | --- |
| `charges` | 500 |
| `paidCharges` | Charges with `status = 'paid'` |
| `winnersPerCharge` | For each charge, the number of **live** allocations; the histogram `{0: n0, 1: n1, 2: n2}` |
| `doubleSettled` | Charges with **two or more live allocations** (query Q04) |
| `paymentsNotSumAlloc` | Posted payments whose amount ≠ the sum of their live allocations (Q08) |
| `manualWon`, `onlineWon` | Charges whose single payment is `source = 'manual'` / `'online'`; their sum is `paidCharges` for a correct design |
| `manualLosers409` | Manual attempts that ended 409 `charge_changed` with the charge `paid` by the online payment |
| `onlineLoserLogRows` | `gateway_event` rows with outcome `charge_already_paid` |
| `lostConfirmations` | Confirmations that are neither a posted payment nor a `gateway_event` row: `500 − onlineWon − onlineLoserLogRows` |
| `unexpectedErrors` | Exceptions and 5xx other than the typed loser outcomes |
| `receiptGaps` | Months in which the counter `last` ≠ the number of issued receipts (Q05) plus Q16 |
| `overlapRate` | Rounds in which the two sides' start times differ by at most 5 ms ÷ 500 |
| `deadlocks` | `40P01` seen (counted; each is retried by the wrapper, DOC-12 §8.1) |
| `invariantRows` | The sum of the rows returned by Q01…Q19 |

For `baseline`, the same metrics are read, and `doubleSettled` is the one the hypothesis is about. `doubleSettledAfterIndex` for `baseline+index` is the same query on the real schema.

## 7. Pass criteria

A criterion of kind `correctness` holds in **every one of the five runs**; `baseline` criteria must hold in every run too (DOC-89 §3, §6).

| ID | Design | Criterion | Kind |
| --- | --- | --- | --- |
| C1 | chosen | `winnersPerCharge[1] == 500` (every charge has exactly one live allocation) | correctness |
| C2 | chosen | `doubleSettled == 0` | correctness |
| C3 | chosen | `paymentsNotSumAlloc == 0` and `invariantRows == 0` (Q01…Q19 all clean) | correctness |
| C4 | chosen | `receiptGaps == 0` and the receipts issued equal 500 | correctness |
| C5 | chosen | `manualWon + onlineWon == 500`; every manual loser is a 409 `charge_changed` and `manualLosers409 == 500 − manualWon` | correctness |
| C6 | chosen | `onlineLoserLogRows == 500 − onlineWon` and `lostConfirmations == 0` | correctness |
| C7 | baseline | `doubleSettled >= 1` (the naive design is seen to fail; `baseline` is `invalid` otherwise, DOC-89 §6) | baseline |
| C8 | baseline+index | `doubleSettled == 0` and `unexpectedErrors >= 1` (the index refuses the second write with `23505`) | baseline |
| C9 | all | `overlapRate >= 0.90` | correctness |
| C10 | chosen | `unexpectedErrors == 0` | correctness |

`deadlocks` is reported, not a criterion: a deadlock that the wrapper retried to a correct outcome is a cost, not a defect (DOC-23 §7.2). A deadlock that surfaced as an error is counted in `unexpectedErrors` and fails C10.

**Worked reading.** A run in which 500 races ended 311 online wins and 189 cash wins, 189 log rows `charge_already_paid`, 311 manual 409s, 0 double settlements and Q01…Q19 clean passes C1…C6. The baseline in the same run with 37 charges carrying two live allocations passes C7; if it had 0, the run is `invalid` and the experiment is not accepted.

## 8. Analysis

- The summary lists per metric `min`, `median`, `max` over the five runs, for the three designs side by side, and the split `manualWon` / `onlineWon` (informational: a split of 500/0 or 0/500 is a **warning** that the offsets did not explore both orders; DOC-89 §13).
- `scripts`: `apps/api/tests/exp/exp03-online-vs-manual.ts` (the runs and the summary), `apps/api/tests/exp/baseline.ts` (the naive code), `apps/api/tests/exp/oracle/ledger.ts` (the metric queries), the shared `lib/` of DOC-89 §12.
- The first run that finds `doubleSettled > 0` in the chosen design stops the set: the offending charge ids, the two allocations and the transaction ids from `pg_stat_activity` snapshots are written to the job artifact, and the code is fixed before a new set.

## 9. Result table template

| Run | Commit | Machine | Design | Charges | Winners = 1 | Double settled | Payments ≠ Σ alloc | Manual won | Online won | Loser log rows | Lost | Receipt gaps | Overlap | Deadlocks | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1…5 | | | chosen | 500 | | | | | | | | | | | |
| 1…5 | | | baseline | 500 | | | | | | | | | | | |
| 1…5 | | | baseline+index | 500 | | | | | | | | | | | |

## 10. Threats to validity

| Threat | Handling |
| --- | --- |
| The barrier makes the two sides start together, but one side (a cash entry) does more work than the other, so one side always wins | The seeded start offsets of −2…+2 ms move the winner; the split is reported and a 500/0 split is a warning |
| The `fake` driver does not exercise the real webhook path (signature, HMAC) | Out of scope: the route is tested by its own tests (DOC-24); `settle()` is the same function the webhook calls (DR-29) |
| One charge per race hides the A,B / B,A deadlock | LG-15 covers it with 10,000 attempts |
| The baseline is written by the same people as the design and may be too naive or not naive enough | It is the one the SDD names (read, decide, write back), and C8 shows the schema's last net separately |
| A developer machine with more cores races differently from the 2 vCPU host | The result describes the machine; correctness criteria are not machine-bound, and the `nightly` run is a second source |
| The oracle shares the SQL of the nightly check | Q01…Q19 are themselves proved against 20 injected corruptions by EXP-11; the metric queries here are written for the experiment and add `winnersPerCharge` from the allocations |

## 11. Results

None yet; the run is P2-14. Planned figures until then: 500 races per design per run, 5 runs.

## 12. Open questions

None. DR-319 (the three designs and the seeded offsets) is decided under the Owner's delegation. The experiment cannot run until `settle()` (P2-06) and `RecordManualPayment` (P2-08) exist; that is its task order, not a question.
