# Requirements

> Status: **Review** · Updated: 2026-10-19 · DOC-03
> Depends on: original SDD §3.3–§3.4, §5–§15, [DR](../00-decision-register.md) (DR-09…24, 28…32, 34…41, 43…51, 53…59, 62, 64, 66, 71, 74, 79, 80, 84), [DOC-01](vision-and-scope.md), [DOC-02](personas-and-journeys.md), [DOC-06](../02-glossary.md)
> Main readers: DOC-04, DOC-05, DOC-21…42 (every design document cites an FR), P0-19, every task `Pn-xx` (acceptance), `docs/10-testing` (test cases)

This document lists what the system must do (FR-01…50) and how well (NFR-01…14), each with acceptance criteria that a test can check. It holds no design: how a rule is built is in the design documents named in §4. Use cases are in DOC-04, features in DOC-05.

## 0. Conventions

- **IDs.** `FR-xx` is a requirement; `FR-xx.y` a sub-requirement with its own acceptance criteria. FR-01…40 keep the numbers of the original SDD. FR-41…50 are marked **(added)**: they came from decisions (DR-79). A number is never reused; a dropped item is struck through with the reason. There is no FR for ticket deadlines: they are phase 2 (DR-47).
- **Acceptance criteria** use **G**iven / **W**hen / **T**hen. Numbers are concrete (amounts in đồng, counts, seconds). Amounts in examples use the sample building. Dates use building time (DR-09).
- **Priority** is MoSCoW: **M** Must, **S** Should, **C** Could. Cut order (DOC-01 §8) removes C before S; an M is never cut.
- **Verification** names the cheapest check that proves the criterion: a test prefix (`LG-` ledger, `IN-` intents and settlement, `PX-` payOS adapter, `ST-` statement, `AU-` identity and sessions, `RM-` residency, `TK-` tickets, `QC-` QR, `VH-` vehicles, `NT-` notices and notifications, `WK-` library, `RP-` reports, `PD-` PDF, `AD-` audit and privacy, `BD-` building and demo, `FS-` files, `JB-` jobs, `IM-` imports), an experiment (`EXP-xx`), or Playwright/Maestro for UI. The test strategy (DOC-88) indexes the prefixes.
- **Error codes** (`allocation_mismatch`, `charge_changed`…) are the codes of DR-74. The status of an error not named there is fixed in DOC-50/DOC-42.
- **UI strings** are quoted exactly; their final wording is in DOC-68.
- **Money rule that every FR in §1 inherits:** a charge is paid in full or not at all (DR-84). No FR allows a partial payment, an advance payment or a credit.

### 0.1 Wording corrections to the original requirements

| Requirement | Correction | Source |
| --- | --- | --- |
| FR-03 | "Members of the unit who can see fees" are the active owner, family members and tenants of a charged unit; helpers are not notified | DR-20 |
| FR-19 | "Up to 5 photos and 1 video", not "or" | DR-43 |
| FR-22 | The resident sees the after photos and the result note once the ticket is closed | DR-45 |
| FR-09 | A confirmation is posted only for an exact amount and open charges; everything else is a log row | DR-84, DR-16 |
| FR-46, FR-47 | The money log has no credit meaning; review does not change the ledger | DR-16, DR-84 |
| NFR-02, 04, 10, 12 | Measurement points are fixed | DR-80 |
| NFR-11 | RPO ≤ 5 min instead of 24 h | DR-66 |
| NFR-14 | Guards see masked, logged phone numbers | DR-48 |

### 0.2 Requirements by area

| Area | Requirements |
| --- | --- |
| Fees and debt | FR-01…06, FR-12, FR-36, FR-44, FR-49 |
| Online payment and the money log | FR-07…11, FR-46, FR-47 |
| Identity, residency, privacy | FR-13…18, FR-39, FR-41, FR-45, FR-50 |
| Tickets | FR-19…24, FR-42 |
| QR and vehicles | FR-25, FR-26, FR-30, FR-31, FR-43 |
| Notices and notifications | FR-27…29 |
| Library, reports, system | FR-32…35, FR-37, FR-38, FR-40, FR-48 |

## 1. Functional requirements

### FR-01 · Import a fee batch from Excel

*Statement (original SDD §3.3):* Manager imports a fee batch from an Excel file; every invalid row is reported with its row number and reason, and only valid rows are saved to a draft batch.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-01.1 | Every invalid row is reported; valid rows are saved | **G** a 240-row file where rows 12, 57, 58 and 201 are wrong (unknown unit code, fee month different from the batch, same unit and item twice, amount ≠ quantity × unit price) **W** the Manager uploads it **T** the response carries 236 valid rows and 4 errors, each with `row`, `column`, `code` and a message in the UI language; on commit exactly 236 rows are saved | M | `IM-` tests; Playwright |
| FR-01.2 | Limits | **G** a file of 5.2 MB or 5,001 rows **W** uploaded **T** it is rejected naming the limit (5 MB, 5,000 rows) and no `import_job` is committed | M | `IM-` tests |
| FR-01.3 | Saving twice saves once | **G** a `validated` job **W** two "Save" requests run in parallel **T** one commit happens; the draft has the rows once; the job is `committed` | M | `IM-` race test |
| FR-01.4 | A stale job is refused | **G** a `validated` job older than 24 h **W** commit **T** 409 `import_expired` | M | `IM-` tests (fake clock) |
| FR-01.5 | Amounts are rounded half up | **G** a row with quantity 12.345 and unit price 15,000 **W** validated **T** the line amount is 185,175 đ (`(12345 × 15000 + 500) / 1000`); a row giving 185,000 for the same inputs is a row error, not a silent recomputation | M | `IM-`, `LG-` table tests |
| FR-01.6 | A line can be an adjustment | **G** a row with Kind `adjustment` and amount −200,000 **W** validated **T** the row is accepted if the unit's charge total stays above 0; a fee row of 0 or a negative fee row is a row error | M | `IM-` tests |
| FR-01.7 | Speed | **G** a 2,000-row file with 40 errors **W** uploaded **T** the validated preview returns within 10 s (NFR-12) | M | timed `IM-` test |

### FR-02 · Edit and re-import a draft; a published batch is frozen

*Statement:* A draft batch can be re-imported (overwrite), and its charges and lines can be added, edited or removed per unit; a published batch cannot be edited, except that its due date can be extended (FR-44).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-02.1 | Re-import overwrites | **G** a draft with 240 charges **W** a file with 200 valid rows is committed **T** the draft has exactly 200 charges, none of the earlier 240 remain, and `version` increased | M | `IM-` tests |
| FR-02.2 | Per-unit edit is version-guarded | **G** two Manager users open charge A-1508 at `version` 3 **W** both save **T** the first succeeds (`version` 4), the second gets 409 `version_conflict` with the fresh charge | M | `LG-` race test |
| FR-02.3 | A published charge never changes | **G** a published batch **W** a request edits a line or the amount of its charge **T** the request is refused, and a direct `UPDATE` of `amount` on a non-draft charge is rejected by a trigger | M | `LG-` tests |
| FR-02.4 | Discarding a draft | **G** a draft batch with code `PH-2611-02` **W** discarded **T** batch and charges are deleted and the code is not issued again | S | `LG-` tests |

### FR-03 · Publish a batch

*Statement:* Publishing a batch freezes every charge, makes it visible to the members of the unit who can see fees and sends them an in-app notification and push.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-03.1 | Publish checks | **G** a draft that has no charge, or a charge whose total is 0, or a `due_date` before today in building time **W** publish **T** it is refused naming the failed check; nothing changes | M | `LG-` tests |
| FR-03.2 | Publish is one publication | **G** a draft of 240 charges **W** two Manager users press "Publish" at the same instant **T** one succeeds, the other sees the batch already published; 240 charges are `open`; one notification round is created | M | `LG-` race test |
| FR-03.3 | Who is notified | **G** a charged unit with 1 owner, 1 family member, 1 tenant and 1 helper **W** the batch is published **T** the owner, the family member and the tenant each get an inbox entry `fee.batch_published` and a push; the helper gets none | M | `NT-` tests |
| FR-03.4 | Code | **G** the first batch of fee month 10/2026 **W** created **T** its code is `PH-2610-01`; the second is `PH-2610-02` | M | `LG-` tests |

### FR-04 · Recall a published batch; re-issue

*Statement:* A published batch with no paid charge can be recalled; recalled charges disappear from debt, and a corrected batch can be published.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-04.1 | Recall a batch with no payment | **G** a published batch of 240 `open` charges and one active intent holding two of them **W** the Manager recalls it **T** 240 charges are `void`, the intent becomes `cancelling` as a whole (including a charge of another batch it holds), `finance.batch_recalled.v1` is written, residents get `fee.batch_recalled`, and debt no longer counts the charges | M | `LG-` tests, EXP-04 |
| FR-04.2 | Recall refused after a payment | **G** a published batch of 240 charges, one of them `paid` **W** recall **T** 409 `batch_has_payments`; 239 of 240 rows updated is detected and the transaction rolled back; every charge is unchanged. The expected count is the number of charges that are not `void`, so a batch with one earlier-voided charge and no payment is still recalled (DR-97) | M | `LG-` tests |
| FR-04.3 | Recall against a payment | **G** charge A-1508 `open` **W** a recall and an exact-amount settlement of that charge start at the same instant **T** exactly one wins: either the batch is recalled and the transfer is a money-log row `charge_recalled`, or the charge is paid and the recall returns 409 `batch_has_payments`; 0 recalled batches with a live allocation over 200 batches (EXP-04) | M | EXP-04, `LG-` race test |
| FR-04.4 | A closed batch cannot be recalled | **G** a batch the Manager closed **W** recall **T** refused; its open charges stay payable | M | `LG-` tests |
| FR-04.5 | Re-issue | **G** a recalled batch with 240 charges **W** the Manager re-issues it **T** a new `draft` appears with `replaces_batch_id` set, 240 copied charges and their lines under new ids, a new code from the counter, and editable `fee_month` and `due_date` | M | `LG-` tests |

