# Flows index

> Status: **Review** · Updated: 2026-10-20 · DOC-43
> Depends on: [DOC-04](../../01-product/use-cases.md), [DOC-51](../../07-api/api-endpoints.md) §2, [DOC-50](../../07-api/api-guidelines.md), [DOC-12](../../03-architecture/code-architecture.md) §4, §5, §8, [DOC-09](../../03-architecture/messaging-contracts.md), [DR](../../00-decision-register.md) (DR-142…), master plan §3.2 (flows), Appendix A.8, [DOC-06](../../02-glossary.md)
> Main readers: the authors of DOC-44…49, P1-25, every task that implements a flow, DOC-56…67 (screens name the `FL-xx` they start), DOC-88

This document is the map of the detailed flows. It lists the 45 flows (`FL-01…FL-45`) with their use case, screens, endpoints and file, fixes how a flow is written (the template, the naming of participants, the diagram rules), and fixes the test prefix of each flow document. A flow's content is in its own file; this file holds no sequence.

A detailed flow expands one use case (DOC-04). The use case says what the user does and which errors exist; the flow says which call crosses which boundary, in which transaction, and what the user sees if the process dies after each commit. Payload schemas stay in the endpoint catalog (DOC-51), DDL in the data documents, UI strings in DOC-68; a flow shows one concrete example value per step and links to the source.

## 1. How a flow is written

| Rule | Content |
| --- | --- |
| Template | Appendix A.8 of the master plan: a section `## FL-xx · <actor + action>`; the line UC / FR / Screen / Endpoints / Events; trigger; preconditions; Participants; the `sequenceDiagram`; Step details; Transactions and concurrency; Errors and handling; Required tests |
| Coverage | Every main, alternative and error flow of the use case is the main path or an `alt`/`else` branch of an `FL-xx`; the use case's *Related* line names its `FL-xx` (UC → FL is complete: every UC with flows lists them) |
| Arrows | Every arrow names the real call: a screen action, `E-xx` with method and path, a class method, an SQL verb with the table, an outbox type. `autonumber` is on, and the step table refers to the arrow numbers |
| Transactions | `Note over` marks `T1 begins`, `T1 commits`, `T1 rolls back`. The *Transactions and concurrency* section says what commits together, which statement is the arbiter of each race, and what the user sees if the process dies after each commit |
| Size | A flow longer than about 25 arrows is split into sub-flows `FL-xx.y` that link to each other. A sub-flow is cited as `FL-18.2`; `FL-18` alone means all of them |
| Unspecified steps | A step whose screen or endpoint is not specified yet stays an open question in the flow, with the document that will decide it |
| Mermaid | Message text is not quoted (quotes render literally); no `;` or `#` in message text; participant aliases have no hyphen (`WLogin` for `W-Login`) |
| Examples | The sample building: unit `A-1508`, owner Nguyễn Văn An (`+84901234567`), tenant Trần Thị Bình (`+84912345678`), Manager Lê Minh |
| Tests | A flow's *Required tests* are scenarios through screen, API and database with concrete values. They do not repeat a unit test of a design document (`AU-`, `RM-`, `LG-`…): they name it when it covers the lower layer |

Every flow-document test prefix is unique to its document (master plan §0.2, DR-142):

| Document | Flows | Test prefix | Test ID blocks |
| --- | --- | --- | --- |
| DOC-44 Fees and payments | FL-01…09, FL-44 | `FF-` | assigned by the author, by flow |
| DOC-45 Online payment | FL-10…16 | `FO-` | |
| DOC-46 Identity and household | FL-17…24, FL-45 | `FI-` | FL-17 `FI-01…10`, FL-18 `FI-11…20`, FL-19 `FI-21…32`, FL-20 `FI-33…40`, FL-45 `FI-41…50`, FL-21 `FI-51…62`, FL-22 `FI-63…74`, FL-23 `FI-75…86`, FL-24 `FI-87…96` |
| DOC-47 Tickets | FL-25…30 | `FT-` | |
| DOC-48 Notices, access, vehicles | FL-31…37 | `FN-` | |
| DOC-49 Admin, reports, library | FL-38…43 | `FA-` | |

