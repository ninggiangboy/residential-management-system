# Glossary

> Status: **Review** · Updated: 2026-10-21 (DR-96: `unmatchedTransfer` outcomes; earlier: DR-174…219: UX/UI terms; earlier: DR-157…173: operations, testing; DR-128…150) · DOC-06
> Depends on: original SDD §1–§22, [DR](00-decision-register.md) (DR-01…127), [master plan](00-master-plan.md) §0.2, §3.2
> Main readers: every document (DOC-01…103), P0-17…P0-35, every task that names a term in code or in a screen

This document defines the words of the project, as the project uses them. Every other document uses these words exactly and never redefines them. It does not hold designs (tables, endpoints, algorithms): a definition points to the decision (DR-xx) or the document (DOC-xx) that does. A new term enters this file in the same change that first uses it (master plan §2, principle 9).

## 0. Conventions

- **Term** is the name used in code and in the product. Code names are in backticks. The **Local name** column holds the Vietnamese word only for terms that the product shows on screen (documents are in English, master plan §0.1). A dash means the term is not shown in the UI or has no fixed Vietnamese name.
- **Owner** (capital O) is the owner of the project, who decides in the decision register. **owner** (lower case) is the owner of a unit. The two are never the same word in one sentence without the qualifier. See *Owner (project)* and *owner* in §1.
- "Staff" means Admin, Manager, Technician and Guard. "Resident" means any holder of a resident account acting through a membership (owner, family member, tenant, helper).
- An ID in a definition (`FR-09`, `DR-84`, `DOC-22`) is the place to read the rule. Identifier prefixes are defined once, in §11.
- UI strings quoted in documents appear exactly as on screen, in the UI language.

## 1. People, roles, accounts and access

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| building | — | One apartment building run by one management company. Phase 1 serves one real building plus a demo building. Every business row carries `building_id` so that several buildings need no data migration. | original SDD §2.3, DR-12 |
| management company | — | The company that operates the building and is the client of this system. It owns the app-store accounts, the receiving bank account and the domain. | DR-69, DR-81 |
| sample building | — | The 24-floor, 240-unit building of the design canvas ("Mộc Miên Residence"), with about 650 resident accounts and 10 staff. All sizing examples use it. | original SDD §2.1, DOC-01 |
| Admin | — | Staff role. Manages staff accounts, building settings, the payment gateway, the audit log and storage. Has every Manager right. | original SDD §3.1, DR-39 |
| Manager | — | Staff role: the building management board. Runs daily operations on the web CMS and in the staff app. Creates and locks Technician and Guard accounts only. | original SDD §3.1 |
| Technician | — | Staff role. Receives assigned tickets, accepts or rejects them, records before/after photos and the result. | DR-46 |
| Guard | — | Staff role. Scans resident QR codes, looks up units and approved plates, handles security tickets, sees Technician tickets read-only. Sees phone numbers masked and logged. | DR-46, DR-48 |
| staff | — | Admin, Manager, Technician and Guard together. | |
| web CMS | — | The web application for Admin and Manager (static site on Cloudflare Pages). | original SDD §2.3, DR-83 |
| staff app | — | The mobile app for Manager, Technician and Guard (Expo). | original SDD §2.3 |
| resident app | — | The mobile app for owner, family member, tenant and helper (Expo). | original SDD §2.3 |
| staff account | — | An account in `identity.staff_account`: email and password, one fixed role, one building. Status `invited`, `active`, `locked` or `disabled`. Signs in to the web CMS and the staff app. | DR-36, DR-39 |
| resident account | — | An account in `identity.resident_account`: one phone number is one account across units and buildings. Signs in with an OTP. Rights come from memberships, not from the account. Status `active`, `deletion_requested` or `deleted`. | DR-36, DR-38 |
| resident | — | A person using the resident app through a membership of a unit. | |
| unit | — | One apartment, identified by a code unique in the building (`A-1508`). Never deleted, only marked vacant. Floor is an attribute, not a module. | DR-40, DR-12 |
| occupancy | — | Status of a unit set by the Manager: `occupied`, `rented` or `vacant`. Not derived from memberships. | DR-40 |
| owner | — | The resident who owns a unit. Exactly one per unit. Has every unit feature, including adding, locking and removing members and granting a tenant `can_pay`. | original SDD §3.1, DR-40 |
| family member | — | A resident of the unit with every unit feature except member management; may pay. A member type separate from tenant, even though the two look alike. | DR-81 |
| tenant | — | A resident of the unit like a family member, but who pays only when the owner enables `can_pay`. Cannot manage members. | original SDD §7.4 |
| helper | — | A long-term domestic worker. Sees broadcast notices and a personal QR code and nothing else. Has no personal notifications and sees no fees. | original SDD §7.4 |
| member type | — | One of `owner`, `family`, `tenant`, `helper` on a membership. Decides the capabilities in the policy table. | DOC-27 |
| membership | — | The link between a resident account and a unit: member type, `can_pay`, status, `credential_version`. Every resident request is evaluated against the active membership of the selected unit. | FR-16, DR-40 |
| `can_pay` | — | A boolean on a tenant membership, set by the owner, that allows paying fees online. Always true in effect for owner and family member. | FR-17 |
| locked membership | — | A membership whose `status` is not `active` because the owner (`locked_by = owner`) or the Manager (`locked_by = manager`) locked it. Takes effect on the next request. A lock by the Manager can be undone only by the Manager. | FR-16, DR-40 |
| `credential_version` | — | An integer on a membership, incremented in the same transaction as any change of status, member type or ownership. It is the switch that kills old QR codes. | DR-40, DR-48 |
| household | — | The set of memberships of one unit. | |
| unit history | — | Rows of `unit_history`: owner changed, moved in, moved out, member added, member removed, with actor and time. | FR-18, DR-40 |
| ownership transfer | — | A Manager action: the old owner is removed and the new owner inserted. By default all other members are removed; the Manager may tick "keep members" per transfer. Fees, receipts and tickets stay with the unit. | FR-18, DR-40 |
| invitation cap | — | At most 10 invitation SMS per owner per building day, counted by `invited_at` of the memberships the owner added. Only the owner's add sends an invitation. | DR-40, DR-137 |
| promoted member | — | A member who becomes the owner by an ownership transfer and keeps their membership row and its start date, so their history window does not restart. | DR-138 |
| `startedAt` | — | `membership.created_at` as returned to callers by `ResidencyApi`; the date of the history rule. | DR-40, DR-42 |
| debt follows the unit | — | A resident always sees the open charges of the unit, whoever the owner was when they were issued. | DR-40 |
| history rule | — | A resident sees paid charges, receipts and payer names only for payments dated on or after `membership.created_at` of their own membership. Manager and Admin see everything. One date filter on `membership.created_at`. | DR-40, DR-73 |
| resident profile | — | `resident_profile`: full name, email, CCCD, date of birth, entered by the Manager. | DR-40 |
| CCCD | — | The Vietnamese citizen identity card number. Stored encrypted, shown masked (`•••• 1234`), readable in full only on the detail view for Manager and Admin, where the read is logged. | NFR-14, DR-58 |
| `BuildingScope` | — | The argument or wrapper that adds `building_id` to every query of a scoped table. A query without it fails the scope lint. | DR-12 |
| `UnitContext` | — | The object built by the request guard from `X-Unit-Id` and the membership: `{buildingId, unitId, membershipId, memberType, canPay}`. Use cases ask one policy function with it. | original SDD §7.4, DOC-27 |
| policy function | — | The single function that decides a capability from a `UnitContext` (member types × capabilities table). | DOC-27 |
| OTP | — | The 6-digit one-time code sent by SMS for a resident sign-in, valid 5 minutes, at most 5 attempts. | FR-15, DR-37 |
| OTP challenge | — | A row in `identity.otp_challenge` holding the HMAC of the code. One live challenge per phone. | DR-37 |
| fixed OTP | — | The code `123456`, accepted only for a resident account with `is_demo = true`. | DR-37, DR-60 |
| demo account | — | A resident account flagged `is_demo`. Lives in the demo building, sends no SMS, uses the fixed OTP. The API refuses to boot in production if a flagged account belongs to a non-demo building. | DR-36, DR-60 |
| demo building | — | A second building with `is_demo = true`, in staging and in production (store review needs a working login). Uses the `fake` payment driver and is reset nightly. | DR-60, ADR-0026 |
| step-up | — | Extra proof for a sensitive staff action: the Admin re-enters the password and a 6-digit code mailed to the Admin's own email (10 minutes, single use). Every Admin is notified of a success. No TOTP in phase 1. | FR-50, DR-39 |
| sensitive staff action | — | One of: change the gateway configuration or the receiving account, create or promote an Admin, change a staff email. Each needs step-up. | FR-50, DR-39 |
| lockout | — | After 5 consecutive failed staff sign-ins, sign-in is locked for 15 minutes. Admin and Manager (for Technician and Guard) can unlock at once. | FR-13, DR-39 |
| invite link | — | A single-use link valid 24 hours that lets a new staff member set a password. | FR-14, DR-39 |
| reset link | — | A single-use link valid 30 minutes for a staff password reset. | FR-13, DR-39 |
| session | — | A sign-in on one device, backed by a refresh family. Users can list and revoke their sessions. | FR-45, DR-38 |
| refresh family | — | The chain of rotating refresh tokens of one device (`sid`). Reuse of an old token revokes the whole family. | DR-38 |
| access token | — | The ES256 JWT of 15 minutes that carries `sub`, `kind`, `sid` and, for staff, `role` and `bid`. It carries no unit permission and, for a resident, no building. | DR-38, DOC-26 §3.1 |
| refresh grace window | — | The 10 seconds after a refresh token is rotated in which the same token is accepted once more and mints a sibling token, because the response of the first call may have been lost. After it, a second use is reuse and revokes the family. | DR-131, DOC-26 §3.5 |
| last admin guard | — | The rule that refuses to lock, disable or demote the last active Admin of a building (409 `last_admin`), made safe against two Admins acting at once by a row lock. | DR-133, DOC-26 §4.4 |
| `OpenTicketsProbe` | — | The port `identity` declares and `tickets` implements, to list and reassign a staff member's open tickets before a lock, a disable or a role change. | DR-133, DOC-26 §2.1 |
| terms version | — | A published version of the terms of use or the privacy notice. A resident who has not accepted the latest version can use only sign-in, account and terms endpoints (403 `terms_required`). | FR-39, FR-41, DR-59 |
| account deletion | — | A resident requests deletion; the Manager approves; execution runs after the cooling-off. Refused while the account is the active owner of a unit (`owner_must_transfer`). | FR-39, DR-59 |
| cooling-off (`accountDeletionDays`) | — | The building setting, default 30 days, between approval and execution of an account deletion. | DR-59, DR-60 |
| account deletion execution | — | The daily job `account_deletion` (identity) and the handlers of `identity.account_deletion_executed.v1`: sessions revoked, phone replaced by `deleted:<id>`, personal fields cleared, memberships removed, device tokens and the IP of terms acceptances deleted; ledger and audit rows keep ids and the payer-name snapshot. | DR-59, DR-115, DOC-20 §8 |
| Owner (project) | — | The owner of this project. Decides in the decision register; decisions are recorded as "Owner". Not a unit owner. | decision log of `00-decision-register.md` |
| Operator | — | The person who runs the deployment (restores backups, rotates keys); in phase 1 the Owner (project). | NFR-11, DR-66 |
| client | — | The management company seen as the customer who supplies inputs (bank statement sample, payOS account, hosting accounts, legal texts). | P0-03…P0-06 |
| `locked_until` | — | The staff column that holds a temporary lockout (15 minutes after 5 wrong passwords). The account stays `active`; the sign-in query compares it with `now()`. Not the manual lock `locked`. | DR-107, FR-13 |

