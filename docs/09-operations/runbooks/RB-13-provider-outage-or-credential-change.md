# RB-13: The payment provider is down, or its credentials changed

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-02) · Updated: 2026-11-02 (P2-00 review: the alert is `GatewayCheckFailing`; staging and `gateway_in_use` corrected) · 2026-11-01 (P2-20: first version, DR-325, DR-326) · DOC-87 / RB-13
>
> Alert: `GatewayCheckFailing` (warning, for 1h, DOC-40 §5.3; built with the check job). `GatewayErrors` (RB-02) usually fires with it · Dashboard: RMS · Overview · Related: DOC-24 §4.11, §4.12, DOC-67 `W-Gateway`, RB-02, RB-03, RB-12
> Depends on: [DOC-23](../../06-design/payment-intents-and-settlement.md), [DOC-24](../../06-design/payment-gateway-drivers.md), [DOC-22](../../06-design/ledger-and-allocation.md) §9, [DOC-40](../../06-design/observability.md), [DOC-19](../../05-data/db-roles-and-grants.md) (`rms_readonly`), [DR](../../00-decision-register.md) (DR-28, 30, 31, 32, 33, 84, 325, 326, 327)
> Main readers: the Admin and the operator, P2-28

## Symptoms and impact

Either the provider (Stripe today) is failing or slow, or our key no longer works because it was rotated, revoked or restricted differently. New payments fail to start (502 `gateway_unavailable`), re-queries and cancels back off, and `W-Gateway` "Kiểm tra kết nối" fails. Payments already posted are unaffected. A payer who is already on the provider's page may still pay: the webhook or the re-query posts it once the path is back.

## Checks

1. **Is it the provider?** Open the provider's status page. If it reports an incident, it is the provider's; go to Remediation 1.
2. **Is it our credentials?** `W-Gateway` → "Kiểm tra kết nối". "Khóa không hợp lệ" means the restricted key was revoked, rotated or lacks a permission; a timeout means the provider or the network.
3. **How wide is it.**

```bash
curl -s localhost:3001/metrics | grep -E '^payment_gateway_requests_total'
```

```bash
docker compose logs --since 30m api worker | grep -E '"provider":"stripe"' | grep -E '"outcome":"(timeout|http_error|rejected)"' | tail -20
```

## Remediation

1. **The provider is down.** Do not change anything. Intents back off and resume; webhooks retry on the provider's side; the re-query settles whatever was paid meanwhile. Tell the Manager; if it lasts more than 30 minutes, the Manager tells residents that cash at the office works. The Admin may disable the gateway on `W-Gateway` ("Tắt cổng") so that residents see the office caption instead of failing buttons; re-enable it afterwards.
2. **The restricted key was rotated or revoked.** In the provider's dashboard create or copy the current restricted key with the permissions of DOC-24 §4.12 (Checkout Sessions write, Customers write, PaymentMethods read and write, PaymentIntents read, Charges read). In `W-Gateway` replace "Khóa API hạn chế" (a step-up is asked) and save. Changing only the key does not ask for open payments to end (E-50: `gateway_in_use` is for a change of driver, receiving account or status). Press "Kiểm tra kết nối".
3. **A permission is missing.** The check names the call that failed (for example `customers.create`); add the permission to the restricted key at the provider, then check again.
4. **The webhook secret changed.** That is RB-03.
5. **The account was suspended or restricted by the provider.** Residents cannot pay online. Disable the gateway, tell the Manager, and contact the provider. Nothing in the system is edited.
6. **Keys rotated on schedule.** The encryption keys of the settings blob are RB-12; a provider credential is changed through `W-Gateway` only.

## On staging

Use a Stripe **sandbox** key and the sandbox webhook secret; `W-Gateway` shows the `mode` read from the key; a live key on staging would take real money, so never save one there (DOC-24 §4.12 warns only about a test key in a production building). If the sandbox is reset, create a new restricted key and endpoint.

## Confirm it is resolved

1. "Kiểm tra kết nối" succeeds and shows the time.
2. `payment_gateway_requests_total{outcome="ok"}` rises with a test payment (a sandbox card on staging); `GatewayErrors` clears.
3. A payment made during the outage is posted or logged (RB-02, RB-11).
4. If the gateway was disabled, it is enabled again and a resident sees the pay buttons.

## Prevention and follow-up

- Give the restricted key only the permissions of DOC-24 §4.12 and record who rotated it and when.
- After an outage, review the intents that expired during it: a payment that landed on an expired intent is posted (DR-281), so there should be no loss.
- Record outages for the go-live review (DOC-103).