## 2. Participants

Participants are named once and keep the same name in every file. A flow adds its own *Participants* table (kind, code, defined in), but a name below is never spelled another way.

| Kind | Naming rule | Examples |
| --- | --- | --- |
| Actor | The role | `Resident`, `Owner`, `Manager`, `Admin`, `Staff member`, `Technician`, `Guard`, `Operator` |
| Screen | The design artboard name, as in the use cases' *Related* line and `references/design-screens.md`; the label is the artboard name, the alias drops the hyphens | `Login`, `OTP`, `Terms`, `Unit-Pick`, `Members`, `W-Login`, `W-Unit-Detail`, `S-Login`, `G-Scan` |
| Client | One per app, plus the typed client | `resident-app`, `staff-app`, `web-cms`, `apiClient` |
| API edge | `api`, with the guards that run before a use case | `api`, `ResidentGuard`, `UnitGuard`, `StaffGuard` |
| Use case or service | The class named in the design document, one participant per class, never the module | `StaffSignIn`, `ResidentOtp`, `SessionService`, `StepUp`, `AddMember`, `TransferOwnership`, `CommitUnitOwnerImport`, `settle` (the function of DOC-23) |
| Contract | The contract name of DOC-09 §7 | `IdentityApi`, `ResidencyApi`, `BuildingApi`, `FilesApi`, `AuditApi`, `FinanceApi` |
| Data store | `db`, with the schema-qualified table in the arrow; `outbox` and `inbox` for the message tables; `r2` for the object store | `db`, `outbox`, `r2` |
| Worker | `worker`, with the handler or job name in the arrow | `worker` (`identity.send_sms`, `account_deletion`) |
| External | The provider, lower case with a hyphen | `sms-provider`, `mail-relay`, `payos`, `expo-push` |

A flow starts at the actor's action on a screen and ends at what the screen shows or at the committed outbox row whose handler is another flow (`FL-32` for a push). A handler that is a flow of its own is shown as the single arrow "outbox type → worker" and linked.

## 3. The flows

Endpoints are the `E-xx` of DOC-51 §2 (the method and path are there). Screens are the artboard names. `Written in` is the file under `06-design/flows/`; a file marked *owed* is written in the task of its phase (master plan §3.2).

### 3.1 Fees and payments (DOC-44, `fees-and-payments.md`, P2)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-01 | Import a fee file and save a draft | UC-01 | `W-Fees`, `W-Fee-Import`, `W-Fee-Batch` | E-36, E-37, E-71, E-72, E-73, E-74, E-93, E-94 |
| FL-02 | Publish a batch | UC-01 | `W-Fee-Batch`, `W-Fee-Notice` | E-95, E-99 |
| FL-03 | Recall a batch, with the race | UC-04 | `W-Fee-Recall` | E-96 |
| FL-04 | Re-issue a batch | UC-04 | `W-Fee-Reissue` | E-92, E-98, E-97 |
| FL-05 | Record a manual payment | UC-02 | `W-Fee-Record` | E-102, E-104, E-106 |
| FL-06 | Void a payment | UC-02 | `W-Fee-Record`, `W-Audit` | E-105 |
| FL-07 | Review money that was not posted | UC-21 | `W-Money-Log`, `UnitMoneyPanel` | E-108, E-109, E-110 |
| FL-08 | Follow debt and send reminders | UC-05 | `W-Debts`, `UnitMoneyPanel` | E-101, E-102, E-103 |
| FL-09 | Settle a confirmation at ledger level | UC-18 | — (the function `settle`, no screen) | — (called by E-117 in FL-12) |
| FL-44 | Void a single open charge and issue a corrected charge | UC-04 | `W-Charge-Void`, `W-Fee-Batch` | E-100, E-90, E-98 |