## 2. Fees, charges and the ledger

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| fee month | — | The month a batch is for, a `date` (first day of the month), shown `MM/YYYY`. A label for reporting; fee batches have no fixed cycle. | DR-09, DR-22 |
| fee batch | Đợt phí | A group of charges published together, with a code (`PH-YYMM-NN`), a name in both languages, a fee month and a due date. | original SDD §5.2 |
| draft | — | Batch and charge status before publishing: editable, re-importable, hard-deletable. | DR-12, DR-20 |
| published | — | Batch status after publishing: charges are frozen and visible to residents. The only edit is a later due date. | FR-02, FR-44 |
| recalled | — | Batch status after a recall: its charges are `void`, intents holding them are cancelled. Possible only if no charge is paid. | FR-04 |
| closed | — | Batch status after the Manager's manual freeze for reporting. Open charges stay payable; a closed batch cannot be recalled. Nothing closes automatically. | DR-20 |
| recall | — | Withdrawing a published batch that has no paid charge. | FR-04 |
| re-issue | — | Copying the charges and lines of a recalled batch into a new draft with `replaces_batch_id`; fee month and due date are editable. | DR-20 |
| due date | — | The last day a charge is payable, a `date`. A charge is overdue when `buildingToday > due_date`. | DR-09 |
| due-date extension | — | The only edit of a published batch: a later due date, audited, residents notified (`fee.batch_due_extended`). | FR-44, DR-20 |
| charge | — | The amount one unit owes within one batch, with its lines. Status `draft`, `open`, `paid` or `void`. `amount` is the sum of its lines and is above zero. | original SDD §5.1, DR-13 |
| charge line | — | One itemized row of a charge: item name (vi/en), quantity, unit price, amount, note, kind. Never changes after publishing. | DR-13 |
| fee line | — | A charge line of kind `fee`; its amount is above zero. | DR-13 |
| adjustment line | — | A charge line of kind `adjustment`; its amount may be negative (a discount, a waiver, the offset of a paid overcharge). The charge total must stay above zero. Entered by hand by the Manager, never derived from the money log. | DR-19 |
| paid in full or not at all | — | The rule that a charge is `open` or `paid`: no channel pays a charge in part, and there is no advance payment and no credit. | DR-84, FR-09 |
| void (charge) | — | Status of a charge that was recalled or voided singly. A voided charge is never reopened. | FR-49, DR-20 |
| void a single open charge | — | A Manager or Admin action on one `open` charge without a live allocation, with a reason of at least 5 characters. Intents holding it are cancelled as a whole. The corrected charge goes into a new batch. | FR-49, DR-19, DR-20 |
| void (payment) | — | Cancelling a manual payment with a reason: its allocations and receipts are voided and its charges reopen. Online payments cannot be voided. | FR-06, DR-24 |
| outstanding | — | The sum of `amount` of `open` charges in `published` or `closed` batches. | DR-18 |
| days past due | — | `buildingToday − due_date` of a charge. | DR-09, DR-18 |
| aging bucket | — | The class of an open charge by days past due: not yet due, 1–30, 31–60, 61–90, over 90. | FR-12, DR-18 |
| collection rate | — | Σ `amount` of `paid` charges ÷ Σ `amount` of non-void charges of non-recalled batches of a fee month. | DR-18 |
| payment | — | A posted receipt of money in the ledger: unit, source, amount, payer, reference. Its amount is exactly the sum of the whole charges it settles. Status `posted` or `void`. | DR-13, DR-84 |
| source (of a payment) | — | `cash`, `bank_transfer` (entered by the Manager) or `online` (settled from a confirmation). | DR-23 |
| manual payment | — | A payment the Manager records for whole charges, selected by the Manager; the system computes the amount, which is never typed. | FR-05, DR-23 |
| allocation | — | The link between a payment and one charge for the charge's full amount. Status `live` or `void`. Unique live allocation per charge. | DR-14, DR-84 |
| live allocation | — | An allocation with status `live`. A charge is `paid` exactly when one live allocation of its full amount exists. | DR-84 |
| ledger invariants | — | `charge paid ⇔ exactly one live allocation of the full amount` and `payment.amount = Σ live allocation.amount`. Checked nightly. | NFR-01, NFR-09, DR-15 |
| receipt | Biên lai thu tiền | The immutable document for one allocation, with a gapless number (`BL-YYMM-NNNN`) and a frozen snapshot. Titled "Biên lai thu tiền / Payment receipt" and states it is not a tax invoice. Status `issued` or `void`. | FR-05, DR-17 |
| receipt snapshot | — | The JSON frozen at issue (company, building, unit, payer, batch, lines, amount, method, reference). The only input of the receipt PDF. | DR-17 |
| `external_invoice` | — | The reserved nullable `finance.receipt` column for a future e-invoice integration. Not used in phase 1. | DR-17 |
| `finance.receipt_issued.v1` | — | The event written once per receipt; the integration seam for e-invoices. | DR-17, DR-42 |
| e-invoice | — | A legal electronic invoice. Out of the system: the company issues one only when a resident asks (a request of type "Khác"). | DR-17, DOC-01 |
| fee item | — | The name of a charge line (for example Management fee, Parking); the unit of the report "collection per fee item". | FR-35 |
| fee notice | — | The PDF and in-app view of a published charge, in Vietnamese, English or both. | FR-36, DR-56 |
| fee notice language | — | The building setting `feeNoticeLanguage`: `vi`, `en` or `both`. | DR-60 |
| batch code | — | `PH-YYMM-NN`, from the fee month; not gapless. | DR-10 |
| receipt number | — | `BL-YYMM-NNNN`, from the issue month in building time; gapless; a void receipt keeps its number. | DR-10 |
| intent code | — | `TT-YYMMDD-NNNN`, the display code of a payment intent. Not the transfer content. | DR-10 |
| ticket code | — | `YC-YYMMDD-NNN`. | DR-10 |
| gapless counter | — | The `GaplessCounter` helper: one `document_counter` row per series and period, incremented in the same transaction as the document, so a rollback leaves no gap. | DR-10 |
| reminder | — | A push sent to selected units with debt, at most one per unit per 24 hours. | FR-12, DR-18 |

