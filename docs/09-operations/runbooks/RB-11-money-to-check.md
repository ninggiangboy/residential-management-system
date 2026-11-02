# RB-11: Money to check is waiting

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-02; queries run on PostgreSQL 18.6) · Updated: 2026-11-01 (P2-20: first version, DR-325, DR-327) · DOC-85 / RB-11
>
> Alert: `MoneyLogOpen` (warning, for 24h) · Dashboard: RMS · Overview · Related: DOC-22 §9, DOC-24 §4.10, DOC-66 `W-Money-Log`
> Depends on: [DOC-23](../../06-design/payment-intents-and-settlement.md), [DOC-24](../../06-design/payment-gateway-drivers.md), [DOC-22](../../06-design/ledger-and-allocation.md) §9, [DOC-40](../../06-design/observability.md), [DOC-19](../../05-data/db-roles-and-grants.md) (`rms_readonly`), [DR](../../00-decision-register.md) (DR-28, 30, 31, 32, 33, 84, 325, 326, 327)
> Main readers: the Manager and the operator, P2-26, P2-28

**The rule.** The money log holds money that could not be posted or that moved after posting. A row is **recorded and reviewed, never turned into a payment, an adjustment or a void** (DR-16, DR-19, DR-327). The Manager refunds or settles outside the system and then marks the row reviewed with a note.

## Symptoms and impact

`money_log_open` has been above 0 for 24 hours: a row of `gateway_event` (or, from P3, a statement line) is not reviewed. Nobody is harmed by the delay itself, but a payer may have paid and not been credited, or may be owed a refund.

## Checks

*Run on 2026-11-02* on `postgres:18.6` against the schema of the local database plus the DDL of DOC-15 §3.1, §4–§11, with a fixture (one stuck `pending`, one stale `creating`, one fresh `pending`; six rejections from three IPs; one open and one `pending` money-log row): every query runs without error and returns exactly the rows it is named for.

Connect with the read-only role and set the building as in RB-01:

```bash
psql "host=127.0.0.1 dbname=rms user=rms_readonly"
```

```sql
SELECT id AS b FROM building.building WHERE is_demo = false ORDER BY created_at LIMIT 1 \gset
```

**1. The open rows.**

```sql
SELECT g.received_at, g.outcome, g.amount, g.reference, g.order_code, p.code AS intent_code, g.unit_id, g.related_payment_id
  FROM finance.gateway_event g LEFT JOIN finance.payment_intent p ON p.id = g.intent_id
 WHERE g.building_id = :'b' AND g.outcome NOT IN ('pending', 'posted') AND g.reviewed_at IS NULL
 ORDER BY g.received_at;
```

The same list is `W-Money-Log` (`/transactions?tab=log`), which also shows the payment, receipts and batches a `refunded` or `disputed` row is attached to.

**2. What each outcome means and what to do.**

| Outcome | Meaning | The Manager does |
| --- | --- | --- |
| `duplicate_transfer` | The payer paid twice | Refunds the second payment in the provider's dashboard |
| `charge_already_paid` | A charge was paid another way first | Refunds in the provider's dashboard |
| `charge_recalled` | The batch was recalled while the payer paid | Refunds in the provider's dashboard |
| `unknown_order` | A confirmation matches no intent | Checks the provider's dashboard; refunds if it is not ours |
| `amount_short`, `amount_over` | Bank-transfer drivers only | Refunds or asks for the rest outside |
| `refunded` | A refund was made at the provider | Cross-checks against the payment and receipts; nothing changes in the ledger |
| `disputed` | The payer disputed with their bank | Works it out with the provider; nothing changes in the ledger |

## Remediation

1. Open each row in `W-Money-Log`; read the hint under its outcome.
2. Do what the table says **in the provider's dashboard or with the payer**, not in the system.
3. Mark the row reviewed with a note that says what was done ("Hoàn tiền ngày 12/11, mã hoàn re_…") (E-109). The note is required (5 to 1,000 characters) and a row is reviewed once.
4. For a `refunded` or `disputed` row, look at the attached payment: if the Manager decides the charge should be payable again, that is a decision outside the system today (an online payment is not voidable, DR-24); record it in the note.

## On staging

Rows on staging come from tests and the demo; review them to keep the counter at 0 or leave the building as `is_demo` (excluded from the gauge).

## Confirm it is resolved

1. The query of check 1 returns no row.
2. `money_log_open` is 0 and the alert clears.
3. Each reviewed row has a note and a reviewer.

## Prevention and follow-up

- A recurring outcome is a signal: many `charge_already_paid` rows mean residents pay online while the Manager records cash; many `unknown_order` rows mean a misconfigured endpoint (RB-03).
- Refunds are made only by the Manager or Admin who holds the provider's dashboard login; record who in the note.