### FR-05 · Record a manual payment

*Statement:* Manager records a manual payment (cash or transfer) for a unit, for whole charges selected by the Manager; the system computes the amount (the sum of the charges, never typed) and issues one receipt per charge paid.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-05.1 | Whole charges, computed amount | **G** open charges A (2,488,000 đ) and B (350,000 đ) of unit A-1508 **W** the Manager selects both, method `cash`, payer "Trần Minh Anh" **T** one payment of 2,838,000 đ, two live allocations (2,488,000 and 350,000), two receipts (for example `BL-2610-0153` and `BL-2610-0154`), both charges `paid` | M | `LG-` tests |
| FR-05.2 | No typed amount | **G** the same selection **W** the request carries `amount` 2,000,000 **T** 422 `allocation_mismatch`; nothing is saved | M | `LG-` tests |
| FR-05.3 | A changed charge stops the entry | **G** charge B was paid by an online transfer one second earlier **W** the Manager submits A and B **T** 409 `charge_changed` with the fresh state; the transaction rolls back; A is not paid | M | `LG-` race test, EXP-03 |
| FR-05.4 | Idempotent | **G** an `Idempotency-Key` K **W** the same request is sent twice **T** one payment exists; the second response is the first with `Idempotent-Replayed: true` | M | `LG-` run-twice test |
| FR-05.5 | Date window | **G** today is 2026-10-19 **W** `receivedOn` is 2026-10-20, or 2026-07-01 (more than 90 days back) entered by a Manager **T** both are refused; 2026-07-01 is accepted for an Admin | M | `LG-` tests |
| FR-05.6 | Warning, not a block | **G** charge A has an active online intent since 09:12 **W** the Manager selects A **T** the form warns "online payment open since 09:12" and the entry is allowed; if that transfer later arrives, its outcome is `charge_already_paid` | M | `LG-`, EXP-03 |
| FR-05.7 | Dry run | **G** a selection **W** `dryRun: true` **T** the response returns the sum and the receipts that would be issued, and nothing is saved | S | `LG-` tests |
| FR-05.8 | Same charge, two actors | **G** 500 charges, each with a manual entry and an exact online settlement started together **W** run **T** exactly one payment wins per charge; 0 charges have two live allocations; each loser's transfer is a log row (EXP-03) | M | EXP-03 |

### FR-06 · Void a manual payment

*Statement:* Manager voids a manual payment with a reason; its allocations and receipts are voided, the charges reopen, and the action is in the audit log.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-06.1 | Void cascades | **G** a posted `cash` payment of two charges **W** the Manager voids it with the reason "recorded on the wrong unit" **T** in one transaction the payment is `void`, both allocations are `void`, both charges are `open`, both receipts are `void` (numbers kept, PDF re-rendered with a diagonal "VOID" watermark), one audit row stores before and after, and `finance.payment_voided.v1` notifies the residents | M | `LG-` tests |
| FR-06.2 | Reason is mandatory | **G** a reason of 4 characters **W** void **T** 422; nothing changes | M | `LG-` tests |
| FR-06.3 | Online payments cannot be voided | **G** a posted `online` payment **W** the Manager voids it **T** refused; money confirmed by the bank is undone only by a refund outside the system | M | `LG-` tests |
| FR-06.4 | A statement link is released | **G** a `bank_transfer` payment linked to a statement line **W** voided **T** the line returns to `unmatched` | S | `ST-` tests |
| FR-06.5 | Voided charges are payable again | **G** a voided payment **W** a resident opens Fees **T** both charges show `open` and can be paid | M | `LG-`, Maestro |

### FR-07 · Select charges and receive one VietQR payment link

*Statement:* A member allowed to pay selects open charges of the selected unit and receives one VietQR payment link for the total amount of the selected charges.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-07.1 | Who may pay | **G** an owner, a family member, a tenant with `can_pay`, a tenant without it, a helper **W** each creates an intent **T** the first three succeed; the last two get 403 | M | `IN-`, `RM-` policy table |
| FR-07.2 | Whole charges only | **G** open charges A (2,488,000 đ) and B (350,000 đ) **W** the owner selects both **T** an intent for 2,838,000 đ is created; there is no way to pay A in part; selecting 0 or 11 charges, a charge that is not `open`, or a charge of a batch that is not `published` or `closed` is refused | M | `IN-` tests |
| FR-07.3 | Link content | **G** the intent above, order code 2610153 **W** created **T** the response carries the VietQR payload, 2,838,000 đ, the receiving account, the transfer content `TT2FMZ9` (at most 9 characters), a QR validity of 30 min and `expires_at` of 60 min | M | `IN-`, `PX-` tests |
| FR-07.4 | A second member meets an open payment | **G** the owner started an intent for A and B at 09:12 **W** a family member selects exactly A and B **T** the same intent is returned with "started by" the owner and the time; if the selection overlaps but differs, 409 `payment_in_progress` names the holder; if the holder's QR validity has passed, that intent is cancelled and a new one is created | M | `IN-` barrier tests, EXP-02 |
| FR-07.5 | The gateway fails | **G** the gateway times out at link creation **W** one `GET` by order code finds nothing **T** the intent becomes `failed`, its charges are released and the resident sees "try again"; if it finds the link, the intent is `pending` | M | `IN-`, `PX-` tests |
| FR-07.6 | Amount limits | **G** the gateway minimum 2,000 đ and maximum 500,000,000 đ (defaults) **W** a selection totals 1,500 đ **T** it is refused | S | `IN-` tests |
| FR-07.7 | Abuse limit | **G** an account **W** it creates 11 intents within one minute **T** the 11th gets 429 with `Retry-After` | S | `IN-` tests |

### FR-08 · A confirmation settles the charges and issues receipts

*Statement:* A successful gateway confirmation settles the selected charges in full and issues receipts within the same transaction; the resident app shows the receipt without manual refresh.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-08.1 | Exact confirmation posts | **G** a `pending` intent for A and B (2,838,000 đ) **W** a signed confirmation for 2,838,000 đ arrives **T** in one transaction: one payment (`source = online`), two live allocations, two receipts, charges `paid`, intent `paid`, `gateway_event.outcome = posted`, event `finance.payment_posted.v1` | M | `IN-`, EXP-01 |
| FR-08.2 | Duplicates are no-ops | **G** one confirmation (same `reference`) **W** delivered 5 times in random order **T** exactly 1 payment and 0 duplicate receipts; the other 4 calls answer 200 and write nothing | M | EXP-01 |
| FR-08.3 | Webhook and re-query together | **G** 1,000 intents **W** the webhook and the re-query confirm each at the same instant (barrier), 10 rounds **T** 1 payment per intent, 0 deadlocks, 0 errors returned to the gateway | M | EXP-02 |
| FR-08.4 | Visible quickly | **G** the app polls every 2 s for the first minute, then every 3 s **W** a webhook is accepted **T** the first poll showing `paid` returns within 5 s at p95; accept → commit takes ≤ 1 s at p95 (NFR-02) | M | EXP-01 |
| FR-08.5 | Forged calls cannot block the real one | **G** a forged body with a real-looking `reference` is posted before the genuine webhook **W** both arrive **T** the forged one gets 401 `invalid_signature` and a `webhook_rejection` row; `gateway_event` has no row for it; the genuine one is posted | M | EXP-01, `PX-` tests |
| FR-08.6 | Answer after commit | **G** the process is killed after the commit and before the answer **W** the gateway retries or the re-query runs **T** the payment exists once and the retry answers 200 as a duplicate | M | `IN-` kill test |
| FR-08.7 | Receipt on screen | **G** `Pay-VietQR` is open **W** the payment is posted **T** the app moves to `Pay-Done` with one receipt per charge, without a manual refresh | M | Maestro |
| FR-08.8 | Retry on deadlock | **G** a transaction fails with SQLSTATE `40001` or `40P01` **W** settlement runs **T** the whole transaction is retried up to 3 times with 20–60 ms jitter | S | `IN-` fault test |

### FR-09 · Money that does not match exactly is logged, not posted

*Statement:* A confirmation is posted only when its amount equals the intent amount and every charge of the intent is still open; any other confirmed transfer is kept in the money log, linked to nothing, for the Manager to check (FR-46).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-09.1 | A charge paid in cash meanwhile | **G** charge A (2,488,000 đ) paid in cash, intent covering A and B (350,000 đ) **W** the confirmation for 2,838,000 đ arrives **T** no payment is created, B stays `open`, the `gateway_event` has outcome `charge_already_paid` and appears in the money log, and the payment invariant holds | M | `IN-` tests, EXP-03 |
| FR-09.2 | Short transfer | **G** an intent for 2,838,000 đ **W** a confirmation for 2,000,000 đ arrives **T** outcome `amount_short`, nothing posted, the intent stays `pending`, its status returns `unmatchedTransfer {amount: 2000000, receivedAt}`, every active Manager and Admin gets an inbox entry, and the resident gets no push and no inbox entry | M | `IN-` tests |
| FR-09.3 | Over transfer | **G** the same intent **W** 3,000,000 đ arrives **T** outcome `amount_over`; nothing posted | M | `IN-` tests |
| FR-09.4 | Second transfer | **G** an intent already `paid` **W** another confirmation with a different `reference` arrives **T** outcome `duplicate_transfer` | M | `IN-`, EXP-01 |
| FR-09.5 | A recalled charge | **G** a charge of the intent is `void` **W** an exact confirmation arrives **T** outcome `charge_recalled`; no part of the intent is posted | M | `IN-`, EXP-04 |
| FR-09.6 | Unknown order | **G** an order code with no intent in this building **W** a signed confirmation arrives **T** outcome `unknown_order`; the payOS registration test payload is answered 200 and writes no row | M | `IN-`, `PX-` tests |
| FR-09.7 | A late exact confirmation is posted | **G** an intent `expired` whose charges are all `open` **W** an exact confirmation arrives **T** it is posted as usual | M | `IN-` tests |
| FR-09.8 | Never matched elsewhere | **G** any wrong transfer **W** processed **T** it is never applied to another charge, period or payment; a charge is cleared only by an exact payment or a manual payment of whole charges | M | `LG-`, `IN-` tests |

