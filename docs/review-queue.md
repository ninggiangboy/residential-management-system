# Review queue

> Status: **Working file** · Updated: 2026-10-21 (Owner answers of 2026-10-21 applied: DR-96, 91, 92, 68, E-169, DOC-69 dry run, DOC-71 review rule, Owner inputs; earlier: DR-01…08, DR-10…81 decisions applied; DR-57, DR-17, DR-42 applied) · Not a project document: delete after the decisions are applied to `00-decision-register.md` and `00-master-plan.md`

How it works: while the Owner reviews, each answer is one line here. The register and master plan are edited later, per cluster, in one pass (`docs-master-plan apply-decisions`). Order of review is by importance (money, security, access first).

## Already applied to the register and master plan

| DR | Decision | Applied |
| --- | --- | --- |
| DR-84 | Charge paid in full or not at all; no partial payment, no credit; mismatched money is a log with review (note, once) | 2026-10-18 |
| DR-14, 15, 16, 13, 17, 18, 19, 23, 24, 28, 29, 31, 32, 35, 42, 72, 73, 78 | Reworded to follow DR-84 | 2026-10-18 |
| DR-32 | Accepted as proposed: `gateway_event` takes only authenticated confirmations, failures go to `webhook_rejection`; if the gateway documentation or sandbox gives payOS IPs, a call from an unknown IP is logged, never blocked, the HMAC being the only gate (sentence in DR-32 and DR-39) | 2026-10-18 |
| DR-84 item 8, DR-72 | Accepted: an intent stays `pending` on a transfer of another amount; `unmatchedTransfer {amount, receivedAt}`; "The management office will check" ("to confirm" removed) | 2026-10-18 |
| DR-29 | Accepted: an exact-amount confirmation for an `expired`, `cancelled` or `cancelling` intent with all charges `open` is posted | 2026-10-18 |
| DR-36, 37, 38, 39, 33 | Accepted with three changes: step-up for sensitive staff actions (password plus a 6-digit emailed code, 10 minutes, single use, every Admin notified; reuses `identity.password_token` with kind `step_up`, endpoint `POST /staff/step-up`); `resident_account.is_demo` with the fixed OTP only for flagged accounts and the production boot guard (also DR-60); same-site, cross-origin cookie wording in DR-38 | 2026-10-18 |
| DR-09 | Accepted as proposed | 2026-10-18 |
| DR-57 | Accepted plus: `actor_kind = 'system'` for webhook/re-query settlement; one `pii.read` row per export with the record count; retention periods to be confirmed in P0-06, ledger tables never deleted | 2026-10-18 |
| DR-84, 16, 23, 35 | Confirmed: the system logs all incoming money; only an exact amount is posted; wrong amounts are never matched to another charge or period | 2026-10-18 |
| DR-19, DR-20, DR-73, DR-42, DR-53 | **Void a single open charge** added (Manager/Admin, reason of at least 5 characters, audited, no live allocation; intents holding it cancelled as a whole; corrected charge in a new batch; `POST /staff/charges/{id}/void`, `finance.charge_voided.v1`, `fee.charge_voided`). The refund note on a payment is not added | 2026-10-18 |
| DR-19 / DR-13 / DR-22 / DR-17 / DR-18 | Decided (Owner, 2026-10-19): **the negative adjustment line is kept** (offset a paid overcharge in a later batch, discounts and waivers, reason on the bill); `charge_line.kind`, its CHECK, the Kind column of the fee template and the report item stay unchanged. Adjustments are entered by the Manager by hand and never created, suggested or pre-filled from the money log; void of a single charge and manual payment are independent of the log (sentence in DR-19, DR-20, DR-16, DR-84 item 5). DR-19 title: "Correcting a wrong charge: void a single open charge, or offset with an adjustment line" | 2026-10-19 |
| DR-57 | Accepted unchanged (the 2026-10-18 wording stays: `actor_kind = 'system'`, one `pii.read` row per export, retention periods confirmed in P0-06, ledger tables never deleted) | 2026-10-19 |
| DR-01 and all spikes | **Spikes dropped** ("the project does not need spikes, remove them all"): S-01…S-09 and tasks P0-08…P0-16 removed (identifiers kept in the master plan table "Dropped spikes"); each question absorbed into the task that needs it; 🔬 marker removed. DR-01 keeps the pinning rules, Dependabot rule and the Expo fallback; the compatibility table is filled in P1-01/P1-02 | 2026-10-19 |
| DR-02 | Vendor (copy) confirmed, plus rename: `kit-*` → `core-*`, `@kit/*` → `@core/*`, `packages/KIT_VERSION` → `packages/CORE_VERSION`, `chore(core): sync <sha>`, ADR-0003 "Vendor the core packages; manual sync"; mapping table in DOC-12 | 2026-10-19 |
| DR-03, DR-04 | Accepted as proposed (DR-04 with the `@core/*` scope) | 2026-10-19 |
| DR-05, DR-06, DR-07 | Owner: "as you see fit". Rewritten by Claude (delegated) to the DR-83 topology; "Superseded" boxes merged; sizes of DR-06 and the NFR-03 restatement kept; webhook URL provider-neutral | 2026-10-19 |
| DR-08 | Kept as is for now, to be revisited later (marked `Decided (Owner, 2026-10-19), to be revisited`) | 2026-10-19 |
| DR-10, 11, 12 | Accepted as proposed (receipt number stays gapless) | 2026-10-19 |
| DR-33 | Accepted with one change: store the provider secrets as **one** AES-256-GCM encrypted JSON blob `secrets_enc` (`v1:<keyId>:<iv>:<ciphertext+tag>`), whose fields each driver defines (payOS: client id, API key, checksum key; VietQR: its own set), instead of three fixed columns. API still returns masked values; changing the configuration or receiving account needs step-up | 2026-10-19 |
| DR-20 | Accepted: (1) "close" = manual Manager freeze for reporting only, charges stay payable, a closed batch cannot be recalled, no automatic close; (2) due-date extension is the only edit of a published batch, later date only, audited, residents notified; (3) publish notification goes to active owner, family and tenants of a charged unit, not to helpers; (4) re-issue creates a new draft with `replaces_batch_id` copying charges and lines, `fee_month` and `due_date` editable; (5) publish needs >= 1 charge, every charge total > 0, `due_date >= buildingToday`; (6) the void-single-charge action is already in DR-20 | 2026-10-19 |
| DR-18 | Accepted as proposed | 2026-10-19 |
| DR-21 | Option B: validate the Excel file **synchronously in the API** (still stored in `import_job` as the preview for the commit step); drop the `validating` state, the outbox command `<module>.import_requested.v1`, the `import.progress` SSE event and the polling fallback; keep 5 MB and 5,000 rows; move to the worker later only if measurements demand it | 2026-10-19 |
| DR-22 | Accepted as proposed (Kind column kept) | 2026-10-19 |
| DR-40 | Accepted with changes: **no limit** on the number of memberships or helpers per unit (drop the 10 and 3); the per-day invitation SMS cap of an owner stays as an abuse and cost guard unless the Owner says otherwise; ownership transfer removes all other members **by default**, Manager can untick it per transfer ("keep members") | 2026-10-19 |
| DR-40 / DR-17 / DR-72 | **Option B** for history: a resident always sees open (unpaid) charges of the unit (debt follows the unit) and sees paid history, receipts and payer names only from the start of their own membership; Manager and Admin see everything. One date filter on `membership.created_at` | 2026-10-19 |
| DR-41, 43, 44, 45, 46, 47 | Accepted as proposed (UI wording for "ticket" is "Yêu cầu") | 2026-10-19 |
| DR-48 | Accepted as proposed with option A: Guards see the owner's phone **masked** with a Call button (`tel:`), every view logged (`access.lookup_log`); NFR-14 reworded as in DR-48 | 2026-10-19 |
| DR-49, 50, 51, 52 | Accepted as proposed | 2026-10-19 |
| DR-53 | Accepted as proposed, with one correction by Claude: remove the template key `payment.short` (no short payment is posted, DR-84); the resident sees the mismatch only in the app (`unmatchedTransfer`), no push | 2026-10-19 |
| DR-54 | Option B: no stored `effective_visibility`; the effective readers of a page are its own `visibility_override`, else the nearest ancestor folder's `visibility` (depth <= 5), computed at read time with one recursive query; drop the subtree recompute; search filters through the same expression. Other points as proposed. Clean the stray text "plus `table`? no" | 2026-10-19 |
| DR-59 | The cooling-off before an approved deletion is executed is a **building setting** (`accountDeletionDays`, default 30), to be confirmed by the legal dossier P0-06 (P0-06 stays; only the spike tasks P0-08…P0-16 were removed) | 2026-10-19 |
| DR-55, 56, 58, 60, 61 | Accepted as proposed; DR-61 wording cleaned (title "presigned PUT", no SeaweedFS, no draft notes about HEIC) | 2026-10-19 |
| DR-63 | Option B: no Jaeger and no traces in phase 1 (request ids in logs are enough); keep Prometheus + Alertmanager + Grafana + Loki; collect logs with **Grafana Alloy** because Promtail reached end of life on 2026-03-02 (verified 2026-10-18 on the Grafana blog); alerts by email and Telegram; drop the OTLP trace export and the Jaeger memory from DR-06 and DOC-40/70 | 2026-10-19 |
| DR-66 | Accepted as in DR-83 (pgBackRest to R2, weekly `pg_dump` as portable copy); **no second off-Cloudflare copy** (Owner declined); clean the "managed PostgreSQL" wording | 2026-10-19 |
| DR-62, 64, 65, 67, 68 | Accepted as proposed; DR-62 drops the `import_requested` override (DR-21 B) and, as written by the Owner, `import_purge`: applied as keeping the `import_purge` job without the outbox command, because the 30-day file retention and expired `import_job` rows still need a purge; DR-67 wording cleaned; DR-68: the Owner or client picks the SMS and mail providers before P1-10 | 2026-10-19 |
| DR-69, 70, 71, 72, 73, 74, 75 | Accepted as proposed; DR-72: "restrict `W-Gateway` to payOS" becomes "to the chosen provider"; DR-75: drop the `import.progress` event (DR-21 B); DR-73 already updated by earlier passes | 2026-10-19 |
| DR-76, 78 | Accepted as proposed | 2026-10-19 |
| DR-77 | Accepted with one change: coverage targets are **warnings only** in CI for every module (no build failure); results still reported | 2026-10-19 |
| DR-79 | Accepted, plus two added requirements: **FR-49** void a single open charge (DR-19/20) and **FR-50** step-up for sensitive staff actions (DR-39); FR range becomes FR-01…50 | 2026-10-19 |
| DR-80 | Accepted; NFR-12 measures from the accepted request to the response carrying the validated preview (DR-21 B), not to a worker state | 2026-10-19 |
| DR-81 | Accepted; the member type "family" stays **separate** from "tenant" (Owner: keep them apart even if they look alike); update the other rows to the decided DRs (owner transfer DR-40, closed batch DR-20, ticket deadlines DR-47 are decided) | 2026-10-19 |
| DR-17 (legal risk) | Owner answer: the management company issues an **e-invoice only when a resident asks for it** (the resident raises a request/ticket); the system does **not** manage e-invoices: no invoice number, no invoice table, no integration. The receipt stays "Biên lai thu tiền, not a tax invoice" | 2026-10-19 |
| DR-17, DR-42 | Accepted as proposed: one receipt per allocation (per charge); `ResidencyApi.getMembership` DTO also returns `startedAt` for the history rule of DR-40 | 2026-10-19 |
| DR-17 / DR-13 / DR-42 (e-invoice readiness) | Accepted (Owner): (1) the receipt snapshot stays complete (lines, quantities, unit prices, amounts, payer); (2) add nullable `finance.receipt.external_invoice jsonb` ({provider, number, issuedAt, url}); (3) add event `finance.receipt_issued.v1`, one per receipt, as the integration seam. No VAT fields, no buyer tax details, no invoice table, no provider port now (decided at integration time by a new migration). **No** extra ticket type: residents ask for an e-invoice with the existing type "Khác" | 2026-10-19 |
| DR-96, DR-91, DR-92 | Accepted as proposed (Owner, 2026-10-21): DR-96 `unmatchedTransfer` for `amount_short`, `amount_over`, `charge_already_paid`, `charge_recalled`; DR-91 no Manager-created payment link (F-PAY-05 "Not built"); DR-92 no pinned library favorites (F-WIK-09 "Not built"). DOC-04, DOC-05, DOC-03 FR-09.1/09.3/09.5, DOC-51 E-86, DOC-68, glossary, ADR-0005 updated; DOC-23 and DOC-58 are written from the DR | 2026-10-21 |
| DR-68 | The SMS provider and the SMTP relay are not chosen yet: ports `SmsSender` and `Mailer` with the `console` and `allowlist` drivers and Mailpit first; real adapters in P1-22 when the Owner picks. P1-10 no longer waits; P1-22 and M1 do. Master plan (P1-10, P1-22, S-06, risk, M1), DOC-01, DOC-11, DOC-26, DOC-41, DOC-70 row 10 and EXP-09 updated | 2026-10-21 |
| `GET /staff/imports` | Built as E-169 (new DR-226): catalog E-01…E-169, tests IM-42, IM-43, `W-Import` recent-imports table (UIWR-41, UIWR-42, `status.import.*`), counts in the master plan, README, DOC-50, DOC-39, DOC-88 and EXP-10 (74 routes first version, 169 final) | 2026-10-21 |
| DOC-69 dry run | As proposed (new DR-227): M0 approval does not wait for the dry run; it is the acceptance of P1-03 (master plan P0-31 and P1-03, DOC-69 open question and §13 check 1) | 2026-10-21 |
| CI review rule (DOC-71 §11.1) | Owner: "up to you, other people may join the repository later": DR-166 kept (note added to the DR), the DOC-71 open question closed | 2026-10-21 |
| Owner inputs (DOC-70 §2) | New DR-228: documents hold placeholders, a real value is supplied only when the task that needs it starts; DOC-70 §2 gets the column "Blocking?" for the 15 inputs; the owner-input open questions of DOC-70, DOC-73, DOC-41 and DOC-40 cite DR-228; the stale open question about booting without the database removed from DOC-70 (DOC-38 §5.1, DR-161) | 2026-10-21 |

