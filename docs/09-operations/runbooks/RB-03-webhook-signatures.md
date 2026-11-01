# RB-03: Webhook calls are being rejected

> Status: **Draft** · Updated: 2026-11-01 (P2-20: first version, DR-325) · DOC-77 / RB-03
>
> Alert: `WebhookSignatures` (warning, more than 3 rejected calls in 10 minutes) · Dashboard: RMS · Overview · Related: DOC-24 §4.4, DOC-52 §12
> Depends on: [DOC-23](../../06-design/payment-intents-and-settlement.md), [DOC-24](../../06-design/payment-gateway-drivers.md), [DOC-22](../../06-design/ledger-and-allocation.md) §9, [DOC-40](../../06-design/observability.md), [DOC-19](../../05-data/db-roles-and-grants.md) (`rms_readonly`), [DR](../../00-decision-register.md) (DR-28, 30, 31, 32, 33, 84, 325, 326, 327)
> Main readers: the operator on call, P2-23, P2-28

## Symptoms and impact

More than three rows were written to `finance.webhook_rejection` in ten minutes. Two causes look alike: **the signing secret is wrong or was rotated** (genuine confirmations are being refused, so payments are not posted until the re-query catches them) and **someone is sending forged calls** (nothing is posted; the rows are noise but worth knowing). A forged call never blocks a genuine one (FR-08.5).

## Checks

Connect with the read-only role and set the building as in RB-01:

```bash
psql "host=127.0.0.1 dbname=rms user=rms_readonly"
```

```sql
SELECT id AS b FROM building.building WHERE is_demo = false ORDER BY created_at LIMIT 1 \gset
```

**1. What is being rejected, and why.**

```sql
SELECT date_trunc('minute', received_at) AS minute, reason, count(*) AS calls, count(DISTINCT ip) AS ips
  FROM finance.webhook_rejection
 WHERE building_id = :'b' AND received_at > now() - interval '1 hour'
 GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

The reasons are `bad_signature`, `bad_account` (the configuration is not the building's or not active), `malformed`, `unknown_config` and `foreign_building` (DR-32).

**2. From whom.**

```sql
SELECT ip, count(*) AS calls, min(received_at) AS first, max(received_at) AS last
  FROM finance.webhook_rejection
 WHERE building_id = :'b' AND received_at > now() - interval '1 hour'
 GROUP BY ip ORDER BY calls DESC LIMIT 10;
```

**3. Are genuine payments still posting.** If the provider's webhook is the source, `payment_webhook_received_total{outcome="verified"}` should keep rising; if it stopped, the secret is the likely cause. Check `W-Gateway` → "Kiểm tra kết nối" (it also tells whether the endpoint is registered).

## Remediation

1. **`bad_signature` from the provider's addresses and verified calls stopped.** The signing secret differs from the one the provider holds (rotated, or a different endpoint's secret). In the provider's dashboard open the webhook endpoint and copy its current signing secret; in `W-Gateway` replace "Khóa ký webhook" (a step-up is asked) and save. Press "Kiểm tra kết nối". Payments missed meanwhile are settled by the re-query within 6 minutes (FL-13), so there is no need to resend.
2. **`bad_signature` from unknown addresses and genuine calls still verify.** It is forged traffic. Do nothing to the configuration. If it is heavy, ask the Admin to add the source to the host firewall; the optional `WEBHOOK_KNOWN_IPS` only counts. Never switch signature checking off.
3. **`unknown_config` or `bad_account`.** The endpoint URL at the provider has a wrong configuration id (a copy of an old URL) or the gateway was disabled. Compare the URL on `W-Gateway` with the one registered at the provider and correct the provider's.
4. **`foreign_building`.** An order code of another building arrived at this endpoint: two buildings share a provider account, which this deployment does not do. Treat as a misconfiguration at the provider.
5. **`malformed`.** The body was not JSON or exceeded the size limit (256 KB); usually a probe. No action.

## On staging

Staging uses the Stripe test endpoint's secret or the `fake` driver's. After a redeploy that regenerated keys (`bun run keys:generate`), the signing secret in `W-Gateway` must be re-entered.

## Confirm it is resolved

1. `payment_webhook_received_total{outcome="verified"}` rises with a test payment, and the query of check 1 shows no new `bad_signature` from the provider's addresses.
2. The alert clears 10 minutes after the last rejection.
3. A payer whose payment fell in the gap has a receipt, or is settled by the next re-query.

## Prevention and follow-up

- A rotated secret is announced to the operator before it is rotated (RB-12 lists the keys).
- Keep the provider's webhook endpoint list in DOC-103 so a copy of an old URL is not mistaken for the current one.