### FR-10 · Re-query pending links; expire them

*Statement:* Pending payment links are re-queried every 5 minutes for 60 minutes; after that they are cancelled at the gateway and expire.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-10.1 | Schedule | **G** a `pending` intent whose webhook was lost **W** the job ticks every 30 s **T** the intent is queried every 5 min plus 0–20 s jitter; a `PAID` answer is settled within one cycle | M | `IN-` tests (fake clock), EXP-02 |
| FR-10.2 | Expiry | **G** 60 min without a confirmation **W** the job runs **T** the intent becomes `expired`, a cancel command is queued and its charges are released | M | `IN-` tests |
| FR-10.3 | "I have transferred" | **G** `last_checked_at` is 45 s ago **W** the resident presses the button **T** an immediate re-query runs; if the last check is 10 s ago the current status is returned and no call is made | S | `IN-` tests |
| FR-10.4 | Stale `creating` | **G** an intent in `creating` for 3 min **W** the job runs **T** a `GET` by order code decides: found → `pending`, absent → `failed` with items released | M | `IN-` tests |
| FR-10.5 | Gateway outage | **G** the gateway answers errors **W** the job runs **T** retries back off 30 s, 60 s, 2 min, 5 min; at most 5 gateway calls run at once; an alert fires when more than half of the calls in 10 min failed | M | `IN-`, `PX-` tests |
| FR-10.6 | Cancel at the gateway | **G** a recall cancels an intent **W** the cancel command fails with a 5xx **T** it is retried 8 times (5 s doubling to 15 min), then dead-lettered with an alert; a gateway answer "already paid" triggers `getStatus` and `settle` | M | `IN-`, `JB-` tests |

### FR-11 · Reconcile with the bank statement

*Statement:* Manager imports a bank statement file and sees each line as matched, proposed, unmatched or already recorded; a line whose amount is exactly the amount of whole charges can be linked to a manual payment of those charges.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-11.1 | Import | **G** an XLSX of 4.9 MB with 18,000 lines **W** the Manager uploads with a saved profile **T** only credit lines are read; a file over 5 MB or 20,000 lines is refused | M | `ST-` tests |
| FR-11.2 | Idempotent re-upload | **G** a statement uploaded yesterday **W** an overlapping statement is uploaded today **T** repeated lines are `already_recorded` (same `dedup_key`); 0 duplicate lines are created | M | `ST-` tests |
| FR-11.3 | Match by order code, after the gateway confirms | **G** a line with content "TT2FMZ9 …" for an intent that is not `paid` **W** reconciled **T** the system asks the gateway; `PAID` → `settle` with the gateway's own reference and `source = statement`; not `PAID` → the line is `statement_only` | M | `ST-`, `IN-` tests |
| FR-11.4 | Amount must be exact | **G** a line whose amount differs from the intent amount **W** matched **T** `settle` is not called; the line is `unmatched` with a note | M | `ST-` tests |
| FR-11.5 | Match a manual transfer | **G** one unreconciled `bank_transfer` payment of 2,838,000 đ dated within ±1 day **W** a line of 2,838,000 đ is reconciled **T** the line is `proposed`; with 2 candidates both are listed for the Manager to pick | M | `ST-` tests |
| FR-11.6 | The only link | **G** a line whose amount is exactly the sum of whole charges **W** the Manager assigns it to a manual payment of those charges **T** it is linked; no other link kind exists | M | `ST-` tests |
| FR-11.7 | Not seen in bank | **G** a posted `online` payment older than 3 days with no line in an imported period **W** the list is built **T** it is listed; cash payments are excluded | S | `ST-` tests |
| FR-11.8 | Bank-specific parsers | **G** the company's real redacted sample (P0-05) **W** parsed **T** a bank-specific profile reads it with 0 errors | C | `ST-` tests with the real sample |

### FR-12 · Debt, aging and reminders

*Statement:* Manager sees debt per unit and per fee month with aging buckets not yet due, 1–30, 31–60, 61–90 and over 90 days past due, and sends push reminders to selected units.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-12.1 | Bucket boundaries | **G** an open charge with due date 2026-10-15 **W** the building date is 10-15, 10-16, 11-14, 11-15, 12-14, 12-15, 2027-01-13, 2027-01-14 **T** the bucket is not yet due (0 days), 1–30 (1), 1–30 (30), 31–60 (31), 31–60 (60), 61–90 (61), 61–90 (90), over 90 (91) | M | `LG-` table test |
| FR-12.2 | Building time, not UTC | **G** due date 2026-10-15, building zone `Asia/Ho_Chi_Minh` **W** it is 23:30 local on 10-15, 00:30 on 10-16, 06:59 on 10-16 **T** days past due are 0, 1 and 1 (a UTC date would give 0 at 06:59) | M | `LG-` table test |
| FR-12.3 | What counts | **G** unit A-1508 has 3 open, 1 paid and 1 void charge **W** debt is shown **T** only the 3 open charges of published or closed batches count; a draft, paid or void charge does not | M | `LG-` tests |
| FR-12.4 | Reminders | **G** 20 selected units **W** the Manager sends reminders, and sends again 2 h later **T** 20 pushes and inbox entries `fee.reminder` the first time; 0 the second time (one per unit per building day); the endpoint allows 10 calls per hour | S | `NT-`, `LG-` tests |
| FR-12.5 | Speed | **G** 5,000 units with 24 batches each **W** the debt-per-unit query runs **T** it finishes in ≤ 50 ms (planned, on the partial index of open charges) | S | timed `LG-` test |

### FR-13 · Staff sign-in, lockout and reset

*Statement:* Staff sign in with email and password; 5 consecutive failures lock sign-in for 15 minutes; a reset link valid 30 minutes is sent by email.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-13.1 | Lockout | **G** 20 parallel wrong passwords for one email **W** processed **T** `failed_attempts` never exceeds 5, the account is locked for 15 min, and the correct password is refused during the lock | M | `AU-` race test |
| FR-13.2 | Per-IP limit | **G** one IP **W** it makes 31 attempts in 15 min across emails **T** the 31st is refused with 429 | S | `AU-` tests |
| FR-13.3 | Reset link | **G** a reset request **W** the link is used **T** it works once within 30 min, a second use and a use at 31 min are refused; a newer link consumes the older | M | `AU-` tests |
| FR-13.4 | No account enumeration | **G** a known and an unknown email **W** a reset is requested **T** the responses are identical; at most 3 requests per email and 10 per IP per hour | M | `AU-` tests |
| FR-13.5 | Password rule | **G** passwords "abc12345", "abcdefgh", "12345678", 129 characters **W** set **T** the first is accepted; the others are refused | M | `AU-` tests |
| FR-13.6 | Unlock | **G** a locked Technician **W** the Manager unlocks it, or a successful reset completes **T** sign-in works at once | M | `AU-` tests |

### FR-14 · Staff accounts

*Statement:* Admin creates staff accounts with a fixed role; the new staff member receives a set-password link valid 24 hours; Manager creates only Technician and Guard accounts.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-14.1 | Who creates what | **G** a Manager **W** it creates a Technician, then an Admin **T** the first succeeds, the second returns 403; an Admin can create all four roles | M | `AU-`, EXP-10 |
| FR-14.2 | Invite link | **G** an invited account **W** the link is used at 23 h and at 25 h **T** it works at 23 h; at 25 h the account stays `invited` until the Admin resends | M | `AU-` tests |
| FR-14.3 | Open tickets block a lock | **G** a Technician holding tickets in `assigned`, `accepted`, `in_progress` or `on_hold` **W** the Manager locks the account **T** 409 `staff_has_open_tickets` listing them; the Admin may force with `reassignTo` | M | `AU-`, `TK-` tests |
| FR-14.4 | Revocation | **G** a staff member whose role changes or who is locked **W** the next request arrives **T** it is refused at once and all refresh families are revoked | M | `AU-` tests |
| FR-14.5 | Sensitive changes need step-up | **G** a request to create or promote an Admin, or to change a staff email, with no valid step-up **W** sent **T** refused (FR-50) | M | `AU-`, EXP-10 |

### FR-15 · Resident OTP sign-in

*Statement:* Residents sign in with a registered phone number and a 6-digit OTP valid 5 minutes; unregistered numbers receive no SMS.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-15.1 | Registered and unregistered phones | **G** a registered and an unregistered number **W** an OTP is requested **T** the first gets a challenge and one SMS; the second gets 404 `phone_not_registered` and 0 SMS | M | `AU-` tests |
| FR-15.2 | Code lifetime and resend | **G** a challenge **W** verified at 4 min 59 s and at 5 min 01 s; resent at 30 s and at 46 s **T** the first verify works, the second does not; the resend at 30 s gets 429 with `Retry-After`, the one at 46 s is accepted and consumes the earlier challenge | M | `AU-` tests (fake clock) |
| FR-15.3 | Wrong codes | **G** a challenge **W** 5 wrong codes are sent **T** each returns 400 `otp_invalid` with `attemptsLeft` (4, 3, 2, 1, 0); the 5th consumes the challenge | M | `AU-`, EXP-09 |
| FR-15.4 | One session | **G** a correct code **W** two verifies run in parallel **T** exactly one signs in | M | `AU-` race test |
| FR-15.5 | Abuse limits | **G** 50 requests for one phone within an hour, 200 phones from one IP **W** processed **T** at most 5 SMS for the phone; at most 20 challenges for the IP; 0 successful guesses in 5 attempts; at 3,000 SMS in a day new challenges are refused with an alert | M | EXP-09 |
| FR-15.6 | The fixed code | **G** the code `123456` **W** used for a flagged demo account and for a non-demo account **T** it works for the first and is refused for the second; the API refuses to boot in production when a flagged account belongs to a non-demo building | M | `AU-`, `BD-` tests |
| FR-15.7 | Stale SMS | **G** an SMS command older than 5 min **W** the worker sees it **T** it is not sent; at most 3 attempts | S | `JB-`, `AU-` tests |