### 3.2 Online payment (DOC-45, `online-payment.md`, P3)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-10 | Pay batches online | UC-03 | `Fees`, `Pay-Select`, `Pay-VietQR`, `Pay-Done` | E-80, E-81, E-85, E-86 |
| FL-11 | A second member meets an open payment | UC-03 | `Pay-Select` | E-85, E-86 |
| FL-12 | Webhook settlement, duplicates included | UC-18 | `W-Transactions` | E-117 |
| FL-13 | Re-query and expiry | UC-18 | `Pay-VietQR`, `Pay-Mismatch` | E-86, E-88 |
| FL-14 | Change method and cancel | UC-03 | `Pay-VietQR` | E-87, E-85 |
| FL-15 | Reconcile a bank statement | UC-06 | `W-Statement`, `W-Money-Log` | E-36, E-37, E-111, E-112, E-113, E-114, E-115, E-116 |
| FL-16 | Late, short, over and duplicate transfers | UC-18, UC-21 | `W-Money-Log`, `Pay-Mismatch` | E-117, E-86, E-108 |

### 3.3 Identity and household (DOC-46, `identity-and-household.md`, P1)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-17 | Staff sign-in and lockout | UC-17 | `W-Login`, `S-Login`, `S-Login-Error` | E-05, E-11 |
| FL-18 | Staff invite and reset | UC-17 | `W-Staff-New`, `W-Reset`, `W-Forgot-Sent`, `S-Forgot`, `S-Forgot-Sent` | E-40, E-08, E-06, E-07 |
| FL-19 | Resident OTP sign-in and terms | UC-14, UC-27 | `Login`, `Login-Error`, `OTP`, `Terms`, `Terms-Update` | E-03, E-09, E-10, E-13, E-15, E-16, E-17, E-22 |
| FL-20 | Pick a unit and authorize a request | UC-14 | `Unit-Pick`, `Main` | E-13, E-26 (as the example of a unit route) |
| FL-21 | Owner adds, locks or removes a member | UC-15 | `Members`, `Member-Add`, `Member-Actions` | E-26, E-27, E-28, E-29 (and E-64, E-69 for the Manager) |
| FL-22 | Manager transfers ownership or changes a login phone | UC-13 | `W-Unit-Detail` | E-59, E-61, E-65, E-67 |
| FL-23 | Import units and owners | UC-13 | `W-Import` | E-36, E-37, E-71, E-72, E-73, E-74 |
| FL-24 | Account deletion | UC-27 | `Account-Deletion`, `W-Residents` | E-18, E-19, E-63, E-68 |
| FL-45 | Step-up for a sensitive staff action | UC-17 | `W-Step-Up`, `W-Gateway` | E-38, E-50 (and E-40, E-42) |

### 3.4 Tickets (DOC-47, `tickets.md`, P4)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-25 | Submit a ticket | UC-07 | `Requests`, `Request-New` | E-118, E-24, E-25, E-120 |
| FL-26 | Assign a ticket | UC-08 | `W-Ticket-Assign`, `B-Assign` | E-125, E-126, E-127 |
| FL-27 | Accept, reject, start, hold, resolve | UC-09 | `K-Job-New`, `K-Job-Working`, `K-Job-Done` | E-128, E-129, E-36, E-37 |
| FL-28 | Close, reopen, rate | UC-10 | `B-Ticket-Close`, `Request-Done` | E-128, E-124, E-121 |
| FL-29 | Resident cancels while the Manager assigns | UC-07, UC-08 | `Request-Cancel`, `W-Ticket-Assign` | E-123, E-127 |
| FL-30 | Manager cancels a ticket | UC-22 | `W-Ticket-Cancel` | E-130 |

### 3.5 Notices, access and vehicles (DOC-48, `notices-access-vehicles.md`, P4 for FL-31…33, P5 for FL-34…37)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-31 | Create and schedule a notice | UC-11 | `W-Notice-Edit`, `B-Notice-New` | E-146, E-147, E-148 |
| FL-32 | Fan-out and push | UC-19 | `Inbox`, `S-Inbox` | E-78, E-22, E-34 (the job and the handlers are the flow) |
| FL-33 | Read tracking and statistics | UC-11 | `Notice-Detail`, `W-Notice-Stats` | E-143, E-144, E-149 |
| FL-34 | Show and scan a QR code | UC-16 | `QR`, `G-Scan`, `G-Scan-OK` | E-141, E-142 |
| FL-35 | Lock a member then scan the old code | UC-15, UC-16 | `Member-Actions`, `G-Scan-Invalid` | E-28, E-69, E-142 |
| FL-36 | Register and review a vehicle | UC-12 | `Vehicle-Add`, `B-Vehicle-Review` | E-134, E-136, E-138, E-24, E-25 |
| FL-37 | Unit and plate lookup | UC-28 | `G-Lookup`, `G-Plate` | E-70, E-140 |

