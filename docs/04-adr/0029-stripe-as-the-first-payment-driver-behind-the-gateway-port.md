# ADR-0029: Take the first online payments through Stripe Checkout, behind a provider-neutral gateway port

- Status: Accepted
- Date: 2026-11-01 · Related: DR-325, DR-326, DR-327, ADR-0007, ADR-0008, DR-25, DR-26, DR-84, FR-07…10, NFR-01, NFR-02, EXP-01, EXP-02

## Context

ADR-0007 chose a payOS payment link per intent (a bank-transfer QR) behind a `PaymentGateway` port, and stayed `Proposed` because no payOS sandbox exists and the facts of DR-25 are unverified. The Owner now wants online payment in P2, easy to test, with a card entered once, saved, and used again, and says the choice of provider is temporary: VNPay or VietQR may replace it (DR-325). The money rules do not change: a charge is paid whole or not at all (DR-84), one `settle()` posts every confirmation, and a confirmation is either a payment or a money-log row (ADR-0008).

## Options considered

1. **A: Stripe hosted Checkout Sessions (`mode: payment`).** The resident is sent to a Stripe-hosted page, enters or picks a saved card, and returns by a deep link. Stripe handles 3-D Secure, declines and saved cards. No card data reaches the API or the app, and the Expo apps need no native SDK. A sandbox is free and needs no contract. Cons: Stripe is a foreign processor; the page is Stripe's look, not Hiên's; VND support and its limits must be confirmed in the sandbox.
2. **B: Stripe PaymentIntent with the native Payment Sheet.** A native form inside the app. Needs the Stripe React Native module in both Expo apps, more screens of our own, and the same webhooks. Rejected for now: more code for a temporary provider, and Stripe prefers Checkout for on-session payment.
3. **C: payOS payment link (ADR-0007).** A bank-transfer QR with exact amount. Stays the likely second driver. Not first: nothing can be tested against it today.
4. **D: Store our own card tokens and charge off-session.** Autopay. Rejected: no requirement, and it would put a card-on-file risk on a building system.

## Decision

Option **A**, behind the port of ADR-0007 generalised so that the shape of the provider's flow is data, not code.

- **Port:** `PaymentGateway` with `capabilities`, `createSession`, `getStatus`, `cancel`, `verifyWebhook` and optional `listSavedMethods`, `removeSavedMethod`. `createSession` returns a **presentation**: `redirect` (a URL: Stripe, VNPay) or `qr` (a payload and a receiving account: VietQR, payOS). The resident app renders by presentation type and never by provider name.
- **Settlement is untouched.** Every driver turns its own event into the same confirmation `{provider, reference, orderCode, amount, currency, paidAt}`; `settle()`, the intent states, the hold rule and the money log (ADR-0008, DR-29) do not change. A driver adds a file in `infrastructure`, a `provider` word, a configuration field list and its test vectors, and no migration.
- **Stripe specifics** (DOC-24): one Checkout Session per intent; `client_reference_id` is the `order_code`; confirmation on `checkout.session.completed` / `async_payment_succeeded` with `payment_status = paid`; the reference is the PaymentIntent id; the re-query is a session retrieve, the cancel is `expire`; one Stripe Customer per resident account for saved cards; no automatic charge; no personal data sent; amounts in `vnd`, a zero-decimal currency.
- **Bank-transfer-only concepts stay in the design** for the drivers that need them (short, over, unmatched transfers; statement reconciliation) and are never reached by a card payment.
- **`fake` stays** the driver of tests, the demo and staging; production refuses a non-demo `fake` configuration (DR-26, DR-60).

## Consequences

**Positive**

- Payment can be built and tested end to end now, in the Stripe sandbox and with `fake`, with no bank and no merchant contract.
- No card data is handled by us (hosted page), which keeps the PCI scope to the lightest form and keeps ADR-0022 (personal data) simple.
- A second provider costs one driver and its tests; the screens, the intent and `settle()` do not change.

**Negative**

- A temporary provider means a later migration of the gateway configuration and of any saved cards (they cannot move between providers; residents enter a card again).
- Stripe fees and its availability for a Vietnamese building are the Owner's to confirm before go-live (DR-325); DOC-103 lists it.
- A redirect leaves the app: the return is a deep link, never trusted, and the app polls our intent status.
- Refunds and disputes happen at Stripe, outside the ledger: DR-327 (proposed) turns them into review rows.