## Decided, not yet applied

None.

## Deferred (waiting for an input from the Owner)

| DR | Waiting for | Notes |
| --- | --- | --- |
| DR-25 (gateway sandbox) | Owner will report when a gateway **sandbox** is available (a client dependency, not a spike: the spikes were dropped on 2026-10-19) | Docs read 2026-10-18 at `api.vietqr.vn` (VietQR Open API Banking, a different provider from payOS): see "VietQR findings" below. Whether VietQR replaces payOS or is a second driver behind `PaymentGateway` is open |
| DR-26, 27, 28, 30, 31, 35 | DR-25 | Written for payOS; revisit when the provider is fixed |

### VietQR findings (api.vietqr.vn, read 2026-10-18; to verify in the sandbox)

- Sandbox exists: `dev.vietqr.org`; `POST /vqr/bank/api/test/transaction-callback` simulates a paid transaction to our callback. Production `api.vietqr.org`. Go-live needs acceptance and a contract.
- Our calls: `POST /vqr/api/token_generate` (Basic auth, token valid 300 s) then `POST /vqr/api/qr/generate-customer` (`qrType` 0 dynamic needs `amount` and `orderId` ≤ 13 chars; `content` ≤ 23 chars, unaccented). Response has `qrCode`, `qrLink`, `transactionId`, `transactionRefId`. No payment link, no cancel call, QR expiry not stated.
- Callback to us: `POST <our host>/bank/api/transaction-sync` with `Authorization: Bearer <token>`; the token is issued by **our own** Get Token endpoint that VietQR calls. Body: `bankaccount, amount, transType (C/D), content, transactionid, transactiontime (ms epoch), referencenumber, orderId, terminalCode?, subTerminalCode?, serviceCode?, urlLink?, sign?`. `sign` is optional and its algorithm is not documented. Expected answer 200 `{error:false, object:{reftransactionid}}`; 400 `{error:true,...}`.
- Retry: up to 10; 5 in the first minute then 1 per minute; stop on success or on an error code outside the agreed retry list. Dedup advice: use `referencenumber`.
- Re-query (host-to-client product): `POST /api/ecommerce-transactions/check-order`, by `orderId` or `referenceNumber`, status 0 awaiting, 1 paid, 2 expired, `checkSum = MD5(bankAccount + username)`. Unclear whether it is available to the callback product.
- Not documented: amount mismatch behavior, payer editing the amount, fee, rate limits, IP list, callback signature.

## Open questions

| DR | Question | Proposal |
| --- | --- | --- |

## Review order (provisional)

1. ~~DR-84/14 allocation~~ done · 2. DR-29/32 webhook (Q above pending) · 3. DR-25 payOS unknowns · 4. DR-36…39 identity, tokens, OTP · 5. DR-09 time zone · 6. ~~DR-57 audit~~ done · 7. ~~DR-19 overcharge correction~~ done · 8. ~~DR-01…08 platform and repository~~ done (2026-10-19)

## Not yet reviewed

- DR-25, 26, 27, 28, 30, 31, 34, 35 are deferred with the gateway sandbox and the bank statement sample (see Deferred)
