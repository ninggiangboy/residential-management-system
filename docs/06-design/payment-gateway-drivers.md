# Payment gateway port and drivers

> Status: **Draft** · Updated: 2026-11-01 (P2-21: first version; Stripe first, DR-325, DR-326, DR-327; ADR-0029) · DOC-24
> Depends on: original SDD §6, [DR](../00-decision-register.md) (DR-16, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 84, 96, 325, 326, 327), [ADR-0007](../04-adr/0007-payment-gateway-port-and-payment-link.md), [ADR-0008](../04-adr/0008-settlement-idempotency.md), [ADR-0029](../04-adr/0029-stripe-as-the-first-payment-driver-behind-the-gateway-port.md), [DOC-23](payment-intents-and-settlement.md) §3, §4, §6, §8, [DOC-15](../05-data/finance-model.md) §6, [DOC-22](ledger-and-allocation.md) §9, [DOC-12](../03-architecture/code-architecture.md) §4.5, [DOC-39](security.md), [DOC-41](configuration-reference.md), [DOC-42](error-handling.md)
> Main readers: P2-21 (port, drivers, simulator), P2-22…P2-24 (intents, webhook, re-query), P2-29 (end to end on staging), the writer of any later driver (VNPay, VietQR, payOS), DOC-52 (webhook contract), DOC-67 (`W-Gateway`)

This document is the contract between the payment code of `finance` and a payment provider. It defines the provider-neutral **port**, says exactly how the **Stripe** driver and the **fake** driver fill it, and gives the **checklist for a new driver** (VNPay, VietQR, payOS) so that adding one changes no screen, no intent state and not `settle()`. What happens to a confirmation after it is normalised (the intent, the hold, the money log) is DOC-23 and ADR-0008; the screens are DOC-58 and DOC-67.

**Draft, and unverified where it says so.** Nothing here has been run against Stripe yet. §4.12 lists the Stripe facts that P2-21 checks in a Stripe sandbox before the driver is accepted; a wrong answer changes §4 and DR-326, not the port.

## 1. Why a port, and what it hides

The provider differs in four ways that the rest of the system must not see:

| Difference | Stripe (card, hosted page) | VietQR / payOS (bank transfer) | VNPay (redirect) |
| --- | --- | --- | --- |
| What the resident sees | A hosted page, then a deep link back | A QR and a transfer content | A hosted page, then a return URL |
| How the amount can go wrong | It cannot: the card is charged the exact amount | Short, over, late, wrong account | It cannot, as for a card |
| What identifies a transaction | The PaymentIntent id behind the session | A transaction reference | A transaction number |
| Who holds saved payment methods | The provider (a Customer) | No | Provider token, if used |

Everything above becomes **data of the driver** (its `capabilities`, its presentation) and the rest stays: an intent holds charges, a confirmation is posted or logged by `settle()`.

## 2. The port

