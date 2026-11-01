# RB-02: Payments are stuck

> Status: **Draft** · Updated: 2026-11-01 (P2-20: first version, DR-325) · DOC-76 / RB-02
>
> Alert: `PaymentsStuck` (critical, for 2m) and `GatewayErrors` (warning, for 5m) · Dashboard: RMS · Worker and jobs; Overview · Related: DOC-23 §8, DOC-24 §4.5
> Depends on: [DOC-23](../../06-design/payment-intents-and-settlement.md), [DOC-24](../../06-design/payment-gateway-drivers.md), [DOC-22](../../06-design/ledger-and-allocation.md) §9, [DOC-40](../../06-design/observability.md), [DOC-19](../../05-data/db-roles-and-grants.md) (`rms_readonly`), [DR](../../00-decision-register.md) (DR-28, 30, 31, 32, 33, 84, 325, 326, 327)
> Main readers: the operator on call, P2-28 (the alerts and this drill)

**The rule.** A payment is never "fixed" by editing a table. A stuck payment is settled by the system's own paths: the webhook, the re-query, the cancel (DOC-23). The operator restores those paths and, at most, brings a check forward or cancels an intent through the product.

## Symptoms and impact

- **`PaymentsStuck`:** at least one intent is `pending` past its window without moving to `expired` (`payment_intents_pending_overdue` > 0), or more than 5 are `creating` for over 2 minutes (`payment_intents_creating_stale`). Residents see "Đang chờ thanh toán" for too long; payers may have paid and not been posted.
- **`GatewayErrors`:** more than half of the provider calls failed in 10 minutes (`payment_gateway_requests_total`). New payments fail to start (502 `gateway_unavailable`) and re-queries back off.
- Impact is on residents trying to pay; nothing already posted is affected. Treat a payer who paid and is not posted as the urgent case.

## Checks

Connect with the read-only role and set the building as in RB-01:

```bash
psql "host=127.0.0.1 dbname=rms user=rms_readonly"
```

```sql
SELECT id AS b FROM building.building WHERE is_demo = false ORDER BY created_at LIMIT 1 \gset
```

**1. Which intents are stuck.**

```sql
SELECT code, status, amount, created_at, display_until, expires_at, next_check_at, last_checked_at, check_count, check_failures
  FROM finance.payment_intent
 WHERE building_id = :'b'
   AND ((status = 'pending' AND expires_at < now())
     OR (status = 'creating' AND created_at < now() - interval '2 minutes'))
 ORDER BY created_at;
```

**2. Is the re-query job alive.**

```sql
SELECT started_at, finished_at, status, details
  FROM building.job_run WHERE name = 'intent_requery' ORDER BY started_at DESC LIMIT 5;
```

```bash
curl -s localhost:3001/metrics | grep -E '^(payment_intents_pending_overdue|payment_intents_creating_stale|payment_gateway_requests_total)'
```

**3. Is the provider reachable.** In the web CMS, `W-Gateway` → "Kiểm tra kết nối" (E-51). A failure there is RB-13.

**4. Did money arrive and not post.** Open `W-Transactions` (the tab "Tiền cần kiểm tra") and, for a payer who says they paid, look for the intent code; or ask the payer for the Stripe receipt number and check it in the provider's dashboard against the intent's `link_id`:

```sql
SELECT code, link_id, status, paid_at, gateway_reference FROM finance.payment_intent
 WHERE building_id = :'b' AND code = 'TT-261019-0001';
```

## Remediation

1. **The worker is down or the job does not run.** `docker compose ps worker`; start it. If it is up and the last `job_run` is old, run the job once: `bun run --filter @app/api jobs:run -- --name intent_requery` (DOC-38 §7). The next tick re-queries every due intent, and a paid one is settled by `settle()` as for a webhook.
2. **The provider is failing (`GatewayErrors`).** Do nothing to the intents: they back off by themselves (30 s, 60 s, 2 min, 5 min). Follow RB-13. Tell residents through the Manager if it lasts more than 15 minutes.
3. **One intent is stuck and the payer says they paid.** In `W-Transactions` press "Truy vấn lại" (E-186). If the provider says paid, the intent is settled within seconds. If the provider says not paid, ask the payer to open the payment page again from the app; do not mark anything paid by hand.
4. **A `creating` intent is stuck.** The job's `getStatus` decides after 2 minutes: found → `pending`, absent → `failed` and the charges are released. If the job cannot run, a Manager cancels the intent (E-175) so the household can pay again.
5. **The payer paid but the intent expired.** A late exact confirmation is posted (DR-281). If it is not, it is in the money log (`W-Money-Log`, RB-11).
6. **A payment is real but the system cannot post it** (the provider confirms it, the system refuses it for a reason in the log): record it by hand as a manual payment (cash or bank transfer, E-104) only after the Manager has refunded or accepted it outside; the log row stays and is reviewed with a note. Never `UPDATE` a table.

## On staging

A staging intent is paid with the `fake` driver or a Stripe sandbox card; "stuck" usually means the worker is not running or `pay:sim` was not used. Restart the worker; no resident is waiting.

## Confirm it is resolved

1. The query of check 1 returns no row.
2. The gauges `payment_intents_pending_overdue` and `payment_intents_creating_stale` are 0.
3. The alert clears after the next scrape; the last `job_run` of `intent_requery` is `succeeded`.
4. Every payer who reported a payment has a receipt, or a log row with a reviewed note.

## Prevention and follow-up

- A stuck state with no external cause is a defect: add an `IN-` test (DOC-23 §16) before the fix is merged.
- If the worker went down, check RB-04 for the outbox backlog as well.
- A provider outage is recorded for the go-live review (DOC-103).