### FR-16 · Every request is evaluated against the active membership

*Statement:* Every resident request is evaluated against the active membership of the selected unit; locking or removing a membership takes effect on the next request.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-16.1 | Immediate effect | **G** a helper with a valid session **W** the owner locks the membership **T** the helper's next request answers 403 `membership_inactive` and the app returns to `Unit-Pick` | M | `RM-`, Maestro |
| FR-16.2 | Policy table | **G** the four member types and eight capabilities of the policy table **W** each pair is exercised **T** the result equals the table (helper: no fees, tickets, vehicles or documents; tenant without `can_pay`: no payment; non-owner: no member management) | M | `RM-` table test, EXP-10 |
| FR-16.3 | No cached permissions | **G** an access token issued before a lock **W** it is used after the lock **T** the request fails; tokens carry no unit permissions and a resident token carries no building | M | `AU-`, `RM-` tests |
| FR-16.4 | Kinds do not mix | **G** a resident token **W** it calls a `/staff/*` endpoint (and the reverse) **T** it is rejected regardless of role | M | EXP-10 |
| FR-16.5 | One owner | **G** a unit with an active owner **W** a second active owner is inserted **T** the unique index rejects it | M | `RM-` tests |

### FR-17 · The owner manages household members

*Statement:* An owner adds members by phone as family member, tenant (with or without `can_pay`) or helper; an existing phone gets a new membership, not a new account.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-17.1 | Add by phone | **G** the owner of A-1508 **W** adds a phone that already has an account, as a tenant with `can_pay` off **T** that account gets a membership of A-1508; no second account exists; one SMS invitation is sent | M | `RM-` tests |
| FR-17.2 | Invitation cap | **G** an owner who sent 10 invitations today **W** an 11th is attempted **T** it is refused (the cap of 10 per day per owner) | S | `RM-` tests |
| FR-17.3 | Edit, lock, remove | **G** a non-owner member **W** the owner changes `family`↔`tenant`, toggles `can_pay`, locks, unlocks, removes **T** each succeeds and `credential_version` increases in the same transaction; the owner cannot act on themself | M | `RM-` tests |
| FR-17.4 | Manager's lock wins | **G** a membership locked by the Manager **W** the owner unlocks it **T** refused; only the Manager can | M | `RM-` tests |
| FR-17.5 | No size limit | **G** a unit with 25 memberships and 8 helpers **W** another is added **T** it succeeds | M | `RM-` tests |
| FR-17.6 | History rule | **G** a payment dated 2026-09-10 and a member whose membership began 2026-10-01 **W** the member opens fee history **T** the paid charge and its receipt are not shown, open charges of the unit are, and the Manager sees both | M | `RM-`, `LG-` tests |

### FR-18 · Units, owners, transfers and phone changes

*Statement:* Manager imports units and owners from Excel, creates an owner by phone, transfers ownership, and changes a resident's login phone; every change is kept in the unit history.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-18.1 | Import rules | **G** a file where one phone appears for two different people, one unit already has another owner, and one phone already has an account **W** validated **T** the second person's row is an error; the owner-conflict row is an error ("transfer is a deliberate action"); the existing account is linked and its name is not overwritten, as the preview says | M | `IM-` tests |
| FR-18.2 | Import speed and file lifetime | **G** a 2,000-row file with 40 errors **W** uploaded **T** the preview returns in ≤ 10 s; after commit or expiry the uploaded file is deleted | M | `IM-`, `FS-` tests |
| FR-18.3 | Transfer | **G** unit A-1508 with an owner and 3 members **W** the Manager transfers ownership **T** the old owner is removed, the new owner inserted, the 3 members removed by default (kept if "keep members" is ticked), one `unit_history` row is written, and fees, receipts and tickets stay with the unit | M | `RM-` tests |
| FR-18.4 | Login phone change | **G** a number that already has an account **W** the Manager sets it as a login phone **T** 409 `phone_in_use`; for a free number all the account's sessions are revoked, the person signs in with the new number, and memberships are unchanged | M | `RM-`, `AU-` tests |
| FR-18.5 | Search | **G** a resident "Nguyễn Văn An" and phone `+84901234567` **W** the Manager searches "nguyen", "van an" and "4567" **T** the resident is found by each; a phone fragment under 4 digits does not search by phone | S | `RM-` tests |
| FR-18.6 | History | **G** an owner change **W** the unit detail opens **T** `unit_history` shows kind, actor and time | S | `RM-` tests |

### FR-19 · Submit and cancel a ticket

*Statement:* A resident submits a ticket with type, title, description, location and up to 5 photos and 1 video, and can cancel it only while it is unassigned.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-19.1 | Content limits | **G** a form **W** submitted with title 121 characters, description 2,001 characters, 6 images, or 2 videos **T** each is refused; 5 images and 1 video (60 s, 50 MB) are accepted | M | `TK-`, `FS-` tests |
| FR-19.2 | Created ticket | **G** an owner, family member or tenant **W** submits **T** the ticket is `submitted` with code `YC-YYMMDD-NNN`, the Manager gets a push, and the resident sees "Sent"; a helper cannot submit (403) | M | `TK-` tests |
| FR-19.3 | Cancel only before assignment | **G** a `submitted` ticket **W** the resident cancels **T** it becomes `cancelled`; after assignment the request returns 409 `ticket_already_accepted` | M | `TK-` tests |
| FR-19.4 | Cancel against assign | **G** a `submitted` ticket **W** the resident cancels and the Manager assigns at the same instant **T** the first commit wins; the loser gets 409 and the fresh ticket | M | `TK-` race test |

### FR-20 · Assign a ticket with workload

*Statement:* Manager assigns a ticket to a Technician or Guard and sees each person's open-ticket count; the assignee receives a push.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-20.1 | Workload | **G** a Technician with 2 `assigned`, 1 `in_progress` and 1 `closed` ticket **W** the assign dialog opens **T** the count shown is 3 | M | `TK-` tests |
| FR-20.2 | Assign and notify | **G** a `submitted` ticket **W** the Manager assigns it with an appointment and a note **T** it is `assigned`, the assignee gets a push, the resident sees "Accepted" | M | `TK-` tests |
| FR-20.3 | Same assignee refused | **G** an assigned ticket **W** it is reassigned to the same person **T** 422 | S | `TK-` tests |
| FR-20.4 | Two Managers | **G** two users at `version` 5 **W** both assign **T** the second gets 409 `version_conflict` | M | `TK-` race test |
| FR-20.5 | Guard view of Technician tickets | **G** a Guard **W** opens a Technician ticket **T** code, title, status, unit code, location and assignee are visible; the resident's name, phone and messages are not | M | `TK-`, EXP-10 |
| FR-20.6 | Urgent | **G** a ticket **W** the Manager marks it `urgent` with `If-Match` **T** it sorts first in every list and the assignee sees the flag | S | `TK-` tests |

### FR-21 · Accept or reject an assignment

*Statement:* The assignee accepts or rejects (with a reason) an assignment; a rejection returns the ticket to the Manager.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-21.1 | Accept | **G** a ticket `assigned` to Technician T **W** T accepts **T** `accepted`; if the Manager reassigned it first, T gets 409 `ticket_reassigned` | M | `TK-` race test |
| FR-21.2 | Reject | **G** an assigned ticket **W** T rejects with `needs_equipment` and a note of 300 characters **T** the ticket returns to `submitted`, the assignee is cleared and the Manager gets a push; a note of 301 characters is refused | M | `TK-` tests |
| FR-21.3 | Reject against reassign | **G** an assigned ticket **W** T rejects and the Manager reassigns at once **T** the first commit wins; a reject after reassignment fails because `assignee_id` no longer matches | M | `TK-` race test |

### FR-22 · Work on a ticket: in progress, on hold, resolved

*Statement:* The assignee moves the ticket to in progress, on hold (with a reason) and resolved, with before/after photos and a result note; the resident sees the after photos and the result note once the ticket is closed.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-22.1 | Transitions | **G** an `accepted` ticket **W** the assignee starts, holds with the reason "waiting for a valve", resumes, and reports done with photos and a result note **T** the states are `in_progress`, `on_hold`, `in_progress`, `resolved`; the hold reason appears on the resident's timeline | M | `TK-` tests |
| FR-22.2 | Resident sees results only after close | **G** a `resolved` ticket **W** the resident opens it **T** the status reads "In progress"; no `before`, `after` or `result` photo and no result note is returned; after the Manager closes it the `after` and `result` photos and the note are returned and `before` photos still are not | M | `TK-`, EXP-10 |
| FR-22.3 | Illegal moves | **G** the transition table **W** each pair not in it is attempted **T** 409 | M | `TK-` table test |
| FR-22.4 | Resolved against reopen | **G** an assignee reports done and the Manager reopens at once **T** reopen needs `resolved`; the second to run sees the new state | M | `TK-` race test |

### FR-23 · Close, reopen and rate

*Statement:* Manager closes or reopens a resolved ticket; the resident is notified on every status change and can rate a closed ticket once with 1–5 stars and a comment.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-23.1 | Close and reopen | **G** a `resolved` ticket **W** the Manager closes it, later reopens a `closed` ticket **T** `closed`, then `assigned` to the same assignee, who must accept again; the assignee is pushed the Manager's note | M | `TK-` tests |
| FR-23.2 | Notifications | **G** any status change the resident can see **W** it commits **T** the resident gets an inbox entry and a push in the same transaction as the change (no "Completed" for a rolled-back close) | M | `TK-`, `NT-` tests |
| FR-23.3 | Rating once | **G** a closed ticket **W** the resident rates 4 stars with a comment of 500 characters, then rates again; on another ticket closed 15 days ago the resident tries to rate **T** the first succeeds; the second returns 409 `already_rated`; the rating after 14 days is refused; a comment of 501 characters is refused | M | `TK-` tests |
| FR-23.4 | A reopened ticket keeps its rating | **G** a rated, closed, reopened ticket **W** closed again **T** the earlier rating remains and no second rating is allowed | S | `TK-` tests |