```ts
// modules/finance/src/application/ports/payment-gateway.ts
export interface PaymentGateway {
  readonly provider: string                       // 'stripe' | 'fake' | later 'payos' | 'vnpay'
  readonly capabilities: GatewayCapabilities

  createSession(input: CreateSessionInput): Promise<PaymentSession>
  getStatus(ref: SessionRef): Promise<GatewayStatus>
  cancel(ref: SessionRef, reason: CancelReason): Promise<CancelResult>
  verifyWebhook(raw: Uint8Array, headers: Headers, secrets: GatewaySecrets): VerifiedWebhook   // throws SignatureError

  listSavedMethods?(customer: CustomerRef): Promise<SavedMethod[]>        // only if capabilities.savedMethods
  removeSavedMethod?(customer: CustomerRef, methodId: string): Promise<void>
}

export interface GatewayCapabilities {
  presentations: ('redirect' | 'qr')[]            // what createSession may return
  savedMethods: boolean                           // listSavedMethods / removeSavedMethod exist
  exactAmountOnly: boolean                        // true for cards: short and over cannot happen
  limits: { min: number; max: number }            // in đồng; from configuration, not hard-coded
  sessionTtl: { min: number; max: number }        // seconds a session may live
  refunds: 'none' | 'external'                    // 'external': done at the provider, reported by webhook
}

export interface CreateSessionInput {
  intentId: string; buildingId: string
  orderCode: number                               // finance.order_code_seq (DR-27)
  code: string                                    // TT-YYMMDD-NNNN
  amount: number                                  // đồng, whole number
  description: string                             // shown to the resident
  expiresAt: Date                                 // display_until
  returnUrl: string; cancelUrl: string            // deep links of the resident app
  customer?: CustomerRef                          // when the driver has saved methods
  locale: 'vi' | 'en'
  idempotencyKey: string                          // the intent id: a retry returns the same session
}

export type PaymentSession = {
  sessionId: string                               // stored as payment_intent.link_id
  expiresAt: Date
  presentation:
    | { type: 'redirect'; url: string }                                                // stored as checkout_url
    | { type: 'qr'; payload: string; receiving: { bin: string; bankName: string; accountNumber: string; accountName: string } }   // qr_payload, receiving
}

export type GatewayStatus =
  | { state: 'open' }                                                                  // can still be paid
  | { state: 'paid'; confirmation: Confirmation }
  | { state: 'expired' | 'cancelled' | 'unknown' }                                     // 'unknown': the provider has no such session

export interface Confirmation {                   // what settle() receives (DOC-23 §6)
  provider: string
  reference: string                               // unique per provider transaction: (provider, reference) is the idempotency key
  orderCode: number
  amount: number                                  // đồng
  currency: 'VND'
  paidAt: Date
  source: 'webhook' | 'requery' | 'cancel' | 'statement'
}
```

Rules of the port:

1. **It carries no provider type.** A driver maps its own objects to these and nothing else leaves `infrastructure`. A screen asks for `presentation.type`, never for `provider`.
2. **`createSession` is idempotent by `idempotencyKey`.** A retry after a timeout returns the same session (DOC-23 §4.5 treats a timed-out call as unknown and asks `getStatus`).
3. **`verifyWebhook` reads the raw bytes.** The route passes the unparsed body (DR-32): a re-serialised body breaks a signature.
4. **A driver makes no network call inside a database transaction** (DOC-12, DR-31). The use case calls the port after commit and records the answer in a second short transaction.
5. **A driver never decides a business outcome.** It returns what the provider says; `settle()` decides `posted`, `duplicate_transfer`, `charge_already_paid` and the rest.
6. **Errors** are three typed ones: `GatewayUnavailable` (timeout, 5xx, rate limit: retried by the caller), `GatewayRejected` (a 4xx that will not change: the intent becomes `failed`), `SignatureError` (a webhook that does not verify: logged in `webhook_rejection`, DR-32).

## 3. How an intent maps to each driver

| Intent field (DOC-15 §6.1) | Stripe | fake | VietQR / payOS (later) |
| --- | --- | --- | --- |
| `provider` | `stripe` | `fake` | `payos` |
| `link_id` | Checkout Session id `cs_…` | row id | `paymentLinkId` |
| `checkout_url` | `session.url` | local page `/dev/pay/{id}` | payment page, if any |
| `qr_payload`, `receiving` | null | null | EMVCo string, account snapshot |
| `gateway_reference` | PaymentIntent id `pi_…` | generated | `data.reference` |
| `display_until` | `expires_at` of the session | same | `expiredAt` |
| `order_code` | `client_reference_id` | same | `orderCode` |

`ck_payment_intent_provider` becomes a pattern (`provider ~ '^[a-z][a-z0-9]{2,15}$'`), so a driver needs no migration (DR-326 item 7).

## 4. The Stripe driver

### 4.1 Objects used

| Stripe object | Used for | Not used |
| --- | --- | --- |
| Checkout Session, `mode: payment`, `ui_mode: hosted` | The payment page, one per intent | Payment Links, Invoices, Subscriptions, Billing |
| PaymentIntent (created by the session) | The `reference` of a transaction; read through the session | Creating PaymentIntents ourselves; the Charges API |
| Customer | One per resident account, for saved cards | Names, phones, e-mails (§4.9) |
| PaymentMethod | Listing and removing a saved card | Creating a card from our side; card data never reaches the API |
| Webhook endpoint | The events of §4.4 | Polling as the only path |

