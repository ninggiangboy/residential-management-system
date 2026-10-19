# ADR-0006: One conditional update per charge decides every payment race, all or nothing

- Status: Accepted
- Date: 2026-10-19 · Related: DR-14, DR-84, DR-29, FR-04.3, FR-05.3, FR-05.8, FR-09.1, FR-49.5, NFR-01, EXP-03, EXP-04, DOC-22, DOC-23

## Context

A charge can be settled by an online confirmation, a manual entry or a statement-assisted settlement, and it can be recalled or voided at the same moment. Something must decide which one wins. The original SDD §5.4 used `WHERE … AND paid_amount + :amount <= amount`, which allowed a clamp: with partial payments the online amount moved wholly to credit when a cash part had been paid. Partial payment and credit no longer exist (DR-84, ADR-0005), so the question is only: which statement decides a race between two full payments, or a payment and a recall, of the same charge?

## Options considered

1. **Read the status, then write.** `SELECT status`, check in the application, then `UPDATE`. Two sessions both read `open` and both write; the second overwrites or double-pays. This is the naive baseline that EXP-03 runs next to the chosen design to show the difference. Rejected.
2. **Clamped update.** Pay what fits, send the surplus to credit or the log. Needed only for partial payments; dropped with DR-84. Rejected.
3. **Advisory or table locks around settlement.** Serializes every payment in a building and moves the arbiter away from the row the business talks about. Rejected.
4. **SERIALIZABLE isolation with retries.** Correct but retries every contended pair and hides the rule in the isolation level. Rejected; READ COMMITTED plus a row predicate is enough here.
5. **All-or-nothing conditional update per charge, in id order.** Chosen.

## Decision

Option **5** (DR-14, DR-84). For each charge of the payment, in ascending `charge.id` order, inside the settlement transaction at READ COMMITTED:

```sql
UPDATE finance.charge SET status = 'paid', version = version + 1
WHERE id = :charge_id AND building_id = :building_id
  AND status = 'open' AND amount = :expected_amount
RETURNING id;
```

- **Zero rows on any charge** means the charge is no longer open (paid by another channel, recalled or voided) or its amount differs. Nothing of the payment is posted.
  - Manual entry: roll back, answer 409 `charge_changed` with the fresh state (FR-05.3).
  - Online settlement: roll back to the savepoint taken after the `gateway_event` claim and set the outcome to `charge_already_paid` or `charge_recalled` (ADR-0008, DR-29); the intent's other charges are not paid.
- **Recall and single-charge void** use the same predicate (`status = 'open'`), so exactly one of a payment and a recall or void wins (FR-04.3, FR-49.5; EXP-04).
- **Id order** makes two payments over the same charges in different orders (A,B and B,A) wait on the same first row instead of deadlocking; SQLSTATE `40001`/`40P01` is still retried up to 3 times with 20–60 ms jitter (DR-29, FR-08.8).
- **Last nets:** `UNIQUE (charge_id) WHERE status = 'live'` on `allocation`, the `CHECK` constraints and a trigger that rejects changes to the `amount` of a non-draft charge. They never replace the predicate.
- The loser of a race leaves a log row; the Manager refunds the transfer outside the system (ADR-0005).

The receipt counter row is locked inside the same transaction; its serialization cost is measured, not assumed (DOC-22).

## Consequences

**Positive**

- The arbiter of every ledger race is one row and one predicate, readable in the SQL and testable with barrier tests.
- No partial state: a payment either posts every allocation, receipt and status change, or none.

**Negative**

- A payment covering several charges fails as a whole when one charge changed, so the resident or Manager must start again. Accepted: a charge is paid whole (DR-84).
- Locking rows in id order is a discipline every write path must follow; one path that forgets it can deadlock (the retry rule limits the damage).
- READ COMMITTED means each statement sees the latest committed row; correctness depends on the predicate, not on snapshot isolation, so a future write path without it is a bug the type system cannot catch (the review checklist of [DOC-12](../03-architecture/code-architecture.md) §14 asks for the condition predicate).

**Follow-up work**

- `LG-` race tests in P2-03 on PostgreSQL 18 with 2…8 racing sessions: exactly one winner, no deadlock for A,B against B,A, no unnecessary serialization on the receipt counter (DR-14).
- EXP-03 (P2-14) writes the naive read-then-write baseline; EXP-04 covers recall against payment.
- DOC-22 holds the statement and its test tables; DOC-23 calls it from `settle()`.