### 3.6 Admin, reports and library (DOC-49, `admin-reports-library.md`, P5 for FL-38, FL-39; P6 for FL-40…43)

| FL | Flow | UC | Screens | Endpoints |
| --- | --- | --- | --- | --- |
| FL-38 | Edit, publish and restore a library page | UC-23 | `W-Docs` | E-153, E-158, E-160, E-162, E-163, E-164 |
| FL-39 | Search the library | UC-24 | `Docs`, `Doc-Page`, `S-Docs` | E-150, E-151, E-152, E-154 |
| FL-40 | Dashboard and report export | UC-25 | `W-Dashboard`, `W-Reports`, `W-Export-Center` | E-165, E-166, E-167, E-168, E-75 |
| FL-41 | Staff accounts and settings | UC-17 | `W-Staff`, `W-Building`, `W-Gateway`, `W-Audit` | E-39…E-46, E-47, E-48, E-49, E-51, E-52, E-53, E-54 |
| FL-42 | Nightly invariant check | UC-20 | `W-System` | — (a job) |
| FL-43 | Sessions and account settings | UC-26 | `Account`, `Sessions`, `S-Account`, `W-Profile` | E-13, E-14, E-20, E-21, E-30, E-31, E-32, E-33, E-11, E-12 |

## 4. Traceability

| Use case | Flows | | Use case | Flows |
| --- | --- | --- | --- | --- |
| UC-01 | FL-01, FL-02 | | UC-15 | FL-21, FL-35 |
| UC-02 | FL-05, FL-06 | | UC-16 | FL-34, FL-35 |
| UC-03 | FL-10, FL-11, FL-14 | | UC-17 | FL-17, FL-18, FL-41, FL-45 |
| UC-04 | FL-03, FL-04, FL-44 | | UC-18 | FL-09, FL-12, FL-13, FL-16 |
| UC-05 | FL-08 | | UC-19 | FL-32 |
| UC-06 | FL-15 | | UC-20 | FL-42 |
| UC-07 | FL-25, FL-29 | | UC-21 | FL-07, FL-16 |
| UC-08 | FL-26, FL-29 | | UC-22 | FL-30 |
| UC-09 | FL-27 | | UC-23 | FL-38 |
| UC-10 | FL-28 | | UC-24 | FL-39 |
| UC-11 | FL-31, FL-33 | | UC-25 | FL-40 |
| UC-12 | FL-36 | | UC-26 | FL-43 |
| UC-13 | FL-22, FL-23 | | UC-27 | FL-19, FL-24 |
| UC-14 | FL-19, FL-20 | | UC-28 | FL-37 |

UC-29 (restore) and UC-30 (rotate secrets) have no flow: they are runbooks (RB-10, RB-12). The numbers `FL-01…FL-45` are the ones the use cases already cite; a flow added later takes the next number (the next number).

## 5. Status of the flow documents

| DOC | File | Flows | Status |
| --- | --- | --- | --- |
| DOC-44 | `fees-and-payments.md` | FL-01…09, FL-44 | Not written (P1-25) |
| DOC-45 | `online-payment.md` | FL-10…16 | Not written (P3) |
| DOC-46 | [identity-and-household.md](identity-and-household.md) | FL-17…24, FL-45 | Review |
| DOC-47 | `tickets.md` | FL-25…30 | Not written (P4) |
| DOC-48 | `notices-access-vehicles.md` | FL-31…37 | Not written (P4, P5) |
| DOC-49 | `admin-reports-library.md` | FL-38…43 | Not written (P5, P6) |

## Open questions

None yet. The screen names of the later flows are the artboards of the design canvas; DOC-56 may rename one, and this index follows it.