The client is a `StripeClient` instance built per gateway configuration (never the global key). No call passes `payment_method_types` (dynamic payment methods, managed in the Stripe Dashboard). The API version is pinned in the client (DOC-11: `2026-09-30.endive` on 2026-11-01, re-checked when the dependency is installed).

### 4.2 Create the session

Called after the intent row is committed (DOC-23 §4.5). Example for the intent of DOC-23 §6.3 (`TT-261019-0001`, 2,838,000 đ); a sample, not recorded from a real call:

```http
POST /v1/checkout/sessions
Idempotency-Key: 0192f3c4-8a10-7000-8000-000000000a01        # the intent id
Stripe-Version: 2026-09-30.endive

mode=payment
client_reference_id=2610153                                   # order_code
customer=cus_…                                                 # created on first use, §4.7
line_items[0][price_data][currency]=vnd
line_items[0][price_data][unit_amount]=2838000                 # VND is zero-decimal: the amount is the đồng
line_items[0][price_data][product_data][name]=Phí 2 khoản, căn A-1508
line_items[0][quantity]=1
expires_at=1792543200                                          # display_until (Unix seconds)
success_url=rms-resident://pay/return?intent=0192…&result=success
cancel_url=rms-resident://pay/return?intent=0192…&result=cancel
locale=vi
saved_payment_method_options[payment_method_save]=enabled     # shows "save this card"
metadata[intentId]=0192f3c4-…   metadata[buildingId]=0192f3c4-…   metadata[code]=TT-261019-0001
payment_intent_data[metadata][intentId]=0192f3c4-…
payment_intent_data[description]=TT-261019-0001
integration_identifier=rms-fees-kqtdhvzm                       # API ≥ 2026-03-25, a suffix of 8 random letters
```

The answer is mapped to `PaymentSession`: `sessionId = id`, `expiresAt = expires_at`, `presentation = {type: 'redirect', url}`. Stripe's `success_url` is not trusted: the app returns to `Pay-Redirect`, which polls our own intent status (E-86). The URLs are deep links of the resident app, one scheme per environment (DOC-55 §7).

### 4.3 What the resident does

1. `Pay-Select` creates the intent (E-85) and receives `presentation.url`.
2. The app opens the URL in the system browser tab (`expo-web-browser`), shows `Pay-Redirect`, and polls E-86 every 2 s (then 3 s, DOC-58).
3. On the hosted page the resident picks a saved card or enters a new one, may tick "save this card", and confirms; Stripe runs 3-D Secure if the issuer asks.
4. Stripe redirects to the deep link; the app closes the tab. The money is settled by the webhook, not by the return: if the deep link is lost, polling still moves the screen.

### 4.4 The webhook

One endpoint per gateway configuration: `POST /api/v1/payments/webhooks/stripe/{gatewayConfigId}` (E-117). The signing secret is the endpoint's (`whsec_…`), kept in the encrypted blob (§4.12).

| Step | Rule |
| --- | --- |
| Size and content | The raw body is read once, at most 256 KB; the route keeps the bytes |
| Signature | `StripeClient.webhooks.constructEvent(raw, header['stripe-signature'], secret)` with the default tolerance of 5 minutes. A failure is `SignatureError`: 401, one `webhook_rejection` row, nothing else (DR-32) |
| Idempotency | The event id is recorded in the inbox (`stripe:<evt_…>`); a repeat is 200 and nothing |
| Answer | 200 after commit (FR-08.6); 503 on a database error so that Stripe retries |

| Event | Meaning | What the driver returns to the route |
| --- | --- | --- |
| `checkout.session.completed` | The payer finished the page | If `payment_status = paid`: a `Confirmation`; if `unpaid` (a delayed method): ignored, waiting for the next event |
| `checkout.session.async_payment_succeeded` | A delayed method was paid | A `Confirmation` |
| `checkout.session.async_payment_failed` | A delayed method failed | A `failed` signal; the intent stays `pending` until its window ends |
| `checkout.session.expired` | The session was not paid in time | An `expired` signal: the intent follows DOC-23 §8 |
| `charge.refunded`, `charge.dispute.created` | Money returned or contested at Stripe | A money-log row (§4.10, DR-327, proposed) |
| any other | | 200 and ignored (never an error: Stripe adds events) |

