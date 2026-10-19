# Vision and scope

> Status: **Review** · Updated: 2026-10-19 · DOC-01
> Depends on: original SDD §1–§3, §21–§22, [DR](../00-decision-register.md) (DR-06, 17, 47, 58, 79, 80, 81, 83, 84), [DOC-06](../02-glossary.md), master plan §1, §4
> Main readers: Owner (project), P0-18…P0-35, every later document that cites a goal or a scope boundary

This document says what the Residential Management System is for, what it must achieve in numbers, what it covers and what it does not. It holds no design. Requirements are in [DOC-03](requirements.md), personas in [DOC-02](personas-and-journeys.md), the architecture in DOC-07, the plan and cut order in the [master plan](../00-master-plan.md).

## 1. Context

A mid-size apartment building in Vietnam has a few hundred units, a management company with an office of two or three people, a few technicians and guards, and residents who are owners, their families, tenants and long-term domestic helpers (original SDD §1.1). Management fees, water, parking and occasional special charges are billed in irregular batches. They are paid in cash at the office, by bank transfer with hand-typed content, and increasingly by QR from a banking app. Requests and announcements travel through paper notices, phone calls and chat groups.

| Fact | Value | Source |
| --- | --- | --- |
| Sample building | 24 floors, 240 units, about 650 resident accounts, 10 staff | original SDD §2.1 |
| Design scale | 20 buildings, 5,000 units on one PostgreSQL instance | original SDD §2.1, DR-06 |
| Clients | One web CMS (Admin, Manager), one staff app (Manager, Technician, Guard), one resident app | original SDD §2.3 |
| Languages | Vietnamese and English; Vietnamese is the fallback | DR-71 |
| Feature volume | 139 features in the product proposal | `references/product-proposal.md` |

The hard part is not the number of screens. It is the places where several people and systems act on the same thing at once: two household members paying the same batch, a cash payment recorded while an online transfer is in flight, a batch recalled while it is being paid, a gateway that confirms twice or not at all, a technician rejecting a job the Manager is reassigning, an owner locking a helper whose QR code is on screen. Each is rare on a given day and certain over a year.

### 1.1 Problems this system removes

| Problem | Today | After this system |
| --- | --- | --- |
| Fee collection reconciled by hand | The Manager reads bank lines and matches units by transfer content; a typo costs an evening and a wrong debt notice | Charges are settled from verified sources; the Manager checks only the money log |
| Residents cannot see what they owe | Paper notices, paper receipts, tenants unaware of the owner's payments | Fees, debt and receipts in the app, per unit |
| Requests vanish in chat groups | No owner, no status, no record | A ticket with one status, one assignee and a timeline |
| Announcements miss people | A lobby notice and a chat group miss tenants and helpers | A notice to a defined audience with read tracking |
| Access relies on memory | Guards recognise faces and plates | A 15-minute QR code checked on the server; plate lookup among approved vehicles |

## 2. Vision: three layers of value

| Layer | Meaning | In phase 1 | Later |
| --- | --- | --- | --- |
| 1. One source of truth for the building | Units, people, vehicles, fees, requests and documents in one system with role-based access, replacing spreadsheets, paper and chat groups | Yes | |
| 2. Money that reconciles itself | Every charge settled from verified sources with receipts; debt always current; statement reconciliation leaves the Manager only real exceptions | Yes | |
| 3. A platform for many buildings | The same system run by a management company for all its buildings, with more gateways and electronic invoices | Prepared: `building_id` on every row, a phone account that spans buildings, a demo building as a second tenant | Several buildings and companies, VNPay, e-invoices (§5.3) |

## 3. Core problem and the two invariants

> How can one building's fee charges be settled from three independent money sources (online VietQR transfers confirmed by a gateway webhook, re-queries of the same gateway, and cash or bank transfers that the Manager records by hand) so that no charge is ever settled twice and no money that reached the bank goes unseen, even when webhooks are repeated, reordered, late or never arrive, when a batch is recalled while a resident is paying, when two household members pay at the same time, and when any process dies midway?

**Target scenario.** The sample building. A batch is published on the 1st of the month; in the next hour about 150 units pay online. On the day before the due date another 100 pay within two hours, while the Manager records cash at the office in parallel. The guarantees hold at 20 buildings and 5,000 units.

**Invariant 1, money** (original SDD §2.1, DR-84):

```
NEVER SETTLE A CHARGE TWICE · NEVER LOSE SIGHT OF A TRANSFER
status(charge) = 'paid'  ⇔  exactly one live allocation of the full amount(charge)
amount(payment) = Σ live allocations(payment)
```

