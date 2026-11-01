# RB-01: The nightly ledger check found violations

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-01) · Updated: 2026-11-01 (P1-27: first version, DR-322) · DOC-75 / RB-01
>
> Alert: `LedgerInvariantViolation` (critical, no `for`: the gauge is set once a day) and `InvariantCheckStale` (critical, no success for 36 hours) · Dashboard: RMS · Worker and jobs (the job `invariant_check`) · Related: DOC-22 §3, §6, §12, [EXP-11](../../10-testing/experiments/EXP-11-ledger-drift-detection.md), DOC-40, DOC-38 §4
> Depends on: [DOC-22](../../06-design/ledger-and-allocation.md), [DOC-15](../../05-data/finance-model.md), [DOC-19](../../05-data/db-roles-and-grants.md) (the `rms_readonly` role), [DOC-70](../deploy-staging-and-production.md) (`maintenance.sh`), [DR](../../00-decision-register.md) (DR-16, 19, 24, 66, 78, 243, 266, 322)
> Main readers: the operator on call (the Owner or an engineer), P2-11 (the job and this runbook are one task), the reviewer of any repair

**The rule that overrides everything below.** A violation means the system wrote a state its own rules forbid: a bug, a hand edit or a bad restore. The check **reports and never repairs** (DOC-22 §12), and so do you: **never edit `charge.status`, `allocation`, `payment`, `receipt` or `document_counter` by hand to make a row disappear.** The way to undo a wrong payment is to **void the payment** through the product (E-105, DOC-22 §6). Any other repair is a code or data change written, reviewed and recorded by an engineer (§4), never an `UPDATE` typed at a prompt.

## Symptoms and impact

- **`LedgerInvariantViolation`:** the gauge `ledger_invariant_violations` is above 0 after the 03:00 run (building time). It is the number of violating rows over the 19 queries of DOC-22 §12 (a demo building is excluded). Residents may see nothing wrong; what is at stake is that a receipt, a debt figure or a total is no longer true.
- **`InvariantCheckStale`:** the job did not succeed for 36 hours. The check is **blind**, which is as serious as a finding. See "The check did not run" below.
- **The three outside corruptions** (a membership with two owners, a member of a removed account, a notice stuck `sending`) are not in this gauge. They raise `IntegrityFindings` (Warning) from `integrity_weekly` and `integrity_notices`, and §3 explains what to do with them.

Who is affected: any unit whose charges or payments appear in the rows. Severity is **critical** because money is involved; it is not an outage, so nothing is stopped unless §2 step 4 says so.

## Checks

Run from the staging or production host as the operator, with the **read-only role** (it cannot change anything). Set the building once; every query filters on it.

```bash
psql "host=127.0.0.1 dbname=rms user=rms_readonly"    # the password is in the operator's ~/.pgpass (DOC-70 §9.1)
```

```sql
SELECT id AS b FROM building.building WHERE is_demo = false ORDER BY created_at LIMIT 1 \gset
\echo :b   -- the building id; every query below uses :'b'
```

If the host has more than one building, set `:b` to the building named in the alert's log lines (`invariant_check` writes `buildingId` and the query tag).

**Step 1: which queries fired, and how many rows.** The log of the last run has the tag and the first 50 rows; the job row has the count:

```sql
SELECT started_at, finished_at, status, details
  FROM building.job_run
 WHERE name = 'invariant_check'
 ORDER BY started_at DESC LIMIT 3;
```

```bash
docker compose logs --since 24h worker | grep '"job":"invariant_check"' | grep -v '"violations":0'
```

**Step 2: list the offending rows of each query that fired.** Each block below is one query of DOC-22 §12 with the columns an operator needs. *Run on 2026-11-01* on `postgres:18.6` against the DDL of DOC-15: all 19 run without error, return 0 rows on a clean fixture and return rows for the corruption they are named for (EXP-11 K01…K19). They are read-only and can be run again at any time; a row that disappears between two runs means a later action changed it.