## 3. Money log and money to check

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| money log | — | The viewable record of every authenticated confirmation (posted or not) and every unmatched statement line. It is two existing tables with review columns, not a ledger table. It never changes the ledger. | FR-47, DR-16, DR-84 |
| unposted money | — | Money that reached the bank but was not posted: a short, over, duplicate, wrong or instalment transfer. Handled by the Manager outside the system. | DR-84 |
| outcome | — | The value of `gateway_event.outcome`: `posted`, `amount_short`, `amount_over`, `duplicate_transfer`, `charge_already_paid`, `charge_recalled`, `unknown_order`. | DR-16 |
| `posted` | — | Outcome of an exact match: a payment exists. | DR-16 |
| `amount_short` | — | Outcome when the confirmed amount is below the intent amount. | DR-16 |
| `amount_over` | — | Outcome when the confirmed amount is above the intent amount. | DR-16 |
| `duplicate_transfer` | — | Outcome of a second transfer for an intent that is already `paid`. | DR-16 |
| `charge_already_paid` | — | Outcome of an exact amount when a charge of the intent is no longer `open` (paid by cash or another link). | DR-16 |
| `charge_recalled` | — | Outcome of an exact amount when a charge of the intent is `void`. | DR-16 |
| `unknown_order` | — | Outcome when no intent has the order code in this building. | DR-16 |
| match status | — | The value of `statement_line.match_status`: `matched`, `proposed`, `already_recorded` (no review needed) and `unmatched`, `statement_only` (reviewable). | DR-16, DR-35 |
| open (log row) | — | A reviewable row that is neither posted nor reviewed. | DR-16 |
| reviewed | — | State of a log row after the Manager marks it with a note of at least 5 characters, once. Handled outside the system; the ledger does not change. | FR-46, DR-16 |
| money to check | — | The dashboard counter of open log rows; a new open row alerts every active Manager and Admin (`finance.money_unposted.v1`). | FR-47, DR-16 |
| `UnitMoneyPanel` | — | The component that shows the log rows of one unit on the unit detail screen and on the debt screen. | DR-72 |
| `unmatchedTransfer` | — | The object `{amount, receivedAt}` returned in the status of an intent that is not `paid` after money was received and not posted (outcomes `amount_short`, `amount_over`, `charge_already_paid`, `charge_recalled`). The app shows a neutral message; no push, no inbox entry. | DR-84, DR-96 |
| refund | — | Returning a wrong transfer to the payer. Done by the Manager outside the system; the system keeps only the log. | DR-84 |

## 4. Online payment

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| payment intent | — | The server's promise "if the bank confirms order `orderCode` for this amount, these whole charges are paid". Lists the charges, owns the payOS link, and has a status. | original SDD §6.2, DR-28 |
| intent status | — | `creating`, `pending`, `cancelling`, `paid`, `failed`, `expired`, `cancelled`. `expired`, `cancelled` and `cancelling` still accept a late confirmation. | DR-28, DR-29 |
| active intent | — | An intent in `creating`, `pending` or `cancelling`. A charge can be in only one active intent. | DR-28 |
| `creating` (intent) | — | The link is being created at the gateway; the charges are already held. Older than 2 minutes, it is resolved by a `GET` by order code. | DR-28, DR-30 |
| `pending` (intent) | — | The link exists and the intent waits for a transfer. Re-queried every 5 minutes. | DR-30 |
| `cancelling` (intent) | — | A cancel was requested (resident, another payer, Manager, recall, void of a held charge); the cancel command is queued. Still accepts a late confirmation. | DR-31 |
| `paid` (intent) | — | Settled. Set only in the last step of settlement, together with the payment. | DR-29 |
| `failed` (intent) | — | The gateway refused or could not be reached and no link was found; the charges are released. | DR-30 |
| `expired` (intent) | — | 60 minutes passed without a confirmation; the link is cancelled and the charges are released. Still accepts a late exact confirmation. | DR-30 |
| `cancelled` (intent) | — | The link was cancelled at the gateway or locally; the charges are released. Still accepts a late exact confirmation. | DR-31 |
| hold | — | The state of a charge listed in an active intent: a `payment_intent_item` with `released_at IS NULL`. | DR-28 |
| supersede rule | — | A creation request that conflicts only with an intent whose `display_until` has passed cancels that intent and creates the new one. | DR-28 |
| `display_until` | — | The end of the QR display validity of an intent (30 minutes). The charges stay held until the intent leaves the active states (60 minutes). | DR-28 |
| order code | — | The integer `order_code` of an intent from `finance.order_code_seq` (starts at 1,000,000), unique per payOS merchant. | DR-27 |
| transfer content | — | The text the payer types or the QR carries: `TT` plus the order code in Crockford base 32, at most 9 characters (order code 2610153 gives `TT2FMZ9`). Matching never depends on it. | DR-27 |
| payOS | — | The payment gateway of phase 1: a payment link per intent that returns a VietQR payload and sends a webhook. | ADR-0007, DR-25 |
| payOS link | — | The payment link created at payOS for one intent: `qrCode`, `checkoutUrl`, `orderCode`. | DR-27 |
| VietQR | — | The Vietnamese interbank QR standard. The payOS `qrCode` is an EMVCo VietQR string, rendered locally. "VietQR" is also the name of a possible second provider (`api.vietqr.vn`); documents say "the VietQR provider" for that meaning. | DR-25, DR-27 |
| payment gateway | — | The external service that issues links and reports transfers, behind the `PaymentGateway` port. | ADR-0007 |
| `PaymentGateway` port | — | The interface (create, get status, cancel, verify webhook) implemented by the drivers `payos` and `fake`. | DR-26 |
| driver | — | One implementation of a port, chosen by configuration: payment `payos` or `fake`; SMS and mail `console`, `allowlist`, `provider`. | DR-26, DR-37 |
| fake driver | — | The test double of the gateway: stores links in a table, lets a test set a link `PAID`, `CANCELLED` or `EXPIRED`. Allowed only for a demo building in `local` and `staging`. | DR-26 |
| payment simulator | — | The CLI `bun run payos:sim` that signs payloads and posts them to the real webhook route (repeat, shuffle, delay, wrong signature). | DR-26 |
| gateway configuration | — | `building.gateway_config`: provider, driver, receiving account, status and `secrets_enc`. One active row per building and provider. Edited by Admin with step-up. | DR-33 |
| `secrets_enc` | — | One AES-256-GCM encrypted JSON blob (`v1:<keyId>:<iv>:<ciphertext+tag>`) holding the provider secrets; the fields are defined by each driver. | DR-33 |
| receiving account | — | The bank account that receives the transfers, stored in the gateway configuration. Changing it needs step-up and no active intent. | DR-33 |
| webhook | — | The signed HTTP call from the gateway to `/api/v1/payments/webhooks/<provider>/{gatewayConfigId}` that reports a transfer. The HMAC signature is the only gate. | DR-32 |
| webhook rejection | — | A row in `finance.webhook_rejection` for a call that failed a check (`bad_signature`, `bad_account`, `malformed`, `unknown_config`, `foreign_building`). Never in `gateway_event`. | DR-32 |
| re-query | — | Asking the gateway for the status of an intent by order code: by the job every 5 minutes for 60 minutes, or when the resident presses "I have transferred". | FR-10, DR-30 |
| confirmation | — | An authenticated report that a transfer was paid, from the webhook, the re-query or the statement path. The input of `settle()`. | DR-29 |
| `gateway_event` | — | One row per authenticated confirmation, unique on `(provider, reference)`; holds the outcome and links the payment when posted. It is the first arbiter of the webhook-versus-re-query race. | DR-13, DR-16 |
| settlement / `settle()` | — | The one function that turns a confirmation into a payment, allocations and receipts, or into a log outcome. Used by the webhook, the re-query and the statement path. | FR-08, DR-29 |
| late confirmation | — | A confirmation that arrives after the intent expired or was cancelled. Posted if the amount is exact and every charge is still `open`; otherwise logged. | DR-29 |
| intent cancel | — | The outbox command `finance.intent_cancel_requested.v1` that cancels the link at payOS. Best effort; correctness never depends on it. | DR-31 |
| `payment_in_progress` | — | The 409 code returned when another intent holds a selected charge. | DR-28, DR-74 |
| payer | — | The owner, family member or tenant with `can_pay` who creates a payment intent. Not the same as the payer name printed on a receipt, which is a snapshot string. | FR-07.1, UC-03 |