A charge is paid in full or not at all. Money that cannot be posted that way (short, over, duplicate, wrong or instalment transfer) is not part of the ledger: it is a row of the money log that the Manager checks by hand, so nothing that reached the bank disappears. Example: a charge of 2,488,000 đ paid in cash while an online link for 2,838,000 đ (two charges) is open. When the 2,838,000 đ transfer arrives, no payment is created, the second charge stays `open`, and a log row with outcome `charge_already_paid` appears.

**Invariant 2, access:** a resident sees and does only what an active membership in the selected unit allows, and staff see only their own building. It decides who may pay, who may open a ticket, what a Guard sees after a scan and who reads which notice. Example: the owner locks a helper; the helper's next request fails with 403 and a QR screenshot taken a minute earlier is rejected as `invalid`.

## 4. Measurable goals

Each goal is a target, the requirement that states it ([DOC-03 §NFR](requirements.md)) and the check that proves it. Load numbers are design targets for the phase 1 machine and are recalibrated when EXP-07 first runs (DR-06). How each is measured is fixed in DR-80.

### 4.1 Quality goals

| Goal | Target | NFR | Verification |
| --- | --- | --- | --- |
| No double settlement, no transfer lost | 0 charges settled twice; 0 duplicate payments per gateway reference; every payment equals the sum of its live allocations; every confirmed transfer is a payment or a money-log row, after 10,000 concurrent settlement attempts | NFR-01 | EXP-01, EXP-02, EXP-03, EXP-04 |
| A payment shows up quickly | Webhook accepted → first poll showing `paid`: p95 ≤ 5 s; server part (accept → commit) p95 ≤ 1 s | NFR-02 | EXP-01 |
| The API is responsive | p95 ≤ 300 ms, p99 ≤ 800 ms at 50 requests/s mixed traffic on the staging host (2 vCPU, 4 GB, everything co-located) | NFR-03 | EXP-07 |
| A notice reaches everyone fast | 5,000 recipients: scheduler claim → last request to Expo returned ≤ 60 s | NFR-04 | EXP-06 |
| Fee notices in bulk | 240 PDFs in ≤ 2 min; 5,000 in ≤ 30 min in the background; worker memory ≤ 1 GB | NFR-05 | EXP-08 |
| Access is revoked at once | 0 stale QR codes accepted after a replace, lock or removal | NFR-06 | EXP-05 |
| OTP abuse is bounded | ≤ 5 SMS per phone per hour, ≤ 20 per IP per hour, ≤ 5 attempts per code | NFR-07 | EXP-09 |
| Isolation | 0 successful reads or writes of another unit or building across the authorization matrix | NFR-08 | EXP-10 |
| Corruption is noticed | A nightly job checks the invariants on every unit; an injected difference is reported within 24 h; 0 false positives on clean data | NFR-09 | EXP-11 |
| Availability | 99.5% per month by an external probe of `/api/v1/health/ready` every 60 s | NFR-10 | External probe over the first month in production |
| Recoverable | RPO ≤ 5 min, RTO ≤ 4 h; a restore drill each quarter | NFR-11 | EXP-12 |
| Import is quick | A 2,000-row Excel file: accepted request → response with the validated preview ≤ 10 s | NFR-12 | Timed integration test (P1-13) |
| Two languages everywhere | 100% of UI strings exist in Vietnamese and English | NFR-13 | Catalog parity test in CI |
| Personal data is protected | CCCD and phone visible only to Manager, Admin, the unit's own members and, masked and logged, Guards | NFR-14 | `AD-`, `RM-` tests; EXP-10 |

### 4.2 Delivery goals

Each phase ends with something that runs on staging (master plan §2, principle 2).

| Milestone | Goal | Observable result |
| --- | --- | --- |
| M1 (P1) | The sample building is on the system | 240 units imported through the web CMS; a resident signs in with a real SMS OTP and switches units; staff sign in; EXP-09 and the first EXP-10 pass |
| M2 (P2) | Money is charged, recorded and visible | A batch is imported, published and settled by manual entries; recall and void work; mismatched money appears in the money log; EXP-03, 04, 08, 11 pass |
| M3 (P3) | Online payment works end to end | Payments settle on staging; a lost webhook is settled by re-query; EXP-01 and EXP-02 pass; statement reconciliation works on the real sample |
| M4 (P4) | Operations are digital | Full ticket and notice flows on the three clients; EXP-06 passes |
| M5 (P5) | Access and content | Guard and resident flows of the design; EXP-05 passes |
| M6 (P6) | Live | Dashboard and exports; EXP-12, EXP-07 and the final EXP-10 pass; the Manager signs the UAT; stores accept both apps; production is live |