```sql
-- Q01 a paid charge whose live allocation has another amount (I-1)
SELECT c.id, c.unit_code, c.amount AS charge, a.amount AS allocation, a.payment_id
  FROM finance.charge c JOIN finance.allocation a ON a.charge_id = c.id AND a.status = 'live'
 WHERE c.building_id = :'b' AND c.status = 'paid' AND a.amount <> c.amount;

-- Q02 a live allocation whose payment is not posted (I-2)
SELECT a.id, a.charge_id, a.amount, p.id AS payment_id, p.status AS payment_status
  FROM finance.allocation a JOIN finance.payment p ON p.id = a.payment_id
 WHERE a.building_id = :'b' AND a.status = 'live' AND p.status <> 'posted';

-- Q03 a live allocation on a void charge (I-2)
SELECT a.id, c.id AS charge_id, c.unit_code, c.void_kind, c.voided_at, a.payment_id
  FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id
 WHERE a.building_id = :'b' AND a.status = 'live' AND c.status = 'void';

-- Q04 a charge with two live allocations (I-1)
SELECT a.charge_id, count(*) AS live, array_agg(a.payment_id) AS payments
  FROM finance.allocation a
 WHERE a.building_id = :'b' AND a.status = 'live' GROUP BY a.charge_id HAVING count(*) > 1;

-- Q05 receipts do not match the counter (I-5): per month, the counter and the count of numbers
SELECT d.period, d.last AS counter, count(r.id) AS receipts, max(substr(r.number, 9)::int) AS highest
  FROM finance.document_counter d
  LEFT JOIN finance.receipt r ON r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period
 WHERE d.building_id = :'b' AND d.series = 'receipt'
 GROUP BY d.period, d.last HAVING d.last <> count(r.id);

-- Q06 two receipts for one allocation (I-4)
SELECT allocation_id, count(*) AS receipts, array_agg(number ORDER BY number) AS numbers
  FROM finance.receipt WHERE building_id = :'b' GROUP BY allocation_id HAVING count(*) > 1;

-- Q07 an issued receipt of a void allocation (I-4)
SELECT r.id, r.number, a.id AS allocation_id, a.voided_at
  FROM finance.receipt r JOIN finance.allocation a ON a.id = r.allocation_id
 WHERE r.building_id = :'b' AND r.status = 'issued' AND a.status = 'void';

-- Q08 a posted payment that differs from the sum of its live allocations (I-3)
SELECT p.id, p.unit_id, p.source, p.amount AS payment,
       coalesce(sum(a.amount) FILTER (WHERE a.status = 'live'), 0) AS allocations
  FROM finance.payment p LEFT JOIN finance.allocation a ON a.payment_id = p.id
 WHERE p.building_id = :'b' AND p.status = 'posted'
 GROUP BY p.id HAVING p.amount <> coalesce(sum(a.amount) FILTER (WHERE a.status = 'live'), 0);

-- Q09 a posted log row without a posted payment (I-6)
SELECT g.id, g.reference, g.amount, g.payment_id, g.received_at
  FROM finance.gateway_event g
 WHERE g.building_id = :'b' AND g.outcome = 'posted'
   AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = g.payment_id AND p.status = 'posted');

-- Q10 an allocation whose charge is of another unit than its payment (I-2)
SELECT a.id, p.unit_id AS payment_unit, c.unit_id AS charge_unit, c.unit_code
  FROM finance.allocation a JOIN finance.payment p ON p.id = a.payment_id JOIN finance.charge c ON c.id = a.charge_id
 WHERE a.building_id = :'b' AND p.unit_id <> c.unit_id;

-- Q11 a paid intent without a posted payment (I-6)
SELECT i.id, i.code, i.status, i.amount, i.paid_at
  FROM finance.payment_intent i
 WHERE i.building_id = :'b' AND i.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.intent_id = i.id AND p.status = 'posted');

-- Q12 an online payment without a paid intent (I-6)
SELECT p.id, p.unit_id, p.amount, p.gateway_reference, p.intent_id
  FROM finance.payment p
 WHERE p.building_id = :'b' AND p.source = 'online'
   AND NOT EXISTS (SELECT 1 FROM finance.payment_intent i WHERE i.id = p.intent_id AND i.status = 'paid');

-- Q13 two active intents on one charge (I-7)
SELECT it.charge_id, count(*) AS active, array_agg(it.intent_id) AS intents
  FROM finance.payment_intent_item it
 WHERE it.building_id = :'b' AND it.released_at IS NULL GROUP BY it.charge_id HAVING count(*) > 1;

-- Q14 a paid charge without a live allocation (I-1)
SELECT c.id, c.unit_code, c.amount, c.updated_at
  FROM finance.charge c
 WHERE c.building_id = :'b' AND c.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM finance.allocation a WHERE a.charge_id = c.id AND a.status = 'live');

-- Q15 a live allocation on a draft or open charge (I-2)
SELECT a.id, c.id AS charge_id, c.status, c.unit_code, a.payment_id
  FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id
 WHERE a.building_id = :'b' AND a.status = 'live' AND c.status IN ('draft', 'open');

-- Q16 the counter is below the highest issued number (I-5)
SELECT d.period, d.last AS counter,
       (SELECT max(substr(r.number, 9)::int) FROM finance.receipt r
         WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period) AS highest
  FROM finance.document_counter d
 WHERE d.building_id = :'b' AND d.series = 'receipt'
   AND d.last < (SELECT coalesce(max(substr(r.number, 9)::int), 0) FROM finance.receipt r
                  WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period);

-- Q17 a live allocation without an issued receipt (I-4)
SELECT a.id, a.charge_id, a.payment_id, a.amount
  FROM finance.allocation a
 WHERE a.building_id = :'b' AND a.status = 'live'
   AND NOT EXISTS (SELECT 1 FROM finance.receipt r WHERE r.allocation_id = a.id AND r.status = 'issued');

-- Q18 an open or paid charge that differs from the sum of its lines (I-8)
SELECT c.id, c.unit_code, c.amount AS charge, coalesce(sum(l.amount), 0) AS lines
  FROM finance.charge c LEFT JOIN finance.charge_line l ON l.charge_id = c.id
 WHERE c.building_id = :'b' AND c.status IN ('open', 'paid')
 GROUP BY c.id HAVING c.amount <> coalesce(sum(l.amount), 0);

-- Q19 a committed log row that is still pending (I-8)
SELECT g.id, g.reference, g.amount, g.received_at, g.intent_id
  FROM finance.gateway_event g WHERE g.building_id = :'b' AND g.outcome = 'pending';
```

