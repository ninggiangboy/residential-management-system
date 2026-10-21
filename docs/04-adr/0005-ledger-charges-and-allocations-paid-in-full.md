# ADR-0005: Ledger of charges and append-only allocations, paid in full only, with a money log for everything else

- Status: Accepted
- Date: 2026-10-19 · Related: DR-13, DR-15, DR-16, DR-84, FR-05, FR-09, FR-46, FR-47, NFR-01, EXP-03, EXP-11, DOC-15, DOC-22

## Context

The ledger must answer "is October batch 1 of A-1508 paid?" at once for the resident app and for settlement, keep a trail of who paid what, and stay correct while three sources settle concurrently (webhook, re-query, staff entry). The original SDD §5.9 compared four designs and chose C, but its version of C allowed partial payments, a `paid_amount` cache and a credit balance kept by the Manager (original SDD §5.1, §5.4, §5.7). The Owner removed those on 2026-10-18 (DR-84): the business wants wrong or partial money checked by hand anyway, and the credit arithmetic, six check queries and an anomaly queue only existed to manage it.

## Options considered

1. **A. A balance column per unit.** One row per unit, trivial debt query. It knows how much a unit owes but not which charge is paid, so whole-charge online payment and per-charge receipts are impossible, and a lost update leaves no trace. Rejected (original SDD §5.9).
2. **B. A double-entry journal.** Balanced entries per unit, cash and gateway clearing accounts. Conservation holds by construction, but every screen becomes a query over journal lines, the proposal excludes accounting, and it is three to four times the code for the same behavior. Rejected for phase 1; a journal can be derived later from `payment` and `allocation`.
3. **C. Charges, append-only allocations and a guarded status.** "Is this charge paid" is one column read; every change is one conditional `UPDATE` whose row lock is the arbiter; allocations keep the trail. Chosen.
4. **D. Event-sourced charges.** Complete history, but a retry loop on stream versions in every settlement, lagging projections and the learning cost, for five event types. Rejected; allocations and the audit log already give the history that matters.
5. **C with partial payment and credit** (the original §5.1 model). Rejected by the Owner in DR-84: it needed `paid_amount`, a credit entry table, `applied`/`refunded`/`void_reversal` entries and an allocation race for a partial cash payment against an open online link.

## Decision

Option **C, reduced** by DR-84.

- A charge is `draft`, `open`, `paid` or `void`. No channel pays a charge in part. A payment's amount is exactly the sum of the amounts of the charges it settles. There is no `paid_amount`, no `unit_credit_entry`, no credit balance, no refund bookkeeping (DR-13, DR-84).
- `allocation` is append-only: one live row per paid charge, `UNIQUE (charge_id) WHERE status = 'live'`. Voiding a payment voids its allocations (DR-24) and the charges reopen.
- The invariants are two: `payment.amount = Σ live allocation.amount` for every posted payment, and `charge.status = 'paid'` if and only if exactly one live allocation of the full `charge.amount` exists (DR-15). The nightly check (NFR-09, DOC-22) tests them.
- **The money log replaces the anomaly queue.** Every authenticated confirmation lives in `gateway_event` and every statement line in `statement_line`, each with an `outcome` or `match_status`. Money that is not exactly right (`amount_short`, `amount_over`, `duplicate_transfer`, `charge_already_paid`, `charge_recalled`, `unknown_order`, `statement_only`, an unmatched line) is a log row linked to nothing. The Manager marks it `reviewed` with a note of at least 5 characters, once; review never changes the ledger and never creates or pre-fills an adjustment, a void or a manual payment (DR-16, FR-46, FR-47).
- A wrong transfer is refunded by the Manager outside the system. The system never matches it to another charge, period or payment (FR-09.8).

The write path that decides a race is ADR-0006; the settlement contract is ADR-0008 and DOC-23. Tables are in DOC-15 (finance schema, [DOC-07](../03-architecture/system-context-and-containers.md) §6).

## Consequences

**Positive**

- One state column and one unique index decide "paid"; no running balance can drift out of step.
- Fewer tables than the original design: no `unit_credit_entry`, no `finance_anomaly`, no `paid_amount`, no `settled_amount`. The EXP-11 corruption list loses the credit and sign cases (DR-15).
- Receipts per allocation and whole-charge payment follow directly from the model ([DOC-03](../01-product/requirements.md) FR-05, FR-08).

**Negative**

- The ledger no longer shows every received đồng. Money that reached the bank but was not posted is visible only in the money log and in bank-statement reconciliation (DR-84). This is the accepted trade-off.
- The Manager does the reconciliation of wrong transfers by hand, and the resident is told only that a transfer "does not match" (DR-84 item 8, DR-96).
- `charge.status` is still a cache of "one live allocation exists" and drifts if any code path bypasses the write path of ADR-0006; the unique index, the `CHECK` constraints and the nightly check are the nets.
- A derived journal for an accounting module remains possible but is not built.

**Follow-up work**

- DOC-15 (DDL, `CHECK`/`UNIQUE`), DOC-22 (invariant queries, log, review) and the `LG-` tests; EXP-03 and EXP-11 verify the choice (NFR-01, NFR-09).
- RB-01 (violations) and RB-11 (money to check) use the log, never edit `charge.status` by hand.