## 5. Bank-statement reconciliation

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| bank statement | — | The file (XLSX or CSV) of the receiving account's credit and debit lines, imported by the Manager. Only credit lines are used. | FR-11, DR-34 |
| statement import | — | `statement_import`: one uploaded statement with its profile, period and counts. Files are kept 1 year. | DR-34 |
| statement profile | — | JSON that maps a bank's columns (sheet, header row, date format, separators). The first profile comes from a real sample; until then a generic profile that the Manager maps once. | DR-34 |
| statement line | — | `statement_line`: one credit line with a `match_status`. | DR-34 |
| dedup key | — | `sha256(bank_reference ‖ booked_on ‖ amount ‖ normalized(content))`; a repeated line is `already_recorded`. | DR-34 |
| reconciliation | — | Matching statement lines to payments in the order: reference, order code, manual transfer, otherwise unmatched. It can settle only after payOS confirms. | FR-11, DR-35 |
| not seen in bank | — | A posted `online` or `bank_transfer` payment older than 3 days with no statement line, within an imported period. A list, not a log row. | DR-35 |

## 6. Support tickets

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| ticket | Yêu cầu (staff and web: Phiếu, "Phiếu hỗ trợ") | A resident's support request about a unit, with type, title, description, location, photos and video. Exactly one status and at most one assignee at any time. The resident app says "Yêu cầu"; the staff app and the web CMS say "Phiếu" (DR-197). | FR-19, DR-43, DR-197 |
| ticket status | — | `submitted`, `assigned`, `accepted`, `in_progress`, `on_hold`, `resolved`, `closed`, `cancelled`. Residents see five simplified labels (Sent, Accepted, In progress, Completed, Cancelled). | DR-44, DR-45 |
| `submitted` | — | Ticket state: sent by the resident and waiting for the Manager. Resident label "Sent". | DR-44 |
| `assigned` | — | Ticket state: the Manager chose an assignee who has not accepted yet. | DR-44 |
| `accepted` | — | Ticket state: the assignee accepted. | DR-44 |
| `in_progress` | — | Ticket state: work started. | DR-44 |
| `on_hold` | — | Ticket state: work paused with a reason (parts, time). | DR-44 |
| `resolved` | — | Ticket state: the assignee reported done with photos and a note; awaiting close. | DR-45 |
| `closed` | — | Ticket state: the Manager closed it; the resident sees "Completed" and may rate. | FR-23 |
| `cancelled` | — | Ticket state: cancelled by the resident (only while `submitted`) or by the Manager with a reason. | FR-19, FR-42 |
| ticket type | — | One of five seeded kinds (repair, cleaning, security, complaint, other) with a bilingual name and a default department. | DR-43 |
| assignee | — | The Technician or Guard a ticket is assigned to. | FR-20, DR-46 |
| assignment | — | The Manager's act of choosing an assignee, with an optional appointment time and note. | FR-20 |
| workload | — | The count of a staff member's open tickets, shown when assigning. | FR-20, DR-46 |
| reject reason | — | `wrong_skill`, `busy`, `needs_equipment` or `other`, plus a note of at most 300 characters, given when an assignee rejects. | FR-21, DR-44 |
| awaiting close | — | The Manager's view of a `resolved` ticket. The resident still sees "In progress". | FR-22 |
| reopen | — | The Manager moves a `resolved` ticket to `in_progress`, or a `closed` ticket to `assigned`. | FR-23 |
| public message | — | A ticket message visible to the resident; the default for staff messages. | DR-45 |
| internal note | — | A ticket message visible to staff only. No resident DTO has a field that could carry it. | FR-24, DR-45 |
| `urgent` | — | A flag on a ticket set by Manager or Admin. | DR-44 |
| rating | — | 1–5 stars and a comment given once by the resident on a closed ticket. | FR-23 |
| ticket deadline | — | Due time and overdue alerts per ticket type. Phase 2; `due_at` exists but nothing reads it. | DR-47 |
| `ticket_event` | — | The timeline row of every transition; the source of handling-time statistics. | DR-43 |

## 7. QR code, vehicles and lookup

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| QR credential | — | `access.qr_credential`: one row per membership holding the current nonce. | DR-48 |
| nonce | — | The random value in the QR credential. Opening the QR screen rotates it, which invalidates every earlier code of the membership. | FR-25, DR-48 |
| QR token | — | The signed string `v1.<payload>.<HMAC>` with `{b, m, n, cv, iat, exp}`, valid 15 minutes. | DR-48, ADR-0012 |
| scan | — | A guard's submission of a QR token to the server, checked in order: signature, building, expiry, nonce, membership status and `credential_version`. | FR-26, DR-48 |
| scan result | — | `valid`, `expired` or `invalid`. Replaced and revoked codes share `invalid` so a scan reveals nothing. | FR-26 |
| masked phone | — | A phone shown as `090••••123` with a Call button that dials through `tel:`; every view is logged. | NFR-14, DR-48 |
| lookup log | — | `access.lookup_log` and `access.qr_scan`: who looked at what; scans kept 90 days. | DR-48 |
| lookup | — | A search by unit code, resident name, phone suffix or plate over units, residents and approved plates. | FR-31, DR-41 |
| vehicle | — | A registered car, motorbike or electric bike of a unit, with plate, photos and the registration paper. | FR-30, DR-49 |
| vehicle status | — | `pending`, `approved`, `rejected`, `retired`. | DR-49 |
| vehicle revision | — | A pending edit of an approved vehicle; the approved data stays visible to Guards during review. | DR-49 |
| plate key | — | The normalized plate: upper case, only letters and digits (`51F-123.45` gives `51F12345`). | DR-49 |
| retire | — | Removing a vehicle: it no longer shows to Guards and its plate key is free. | FR-43 |
| vehicle limit | — | The building setting `maxCarsPerUnit` (default 2); exceeding it warns the Manager and never blocks. | DR-60 |