**Step 3: read the story of one row.** For a charge `:c` and its unit, the sequence of actions that touched it (the audit row is the control, DR-24):

```sql
SELECT at, action, actor_kind, actor_id, reason, changes, details
  FROM audit.audit_log
 WHERE building_id = :'b' AND (object_id = :'c' OR details->>'chargeId' = :'c')
 ORDER BY at;
```

## Remediation

Work in this order. Steps 1 to 3 change nothing.

1. **Confirm, do not assume.** Run step 2 above for the queries that fired. A row that was there at 03:00 may be gone: if every query is now empty, it was a transient state that a later action settled; record that in the incident note and go to "Confirm it is resolved". If a row is still there, it is real.
2. **Classify by the invariant, then by the cause.** One corruption usually fires several queries (EXP-11 lists the sets, e.g. a second live allocation fires Q04, Q08, Q10 and Q17). Treat the **lowest-numbered invariant** that fired (I-1 first) as the cause and the others as its shadows.
3. **Collect the evidence** for the engineer, before anything changes: the output of step 2 (CSV through `\copy … TO` into `/var/lib/rms/incidents/<date>/`), the audit rows of step 3 for each row, the worker log lines of the run, the version of the running image (`/var/lib/rms/deploy-state`), and whether a deploy, a restore or a manual database access happened in the last 24 hours.
4. **Stop the bleeding only if the count grows.** Run step 2 again 15 minutes later. If the number of rows grew and no one is repairing, the write path is still producing the state: set maintenance (`ops/deploy/maintenance.sh on "ledger invariant, RB-01"`); every process then answers 503 `maintenance`, the money log keeps nothing new, and the gateway retries its webhooks (they are 503 and are retried, DOC-42 §6). Clear it with `off` when the engineer says the cause is fixed. Do not use maintenance for a stable count: a frozen system is not a repair.
5. **Repair by the product wherever the product has the action.**

| Situation | The repair | Who |
| --- | --- | --- |
| A manual payment (cash or bank transfer) is wrong or its charges are in a bad state (Q01, Q08, Q14, Q15, Q17 on a manual payment) | **Void the payment**: `POST /staff/payments/{id}/void` with a reason that cites this incident (E-105, DOC-22 §6). The charges return to `open`, the receipts become `void` (their numbers stay), then the Manager records the payment again if the money was received | Manager or Admin, with the operator watching |
| An online payment is wrong (Q02, Q08, Q11, Q12 on `source = 'online'`) | An online payment cannot be voided (`payment_not_voidable`, DR-24). The money is real. An engineer reviews it: the fix is a reviewed data change (below), and the transfer is never moved to another charge or unit (FR-09.8) | Engineer |
| A charge voided with a live allocation (Q03) | Never "unvoid". The payment is real money for a charge that no longer exists: it is the case of a recalled charge that was paid, which the design makes impossible (EXP-04). Engineer, code review first | Engineer |
| The counter or the numbers (Q05, Q16) | A gap or a counter below the highest number is repaired only by an engineer, with the audit row and the receipts at hand; **numbers already issued are never changed or reused** (DOC-22 §7) | Engineer |
| A pending log row (Q19) | The transaction that wrote it was interrupted in a way the design forbids (a commit between steps 2 and 3 of `settle()`). The row's `reference` is the gateway's: the engineer replays `settle()` for it through the supported command, after reading the gateway for the transfer | Engineer |
| A charge differs from its lines (Q18) | The trigger that keeps them equal was bypassed. Engineer | Engineer |