### FR-24 · Internal notes never reach residents

*Statement:* Internal notes on a ticket are never returned by any resident endpoint.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-24.1 | No leak | **G** a ticket with 3 internal notes **W** every resident endpoint that can return ticket data is called as owner, family member and tenant **T** 0 responses contain an internal note, and the resident DTO has no field that could carry one | M | EXP-10 |
| FR-24.2 | Default visibility | **G** a staff message **W** posted without choosing "Internal note" **T** it is `public` and the resident gets a push; an explicit internal note sends none | M | `TK-` tests |

### FR-25 · A resident QR code valid 15 minutes

*Statement:* A resident opens a QR code for the selected unit, valid 15 minutes; opening a new code invalidates the previous one.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-25.1 | Validity | **G** a code issued at 10:00:00 **W** scanned at 10:14:59 and at 10:15:01 **T** the first is `valid`, the second `expired` | M | `QC-` tests (fake clock) |
| FR-25.2 | A new code kills the old | **G** a code on phone 1 **W** the same membership opens the QR screen on phone 2 **T** the first code is rejected as `invalid` on the first scan after the change; 0 stale codes over 1,000 rounds | M | `QC-`, EXP-05 |
| FR-25.3 | One code per unit | **G** an account in two units **W** it opens each **T** it holds two codes, and each screen names its unit | M | `QC-` tests |
| FR-25.4 | Countdown and refresh | **G** a phone whose clock is 3 min wrong **W** the screen counts down **T** it counts from server time minus `exp`; it regenerates on focus when less than 60 s remain; `POST /me/qr` allows 30 per minute per account | S | Maestro, `QC-` tests |

### FR-26 · A guard scan

*Statement:* A guard scan of a valid code shows unit, name, member type and rights, and the owner's name with a masked phone and a Call button; an expired, replaced, foreign or revoked code shows no resident data.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-26.1 | Valid scan | **G** a valid code of a family member of A-1508 **W** a Guard scans it **T** the result shows unit, name, member type and rights, the owner's name, the phone masked as `090••••123` with a Call button that dials through `tel:`, and "valid for N more minutes"; the view is logged with guard and target | M | `QC-` tests |
| FR-26.2 | Expired scan | **G** an expired code **W** scanned **T** only the creation and expiry times are shown; no resident data | M | `QC-`, EXP-05 |
| FR-26.3 | Invalid scan | **G** a bad signature, another building, a replaced nonce or an inactive membership **W** scanned **T** one generic "invalid code" with possible causes and no resident data, so a scan cannot tell whether the person still lives there | M | `QC-`, EXP-05 |
| FR-26.4 | Lock, unlock, scan old | **G** a code issued, then the member locked, then unlocked **W** the old code is scanned **T** `invalid` (the `credential_version` differs) | M | EXP-05 |
| FR-26.5 | Scan log | **G** 100 scans **W** logged **T** each has guard, result and time; an `invalid` row stores no membership; rows older than 90 days are purged | S | `QC-`, `JB-` tests |

### FR-27 · Write, schedule and send a notice

*Statement:* Manager writes a notice in Vietnamese and optionally English, with category, attachments, audience, pin and display expiry, and sends it now or at a scheduled time.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-27.1 | Content rules | **G** a notice **W** saved with no Vietnamese title, a body of 101 KB, 6 attachments, an attachment of 21 MB, an image from an external URL, or a heading of level 1 **T** each is refused; a Vietnamese-only notice with 5 attachments of 20 MB and the allowed node set is accepted | M | `NT-` tests |
| FR-27.2 | Send now or schedule | **G** a draft **W** the Manager sends now, or schedules it for 18:00 building time **T** `sending` starts at once, or the scheduler (tick 30 s) claims it at 18:00 ± 30 s; a scheduled notice can be edited or returned to `draft` until it is `sending` | M | `NT-`, `JB-` tests |
| FR-27.3 | Audience | **G** an audience of all residents plus Guards **W** sent **T** every resident account with an active membership and every active Guard is a recipient; a person in two units receives one notice | M | `NT-` tests |
| FR-27.4 | Sent notices are fixed | **G** a `sent` notice **W** the Manager edits title, body or audience **T** refused; pin, unpin and display expiry are allowed; a correction is a new notice | M | `NT-` tests |
| FR-27.5 | Categories and expiry | **G** categories `general`, `maintenance`, `urgent`, `event` and a display expiry of 2026-11-01 **W** the date passes **T** the notice leaves lists without being deleted; a pinned notice shows on the resident home only for its recipients | S | `NT-` tests |
| FR-27.6 | Helpers receive broadcast notices | **G** a notice in category `maintenance` addressed to all residents **W** a helper opens the app **T** the helper receives it, because an audience of "residents" includes helpers (DR-50); entries about fees, tickets and vehicles are not created for the helper | S | `NT-`, `RM-` tests |

### FR-28 · Read statistics

*Statement:* Manager sees read and unread counts per notice and per member type, and the list of recipients who have not read it.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-28.1 | Counts | **G** a notice sent to 610 recipients, 400 read **W** the statistics open **T** read 400, unread 210, with counts per member type (owner, family, tenant, helper) and push failures | M | `NT-` tests |
| FR-28.2 | Unread list | **G** 210 unread recipients **W** the list opens **T** pages of 20 rows show name, unit and last app open | S | `NT-` tests |
| FR-28.3 | Read once | **G** a recipient who opened the notice **W** opens it again, or via the inbox **T** `read_at` keeps its first value and the matching inbox entry becomes read | M | `NT-` run-twice test |
| FR-28.4 | Late joiners | **G** a notice sent on 10-01 **W** a resident is added on 10-05 **T** the notice is not shown to them as unread | S | `NT-` tests |

### FR-29 · Inbox and push in the recipient's language

*Statement:* Every user has an in-app inbox with an unread count; push follows the recipient's language and their push setting.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-29.1 | Fan-out | **G** 5,000 generated recipients and a fake Expo endpoint answering in 200 ms **W** one notice is sent **T** from the scheduler claim to the last request to Expo returned takes ≤ 60 s (NFR-04); recipients are read in batches of 500 and pushes sent in requests of 100 | M | EXP-06 |
| FR-29.2 | Crash safety | **G** the worker is killed after 6 of 10 batches **W** it restarts, or its heartbeat stops for more than 5 min **T** the notice is reclaimed and finished; there are 0 duplicate recipient or inbox rows | M | EXP-06, `NT-` kill test |
| FR-29.3 | Privacy of the payload | **G** any push **W** it is built **T** title and body come from a template in the recipient's language and contain no amount, name, phone number or ticket text; `data` holds only `{route, unitId, entityId}` | M | `NT-` tests |
| FR-29.4 | Templates, not text | **G** an inbox entry created in Vietnamese **W** the user switches to English **T** the entry shows English, rendered from its template key and parameters | M | `NT-`, catalog parity |
| FR-29.5 | Push setting and unit | **G** `push_enabled = false` and an entry for a unit where the membership is now `removed` **W** events occur **T** no push is sent but the entry exists; the entry of the removed unit is hidden; tapping an entry of an active unit switches the app to that unit first | M | `NT-`, Maestro |
| FR-29.6 | Tokens | **G** a push receipt of `DeviceNotRegistered`, or a sign-out **W** processed 15 min after sending, or at sign-out **T** the device token is deleted; other errors count as "push failed" for the notice | M | `NT-` tests |
| FR-29.7 | No money in inbox for a mismatch | **G** a transfer of another amount **W** it arrives **T** the resident gets no inbox entry and no push (FR-09.2) | M | `IN-`, `NT-` tests |

### FR-30 · Register and review a vehicle

*Statement:* A resident registers a vehicle with plate, type, photo and both sides of the registration paper; Manager approves or rejects with a reason; the resident is notified.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-30.1 | Required data | **G** a registration **W** it lacks the plate photo or one side of the paper **T** it is refused; a complete one becomes `pending` | M | `VH-`, `FS-` tests |
| FR-30.2 | Plate key | **G** plates `51F-123.45`, `59-X1 123.45`, `29 Z1-1234` **W** normalized **T** keys `51F12345`, `59X112345`, `29Z11234`; a second `pending` or `approved` vehicle with the same key in the building is refused | M | `VH-` table test |
| FR-30.3 | Review | **G** a `pending` vehicle **W** the Manager approves, or rejects with code `unclear_photo` and a note **T** the status changes and the resident gets a notification with the reason; a rejected vehicle can be edited and resubmitted | M | `VH-` tests |
| FR-30.4 | Car limit is a warning | **G** `maxCarsPerUnit` 2 and a unit with 2 cars **W** a third `car` is `pending` **T** the Manager sees a warning and may still approve; motorbikes and electric bikes are not counted | S | `VH-` tests |
| FR-30.5 | Editing an approved vehicle | **G** an approved vehicle **W** the owner edits its colour **T** a `vehicle_revision` in `pending` is created; the approved data stays visible to Guards until approval | M | `VH-` tests |

### FR-31 · Plate and unit lookup

*Statement:* Guards and Manager look up a plate among approved vehicles only, by any 3 or more characters of it.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-31.1 | Approved only | **G** vehicles `approved` (`51F12345`), `pending`, `rejected` and `retired` **W** a Guard searches "123" **T** only the approved vehicle is returned, with its unit, owner and vehicle type; a query of 2 characters returns nothing | M | `VH-` tests |
| FR-31.2 | Union lookup | **G** a Manager types "A-15" **W** the lookup runs **T** results are labelled unit, resident or plate, at most 20 per kind; names match with or without diacritics | S | `RM-`, `VH-` tests |
| FR-31.3 | Logged | **G** a Guard opens a unit with a masked owner phone **W** viewed **T** the view is written to the lookup log with guard and target | S | `QC-`, `AD-` tests |