## 8. Notices, notifications and push

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| notice | — | A bilingual announcement from the Manager to an audience, with category, attachments, pin and display expiry. Content and audience never change after sending. | FR-27, DR-50 |
| notice category | — | `general`, `maintenance`, `urgent` or `event`. | original SDD §10.1 |
| audience | — | Who a notice goes to: all resident member types (helpers included) and any of the staff roles Manager, Technician, Guard. | DR-50 |
| notice status | — | `draft`, `scheduled`, `sending`, `sent`. | original SDD §10.1 |
| fan-out | — | Resolving a notice to recipient rows in batches of 500 and creating one inbox entry and at most one push per recipient. | FR-29, DR-51 |
| recipient | — | A row of `notice_recipient`: the account that a notice was resolved to, with locale, member type, `read_at` and `push_status`. A person who joins later is not a recipient. | DR-50, DR-51 |
| read state | — | `notice_recipient.read_at`, the single source of truth; the inbox entry follows through `notices.notice_read.v1`. | DR-51 |
| heartbeat reclaim | — | A stuck `sending` notice is reclaimed when `sending_heartbeat_at` is older than 5 minutes; the worker updates it after each batch. | DR-51 |
| pinned notice | — | A notice shown on the resident home for its recipients. | DR-50 |
| display expiry | — | `display_until`: hides a notice from lists after a date without deleting it. | DR-50 |
| rich-text subset | — | The fixed set of TipTap nodes and marks allowed in notices and library pages (paragraph, headings 2–3, lists, hard break, image by file id, bold, italic, underline, link). | DR-50 |
| inbox entry | — | A row of `notification.inbox_entry`: a template key and parameters for one account (and optionally a unit). Not the consumer inbox of the messaging runtime (§10). | DR-53 |
| template key | — | The key of a notification text in the shared vi/en catalog (`fee.batch_published`, `payment.received`, …). The inbox stores keys and parameters, never text. | DR-53, DR-71 |
| push notification / Expo push | — | A message to a device through Expo Push (FCM and APNs). The text comes from a template in the recipient's language. | FR-29, DR-52 |
| payload privacy rule | — | A push contains no amounts, names, phone numbers or ticket text; `data` carries only `{route, unitId, entityId}`. | DR-52 |
| device token | — | `notification.device_token`: an Expo push token of a session; reassigned if registered to another account, deleted on sign-out. | DR-52 |
| push ticket / push receipt | — | The id Expo returns for an accepted message, stored in `push_ticket`; its receipt is read 15 minutes later. `DeviceNotRegistered` deletes the token. | DR-52 |
| unit visibility (inbox) | — | An inbox entry with a `unit_id` is shown only while the account has an active membership of that unit. | DR-53 |
| SMS brandname | — | A registered sender name for OTP SMS in Vietnam; approval takes calendar time. | DR-68 |

## 9. Library, reports and files

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| document library (wiki) | — | The folder tree of bilingual pages with attachments, video links and role visibility. Only Manager and Admin write. | FR-32, DR-54 |
| folder / page | — | A folder (depth at most 5) holds folders and pages; a page has versions. | DR-54 |
| page version | — | An appended row on each save; the published version is pointed to by `published_version_id`. The last 50 are kept. | FR-32, DR-54 |
| visibility | — | The groups that may read a folder or page: resident, manager, technician, guard. Admin and Manager always read and write; helpers read nothing. | DR-54 |
| effective readers | — | The readers of a page: its own `visibility_override`, else the nearest ancestor folder's `visibility`, computed at read time by one recursive query. Nothing is stored. | DR-54 |
| dashboard | — | The Manager's overview: collection rate, total debt, open and unassigned tickets, vehicles pending, latest notice read rate, money to check. | FR-34, DR-18 |
| report | — | One of `collection_by_fee_item`, `debt_aging`, `collection_by_month`, `online_transactions`, `tickets_summary`, `staff_workload`. | FR-35, DR-55 |
| export job | — | `reporting.export_job`: a requested Excel or PDF export, run by the worker; file kept 7 days, delivered as a 15-minute signed URL. | FR-48, DR-55 |
| export center | — | The screen where requested exports are listed and downloaded. | FR-48, DR-72 |
| file object | — | `building.file_object`: the ledger of every stored file (`pending`, `verified`, `attached`, `deleted`); the basis of the quota. | FR-40, DR-61 |
| presigned PUT | — | The upload method for files: a short-lived URL with a signed `Content-Type`. R2 has no presigned POST. | DR-61, DR-83 |
| signed URL | — | A presigned `GET` URL for a file, valid 15 minutes (5 for a vehicle paper), given inside an authorised response; a bearer token that is never logged or stored. | DR-61, DOC-37 §8 |
| verify (a file) | — | The call after the client's `PUT`: `HEAD` for size and type, a ranged `GET` for the first bytes; passes to `verified` or deletes the file. | DR-123, DOC-37 §6.3 |
| thumbnail | — | The 480 px WebP copy of an image (512 px for the logo), a `file_object` row of purpose `thumbnail` made by the worker. | DR-122, DOC-37 §10 |
| generated file | — | A file the system writes itself (receipt and fee-notice PDFs, bulk ZIP, export): stored as account kind `system`, never refused by the quota. | DR-123, DOC-37 §9 |
| upload verification | — | After an upload the server reads the size with `HEAD`, deletes an oversized object, and checks the first bytes against the allowed type before attaching. | DR-61 |
| storage quota | — | The per-building cap (default 50 GiB, `storageQuotaBytes` = 53,687,091,200); Admin is alerted at 80% and uploads are refused at 100% (413 `quota_exceeded`). | FR-40 |
| orphan upload | — | A file still `pending` or `verified` 24 hours after it was registered because no module attached it; the hourly job deletes it. | DR-61, DR-112 |
| import job | — | `<module>.import_job`: a stored Excel upload with its validated preview. Status `validated`, `failed`, `committed`, `expired`. Validation is synchronous in the API. | DR-21 |
| preview (import) | — | The counts, the first 50 valid rows and up to 500 row errors returned by the validating request. | DR-21 |
| header alias | — | A Vietnamese or English name accepted for an Excel column. | DR-22 |
| data-quality rule (`DQ-xx`) | — | One check of an import, with its layer (`file`, `row`, `set`, `db`, `commit`, `post`), severity (`fail`, `error`, `warning`, `info`), action, threshold and error code. The catalog is DOC-18. | DOC-18 |
| stale import (`import_stale`) | — | The 409 answer when the commit finds that the data changed since the preview (the counts differ). Nothing is written; the user uploads the file again. | DR-114, DOC-18 |
| Excel template | — | The downloadable file for a kind (`fee_batch`, `unit_owner`). | DR-22 |