A `Confirmation` is built from the session expanded with its `payment_intent`: `reference = payment_intent.id`, `orderCode = client_reference_id`, `amount = amount_total`, `currency = 'VND'`, `paidAt` = the charge's `created`, `source = 'webhook'`. The route resolves the building from `gatewayConfigId` and calls `settle()`; an `orderCode` that belongs to another building is `foreign_building` (DOC-23 §6.1 step 1).

### 4.5 Status (the re-query)

`getStatus` retrieves the session (`checkout.sessions.retrieve`, expanding `payment_intent.latest_charge`):

| Session | `GatewayStatus` |
| --- | --- |
| `status = open` | `open` |
| `status = complete` and `payment_status = paid` | `paid` with a `Confirmation` (`source: requery`) |
| `status = complete` and `payment_status = unpaid` | `open` (a delayed method in flight) |
| `status = expired` | `expired` |
| 404 `resource_missing` | `unknown` |

The job of DOC-23 §8 runs it. A `paid` answer calls the same `settle()` as the webhook; whichever arrives second is `already_processed`.

### 4.6 Cancel

`cancel` calls `checkout.sessions.expire`. Stripe answers 400 for a session that is not `open` (already complete or expired): the driver then runs `getStatus` and returns `{ ok: false, state }`, so a payment that won the race is settled, not lost (DR-31). An expired session cannot be paid, so after a successful cancel no late payment exists for it.

### 4.7 Saved cards

- **Customer.** One Stripe Customer per resident account, created at the first payment: `customers.create({ metadata: { accountId } })`, and recorded in `finance.payment_customer (account_id, provider, provider_customer_id, created_at)` (unique on `(account_id, provider)`). The Customer has no name, phone or e-mail (§4.9).
- **Saving.** The session sets `customer` and `saved_payment_method_options.payment_method_save = enabled`; the resident ticks the box on the hosted page. Without the tick nothing is saved.
- **Paying again.** The next session of the same Customer shows the saved cards on the page; the resident picks one and confirms (and passes 3-D Secure if asked). **There is no automatic or off-session charge** (DR-326 item 5).
- **Listing and removing.** `listSavedMethods` returns `{id, brand, last4, expMonth, expYear}` from `paymentMethods.list({ customer, type: 'card' })`; `removeSavedMethod` calls `paymentMethods.detach`. Nothing about a card is stored on our side. The screen is `Cards` (DOC-58, E-184, E-185).
- **Whose cards.** A card belongs to the account that saved it. A tenant with `can_pay` sees only their own cards; the owner never sees a tenant's.
- **Account deletion.** The deletion job deletes the Stripe Customer (`customers.del`) with the account (DOC-35 §10.1); a failure retries and alerts.

### 4.8 Amounts and currency

VND is a zero-decimal currency at Stripe: `unit_amount` is the number of đồng, with no multiplication. The intent amount is the sum of whole charges (DR-84), so the session amount equals the intent amount; the confirmation is `amount_total`. A confirmation whose amount differs from the intent's is `amount_short` or `amount_over` in `settle()` as for any driver; with Stripe it can only come from a bug or from a session edited at Stripe, and the metric `payment_amount_mismatch_total` makes it visible. The driver's limits are `capabilities.limits` from the configuration (§4.12), not constants: the default minimum is DR-28's 2,000 đ and the real Stripe minimum for VND is checked in the sandbox.

### 4.9 What is sent to Stripe

The session and the Customer carry: the intent id, the building id, the intent code, the order code, the amount and a product line "Phí {n} khoản, căn {unit}". They carry **no** name, phone number, e-mail, ID number or member type. The page may ask the payer for an e-mail for the Stripe receipt; the session turns Stripe's receipt e-mail off (the receipt is ours, `BL-…`). The card data is entered on Stripe's page and never reaches our API, logs or database (PCI scope: the hosted page, SAQ A). Stripe's own data stays at Stripe; DOC-103 lists the cross-border review (DR-83).