### FR-32 · The document library

*Statement:* Admin and Manager maintain a folder tree of pages with attachments and video links, choose the roles that may read each folder or page, and restore earlier versions.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-32.1 | Tree and writers | **G** a folder at depth 5 **W** a sixth level is created, or a Technician edits a page **T** both are refused; Admin and Manager can write; helpers read nothing | M | `WK-` tests |
| FR-32.2 | Effective readers at read time | **G** folder F (visible to `resident`) with 40 pages, one with `visibility_override = [manager]` **W** the Admin changes F to `[technician]` **T** the next read by a resident of the 39 inheriting pages is refused and by a Technician allowed, with no recompute job; the override page keeps its readers | M | `WK-` tests |
| FR-32.3 | Versions | **G** a page saved 55 times **W** it is read **T** the last 50 versions and the published one remain; restoring version 12 copies it into a new version and publishes it | M | `WK-` tests |
| FR-32.4 | Media | **G** a video link and attachments **W** added **T** only YouTube links (`youtube-nocookie.com` embed) are accepted; an attachment over 20 MB is refused; a PDF or image previews, an Office file downloads | S | `WK-`, `FS-` tests |
| FR-32.5 | Restore and page PDF export | **G** version history and a page **W** restore and export are used **T** both work; they are first in the cut order | C | `WK-`, `PD-` tests |

### FR-33 · Search the library

*Statement:* Readers search pages by title and content within what their role may read.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-33.1 | Accent-insensitive | **G** a page titled "Hướng dẫn phòng cháy" **W** a resident searches "huong dan phong chay", and "phong ch" **T** the page is found both times (prefix on the last term) with a highlighted snippet | M | `WK-` tests |
| FR-33.2 | Role filter | **G** a page readable only by `manager` **W** a Guard and a Manager search for a word in it **T** the Guard gets 0 results, the Manager 1 | M | `WK-`, EXP-10 |

### FR-34 · Dashboard

*Statement:* The dashboard shows the collection rate per fee month, total debt, open and unassigned tickets, vehicles pending and the latest notice read rate.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-34.1 | Collection rate and debt | **G** a fee month with 10 charges of 1,000,000 đ each in non-recalled batches: 6 `paid`, 3 `open`, 1 `void` **W** the dashboard loads **T** the collection rate is 6,000,000 ÷ 9,000,000 = 66.7%, total debt is 3,000,000 đ; the void charge counts in neither | M | `RP-` fixture test |
| FR-34.2 | Ticket and vehicle numbers | **G** tickets in every status, vehicles in every status **W** loaded **T** "open tickets" counts statuses other than `closed` and `cancelled`; "unassigned" counts `submitted`; "pending vehicles" counts `pending` | M | `RP-` fixture test |
| FR-34.3 | Notice read rate and money to check | **G** the newest `sent` notice with 610 recipients and 400 read, and 3 open log rows **W** loaded **T** the read rate is 65.6% and "money to check" is 3 | M | `RP-` tests |
| FR-34.4 | Composition | **G** the dashboard **W** loaded **T** it is composed through the read contracts of finance, tickets, vehicles and notices; no module reads another's tables | S | `RP-`, `check:arch` |

### FR-35 · Reports and exports

*Statement:* Reports (collection per fee item, debt aging, tickets, online transactions, staff workload) export to Excel and PDF.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-35.1 | Report set | **G** the six reports `collection_by_fee_item`, `debt_aging`, `collection_by_month`, `online_transactions`, `tickets_summary`, `staff_workload` **W** each is run with a fee-month or date filter **T** each returns rows scoped to the building | M | `RP-` tests |
| FR-35.2 | Item split without rounding | **G** paid charges whose lines are "Management fee" 2,488,000 and "Parking" 350,000, plus one adjustment line of −100,000 **W** collection per fee item runs **T** totals are the sums of line amounts of paid charges; the adjustment is its own item; sums are exact | M | `RP-` table test |
| FR-35.3 | Excel export | **G** a report of 50,000 rows **W** exported **T** an Excel file is produced by a streaming writer; 50,001 rows is refused | M | `RP-` tests |
| FR-35.4 | PDF export | **G** a report **W** exported as PDF **T** a landscape A4 table is produced | C | `RP-`, `PD-` tests |

### FR-36 · Fee notice and receipt PDFs

*Statement:* Fee notices and receipts are generated as PDF in Vietnamese, English or both, with the company logo and contact details.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-36.1 | Languages | **G** `feeNoticeLanguage` = `vi`, `en` or `both` **W** a fee notice is rendered **T** the PDF follows the setting, shows the lines, total and due date, and uses Be Vietnam Pro so diacritics render | M | `PD-` tests |
| FR-36.2 | Receipt from the snapshot | **G** a receipt issued in October **W** the company logo changes in November **T** the October receipt is unchanged; it is titled "Biên lai thu tiền / Payment receipt" and states it is not a tax invoice | M | `PD-` tests |
| FR-36.3 | Void watermark | **G** a voided receipt **W** rendered **T** a second PDF with a diagonal "VOID" replaces the cached one; the number is unchanged | S | `PD-` tests |
| FR-36.4 | Bulk | **G** 240 and 5,000 units **W** fee notices are generated **T** 240 finish in ≤ 2 min and 5,000 in ≤ 30 min with worker memory ≤ 1 GB (NFR-05) | M | EXP-08 |
| FR-36.5 | Bulk ZIP | **G** a batch **W** "bulk PDF" runs **T** one job produces a per-unit PDF set and a ZIP, not one merged file | C | `PD-` tests |

### FR-37 · Audit every staff mutation

*Statement:* Every staff mutation is written to the audit log, in the same transaction, with actor, time, IP, object and changed fields.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-37.1 | Same transaction | **G** a mutation that rolls back **W** it ends **T** no audit row exists; a committed mutation always has one; an audit insert that fails fails the mutation | M | `AD-` tests |
| FR-37.2 | Content | **G** the void of a payment with the reason "wrong unit" **W** audited **T** the row has actor, role, IP, request id, action, object type and id, `changes` with before and after, reason and time; secrets and CCCD are masked | M | `AD-` tests |
| FR-37.3 | System actor | **G** a webhook settlement **W** posted **T** its audit row has `actor_kind = 'system'` and no actor id | M | `AD-`, `IN-` tests |
| FR-37.4 | Append-only | **G** the runtime database role **W** it runs `UPDATE` or `DELETE` on `audit.audit_log` **T** it fails | M | `AD-`, permission test |
| FR-37.5 | Personal-data reads | **G** a Manager opens a profile detail, then exports 300 residents **W** logged **T** one `pii.read` row for the view and one row for the export with `recordCount = 300`, not 300 rows | M | `AD-` tests |
| FR-37.6 | Retention | **G** audit rows older than 5 years for finance objects, 2 years for others **W** the monthly purge runs **T** they are deleted; `charge`, `payment`, `allocation`, `receipt` and the money log are never deleted (periods confirmed in P0-06) | S | `AD-`, `JB-` tests |

### FR-38 · Building settings

*Statement:* Admin edits building and company information, default due days, default language and login lockout settings.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-38.1 | Who and what | **G** the settings (`defaultLanguage`, `defaultDueDays` 10, `accountDeletionDays` 30, `lockout {5, 15}`, `maxCarsPerUnit` 2, `storageQuotaBytes` 50 GB, `feeNoticeLanguage`, `reportColumns`) **W** an Admin saves valid values and a Manager tries to save **T** the Admin succeeds and the change is audited; the Manager gets 403 | M | `BD-`, EXP-10 |
| FR-38.2 | Validation | **G** `defaultDueDays` = −1 or `feeNoticeLanguage` = `fr` **W** saved **T** 422 and nothing changes | M | `BD-` tests |
| FR-38.3 | Gateway and receiving account | **G** the Admin changes the receiving account while an intent is active **W** saved with a valid step-up **T** 409 until no intent is active; secrets are returned masked | M | `BD-`, `IN-` tests |
| FR-38.4 | Default due date | **G** `defaultDueDays` 10 **W** a batch is created on 2026-10-05 **T** the proposed due date is 2026-10-15 | S | `BD-` tests |

### FR-39 · Terms and account deletion

*Statement:* Residents accept the current terms on first sign-in and after each new version; they can request account deletion.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-39.1 | First sign-in | **G** a resident who has not accepted the latest terms **W** a fees endpoint is called **T** 403 `terms_required` with the version to accept; `/auth/*`, `/me` and `/me/terms*` still answer | M | `AD-`, `AU-` tests |
| FR-39.2 | Request and cancel | **G** a resident **W** requests deletion, uses the app, then cancels **T** the account is `deletion_requested`, stays usable, and returns to `active` on cancel | M | `AD-` tests |
| FR-39.3 | Approval and execution | **G** an approved request and `accountDeletionDays` 30 **W** day 30 passes **T** sessions and device tokens are revoked, memberships removed, name, avatar and profile fields cleared, the phone replaced by `deleted:<id>` (the number is free), financial rows keep the payer-name snapshot, audit rows keep ids only | M | `AD-` tests |
| FR-39.4 | The owner must transfer first | **G** an account that is the active owner of a unit **W** deletion is approved **T** refused with 409 `owner_must_transfer` until ownership is transferred | M | `AD-`, `RM-` tests |

### FR-40 · Files and the storage quota