## 10. Platform and processing

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| gate (request gate) | — | One check a request meets on its way to a use case, in a fixed order: maintenance, CORS, media type and size, app version, IP bucket, authentication, role or unit guard, terms, step-up declaration, account buckets, validation. A request without a valid credential never receives a validation answer. | DR-143, DOC-50 §7 |
| `operationId` | — | The unique lowerCamel name of an endpoint in OpenAPI (`createPaymentIntent`), fixed in DOC-51 §2 together with `x-endpoint-id`. | DR-142, DOC-50 §3 |
| `ImportHandler` | — | The interface by which a module serves one `kind` of import behind the shared routes `POST /staff/imports`, `GET /staff/imports/{id}` and `POST /staff/imports/{id}/commit`: `{kind, validate, get, commit}`. `apps/api` routes by `kind`. | DR-149, DOC-51 §10 |
| public config | — | `GET /public/config`: the minimum app versions, store links, languages and the Manager's contact block, answered without a token and cached 60 seconds. | DR-145, DOC-51 §3 |
| session id (`sid`) | — | The id of a refresh family, carried in the access token; the key of the session list, of a revocation and of a device token. | DOC-26 §3 |
| `request_in_progress` | — | The 409 a duplicate of an unfinished create receives while its idempotency key is `in_progress`; the client retries with the same key. | DR-143, DOC-42 §5.1 |
| modular monolith | — | One deployable API made of modules with their own schema and public contracts. Chosen because the money invariant needs local database transactions. | ADR-0002 |
| module | — | A business unit of the code with its own schema: `identity`, `building`, `residency`, `finance`, `tickets`, `access`, `vehicles`, `notices`, `notification`, `wiki`, `audit`, `reporting`, `realtime`. | DR-03 |
| DTO | — | A plain data object returned by a contract or an endpoint; contains no domain behavior and, for residents, no staff-only field. | DR-42 |
| contract (`contracts/`) | — | The only entry point of a module for other modules: synchronous interfaces with plain DTOs and versioned events. Enforced by dependency-cruiser. | DR-42, ADR-0004 |
| event | — | A versioned message `<module>.<name>.v1` written to the producer's outbox in the state-change transaction. | DR-42 |
| outbox | — | The table, per module, where events and commands are written in the transaction of the change and later relayed. | ADR-0009 |
| relay | — | The worker process that reads the outbox and delivers to handlers: poll 500 ms when idle, batch 50, lease 60 s, 8 attempts. | DR-62 |
| inbox (consumer) | — | The per-consumer table that makes a handler idempotent: a handled message id is recorded once. A different thing from an inbox entry (§8). | ADR-0009 |
| dead letter | — | A message that failed all attempts and is parked; an alert fires. | DR-62 |
| command | — | A message addressed to one handler (intent cancel, receipt render, SMS, mail), as opposed to an event with many consumers. | DOC-09 |
| envelope | — | The wire format of every outbox message: `id`, `type`, `source`, `aggregateId`, `occurredAt`, `payload`, `headers`. | DOC-09 §3 |
| handler (consumer group) | — | A named consumer of one message type, `<module>.<effect>_on_<producer>_<event>`. The pair (module, handler name) is the second half of the inbox key; a message with three handlers is delivered to each. | DOC-09 §3.3 |
| inbox mode | — | How a handler records that it ran: `transactional` (database effect, one transaction with the inbox row), `afterSideEffect` (SMTP, SMS, Expo, payOS, R2: check, do, record) or none (live SSE). | DOC-09 §4.3 |
| retry class | — | The number of attempts a message type gets: `default` (8), `sms` (3), `push` (3), `intent_cancel` (8). | DR-118, DOC-09 §4.2 |
| retry later | — | The outcome of a handler that throws `RetryLaterError`: the attempt is given back and the message returns after a delay, dead only after 24 hours. For provider rate limits. | DOC-09 §4.4 |
| message part | — | One of the messages of a chunked action: at most 500 ids per message, with `part` and `parts`. | DR-118, DOC-09 §3.4 |
| `secretEnc` | — | The field of `identity.sms_requested.v1` and `identity.mail_requested.v1` that holds the OTP, link token or step-up code encrypted with the settings key ring; never plaintext in an outbox row. | DR-117 |
| job | — | A timer-driven task in the worker (`notice_scheduler`, `intent_requery`, `invariant_check`, purges …). Each run writes `job_run`. | DR-62 |
| `job_run` | — | The row `building.job_run` written by every job run; feeds the "last success" metrics. | DR-62 |
| job mode | — | How a job stays safe if two workers run it: `claim` (rows claimed with `SKIP LOCKED`), `lock` (advisory lock at the start of every transaction), `snapshot` (one read-only transaction that holds the lock). | DR-121, DOC-38 §3.2 |
| slot, grace window | — | A slot is a scheduled time of a clock job. The grace window is how late a missed slot may still run once, after a restart (none for hourly, 12 h daily, 24 h weekly, 7 days monthly). | DR-120, DOC-38 §3.3 |
| advisory lock | — | A PostgreSQL lock used for singleton jobs: the transaction-level `pg_try_advisory_xact_lock`, safe behind a pooler. | DR-62, ADR-0015 |
| `SKIP LOCKED` | — | The `FOR UPDATE SKIP LOCKED` clause used to claim work rows so workers take disjoint rows. | DR-30 |
| arbiter | — | The one row whose conditional update decides a race (the charge, `gateway_event`, the intent, the ticket, the QR nonce, the OTP challenge). The loser sees zero rows. | original SDD §2.1, §8.2 |
| conditional update | — | `UPDATE … WHERE <expected state> RETURNING`; zero rows means the state already changed. | DR-14 |
| `version` | — | An integer on aggregates edited by several actors, used for optimistic locking with `If-Match`. | DR-12, DR-74 |
| idempotency key | — | The `Idempotency-Key` header stored in `platform.idempotency_key`: the same key with the same body replays the stored response (`Idempotent-Replayed: true`). One key per user intent, 8…128 characters, required on the routes marked `R` in DOC-51; only a committed 2xx is stored. | DR-74, DR-143, DOC-50 §8 |
| request id | — | The `X-Request-Id` on every request and log line; the only means of following one request in phase 1 (no traces). | DR-63 |
| rate bucket | — | A PostgreSQL token bucket (`identity.rate_bucket`) that limits OTP, sign-in and other endpoints. | DR-64 |
| audit log | — | `audit.audit_log`: an append-only row per staff mutation, written in the mutation's transaction. | FR-37, DR-57 |
| `actor_kind = 'system'` | — | The audit actor of a settlement posted by the webhook, the re-query or the statement path. | DR-57 |
| `pii.read` | — | The audit action for reading CCCD or date of birth: one row per detail view and one per export (with the record count). | DR-57, DR-58 |
| audit action | — | The name of an audited mutation, `<module>.<object>.<verb>` (or `pii.read`), declared in the module's manifest and listed in DOC-35 §4; `AuditApi.record` refuses an undeclared one. | DR-124 |
| bulk form (audit) | — | One audit row for an action over many rows: it names the parent object, `changes` is empty and the counts are in `details`. | DR-124 |
| terms gate | — | The check, on every resident request, that the latest `terms` and `privacy` versions are accepted; if not, 403 `terms_required`. Not cached; `/auth/*`, `/me`, `/me/terms*` and `/me/account/deletion` are exempt. | DR-59, DR-125 |
| `SecretBox` | — | The AES-256-GCM helper of `@core/core`: blob `v1:<keyId>:<iv>:<ciphertext+tag>`, newest key = highest `k<n>`, additional data bound to the row so a blob cannot be moved. | DR-33, DR-126 |
| boot guard | — | The checks run at start by `api` and `worker` that refuse to boot (exit 78) when the demo and real data are mixed: a flagged account in a real building, a `fake` driver in a real building, a stored secret whose key is gone. | DR-60, DR-126 |
| demo reset | — | The deletion and reseeding of the demo building in one transaction, run nightly at 04:00 and through `POST /staff/demo/reset`; every module asserts `is_demo` first. | DR-60, DR-126 |
| rule violation | — | A request that is well-formed but breaks a business rule: 422 `validation_failed` (a schema violation is 400). The status belongs to the rule code. | DR-127 |
| `invalid_transition` | — | The generic 409 for an action the object's current state does not allow. | DR-127 |
| retention class | — | The generated column `audit_log.retention_class`: `finance` (action starts with `finance.`, kept 5 years) or `standard` (kept 2 years). `audit.purge` selects on it. | DR-57, DR-110 |
| append-only table | — | A table the runtime role can only `SELECT` and `INSERT` (`audit.audit_log`); a trigger is a second layer. | DR-57, DR-110 |
| maintenance flag | — | The single row `platform.maintenance`: while `active`, every process answers 503 `maintenance`. Written by the deploy script with the migration role, read by the application role. | DR-85, DR-112 |
| SSE | — | Server-sent events: the stream `GET /staff/events` that updates the web CMS; heartbeat at least every 30 s. Mobile apps do not use it. | DR-75 |
| `api` role / `worker` role | — | The two values of `APP_ROLES` of the one image: `api` serves HTTP; `worker` runs the relay and the jobs. | DR-05 |
| core packages (`core-*`) | — | The reference repository's infrastructure packages, copied (vendored) into this repository under `@core/*`. The reference's `kit-*` names appear only in the mapping table of DOC-12. | DR-02, ADR-0003 |
| `CORE_VERSION` | — | The file `packages/CORE_VERSION` holding the upstream commit SHA of the vendored packages. | DR-02 |
| reference repository | — | The Bun/Elysia reference architecture (`../elysia-architecture`) that this project follows as a standard. | DR-02, DR-03 |
| scope lint | — | The merge-gate rule that rejects a query on a scoped table without `BuildingScope`. | DR-12 |
| `buildingToday` | — | The helper returning today's date in the building time zone; every business calendar rule uses it. | DR-09 |
| building time | — | The zone of `building.time_zone` (default `Asia/Ho_Chi_Minh`). Servers and PostgreSQL run in UTC. | DR-09, ADR-0013 |
| route `audience` | — | Route metadata that every route declares (`public`, `resident`, `staff`, `system`…). The authorization-matrix generator reads it and a route without it fails the build. | DR-99, EXP-10 |
| guard (code) | — | One of the three request guards built in the composition root and injected into modules as `host.guards`: `resident`, `unit(capability)`, `staff(...roles)`. Not the Guard staff role. | DR-99, DOC-12 §5.3 |
| `StaffContext` | — | The request context of a staff call: account id, role, building. | DOC-12 §11 |
| `LocalDate` | — | The branded `YYYY-MM-DD` type for `fee_month`, `due_date` and other building-calendar dates. | DR-09, DR-100 |
| `Money` | — | The branded `bigint` of the domain; an integer JSON number at the edge. Never a float. | DR-11, DR-100 |
| vendored package | — | A reference package copied into `packages/core-<name>` and owned by this repository from then on. | DR-02 |
| local change | — | An edit made to a vendored package after the copy, listed in `packages/CORE_VERSION` so a manual sync can re-apply it. | DR-02, DR-98 |
| allow-list (scope lint) | — | The explicit list of tables exempt from the `building_id` predicate check because they are looked up before a building is known, belong to an account spanning buildings, or are infrastructure. Reasons in DOC-14 §5.3. | DR-12, DR-104 |
| scoped list | — | The tables that must be queried with a `BuildingScope` argument or a `building_id` predicate; generated from the module schemas. | DR-12, DOC-12 §7 |
| bootstrap migration (`0000-bootstrap.sql`) | — | The first migration: creates extensions, schemas, the `platform` tables and shared SQL helper functions. | DR-105, DOC-14 §2.1 |
| database roles (`rms_*`) | — | `rms_migrator` (owns the objects, runs migrations and the deploy), `rms_app` (DML for `api` and `worker`, no DDL), `rms_readonly` (support and metrics, no secrets) and `rms_backup` (dump and backup functions). One application role, not one per module. | DR-67, DR-113, DOC-19 |
| grants step (`0900-grants.sql`) | — | The idempotent script, run by `rms_migrator` at the end of every `db:migrate`, that computes the privileges of `rms_app` and `rms_readonly` from nothing. A table it has not covered is closed (fail closed). | DR-113, DOC-19 §4 |
| denied table | — | A table `rms_readonly` cannot read at all (sessions, codes, link hashes, stored responses, push tokens, every outbox). | DR-113, DOC-19 §4.2 |
| history schema (`drizzle_<module>`) | — | The schema where drizzle-kit keeps the applied-migrations table of one module. | DOC-14 §14 |
| expand/contract | — | A migration style in two releases: add what the new code needs, switch the code, then remove what the old code used. No down migrations. | DR-08, DR-105 |