### 4.10 Refunds and disputes (DR-327, proposed)

Refunds and disputes happen in the Stripe Dashboard. The driver reports `charge.refunded` and `charge.dispute.created`; the route writes a `gateway_event` row with outcome `refunded` or `disputed`, keyed `(stripe, re_… / dp_…)`, linked to the payment through the PaymentIntent id, open in the money log. **Nothing else changes**: the charge stays `paid` and the receipt valid until the Manager acts. Until DR-327 is decided, the Manager cannot void an online payment (DR-24) and the row is the only trace. The system never refunds through the API (`capabilities.refunds = 'external'`).

### 4.11 Timeouts, retries, rate limits

| Call | Timeout | Retry |
| --- | --- | --- |
| `checkout.sessions.create` | 10 s (DOC-23 §4.5) | The SDK retries on connection errors with the same idempotency key; a timeout is `unknown` and the caller asks `getStatus`, never creates twice |
| `retrieve`, `expire`, `list`, `detach` | 10 s | Backoff 30 s, 60 s, 2 min, 5 min (DOC-23 §8.1); at most 5 provider calls at once per building |
| Stripe 429 | | `GatewayUnavailable`; the backoff above |

### 4.12 Configuration and the unverified facts

**Fields of the encrypted blob** (`gateway_config.secrets_enc`, DR-33), for `driver = stripe`:

| Field | Meaning | Mask shown |
| --- | --- | --- |
| `restrictedKey` | A restricted API key (`rk_…`), with only: Checkout Sessions (write), Customers (write), PaymentMethods (read, write), PaymentIntents (read), Charges (read) | `••••` + last 4 |
| `webhookSecret` | The signing secret of the endpoint (`whsec_…`) | `••••` + last 4 |
| `mode` | `test` or `live`, read from the key prefix on save (never typed) | shown |

Non-secret fields: `limits.min`, `limits.max` (đồng), `statementDescriptor` (not used in v1). `receiving_account` is null. "Check connection" (E-51) calls `balance.retrieve` and the webhook check calls `webhookEndpoints.list`, both side-effect free; the screen warns when `mode = test` in a non-demo production building.

**To verify in a Stripe sandbox in P2-21** (the driver is not accepted before; the answer goes into this section):

| # | Fact assumed | If it is wrong |
| --- | --- | --- |
| 1 | `vnd` is accepted as a card currency on a sandbox account, as a zero-decimal amount | The driver is blocked; the Owner is told. Fallback: the sandbox account's country, or `fake` until a VND-capable account exists |
| 2 | The minimum amount for `vnd` and the maximum | `capabilities.limits` and DR-28 change |
| 3 | A session can live from 30 minutes to 24 hours (`expires_at`) | `display_until` and `expires_at` of DR-28 follow |
| 4 | `payment_status = paid` arrives on `checkout.session.completed` for a card | §4.4 already handles `unpaid` |
| 5 | `saved_payment_method_options` works with `ui_mode: hosted` and `customer` for `vnd` | Saved cards move to a SetupIntent step |
| 6 | The session's `payment_intent` is expandable and its id is stable | The reference becomes the charge id |
| 7 | `locale: vi` is supported | The page is in English |
| 8 | Webhook retry schedule and the 3-day window of Stripe | The re-query covers a longer gap |

### 4.13 Test mode

Tests use a **sandbox** created for development (`stripe sandbox create`), separate for local and for CI, never the shared test mode, with test cards (`4242 4242 4242 4242` success, a decline card, a 3-D Secure card). `stripe listen --forward-to` delivers webhooks to a local API. Contract tests replay the events recorded in the sandbox as fixtures against `verifyWebhook` (signature vectors included).

## 5. The fake driver

`fake` implements the port without a network (DR-26, ADR-0026).