*Statement:* Files are stored with a per-building quota; Admin is alerted at 80% use.

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-40.1 | Quota | **G** a 50 GB quota **W** usage passes 40 GB, then 50 GB **T** the hourly job alerts the Admin at 40 GB; at 50 GB new uploads are refused with 413 `quota_exceeded` | M | `FS-` tests, alert drill |
| FR-40.2 | Upload verification | **G** an 11 MB image (limit 10 MB), a file named `.jpg` whose first bytes are not JPEG **W** uploaded and verified **T** the first is deleted after `HEAD`; the second is refused with 422 `file_not_verified` | M | `FS-` tests |
| FR-40.3 | Orphans | **G** a `pending` file older than 24 h **W** the hourly job runs **T** it is deleted (fake clock) | M | `FS-` tests |
| FR-40.4 | Signed downloads | **G** a vehicle paper **W** its URL is requested **T** the signed URL lives 5 min; other files 15 min; there is no public bucket | M | `FS-` tests |

### FR-41 · Terms versions (added)

*Statement:* Admin publishes terms and privacy versions; a resident who has not accepted the latest version can use only sign-in, account and terms endpoints (added, DR-59).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-41.1 | Publish a version | **G** terms version 3 and 650 residents who accepted version 2 **W** the Admin publishes version 4 **T** the next request of each resident answers 403 `terms_required` until accepted; the acceptance stores account, version, time, IP and app version | M | `AD-`, `BD-` tests |
| FR-41.2 | Both kinds | **G** a `terms` and a `privacy` version **W** both are published **T** each is versioned separately | S | `BD-` tests |

### FR-42 · The Manager cancels a ticket (added)

*Statement:* Manager cancels a ticket in any state before resolution with a mandatory reason; the resident is notified with it (added, DR-44).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-42.1 | Cancel with a reason | **G** tickets `submitted`, `assigned` and `accepted` **W** the Manager cancels each with the reason "duplicate of YC-261019-004" **T** each becomes `cancelled` with `cancelled_by = staff`; the resident is notified with the reason | M | `TK-` tests |
| FR-42.2 | Reason is mandatory and the window is fixed | **G** an empty reason, or a ticket `in_progress` **W** cancel **T** the first is refused with 422; the second is refused because the transition does not exist | M | `TK-` table test |

### FR-43 · Retire a vehicle (added)

*Statement:* A vehicle is retired by the owner, a family member or Manager and stops showing to guards; Manager can retire all vehicles of a unit at move-out (added, DR-49).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-43.1 | Retire | **G** an approved vehicle **W** the owner, a family member or the Manager retires it **T** it is `retired`, no longer returned by plate lookup, and its plate key can be registered again; a tenant cannot retire it | M | `VH-` tests |
| FR-43.2 | Retire all at move-out | **G** a unit with 3 vehicles and a move-out recorded **W** the Manager retires all **T** all 3 are `retired` in one action | S | `VH-` tests |

### FR-44 · Extend a due date (added)

*Statement:* Manager extends the due date of a published batch to a later date; residents are notified (added, DR-20).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-44.1 | Later date only | **G** a published batch due 2026-10-15 **W** the Manager sets 2026-10-25, then 2026-10-10 **T** the first succeeds (`version` guarded, audited) and residents get `fee.batch_due_extended`; the second is refused | M | `LG-` tests |
| FR-44.2 | Only edit | **G** a published batch **W** any other field is patched **T** refused (FR-02.3) | M | `LG-` tests |
| FR-44.3 | Aging follows | **G** a charge 3 days past due **W** the due date is extended past today **T** it moves to "not yet due" | S | `LG-` tests |

### FR-45 · Sessions (added)

*Statement:* Every user sees the list of their sessions and can revoke any of them (added, DR-38).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-45.1 | List and revoke | **G** an account with 3 sessions **W** the user revokes one **T** its refresh family is revoked, its device token is deleted, and a web CMS stream of that session closes | M | `AU-` tests |
| FR-45.2 | Reuse detection | **G** a refresh token used twice outside the 10 s grace window **W** the second use arrives **T** the whole family is revoked | M | `AU-` tests |
| FR-45.3 | Cap | **G** an account with 10 live families **W** an 11th sign-in occurs **T** the oldest is revoked | S | `AU-` tests |
| FR-45.4 | Lifetimes | **G** staff and resident tokens **W** used **T** staff refresh lasts 30 days sliding with a 90-day cap; resident 180 days sliding with a 365-day cap; access tokens last 15 min | M | `AU-` tests |

### FR-46 · Review money that was not posted (added)

*Statement:* Manager marks a row of the money log reviewed with a note of at least 5 characters, once; a new open row alerts every Manager and Admin (added, DR-16, DR-84).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-46.1 | Review once | **G** an open row (outcome `amount_short`) **W** the Manager reviews it with the note "refunded by bank transfer 10/19", then again **T** the first succeeds (`open → reviewed`, audited); the second is refused; a note of 4 characters is refused | M | `LG-` tests |
| FR-46.2 | Which rows | **G** a row with outcome `posted` or a statement line `matched` **W** review is attempted **T** refused | M | `LG-` tests |
| FR-46.3 | The ledger does not change | **G** a reviewed row **W** the ledger is checked **T** payments, allocations and charges are identical to before | M | `LG-` tests |
| FR-46.4 | Alert | **G** a new open row **W** it is written **T** every active Manager and Admin gets an inbox entry `finance.money_unposted` and the "money to check" counter rises by 1 | M | `NT-`, `LG-` tests |

### FR-47 · The money log viewer (added)

*Statement:* The money log shows every confirmation, posted or not, and the unmatched statement lines, with filters and a per-unit panel, and the dashboard shows the number of rows to check (added, DR-16).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-47.1 | List and filters | **G** 1,000 `gateway_event` rows of every outcome **W** the Manager filters by outcome `charge_already_paid`, unit A-1508, a date range and `open` **T** only matching rows are returned, newest first, keyset-paginated | M | `LG-`, Playwright |
| FR-47.2 | Row detail | **G** a row **W** opened **T** the amount, time, reference, order code, intent, a payload excerpt, the payment and receipt link when posted, and the review note are shown | M | Playwright |
| FR-47.3 | Per unit | **G** unit A-1508 **W** its detail screen opens **T** a panel shows that unit's log rows; the resident never sees the log | M | Playwright, EXP-10 |

### FR-48 · The export center (added)

*Statement:* Manager and Admin request exports in an export center and download the file from a 15-minute link; the kinds are the six reports and the lists `units` and `residents` (added, DR-55, DR-90).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-48.1 | Request and download | **G** an export request **W** the worker finishes **T** the requester gets `report.export_ready` (inbox and SSE) and a 15-minute signed URL; the file is deleted after 7 days | M | `RP-` tests |
| FR-48.2 | Concurrency | **G** a user with 2 running exports **W** a third is requested **T** it is refused | S | `RP-` tests |

### FR-49 · Void a single open charge (added)

*Statement:* Manager or Admin voids a single open charge that has no live allocation, with a reason of at least 5 characters; intents holding it are cancelled and the resident is notified (added, DR-19, DR-20).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-49.1 | Void an open charge | **G** an `open` charge of 2,488,000 đ with no live allocation **W** the Manager voids it with the reason "billed to the wrong unit" **T** the charge is `void`, `finance.charge_voided.v1` is written, the resident gets `fee.charge_voided`, one audit row is written, and other charges of the batch are untouched | M | `LG-` tests |
| FR-49.2 | Refused cases | **G** a `paid` charge, a charge with a live allocation, a reason of 4 characters, and a Technician **W** void is attempted **T** 409, 409, 422 and 403 | M | `LG-`, EXP-10 (role × charge state) |
| FR-49.3 | Held charges | **G** an active intent holding the charge and another charge **W** the charge is voided **T** the intent is cancelled as a whole in the same transaction and the resident is told to start again; a late exact confirmation of that intent finds the charge `void` and goes to the log as `charge_recalled` | M | `LG-`, `IN-` tests |
| FR-49.4 | Never reopened | **G** a voided charge **W** a corrected charge is needed **T** it is issued in a new draft batch; the voided charge cannot be reopened | M | `LG-` tests |
| FR-49.5 | Race with payment | **G** an `open` charge **W** a void and an exact settlement start together **T** exactly one wins: voided with a log row, or paid with 409 on the void | M | `LG-` race test, EXP-04 |

### FR-50 · Step-up for sensitive staff actions (added)

*Statement:* Changing the gateway configuration or the receiving account, creating or promoting an Admin, or changing a staff email needs the password and a one-time emailed code; every Admin is notified (added, DR-39).

| ID | Requirement | Acceptance criteria | Priority | Verification |
| --- | --- | --- | --- | --- |
| FR-50.1 | Code | **G** an Admin requests a code for `gateway_config` **W** it is mailed **T** it has 6 digits, is valid 10 min, is single use, and one live code exists per staff member and action (a new request consumes the older) | M | `AU-` tests |
| FR-50.2 | Refusals | **G** a sensitive request with no code, a wrong code, an expired code, a reused code, a wrong password, and another Admin's code **W** sent **T** each is refused (403 `step_up_required` when the proof is missing, 403 `step_up_failed` for every other failure, DOC-42 §5.3) and 0 unexpected 2xx appear across the sensitive endpoints (EXP-10) | M | `AU-`, EXP-10 |
| FR-50.3 | Attempts | **G** 5 wrong codes **W** entered **T** the challenge is consumed; a wrong password counts toward the sign-in lockout | M | `AU-` tests |
| FR-50.4 | Success is announced | **G** a successful change **W** it commits **T** every Admin of the building gets an email and an inbox entry `staff.step_up_done`; the audit row records which fields changed, not the secret values | M | `AU-`, `NT-` tests |

## 2. Non-functional requirements

Numbers are design targets for the phase 1 machine and are recalibrated on the staging machine when EXP-07 first runs (DR-06). "Planned" numbers become "measured" only with a dated result file under `10-testing/experiments/results/` (DR-77, DR-78). Each experiment is run 5 times; correctness criteria must hold in every run and latency in the median (DR-78).