## 5. Scope

### 5.1 In scope (phase 1)

| Item | Reason it is in |
| --- | --- |
| One building operated by one management company, with `building_id` on every business row | The real client; the column makes several buildings later a configuration change |
| Three clients: web CMS, staff app, resident app (the 139 proposal features, adjusted by the design) | The client's baseline scope |
| Fixed roles and member types with predefined permissions | A permission editor adds cost and risk with no phase 1 need |
| Fee batches without a fixed cycle, each labelled with a fee month; Excel import; publish, recall, re-issue, void of a single charge; manual payments of whole charges; receipts; debt and aging; the money log | The core problem |
| Online payment through one gateway: VietQR payment links from payOS, whole charges only, several at once | Residents already pay by QR from a banking app |
| Vietnamese and English for the UI and for bilingual content | Tenants and owners include foreigners |
| Push through Expo (FCM, APNs), SMS for resident OTP, email for staff passwords | Residents have no passwords; staff are on a browser |
| Continuous backup (WAL archive, RPO ≤ 5 min), staging and production | "Never lose a payment" outranks a daily dump (DR-66) |

### 5.2 Out of scope

| Item | Reason |
| --- | --- |
| Expense tracking, income–expense reports, accounting roles | The proposal's checklist excludes them |
| Patrol management, floors as a module, materials and cost on tickets | The proposal's checklist excludes them |
| Self sign-up for residents | The Manager creates owners and owners add members, so every account is known |
| Partial payment, advance payment and credit by any channel | The Owner decided a charge is paid in full or not at all; any other money is a log row handled outside the system (DR-84) |
| Custom branding per building beyond logo, names and contact details | Not needed for one building |
| **Electronic invoices** | The company issues an e-invoice only when a resident asks (a request of type "Khác"), outside the system. The system keeps no invoice number, no invoice table and no integration. It records only the seam: the reserved nullable column `finance.receipt.external_invoice` and the event `finance.receipt_issued.v1`, one per receipt (DR-17) |
| Refunds through the gateway | The company refunds a wrong transfer by bank transfer outside the system; the money log keeps the transfer (DR-84) |

The receipt is titled "Biên lai thu tiền / Payment receipt" and states it is not a tax invoice (DR-17).

### 5.3 Later

| Item | Content | How phase 1 prepares |
| --- | --- | --- |
| Several buildings, several companies | One deployment for many buildings; a company admin above building admins | `building_id` on every row and in every query filter; a phone account already spans buildings; the demo building is already a second tenant |
| VNPay | Card and wallet payments by redirect | Online payment sits behind the `PaymentGateway` port; VNPay is a second adapter with its own route |
| Ticket deadlines and overdue alerts | Due time per ticket type, escalation | `ticket.due_at` and `ticket_type.resolution_hours` exist; nothing reads them; flag `FEATURE_TICKET_DEADLINES=false` (DR-47) |
| Electronic invoices | Legal e-invoices for fees | The seam of §5.2; a new decision and an expand migration at integration time |
| Online refunds | Refund through the gateway | The money log keeps the transfer |

## 6. Assumptions

Work proceeds on these defaults (DR-81). An answer from the client that differs creates a `Changed` DR and updates the target documents.

| Assumption | Default | Confirm by | DR |
| --- | --- | --- | --- |
| payOS behavior (webhook retry, expired-link transfers, rate limits, order-code range, fees) | The assumptions of original SDD §6.5, checked against a gateway sandbox when the Owner reports one. No sandbox: the `fake` driver, then one real minimum-amount payment before go-live (P6-09) | Before P3-01 | DR-25 |
| Receiving account linked through payOS | Not linked: transfer content at most 9 characters (`TT2FMZ9`) | Start of P3 | DR-27 |
| SMS provider and brandname, mail relay | Chosen by the Owner or client | Before P1-10 | DR-68 |
| PostgreSQL hosting | The Owner's VPS, native PostgreSQL 18, pgBackRest to R2 | Start of P1 | DR-67, DR-83 |
| Ticket deadlines | Phase 2 (decided) | Decided 2026-10-19 | DR-47 |
| Meaning of a "closed" batch | A manual reporting freeze; charges stay payable (decided) | Decided 2026-10-19 | DR-20 |
| Family member type | Kept, separate from "tenant" (decided) | Decided 2026-10-19 | DR-81 |
| Owner transfer default | Other members are removed; the Manager may keep them per transfer (decided) | Decided 2026-10-19 | DR-40 |
| Bank statement format | A generic column-mapping profile until a real sample arrives | Start of P3 | DR-34 |
| Real scale | 240 units and about 650 accounts; sized for 5,000 units | End of P0 | DR-06 |