- `createSession` stores the session in `finance.fake_gateway_session` and returns `{type: 'redirect', url}` to a local page (`/dev/pay/{id}`, served only in `local` and `staging`) with three buttons: pay, decline, let it expire. With `presentation: 'qr'` in the configuration it returns a fake QR instead, to test the `Pay-VietQR` screen.
- `getStatus` reads the row; `cancel` sets it `cancelled`; `listSavedMethods` returns a stored list, to test `Cards`.
- **Simulator:** `bun run pay:sim` signs a payload with the configured secret and posts it to the real webhook route: `--repeat`, `--shuffle`, `--delay`, `--wrong-signature`, `--amount`, `--event`. It works for `fake` and, with a Stripe test signing secret, for `stripe`.
- Allowed only for a building with `is_demo = true`, in `local` and `staging`; production refuses to boot with a non-demo `fake` configuration (DR-26, DR-60).

## 6. Adding a driver (VNPay, VietQR, payOS)

A new driver is finished when every line below is done and no other file needs a change.

| Step | Where | What |
| --- | --- | --- |
| 1 | `modules/finance/src/infrastructure/gateways/<name>/` | Implement `PaymentGateway`; declare `capabilities` truthfully |
| 2 | the same | Map the provider's objects to `PaymentSession` (a `redirect` or a `qr`), `GatewayStatus` and `Confirmation`; choose the `reference` that is unique per provider transaction |
| 3 | the same | `verifyWebhook` over the raw bytes; document the algorithm and give test vectors |
| 4 | DOC-24 | A section like §4: objects, session, webhook events, status mapping, cancel, limits, secret fields, unverified facts |
| 5 | `gateway_config` | The field list of the blob; no column |
| 6 | the registry | One line in the driver table of the composition root, keyed by the `provider` word |
| 7 | DOC-52 | The webhook contract: path, headers, signed sample, test payload |
| 8 | tests | The `PX-` contract tests (§9) with fixtures recorded in the provider's sandbox |
| 9 | DOC-58 | Only if `capabilities.presentations` has a type the app cannot render (never for `redirect` and `qr`) |
| 10 | DOC-103 | The go-live line: contract, fees, data residency |

**What must not change:** `settle()`, the intent states, the hold index, the money-log outcomes, the screens `Pay-Select`, `Pay-Redirect`, `Pay-VietQR`, `Pay-Done`, the web screens, and the order code sequence. A driver whose flow needs one of them to change is a design question for a DR, not a reason to edit them silently.

**Bank-transfer drivers** add three things the card driver does not need: the transfer content (DR-27), the outcomes `amount_short`, `amount_over` and the `unmatchedTransfer` field of E-86, and the statement path (DOC-25). They are already in DOC-22, DOC-23 and DOC-58 and are reached only when `capabilities.exactAmountOnly = false`.

## 7. The webhook route and the rejection log

The route is shared (E-117): `POST /api/v1/payments/webhooks/{provider}/{gatewayConfigId}`. It is the only route that knows the driver, through the registry; it loads the configuration, decrypts the secrets, calls `verifyWebhook`, builds a `Confirmation` or a signal, and calls `settle()` or the expiry/refund writers of DOC-23. A failed verification is 401, writes one `webhook_rejection` row (provider, configuration, reason, source IP, a hash of the body; no body) and nothing else; more than three rejections in ten minutes raise the alert of DR-32.

## 8. Configuration, metrics, logs

| Key / metric | Meaning |
| --- | --- |
| `PAYMENTS_RETURN_SCHEME_RESIDENT` | The deep-link scheme the session returns to (per environment) |
| `PAYMENT_CLIENT_TIMEOUT_MS` | 10,000 (DOC-23 §4.5) |
| `payment_gateway_requests_total{provider, op, outcome}` | Calls to the provider by operation and outcome |
| `payment_webhook_received_total{provider, outcome}` | `verified`, `rejected`, `ignored`, `duplicate` |
| `payment_amount_mismatch_total{provider}` | A confirmation whose amount differs from its intent (§4.8) |
| `payment_saved_methods_total{op}` | `list`, `remove`, `error` |

The names are added to DOC-40 §4 and DOC-41 in the same change as the code (DR-233 rules); logs carry the provider, the operation, the intent code and the provider's request id, never a key, a secret or a card detail.

## 9. Required tests

Prefix `PX-` (payment gateway drivers; formerly "payOS adapter", renamed by DR-326; master plan §0.2; DOC-88 indexes it).