| ID | Requirement | Target | How measured | Tool | Verification |
| --- | --- | --- | --- | --- | --- |
| NFR-01 | No double settlement, no lost sight of a transfer | 0 charges settled twice; 0 duplicate payments per gateway reference; every payment equals the sum of its live allocations; every confirmed transfer is a payment or a money-log row, after 10,000 concurrent settlement attempts | Count queries after the runs: charges with 2 live allocations, payments ≠ Σ allocations, confirmations with neither a payment nor a log row | Race harness (`apps/api/test/race`), SQL, the EXP-03 naive baseline | EXP-01, EXP-02, EXP-03, EXP-04 |
| NFR-02 | Payment confirmation latency | p95 ≤ 5 s from webhook accepted to the first poll response showing `paid` (app polling every 2 s for 60 s, then every 3 s); server part (accept → commit) p95 ≤ 1 s | Timestamps in the EXP-01 harness (DR-80) | Harness, request timing | EXP-01 |
| NFR-03 | API latency | p95 ≤ 300 ms, p99 ≤ 800 ms, errors < 0.1% at 50 requests/s for 15 min of mixed traffic (60% reads of home, fees, tickets; 25% writes; 15% list and search) on the staging host (2 vCPU, 4 GB, API, worker and PostgreSQL co-located) | Latency histograms by route | k6 | EXP-07 |
| NFR-04 | Notice fan-out | 5,000 recipients: scheduler claim → last request to Expo returned ≤ 60 s; no duplicate rows after a mid-run kill | Timestamps against a fake Expo endpoint answering in 200 ms | Harness | EXP-06 |
| NFR-05 | Bulk PDF | 240 fee notices ≤ 2 min; 5,000 ≤ 30 min in the background; worker memory ≤ 1 GB | Duration and RSS | Script, container stats | EXP-08 |
| NFR-06 | QR revocation | 0 stale codes accepted after a replace, lock, unlock or removal over 1,000 rounds; 0 personal fields in `expired` or `invalid` responses | Scan each old code immediately after each change | Harness | EXP-05 |
| NFR-07 | OTP abuse | ≤ 5 SMS per phone per hour; ≤ 20 challenges per IP per hour; ≤ 5 attempts per code; 0 successful guesses | Count SMS sent and guesses in the run | Harness | EXP-09 |
| NFR-08 | Isolation | 0 successful reads or writes of another unit or building across the matrix of every endpoint × role and member type × own and foreign unit and building, including internal ticket notes | Unexpected 2xx count | Matrix generated from route metadata | EXP-10 |
| NFR-09 | Ledger self-check | A nightly job (03:00 building time) verifies the invariants on every unit; an injected difference is reported within 24 h; 0 false positives on clean data | Inject 20 corruptions (DR-78) and compare the report | SQL queries, harness | EXP-11 |
| NFR-10 | Availability | 99.5% per month | Successful probes ÷ all probes of `GET /api/v1/health/ready` every 60 s, minus announced maintenance (DR-80) | External uptime probe (free tier) | First month in production |
| NFR-11 | Backup and restore | RPO ≤ 5 min; RTO ≤ 4 h; a restore drill succeeds once per quarter (pgBackRest to R2, point-in-time recovery; DR-66) | Time to a working system; data-loss window; invariant checks after restore | pgBackRest, smoke test | EXP-12 |
| NFR-12 | Import | A 2,000-row Excel file: accepted `POST /staff/imports` → response carrying the validated preview ≤ 10 s; validation is synchronous in the API (DR-21, DR-80) | Timed integration test | `bun test` | P1-13 (`IM-`) |
| NFR-13 | Languages | 100% of UI strings exist in Vietnamese and English, with the same ICU placeholders | Parity of keys and placeholders | Catalog parity test in CI | CI |
| NFR-14 | Personal data | National ID numbers (CCCD) and phone numbers are visible only to the Manager, Admin, the unit's own members and, masked and logged, Guards; the detail view of a profile and every export of it are logged (DR-48, DR-58) | Field-level assertions per role; log rows per view and per export | Authorization matrix, `AD-`/`RM-` tests | `AD-`, `RM-` tests; EXP-10 |

## 3. Matrix: requirement → use case → feature group → design

Use cases are in DOC-04; the feature IDs `F-<GROUP>-xx` are assigned in DOC-05, which maps each of the 113 proposal features to an FR here; the table gives the feature group. Tasks and verification per requirement are in master plan §6.

| Requirement | Use case | Feature group | Design documents |
| --- | --- | --- | --- |
| FR-01 | UC-01 | FEE | DOC-21, DOC-18 |
| FR-02 | UC-01 | FEE | DOC-21 |
| FR-03 | UC-01 | FEE, NOT | DOC-21, DOC-31 |
| FR-04 | UC-04 | FEE | DOC-21, DOC-22 |
| FR-05 | UC-02 | FEE | DOC-22, DOC-44 |
| FR-06 | UC-02 | FEE | DOC-22, DOC-44 |
| FR-07 | UC-03 | PAY | DOC-23, DOC-24 |
| FR-08 | UC-03, UC-18 | PAY | DOC-23, DOC-22 |
| FR-09 | UC-18, UC-21 | PAY | DOC-22, DOC-23 |
| FR-10 | UC-03, UC-18 | PAY | DOC-23 |
| FR-11 | UC-06 | PAY | DOC-25 |
| FR-12 | UC-05 | FEE | DOC-22 |
| FR-13 | UC-17 | ACC | DOC-26 |
| FR-14 | UC-17 | ACC | DOC-26, DOC-27 |
| FR-15 | UC-14 | ACC | DOC-26 |
| FR-16 | UC-14 | ACC | DOC-27 |
| FR-17 | UC-15 | UNI | DOC-27 |
| FR-18 | UC-13 | UNI | DOC-27, DOC-18 |
| FR-19 | UC-07 | TIC | DOC-28 |
| FR-20 | UC-08 | TIC | DOC-28 |
| FR-21 | UC-09 | TIC | DOC-28 |
| FR-22 | UC-09 | TIC | DOC-28 |
| FR-23 | UC-10 | TIC | DOC-28 |
| FR-24 | UC-10 | TIC | DOC-28 |
| FR-25 | UC-16 | QRC | DOC-29 |
| FR-26 | UC-16 | QRC | DOC-29 |
| FR-27 | UC-11, UC-19 | NOT | DOC-31 |
| FR-28 | UC-11 | NOT | DOC-31 |
| FR-29 | UC-19 | NOT | DOC-31 |
| FR-30 | UC-12 | VEH | DOC-30 |
| FR-31 | UC-28 | VEH, UNI | DOC-30, DOC-27 |
| FR-32 | UC-23 | WIK | DOC-32 |
| FR-33 | UC-24 | WIK | DOC-32 |
| FR-34 | UC-25 | DSH | DOC-33 |
| FR-35 | UC-25 | DSH | DOC-33 |
| FR-36 | UC-25 | FEE, DSH | DOC-34 |
| FR-37 | UC-17 | SYS | DOC-35 |
| FR-38 | UC-17 | SYS | DOC-36 |
| FR-39 | UC-14, UC-27 | ACC | DOC-35 |
| FR-40 | UC-17 | SYS | DOC-37 |
| FR-41 (added) | UC-27 | ACC | DOC-35, DOC-36 |
| FR-42 (added) | UC-22 | TIC | DOC-28 |
| FR-43 (added) | UC-12 | VEH | DOC-30 |
| FR-44 (added) | UC-04 | FEE | DOC-21 |
| FR-45 (added) | UC-26 | ACC | DOC-26 |
| FR-46 (added) | UC-21 | PAY | DOC-22 |
| FR-47 (added) | UC-21 | PAY | DOC-22, DOC-66 |
| FR-48 (added) | UC-25 | DSH | DOC-33 |
| FR-49 (added) | UC-04 | FEE | DOC-21, DOC-22 |
| FR-50 (added) | UC-17 | ACC | DOC-26, DOC-39 |
| NFR-01 | UC-18 | PAY | DOC-22, DOC-23, ADR-0005, ADR-0006, ADR-0008 |
| NFR-02 | UC-18 | PAY | DOC-10, DOC-23 |
| NFR-03 | — | SYS | DOC-10 |
| NFR-04 | UC-19 | NOT | DOC-31 |
| NFR-05 | UC-25 | FEE | DOC-34 |
| NFR-06 | UC-16 | QRC | DOC-29, ADR-0012 |
| NFR-07 | UC-14 | ACC | DOC-26 |
| NFR-08 | UC-30 | ACC | DOC-39, DOC-27 |
| NFR-09 | UC-20 | FEE | DOC-22 |
| NFR-10 | — | SYS | DOC-10, DOC-70 |
| NFR-11 | UC-29 | SYS | DOC-72, ADR-0017 |
| NFR-12 | UC-13 | UNI | DOC-18, DOC-27 |
| NFR-13 | — | SYS | DOC-68, DOC-55 |
| NFR-14 | UC-16 | ACC | DOC-35, DOC-27, DOC-29 |

## 4. Not in this document

| Topic | Lives in |
| --- | --- |
| Use cases with main, alternative and error flows | DOC-04 |
| Features and their phases | DOC-05 |
| Endpoint contracts and error shapes | DOC-50, DOC-51 |
| Tables, columns, constraints | DOC-14…17 |
| Test procedures and the prefix index | DOC-88 and each design document's "Required tests" |
| Scope, goals and cut order | [DOC-01](vision-and-scope.md) |

## Open questions

- **Gateway-specific values (DR-25, DR-27, DR-28, DR-30, DR-31):** the criteria of FR-07, FR-08, FR-10 use the defaults of the original SDD and the register (amount limits 2,000 and 500,000,000 đ, 9-character content, 30 min QR validity, 60 min expiry). They are confirmed or changed when the Owner reports a gateway sandbox; a change creates a `Changed` DR and edits the criterion in the same change. Not blocking P1.
- **Bank statement profile (DR-34, DR-35):** FR-11.8 waits for the real redacted sample (P0-05). The generic profile (FR-11.1…11.7) is complete without it. Not blocking P1.
- **Retention periods (FR-37.6):** 5 years for finance audit rows and 2 years for others are defaults until the legal dossier P0-06 confirms them.