## 11. Infrastructure and delivery

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| VPS | — | The one virtual server per environment that runs Caddy, `cloudflared`, `api`, `worker`, monitoring and native PostgreSQL. | DR-83 |
| Cloudflare Tunnel (`cloudflared`) | — | The outbound tunnel from Cloudflare to Caddy; the VPS has no inbound port. | DR-83 |
| Caddy | — | The reverse proxy inside the VPS (plain HTTP; TLS ends at Cloudflare). | DR-83 |
| Cloudflare Pages | — | Hosting of the static web CMS at `admin.<domain>`. | DR-83 |
| R2 | — | Cloudflare's S3-compatible object storage: a files bucket and a backup bucket per environment. | DR-83, ADR-0016 |
| pgBackRest | — | The backup tool: weekly full, daily differential, continuous WAL archive to R2. | DR-66, ADR-0017 |
| PITR | — | Point-in-time recovery from a base backup plus archived WAL. | DR-66 |
| uptime probe | — | The external check of `GET /api/v1/health/ready` every 60 seconds that measures availability. | NFR-10, DR-80 |
| RPO / RTO | — | Recovery point objective (at most 5 minutes of data lost) and recovery time objective (at most 4 hours). | NFR-11 |
| Expo SDK | — | The version family of the mobile framework (58 at the 2026-10-18 snapshot) that bundles React Native. | DR-82 |
| EAS / EAS Update | — | Expo Application Services: cloud builds of the binaries, and over-the-air updates of JavaScript per channel. | DR-69 |
| development build | — | An EAS build of the app with native modules, used instead of Expo Go. | DR-82 |
| New Architecture | — | React Native's current architecture; the only one targeted. | DR-82 |
| `MIN_APP_VERSION` | — | The minimum app version per app; older clients get 426 `upgrade_required`. | DR-69 |
| currency policy | — | Every dependency is the latest stable, verified on the web with the date and source recorded in DOC-11. | DR-82 |
| Prometheus, Alertmanager, Grafana, Loki, Alloy | — | The observability stack; Alloy collects logs into Loki. No traces in phase 1. | DR-63 |
| trust boundary (TB1–TB10) | — | A numbered line in the container diagram where the caller changes and a credential is checked (for example TB1 resident app to API, TB4 payOS webhook to API). The STRIDE table of the security document walks them. | DOC-07 §7, DOC-39 |
| deployment unit | — | A process or container that is started and stopped on its own: `api-1`, `api-2`, `worker`, `caddy`, `cloudflared`, monitoring. | DR-05, DOC-07 §4.3 |
| ops port | — | The internal port that serves `/health/*` and `/metrics`; neither Caddy nor the Tunnel routes it. Configured by `OPS_PORT`. | DR-07, DOC-07 |
| authorization matrix | — | The generated test of EXP-10: every route called as each of 16 actors on the `own` and `foreign` scope, with the expected outcome computed from the route's `audience` metadata. It passes with 0 unexpected 2xx. | DR-151, DOC-39 §4 |
| unexpected refusal | — | A matrix cell that should pass the gate (`ALLOW`) but answers 401, 403 or 404. It fails the run like an unexpected 2xx. | DR-151 |
| client IP | — | The address `clientIp()` returns: the socket peer, or `CF-Connecting-IP` when the peer is a trusted proxy. A bucket key uses the `/64` prefix of an IPv6 address. | DR-152, DOC-39 §5.3 |
| `job_name` | — | The label that names a job in a metric (`job_last_success_timestamp{job_name}`); the label `job` is Prometheus's own. | DR-154 |
| silence (alert) | — | An Alertmanager silence: how an operator acknowledges an alert and stops its repeats. | DR-155, DOC-40 §6 |
| boot validation | — | The 13 rules `loadConfig` checks before a process starts; a failure writes one `config_invalid` line without secret values and exits 78. | DR-156, DOC-41 §17 |
| `platform` schema | — | The schema owned by the vendored core packages, not by a module: `maintenance`, `idempotency_key` and `rate_bucket` for every limiter except sign-in, OTP and reset. | DR-85 |
| autonomous transaction | — | A transaction on a separate pool connection (`database.autonomous`) that commits before the ambient one ends. Only `identity` uses it, to count failed step-up proofs so that the count survives the rollback of the action. | DR-132, DOC-12 §8.1 |
| composition root | — | The place where an app wires modules together (`apps/api`): the only code allowed to import several modules' manifests. | DOC-07, DOC-12 |
| Access service token | — | The Cloudflare Access credential that lets the CI deploy job reach the VPS over the Tunnel. | DR-83 |
| integration (`integrations/<consumer>`) | — | An entry point of a producer module written for one named consumer module; it is the only code that translates the producer's contract for that consumer. | DR-04, DR-42 |
| data owner | — | The one module that writes a table, topic or bucket prefix; other modules read it only through a contract. | DOC-07 §6 |
| resource ceiling | — | The memory or CPU limit set on a container (`mem_limit`, `cpus`). The ceilings of all units may add up to more than the host has (bounded overcommit). | DR-06, DR-102 |
| stress day | — | The day of the month when load peaks: batch publication and the two hours before the due date. The capacity estimate sizes for it. | DOC-10 §5 |
| degraded mode | — | What a unit does at its limit instead of failing: refuse new uploads, queue exports, answer 429, keep the settlement path alive. | DOC-10 §8 |
| stalled archive | — | PostgreSQL cannot hand WAL segments to pgBackRest, so `pg_wal` grows until the disk fills. Alert on `pg_stat_archiver.failed_count`. | DR-66, DOC-10 §6 |
| release (on the host) | — | One unpacked tarball of `docker/` and `ops/` at `/opt/rms/releases/<tag>`; `/opt/rms/current` points at the running one and the last five are kept. | DR-158, DOC-70 §3.2 |
| `gate` | — | The one required status check of `main`: it fails unless every CI job that ran finished `success` or `skipped`. | DR-163, DOC-71 §4 |
| smoke test | — | The short set of public requests run after a deploy (ready, public config, the ops route is 404, the admin headers, and on staging a demo staff sign-in); `ops/deploy/smoke.sh`. | DR-163, DOC-71 §7.3 |
| promote (a release) | — | Adding the tag `vX.Y.Z` to the `sha-<7>` image that passed staging, instead of building again. | DR-164, DOC-71 §7.4 |
| compose profile | — | A Compose switch that starts optional services: `api2` (second API), `logs` (Loki, Alloy), `deploy` (the one-shot `migrate`). | DR-161, DOC-70 §6.1 |
| Bot Fight Mode | — | A Cloudflare zone setting that challenges suspected bots; it cannot be skipped by a rule on the free plan, so it is off for the zone. | DR-160 |
| `ssh-<env>` host | — | The Tunnel hostname of type SSH (behind Access) through which operators and CI reach the VPS. | DR-158 |