| ID | Scenario | Expected |
| --- | --- | --- |
| PX-01 | `verifyWebhook` for Stripe with the recorded vectors: a valid signature; a wrong secret; a body changed by one byte; a timestamp older than 5 minutes | Verified; `SignatureError` for the other three |
| PX-02 | `checkout.session.completed` with `payment_status = paid` | One `Confirmation`: `reference = pi_…`, `orderCode`, `amount`, `currency VND`, `source webhook` |
| PX-03 | `checkout.session.completed` with `payment_status = unpaid`, then `async_payment_succeeded` | No confirmation, then one |
| PX-04 | The same event delivered 5 times, in order and shuffled | One payment (inbox and `(provider, reference)`); the rest 200 |
| PX-05 | `checkout.session.expired` | The `expired` signal; the intent follows DOC-23 §8 |
| PX-06 | `getStatus` for open, complete+paid, complete+unpaid, expired and a 404 session | `open`, `paid`, `open`, `expired`, `unknown` |
| PX-07 | `cancel` of an open session; of a session paid a moment earlier | `ok`; `{ ok: false, state: paid }` and the payment is settled |
| PX-08 | `createSession` called twice with one idempotency key after a timeout | One session |
| PX-09 | The request body of `createSession` for the intent of §4.2 | The parameters of §4.2: no `payment_method_types`, `vnd` whole amount, `client_reference_id`, the metadata, the return URLs, no name, phone or e-mail |
| PX-10 | A saved-card flow with the fake driver: first payment creates the Customer; `listSavedMethods`; `removeSavedMethod`; a second account | One `payment_customer` per account; the list shows brand and last four only; the other account sees none |
| PX-11 | `charge.refunded` for a posted payment | A `gateway_event` row `refunded`, open in the money log; the charge stays `paid` (DR-327) |
| PX-12 | A confirmation whose amount differs from the intent's | `settle()` answers `amount_short` or `amount_over`; `payment_amount_mismatch_total` + 1 |
| PX-13 | A webhook for a configuration of another building; a wrong provider path | `foreign_building` and 400; 404 |
| PX-14 | The registry with a driver that declares `presentations: ['qr']` | The intent stores `qr_payload` and `receiving`; the status endpoint returns a `qr` presentation |
| PX-15 | Production boot with a non-demo `fake` configuration | The process refuses to start |
| PX-16 | `bun run pay:sim --repeat 5 --shuffle` against a local API | One payment, "duplicates blocked: 4" |

## 10. Decisions made while writing

Recorded as DR-326 and DR-327 (the register has them in full).

## 11. Not in this document

| Topic | Lives in |
| --- | --- |
| The intent, the hold, `settle()`, the re-query job, the cancel handler | DOC-23 |
| The money log and the ledger | DOC-22 |
| The screens a resident sees | DOC-58 |
| The configuration screen | DOC-67 `W-Gateway` |
| The webhook contract summary and the signed samples | DOC-52 |
| The statement path | DOC-25 |
| Why Stripe, and the rejected options | ADR-0029 |

## 12. Traceability

| Section | Decision | Requirements and checks |
| --- | --- | --- |
| §2 port | ADR-0007, ADR-0029, DR-326 | NFR-01; `PX-14` |
| §4.2…4.6 Stripe flow | DR-326, DR-28, DR-30, DR-31 | FR-07, FR-08, FR-10; `PX-02…08` |
| §4.4 webhook | DR-32 | FR-08.5, FR-08.6; `PX-01`, `PX-04`, `PX-13` |
| §4.7 saved cards | DR-325, DR-326 | `PX-10` |
| §4.10 refunds | DR-327 | `PX-11` |
| §5 fake driver | DR-26, DR-60 | `PX-15`, `PX-16` |
| §6 new driver | ADR-0029 | `PX-14` |

## Open questions

1. **DR-327** (proposed): may the Manager void an online payment that was fully refunded at Stripe? Until decided, a refund is a review row only.
2. The Stripe facts of §4.12, above all VND support and its minimum. They are verified in the sandbox by P2-21, not by a decision.