## 7. Constraints

| Constraint | Effect |
| --- | --- |
| One person, full time, 50 weeks (about 100 calendar weeks at 50%) | The plan has a cut order (§8) and a two-person split after M1 (master plan §4.1) |
| Hosting: one VPS per environment behind Cloudflare, no inbound port | A single point of failure per environment; recovery is a rebuild plus a pgBackRest restore (DR-83) |
| Cloudflare free plan | One rate-limiting rule; the application limiter carries more of the load (DR-83) |
| SMS brandname approval takes calendar time (the target is at most 3 weeks) | Register the brandname during P0/P1; an unbranded OTP route is the paid fallback (DR-68) |
| Client inputs with waiting time | Bank statement sample, payOS account, hosting and store accounts, legal texts (P0-03…P0-06); the DR-81 defaults apply meanwhile |
| Latest stable of every dependency, verified on the web | Version choices are evidence, not memory (DR-82) |
| Design canvas of 115 artboards is incomplete | New screens (DR-72) are specified in text and built with the design system |
| Personal data protection under Decree 13/2023/NĐ-CP | Field protection, logged reads, generic push text, a deletion flow (DR-58, DR-59) |

## 8. Cut order

When time runs short, cut from the top. A milestone more than 50% late starts the cut order and a re-plan (master plan §4.3).

1. Library version restore and PDF export of pages.
2. Report exports beyond Excel.
3. Statement parsers beyond the company's own bank (the generic profile stays).
4. Ticket deadlines (already phase 2).
5. Bulk ZIP of fee notices beyond the per-unit PDF.
6. Maestro flows beyond the critical ones.

**Never cut:** the allocation statements and `settle()`, the re-query job, the nightly invariant check, the webhook hardening, point-in-time recovery and the authorization matrix. They are what make the first real payment safe.

## 9. Risks

Only the risks that decide scope or the value of the system are listed here; the full lists are in original SDD §22 and master plan §8.

| Risk | Early sign | Mitigation |
| --- | --- | --- |
| **E-invoices become mandatory or are requested more often** (DR-17) | The client or residents ask for them regularly, or the client reports a legal obligation | The reserved column and event; no work in phases 1–6 unless the client asks, then a new DR and an expand migration |
| **Personal data law, Decree 13/2023/NĐ-CP** (DR-58) | The legal dossier (P0-06) rejects a cross-border flow; real data is about to be imported | Encrypted CCCD, ciphertext backups, no CCCD images on R2, generic push text; files can move to a Vietnam-hosted store behind `FilesApi` (DR-83 options a–c) |
| Cloudflare edge and R2 are outside Vietnam | As above | The review is deferred by the Owner: before real personal data is loaded, at the latest at go-live (DR-83, DOC-103) |
| payOS differs from the assumptions | The sandbox or documentation contradicts DR-25 | Fake driver and simulator for all tests; one real minimum payment; re-query and statement reconciliation as independent paths |
| A transfer is made twice or with another amount | Rows in the money log | Nothing is posted; the Manager refunds outside the system; the resident sees a neutral message (DR-84) |
| One person cannot carry the plan | M1 more than 3 weeks late | The cut order and the two-person split |
| One provider holds the edge, files and backups | A Cloudflare account problem | Accepted by the Owner (2026-10-19); encrypted repository with offline key custody; the weekly `pg_dump` is portable (DR-66) |
| SMS brandname approval is slow | No approval 3 weeks after choosing the provider | Start before P1-10; unbranded route as the fallback |
| Scope creep from the 139-feature checklist | Features with no FR | Every feature is mapped to an FR or marked out of scope (P0-07, DOC-05) |

## 10. Not in this document

| Topic | Lives in |
| --- | --- |
| Requirements with acceptance criteria and the NFR table | [DOC-03](requirements.md) |
| Personas and journeys | [DOC-02](personas-and-journeys.md) |
| Use cases and the feature catalog | DOC-04, DOC-05 |
| Architecture, deployment, capacity | DOC-07, DOC-10 |
| Terms | [DOC-06](../02-glossary.md) |
| Experiments | DOC-89…101 |

## Open questions

- **Gateway provider and payOS facts (DR-25, DR-26, DR-27, DR-28, DR-30, DR-31):** open until the Owner reports a gateway sandbox. Not blocking P1. The document assumes payOS with the fake driver as the fallback.
- **Bank statement format (DR-34, DR-35):** open until the client supplies a redacted sample (P0-05). Not blocking P1. The document assumes the generic profile.