6. **A data repair, when there is no product action**, is a migration-style change: a SQL file in a pull request (`fix(db): …`), reviewed by a second person, applied in a transaction with `RETURNING` counts that match what the review expected, and an audit row written by the same file (`details` = the incident, the ids, the before and after). It is **never** run from an interactive prompt, never edits `charge.status` to hide a row, and never deletes a receipt, an allocation or a log row. A repair that deletes evidence is not a repair.
7. **Tell the Owner** the number of units affected and whether any resident saw a wrong figure. A resident who paid and is shown as owing is told through the Manager, outside the system.

**The three outside corruptions.** `integrity_weekly` and `integrity_notices` log findings with a `kind` (DR-321). `membership_two_owners`: the Manager transfers ownership in the product (DOC-27), which closes one membership; `member_of_removed_account`: remove the membership from the unit page; `notice_stuck_sending`: the worker was killed during the fan-out, restart the worker and the job resumes (EXP-06); if it does not, an engineer. These are Warnings: they do not use maintenance.

## The check did not run (`InvariantCheckStale`)

```sql
SELECT started_at, finished_at, status, details
  FROM building.job_run WHERE name = 'invariant_check' ORDER BY started_at DESC LIMIT 5;
```

1. The job never started: the worker is down or the scheduler is stuck. Check `docker compose ps worker`, then RB-04 (outbox lag) for the worker, and the metric `job_last_success_timestamp{job_name="invariant_check"}`.
2. The job started and failed: the reason is in `details` and in the worker log. A `statement_timeout` means a query got slow on a large building: run the union of DOC-22 §12 by hand, once, as `rms_readonly` with `SET statement_timeout = 0` and `EXPLAIN (ANALYZE, BUFFERS)`, and give the plan to the engineer.
3. Run the job again only after the cause is fixed: `jobs:run` (`bun run --filter @app/api jobs:run -- --name invariant_check`, DOC-38 §7) runs it once, now, under the same job lock, and writes a `job_run` row with `details.manual = true`.
4. Until the check runs, run step 2 of "Checks" by hand once a day.

## On staging

- The data is not real money: a violation on staging is still a **bug** and the evidence of §Remediation 3 is collected the same way, but the repair is `bun run db:reset` after the evidence is kept, and the cause is found before the next deploy.
- EXP-11 runs on staging (DOC-100); a violation there is the injected one, in a clone, and does not reach this runbook.
- The alert goes to the mailbox of the staging inbox and Mailpit locally (DOC-40), not to a pager.

## Confirm it is resolved

1. Every query of step 2 returns 0 rows for the building.
2. Run the job now (`jobs:run -- --name invariant_check`, as in "The check did not run") and check that the gauge is 0: `curl -s localhost:3001/metrics | grep '^ledger_invariant_violations'` returns `0`.
3. The alert clears after the next scrape and the 03:00 run of the next day shows no new row.
4. The incident note has: the queries, the row counts, the cause, the repair (the void of a payment, or the pull request), the audit row id, and the date of the next clean run.

## Prevention and follow-up

- Every violation gets a **test**: the case that produced it becomes an `LG-` test (DOC-22 §16) before the repair is merged, so the same state cannot come back unseen.
- A violation that the write path should have prevented is a defect in `ChargeAllocator` or its callers: the race tests (LG-14…LG-19) and EXP-03 and EXP-04 are re-run, and the experiment's set of five is repeated on the fixed commit (DOC-89 §10).
- A violation after a restore is expected until the post-restore reconciliation of DR-66 has run: RB-10 describes it, and this check is one of its steps.
- If the cause was a manual database access, the access is reviewed: the roles of DOC-19 give an operator no write rights on the `finance` schema, so a write means a superuser session; it is written in the incident note and the Owner is told.
- Add the query that fired to the follow-up list of the weekly review until three clean weeks have passed.

## Required tests

A runbook has no test prefix of its own: it is exercised in the restore drill and in a yearly walkthrough. Its queries are the text of DOC-22 §12 in a form an operator can read, and the corruptions that fire them are injected by EXP-11 (K01…K19); the rule "no hand edit" is backed by `LG-60` (the guard triggers refuse a direct `UPDATE` of a payment, an allocation and a receipt) and by the grants of DOC-19 (GRT-): `rms_readonly` is read-only (`default_transaction_read_only`).

## Open questions

None. DR-322 (the read-only role, maintenance only for a growing count, the rule against hand edits, the evidence before a repair) is decided under the Owner's delegation. The `job:run` command and the `building.job_run` columns used above are built by P2-11 and P1-05; this document's commands are the contract they meet.