## 12. Documents, process and testing

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| original SDD | — | The file `residential-management-sdd.md`, the system design document the plan was made from. Never edited by the plan. | |
| UAT | — | User acceptance test: the Manager runs the agreed script on staging and signs. | DOC-103, M6 |
| DR | — | A decision register entry. State `Proposed`, `Decided` or `Changed`. | `00-decision-register.md` |
| ADR | — | An architecture decision record in `04-adr/`. | DOC-13 |
| DOC | — | A document of the plan, numbered `DOC-01…103`. | master plan §3.1 |
| FR / NFR | — | Functional / non-functional requirement. FR-41…50 are "(added)". | DOC-03 |
| UC | — | A use case. | DOC-04 |
| PS / J | — | A persona / a journey. | DOC-02 |
| `F-<GROUP>-xx` | — | A feature of the catalog, in groups `ACC`, `UNI`, `VEH`, `QRC`, `NOT`, `TIC`, `FEE`, `PAY`, `WIK`, `DSH`, `SYS`. | DOC-05 |
| `E-xx` | — | An API endpoint of the endpoint catalog. | DOC-51 |
| `FL-xx` | — | A detailed flow. | DOC-43 |
| `DQ-xx` | — | A data quality rule. | DOC-18 |
| `EXP-xx` | — | One of the 12 experiments. | DOC-89 |
| `RB-xx` | — | A runbook. | DOC-74 |
| `UX-nn` | — | A numbered UX principle (UX-01…20). A screen document cites the principles it relies on. | DOC-53 §2 |
| `UI…-nn` | — | Test and acceptance-criterion ID of one screen document: `UIRA-` (DOC-57), `UIRF-` (DOC-58), `UIRU-` (DOC-59), `UIRQ-` (DOC-60), `UISM-` (DOC-61), `UIST-` (DOC-62), `UISG-` (DOC-63), `UIWO-` (DOC-64), `UIWR-` (DOC-65), `UIWF-` (DOC-66), `UIWS-` (DOC-67), `UICP-` (DOC-68). `DS-` is the design system (DOC-54), `CL-` the clients (DOC-55). | DR-195, DOC-56 §6 |
| `Pn-xx`, `Mn` | — | A task of phase n; the milestone that closes phase n. `Pn-00` is the doc gate. | master plan §5 |
| doc gate | — | The task `Pn-00` that reviews the documents a phase needs; the phase starts only when they are `Approved`. | master plan §0.1 |
| Approved | — | A document that has its required content, no open question, defined terms and IDs, listed dependencies and examples for every ambiguity. Only the Owner (project) moves a document here. | master plan §3.3 |
| spike | — | A short experiment. All nine spikes (S-01…S-09) were dropped on 2026-10-19; their questions are verified inside the tasks. | master plan §5 |
| MoSCoW | — | Priority labels M (Must), S (Should), C (Could), W (Won't). | DOC-03 |
| G/W/T | — | Given/When/Then, the form of acceptance criteria. | DOC-03 |
| cut order | — | The order in which scope is cut when time runs short, never touching the settlement path. | master plan §4.3 |
| race test | — | A test that opens N real database connections and releases them together with a barrier. Written before the feature it protects. | master plan §2, DR-77 |
| barrier | — | The synchronization point that starts all racing sessions at the same instant. | DR-77 |
| run-twice test | — | A test that runs a money or notification mutation twice and expects one effect. | master plan §7.2 |
| kill test | — | A test that kills the process in the middle of a transaction and expects no half effect. | master plan §2 |
| baseline (experiment) | — | The deliberately naive implementation an experiment compares against (EXP-03: read the status, decide in code, write without the predicate). | DR-78 |
| template database | — | A migrated PostgreSQL database cloned per test file for isolation and speed. | DR-77 |
| planned number / measured number | — | A planned number is a design target or a script estimate. It becomes measured only with a dated result file, machine and script (DR-77, DR-78). | DR-80, DOC-10 §2 |
| sample template | — | The template database `rms_tpl_sample_<hash8>` that holds the migrated schema and the sample building; each test file clones it. | DR-77, DOC-88 §6, §7 |
| mutant (of the generator) | — | A deliberately broken guard or repository that the authorization matrix must catch; a surviving mutant fails EXP-10. | DR-172, DOC-99 §3 |
| burst reading (of NFR-07) | — | The reading of "5 SMS per phone per hour" as the bucket's capacity (a burst of 5, then one per 12 minutes) rather than a sliding hour; NFR-07 is worded this way (at most 10 in any hour). | DR-171, DOC-98 §12 |
| port suite | — | One contract suite run against both the fake and the real adapter of a port. | DOC-88 §14 |
| race profile | — | `TEST_RACE_PROFILE`: `ci` (20 rounds) or `nightly` (1,000 rounds, 8 sessions) for the race harness. | DR-169, DOC-88 §8.3 |
| `TEST_` variables | — | Environment variables read only by `@rms/test-support` and the test scripts, never by `loadConfig`. | DR-169, DOC-88 §6.3 |

## 13. Language, units and formats

| Term | Local name | Definition | Related |
| --- | --- | --- | --- |
| đồng / `VND` / đ | đồng (đ) | The currency. No minor unit. Amounts are integers; the currency is the constant `VND`. | DR-11 |
| `Money` | — | A branded `bigint` in the domain and an integer JSON number at the edge. Never a float. | DR-11 |
| `qty_milli` | — | Quantity held as integer thousandths in code (`numeric(12,3)` in SQL). Line amount is `(qty_milli × unit_price + 500) / 1000`, half up. | DR-11 |
| UI language | — | `vi` or `en`, resolved from the account, then the building default, then `vi`. | NFR-13, DR-71 |
| bilingual content | — | Notices, library pages, ticket types and fee notices in `vi` and optionally `en`, stored as `jsonb`; `vi` is the fallback. | DR-71 |
| ICU message | — | The message format of the shared catalog (`intl-messageformat`). | DR-71 |
| catalog parity | — | The CI test that fails when a key or an ICU placeholder is missing in `vi` or `en`. | NFR-13 |
| amount format | — | Vietnamese `2.838.000 đ`; English `₫2,838,000`. | DR-71 |
| date format | — | Vietnamese `09/10/2026`; English `Oct 9, 2026`; times 24-hour in building time. | DR-71 |
| E.164 | — | The international phone number format in which phones are stored. | DR-36 |
| Be Vietnam Pro | — | The font of PDFs and documents only (SIL OFL); the apps and the web use Geologica and Big Shoulders. | DR-56, DR-180 |
| Hiên | — | The name of the design system of the design canvas (namespace `Hien`): tokens, light and dark themes, the component set. | DOC-54, DR-180 |
| design token | — | A named value (color, type style, spacing, radius, size, shadow) in `packages/design-tokens`, from which the Tailwind preset and the NativeWind theme are generated. | DOC-54 §2, DR-70 |
| plate (UI) | — | The `Plate` component: a code shown on a dark, nearly square label (unit code, ticket code, vehicle plate). Not the vehicle plate itself. | DOC-54 §7.2, DR-180 |
| tone | — | The color family of a `Tag`, a well or a banner: neutral, info, success, warning, danger (and, for icon wells, teal, gold, coral, sky, violet). It tells the viewer what to do, never carries meaning alone. | DOC-54 §6.1, DR-183 |
| well | — | The round or squared tinted tile behind an icon on a service tile, notice or list row. | DOC-54 §6.5 |
| Tag | — | The status label component: text plus icon plus tone. | DOC-54 §6.1, DR-183 |
| hero card | — | The gradient card (`hero-from` to `hero-to`) that carries the main figure of a home screen, such as the bill slip due. It holds the one `gold` action of the screen. | DOC-54 §3.1, §7.2 |
| intent key | — | The `Idempotency-Key` a client creates once per user intent (when the form mounts) and reuses on every retry of that intent. | DOC-55 §4.3, DR-74 |
| unit context (client) | — | In the resident app: the selected unit id, the membership and `can()`, kept in secure storage and as the prefix of every query key. Switching drops the previous unit's cache. | DOC-55 §7, DR-191 |
| offline read-only mode | — | What the clients do without a network: show the last persisted data with a banner, disable every write, keep money and QR screens unavailable. No write queue. | DOC-55 §9, DR-190, DR-175 |
| `/wrong-app` | — | The web CMS page that a Technician or Guard sees after signing in on the web (and the staff app's equivalent for an Admin): says which app to use and offers sign-out. | DR-174, DOC-53 §3.4 |

## Open questions

None.
