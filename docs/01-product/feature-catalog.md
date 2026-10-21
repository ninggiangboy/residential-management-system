# Feature catalog

> Status: **Review** · Updated: 2026-10-21 (DR-91, DR-92 decided) · DOC-05
> Depends on: original SDD §2.3, §14, §21, [DR](../00-decision-register.md) (DR-17, 19, 20, 38, 39, 44, 47, 49, 55, 60, 72, 76, 79, 81, 84, DR-91, DR-92), [DOC-01](vision-and-scope.md) §5, §8, [DOC-02](personas-and-journeys.md), [DOC-03](requirements.md), [DOC-06](../02-glossary.md), master plan §3.4, §4.3, [product proposal](../references/product-proposal.md)
> Main readers: P0-07, DOC-04, DOC-56 (screens by feature), the phase tasks `Pn-xx` (scope of each milestone), DOC-88 (which feature each test protects)

This document gives every feature of the client's product proposal an identifier `F-<GROUP>-xx`, ties it to requirements and use cases, and says in which phase it is complete, on which app it runs and where it is cut when time runs short. It holds no behavior: acceptance criteria are in [DOC-03](requirements.md), flows in DOC-04, design in the `06-design` documents.

## 0. Conventions

- **ID.** `F-<GROUP>-nn`, with the 11 groups of the proposal's modules (§3.1 to §3.11): `ACC` accounts, login and settings · `UNI` units, residents and members · `VEH` vehicles · `QRC` resident QR code · `NOT` news and notifications · `TIC` support tickets · `FEE` fees and debt · `PAY` online payment · `WIK` document library · `DSH` home, dashboard and reports · `SYS` configuration, language and system operations. A number is never reused; a dropped feature is struck through with the reason.
- **Order.** In each group, `nn` is the order of the row in the proposal table of that module, so `F-TIC-16` is the 16th row of proposal §3.6 ("Create request"). Features that no proposal row asks for but that the decisions add are numbered after the proposal rows and marked **(added)**, with the source (DR or NFR) in the group note.
- **Columns.** *FR*: the requirements that give the feature its acceptance criteria ([DOC-03](requirements.md); an `NFR-xx` when the feature is a quality property). *UC*: use cases of master plan §3.4 (`—` when none applies). *Phase*: the phase whose milestone includes the feature **complete** and usable end to end (`P1…P6`); a hardening or measurement that comes later (the final EXP-10 in P6, for example) does not move the phase. `Later` means designed for and not built in phases 1–6; `Not built` means out of scope (§13). *MoSCoW*: `M` must, `S` should, `C` could; a feature takes its highest FR priority, except that a part that is `C` in DOC-03 is named in *Cut step*. *Flag*: a feature flag or configuration switch that turns the feature off, `—` if none (only `FEATURE_TICKET_DEADLINES` and the `is_demo` account flag exist). *Depends on*: features that must be complete or stubbed first. *App*: where a person uses it: `web` CMS, `staff` app, `resident` app; `api` when the feature has no screen (a job, a webhook, an operation). *Cut step*: the step of the cut order (master plan §4.3, DOC-01 §8) that removes it, or `Never cut`.
- **Several apps.** A proposal row that names several apps is one feature with several entries in *App*.
- **UI strings** are quoted as they appear on screen.

### 0.1 The proposal has 113 feature rows, not 139

The master plan, DOC-01, DOC-03 and the original SDD count "139 features". Counting the rows of the proposal tables (§3.1–§3.11) gives **113 features**, or **131** if a row that is delivered on two or three apps is counted once per app. The figure 139 cannot be reproduced from `references/product-proposal.md`. This catalog maps all 113 rows, one `F-` ID each, and adds 11 features that the decisions require (124 in total). The correction is DR-89.

| Proposal section | Module | Rows | Row × app |
| --- | --- | ---: | ---: |
| §3.1 | Accounts, login and settings | 9 | 14 |
| §3.2 | Units, residents and members | 11 | 11 |
| §3.3 | Vehicles | 4 | 7 |
| §3.4 | Resident QR code | 3 | 3 |
| §3.5 | News and notifications | 7 | 8 |
| §3.6 | Support tickets | 21 | 25 |
| §3.7 | Fees and debt | 15 | 16 |
| §3.8 | Online payment | 10 | 11 |
| §3.9 | Document library | 9 | 12 |
| §3.10 | Home, dashboard and reports | 12 | 12 |
| §3.11 | Configuration, language and system operations | 12 | 12 |
| | **Total** | **113** | **131** |

## 1. Overview

| | Count |
| --- | ---: |
| Proposal rows mapped | 113 |
| Features added by decisions (no proposal row) | 11 |
| **Features in the catalog** | **124** |
| Built in phases 1–6 | 121 |
| Later (F-TIC-07, ticket deadlines) | 1 |
| Not built (F-PAY-05 payment links, F-WIK-09 pin favorites) | 2 |

Features by group and the phase in which they are complete (the phase columns count every feature of the group, added ones included; "Proposal rows" and "Added" explain the total):

| Group | Proposal rows | P1 | P2 | P3 | P4 | P5 | P6 | Later | Not built | Added | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ACC Accounts, login and settings | 9 | 11 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 3 | 12 |
| UNI Units, residents and members | 11 | 6 | 0 | 0 | 3 | 1 | 1 | 0 | 0 | 0 | 11 |
| VEH Vehicles | 4 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 1 | 5 |
| QRC Resident QR code | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| NOT News and notifications | 7 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| TIC Support tickets | 21 | 0 | 0 | 0 | 21 | 0 | 0 | 1 | 0 | 1 | 22 |
| FEE Fees and debt | 15 | 0 | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 17 |
| PAY Online payment | 10 | 0 | 1 | 10 | 0 | 0 | 0 | 0 | 1 | 2 | 12 |
| WIK Document library | 9 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 1 | 0 | 9 |
| DSH Home, dashboard and reports | 12 | 1 | 1 | 0 | 1 | 1 | 9 | 0 | 0 | 1 | 13 |
| SYS Configuration, language and system operations | 12 | 4 | 3 | 0 | 1 | 0 | 5 | 0 | 0 | 1 | 13 |
| **Total** | **113** | **22** | **22** | **10** | **33** | **18** | **16** | **1** | **2** | **11** | **124** |

Of the 121 built features, 104 are must, 15 should and 2 could. Counting every app a feature runs on: web 74, resident 40, staff 31, api-only 8.

Milestones: M1 closes with 22 features, M2 with 22 more (the fees ledger, the money-log review and the nightly check), M3 with 10 (online payment), M4 with 33 (tickets, notices, household), M5 with 18 (QR, vehicles, library) and M6 with 16 (reports, hardening, release).

## 2. ACC · Accounts, login and settings

Proposal §3.1. Roles and sign-in are the base of every other group; this group is almost all P1 (M1). **F-ACC-06** is P6 because deletion execution (FR-39.3) is P6-04; terms acceptance itself is P1. **F-ACC-10…12** are added by DR-38, DR-39 and DR-59 and have no proposal row.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-ACC-01 | Staff login and password reset | Email and password sign-in; 5 failures lock it for 15 min; reset link valid 30 min | FR-13.1, FR-13.2, FR-13.3, FR-13.4, FR-13.5, FR-13.6 | UC-17 | P1 | M | — | — | web, staff | — |
| F-ACC-02 | Staff account management | Admin creates accounts with a fixed role; invite link valid 24 h; edit, lock, unlock; Manager creates only Technician and Guard | FR-14.1, FR-14.2, FR-14.3, FR-14.4, FR-14.5, FR-13.6 | UC-17 | P1 | M | — | F-ACC-01 | web | — |
| F-ACC-03 | Fixed roles | Four staff roles and four member types with predefined permissions; no permission editor; the authorization matrix is generated from route metadata | FR-14.1, FR-16.2, FR-16.4 | UC-14, UC-17 | P1 | M | — | F-ACC-01, F-ACC-07 | web, staff, resident | Never cut (authorization matrix) |
| F-ACC-04 | Profile | View and update own name and avatar (`PATCH /me`); staff on web and in the staff app, residents in the resident app | — | UC-26 | P1 | S | — | F-ACC-01, F-ACC-07 | web, staff, resident | — |
| F-ACC-05 | Settings | Vietnamese or English, push on or off, sign out | FR-29.5, FR-45.1 | UC-26 | P1 | M | — | F-ACC-01, F-ACC-07 | staff, resident | — |
| F-ACC-06 | Terms and account deletion | Accept the current terms on first sign-in; request deletion with a cooling-off, the Manager approves, execution clears personal data | FR-39.1, FR-39.2, FR-39.3, FR-39.4 | UC-14, UC-27 | P6 | M | — | F-ACC-07, F-ACC-10, F-UNI-05 | web, resident | — |
| F-ACC-07 | OTP login | Phone number plus 6-digit OTP valid 5 min; unregistered numbers get no SMS | FR-15.1, FR-15.2, FR-15.3, FR-15.4, FR-15.5, FR-15.6, FR-15.7 | UC-14 | P1 | M | — | F-UNI-04 | resident | — |
| F-ACC-08 | One account, multiple units | One phone, several memberships; the selected unit decides data and rights on every request | FR-16.1, FR-16.3, FR-25.3 | UC-14 | P1 | M | — | F-ACC-07, F-UNI-04 | resident | — |
| F-ACC-09 | Change phone number | The resident app shows how to contact the Manager; the Manager changes the login phone and all sessions of the account end | FR-18.4 | UC-13 | P1 | M | — | F-UNI-05 | web, resident | — |
| F-ACC-10 | (added) Terms versions and gating | Admin publishes terms and privacy versions; a resident who has not accepted the latest can use only sign-in, account and terms endpoints | FR-41.1, FR-41.2 | UC-27 | P1 | M | — | F-SYS-01 | web, resident | — |
| F-ACC-11 | (added) Sessions | Every user lists their sessions and revokes any; refresh reuse revokes the family; at most 10 live families | FR-45.1, FR-45.2, FR-45.3, FR-45.4 | UC-26 | P1 | M | — | F-ACC-01, F-ACC-07 | web, staff, resident | — |
| F-ACC-12 | (added) Step-up for sensitive staff actions | Password re-entry plus a 6-digit code mailed to the Admin for gateway or receiving-account changes, creating or promoting an Admin, changing a staff email; every Admin is told | FR-50.1, FR-50.2, FR-50.3, FR-50.4 | UC-17 | P1 | M | — | F-ACC-01, F-ACC-02 | web | — |

## 3. UNI · Units, residents and members

Proposal §3.2. The staff-side features (units, import, profiles, linking, member management) are P1 (M1: the sample building is imported). The owner's own household screens are P4 (P4-10) and lookup is P5, with the Guard app. **F-UNI-06** finishes in P6 because the Excel export goes through the export center (DR-90).

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-UNI-01 | Unit management | Unit code, floor (attribute), area, type, occupancy (occupied, rented, vacant); units are never deleted | FR-18.1, FR-18.3, FR-18.6 | UC-13 | P1 | M | — | F-SYS-01 | web | — |
| F-UNI-02 | Excel import of units and residents | Validate in the API, row errors with row and column, duplicate-phone check, save valid rows only; 5 MB and 5,000 rows | FR-18.1, FR-18.2 | UC-13 | P1 | M | — | F-UNI-01, F-SYS-03 | web | — |
| F-UNI-03 | Resident profile | Name, phone, email, ID number (CCCD, stored encrypted, shown masked), date of birth, entered by the Manager | FR-18.1, FR-37.5 | UC-13 | P1 | M | — | F-UNI-01 | web | — |
| F-UNI-04 | Resident–unit linking | One owner per unit; one phone links to several units with different member types; an existing phone gets a membership, not a new account | FR-16.5, FR-17.1, FR-18.1 | UC-13, UC-14 | P1 | M | — | F-UNI-01, F-UNI-03 | web | — |
| F-UNI-05 | Member and account management | Manager views, locks, removes members and accounts, changes a login phone, approves a deletion request; a lock by the Manager cannot be undone by the owner | FR-17.4, FR-18.3, FR-18.4, FR-39.3 | UC-13, UC-15, UC-27 | P1 | M | — | F-UNI-04 | web | — |
| F-UNI-06 | Search and export | Search units and residents by code, name with or without diacritics, phone suffix; Excel export of units and residents through the export center | FR-18.5, FR-37.5, FR-48.1 | UC-13, UC-25 | P6 | S | — | F-UNI-01, F-DSH-13 | web | — |
| F-UNI-07 | Unit change history | Owner changes, move-ins and move-outs kept as `unit_history` with kind, actor and time | FR-18.3, FR-18.6 | UC-13 | P1 | S | — | F-UNI-01 | web | — |
| F-UNI-08 | Unit and resident lookup | Find a unit, resident or plate by any 3 characters; owner and members with a masked phone and a Call button; every view logged | FR-31.2, FR-31.3 | UC-28 | P5 | S | — | F-UNI-01, F-VEH-04 | staff | — |
| F-UNI-09 | Unit info | The resident sees the unit and its members according to the member-type policy table | FR-16.2 | UC-15 | P4 | M | — | F-ACC-08 | resident | — |
| F-UNI-10 | Member management | The owner adds, edits, locks and removes members by phone; no size limit; 10 invitation SMS per day | FR-17.1, FR-17.2, FR-17.3, FR-17.5 | UC-15 | P4 | M | — | F-UNI-04, F-UNI-11 | resident | — |
| F-UNI-11 | Member types | Family member, tenant (with or without `can_pay`) and helper; the owner sets who may pay; history starts at the membership | FR-07.1, FR-17.3, FR-17.6 | UC-15 | P4 | M | — | F-UNI-04 | resident | — |

## 4. VEH · Vehicles

Proposal §3.3. All of P5 (M5). **F-VEH-05** is added by DR-49 (retire).

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-VEH-01 | Vehicle management | Register and edit a vehicle: plate, type, vehicle photo and both sides of the registration paper (all required); an edit of an approved vehicle is a pending revision | FR-30.1, FR-30.2, FR-30.5 | UC-12 | P5 | M | — | F-SYS-03 | web, resident | — |
| F-VEH-02 | Vehicle approval | Manager reviews photos and the unit's vehicle count, approves or rejects with a reason code; the car limit is a warning | FR-30.3, FR-30.4 | UC-12 | P5 | M | — | F-VEH-01 | web, staff | — |
| F-VEH-03 | Approval result notification | Inbox entry and push to the resident on approval or rejection with the reason; the Manager is told of a pending vehicle | FR-30.3, FR-29.1 | UC-12 | P5 | M | — | F-VEH-02, F-NOT-07 | staff, resident | — |
| F-VEH-04 | Plate lookup | Search approved vehicles only by any 3 characters of the plate; shows unit, owner (masked phone) and vehicle type | FR-31.1 | UC-28 | P5 | M | — | F-VEH-02 | staff | — |
| F-VEH-05 | (added) Retire a vehicle | Owner, family member or Manager retires a vehicle; the Manager retires all at move-out | FR-43.1, FR-43.2 | UC-12 | P5 | M | — | F-VEH-02 | web, resident | — |

## 5. QRC · Resident QR code

Proposal §3.4. All of P5 (M5, EXP-05). The credential is a signed token with a nonce and the membership's credential version (ADR-0012).

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-QRC-01 | Per-unit, per-role QR | Each selected unit has its own code tied to the person and member type | FR-25.3, FR-16.2 | UC-16 | P5 | M | — | F-ACC-08 | resident | — |
| F-QRC-02 | 15-minute dynamic QR | A new code on opening the screen, valid 15 min with a server-time countdown; a new code invalidates the old one; lock, unlock or removal kills codes | FR-25.1, FR-25.2, FR-25.4 | UC-16 | P5 | M | — | F-QRC-01 | resident | — |
| F-QRC-03 | QR scan | The Guard sees unit, name, member type, rights and the owner with a masked phone; expired or invalid codes show no resident data; every scan is logged | FR-26.1, FR-26.2, FR-26.3, FR-26.4, FR-26.5 | UC-16 | P5 | M | — | F-QRC-02 | staff | — |

## 6. NOT · News and notifications

Proposal §3.5. All of P4 (M4, EXP-06). The notification core (inbox, device tokens, Expo push) is built earlier, in P2, because fees and payments already notify (DR-76); **F-NOT-07** is completed in P4 with the resident and staff inbox screens.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-NOT-01 | Compose news | Rich text (a fixed subset), Vietnamese required and English optional, category, up to 5 attachments, drafts | FR-27.1 | UC-11 | P4 | M | — | F-SYS-03 | web | — |
| F-NOT-02 | Recipients and sending | Audience by role and member type; send now or schedule; in-app entry and push; fan-out in batches that survive a crash | FR-27.2, FR-27.3, FR-29.1, FR-29.2 | UC-11, UC-19 | P4 | M | — | F-NOT-01, F-NOT-07 | web | — |
| F-NOT-03 | Read tracking | Read and unread counts per member type, unread list with last app open, push failures | FR-28.1, FR-28.2, FR-28.4 | UC-11 | P4 | M | — | F-NOT-02 | web | — |
| F-NOT-04 | Pin and expiry | Pin a notice and set a display expiry; a sent notice can change only these | FR-27.4, FR-27.5 | UC-11 | P4 | S | — | F-NOT-02 | web | — |
| F-NOT-05 | Quick news | The Manager composes a short notice and reads the read rate in the staff app | FR-27.2, FR-28.1 | UC-11 | P4 | S | — | F-NOT-02 | staff | — |
| F-NOT-06 | News list and detail | Filter by category and read status, pinned first; helpers receive broadcast notices; first read time is kept | FR-27.5, FR-27.6, FR-28.3 | UC-11 | P4 | M | — | F-NOT-02 | resident | — |
| F-NOT-07 | Notification center | Inbox with unread count for fees, tickets, payments, vehicles and notices; push that follows language and push setting; device tokens | FR-29.3, FR-29.4, FR-29.5, FR-29.6 | UC-19 | P4 | M | — | F-ACC-05 | web, staff, resident | — |

## 7. TIC · Support tickets

Proposal §3.6. All of P4 (M4). Rows 8–15 are the Technician's and Guard's app; rows 16–21 the resident's. **F-TIC-07** (deadlines) is not built in phase 1 (DR-47). **F-TIC-22** is added by DR-44.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-TIC-01 | Ticket list and filters | Filter by status, type, assignee and time; urgent first; the Guard sees Technician tickets read-only | FR-20.5, FR-20.6 | UC-08 | P4 | M | — | F-TIC-16 | web, staff | — |
| F-TIC-02 | Assignment | Assign to a Technician or Guard with workload, appointment and note; reassign; the assignee is pushed | FR-20.1, FR-20.2, FR-20.3, FR-20.4 | UC-08 | P4 | M | — | F-TIC-16 | web, staff | — |
| F-TIC-03 | Progress tracking | The Manager follows status, hold reasons and result photos on one timeline | FR-22.1, FR-22.3 | UC-09, UC-10 | P4 | M | — | F-TIC-02 | web, staff | — |
| F-TIC-04 | Communication | Staff messages are public by default, internal notes never reach residents | FR-24.1, FR-24.2 | UC-09, UC-10 | P4 | M | — | F-TIC-16 | web, staff | — |
| F-TIC-05 | Close and reopen | The Manager closes a resolved ticket or reopens a closed one back to the same assignee | FR-23.1 | UC-10 | P4 | M | — | F-TIC-11 | web, staff | — |
| F-TIC-06 | Ticket types | Five seeded types with Vietnamese and English names, enabled or disabled by the Manager | FR-19.2 | UC-07 | P4 | S | — | F-SYS-07 | web | — |
| F-TIC-07 | SLA and overdue alerts | Due time and overdue alerts per ticket type; phase 2, the columns exist and nothing reads them | — | — | Later | C | `FEATURE_TICKET_DEADLINES=false` | F-TIC-06 | web | Cut 4 |
| F-TIC-08 | My tasks | Assigned tickets of the Technician, filtered by status and urgency | FR-20.6, FR-21.1 | UC-09 | P4 | M | — | F-TIC-02 | staff | — |
| F-TIC-09 | Ticket detail | Description, photos and video, unit location, contact phone and quick call | FR-21.1, FR-22.1 | UC-09 | P4 | M | — | F-TIC-16 | staff | — |
| F-TIC-10 | Accept or return | Accept, or reject with a reason code and a note of at most 300 characters; the ticket returns to the Manager | FR-21.1, FR-21.2, FR-21.3 | UC-09 | P4 | M | — | F-TIC-02 | staff | — |
| F-TIC-11 | Progress and results | Start, hold with a reason, resume, report done with before and after photos and a result note | FR-22.1, FR-22.3, FR-22.4 | UC-09 | P4 | M | — | F-TIC-10 | staff | — |
| F-TIC-12 | Extension and waiting for materials | The Technician puts a ticket on hold with a reason (for example "waiting for a valve"); there is no cost or material record | FR-22.1 | UC-09 | P4 | S | — | F-TIC-11 | staff | — |
| F-TIC-13 | Handling history | Completed tickets of the Technician with the resident's rating | FR-23.3 | UC-09 | P4 | S | — | F-TIC-20 | staff | — |
| F-TIC-14 | Ticket handling (Guard) | The Guard accepts and updates security tickets with photos and notes and reads Technician tickets without personal data | FR-20.5, FR-21.1, FR-22.1 | UC-09 | P4 | M | — | F-TIC-10, F-TIC-11 | staff | — |
| F-TIC-15 | New-task push | Push to the assignee when a ticket is assigned | FR-20.2 | UC-08 | P4 | M | — | F-TIC-02, F-NOT-07 | staff | — |
| F-TIC-16 | Create request | Type, title (120), description (2,000), location, up to 5 photos and 1 video; code `YC-YYMMDD-NNN`; a helper cannot submit | FR-19.1, FR-19.2 | UC-07 | P4 | M | — | F-SYS-03, F-UNI-11 | resident | — |
| F-TIC-17 | Track status | Sent, accepted, in progress, done; results appear after the Manager closes | FR-22.2, FR-23.2 | UC-07, UC-10 | P4 | M | — | F-TIC-16 | resident | — |
| F-TIC-18 | Chat with the Manager | The resident comments on the ticket; only public messages are shown | FR-24.1, FR-24.2 | UC-07 | P4 | M | — | F-TIC-16 | resident | — |
| F-TIC-19 | Cancel | Cancel only while unassigned; against a simultaneous assignment the first commit wins | FR-19.3, FR-19.4 | UC-07 | P4 | M | — | F-TIC-16 | resident | — |
| F-TIC-20 | Rating | 1–5 stars and a comment once per ticket, within 14 days of closing | FR-23.3, FR-23.4 | UC-10 | P4 | M | — | F-TIC-05 | resident | — |
| F-TIC-21 | History and push | Ticket history of the unit; inbox entry and push in the same transaction as every visible status change | FR-23.2 | UC-07 | P4 | M | — | F-TIC-16, F-NOT-07 | resident | — |
| F-TIC-22 | (added) Manager cancels a ticket | Cancel before resolution with a mandatory reason; the resident is told the reason | FR-42.1, FR-42.2 | UC-22 | P4 | M | — | F-TIC-02 | web | — |

## 8. FEE · Fees and debt

Proposal §3.7. All of P2 (M2). The proposal's "partial payment" is gone (DR-84); **F-FEE-16** and **F-FEE-17** are added by DR-20 and DR-19.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-FEE-01 | Payment due date setting | `defaultDueDays` (default 10) proposes the due date of a new batch | FR-38.4 | UC-01, UC-17 | P2 | S | — | F-SYS-01 | web | — |
| F-FEE-02 | Fee import | Template download and per-batch Excel import: unit, fee month, item, quantity, unit price, amount, kind, note; amounts rounded half up | FR-01.1, FR-01.2, FR-01.5, FR-01.6 | UC-01 | P2 | M | — | F-UNI-01, F-SYS-03 | web | — |
| F-FEE-03 | Validation | Synchronous preview before saving with row errors; stale and double saves refused; re-import overwrites a draft | FR-01.3, FR-01.4, FR-01.7, FR-02.1 | UC-01 | P2 | M | — | F-FEE-02 | web | — |
| F-FEE-04 | Fee adjustment | Add, edit and remove a unit's lines before publishing, including negative adjustment lines; version-guarded | FR-01.6, FR-02.2, FR-02.3, FR-02.4 | UC-01 | P2 | M | — | F-FEE-02 | web | — |
| F-FEE-05 | Batch management | Draft, published, recalled and closed (a manual freeze, charges stay payable); per-batch due date; codes `PH-YYMM-NN` | FR-02.4, FR-03.4, FR-04.4 | UC-01, UC-04 | P2 | M | — | F-FEE-02 | web | — |
| F-FEE-06 | Publish fee notice | Freeze the charges, notify active owner, family and tenants with inbox entry and push; one publication under a race | FR-03.1, FR-03.2, FR-03.3 | UC-01 | P2 | M | — | F-FEE-05, F-NOT-07 | web | — |
| F-FEE-07 | PDF export of fee notices | Fee notices as PDF in Vietnamese, English or both with logo and contact; 240 in 2 min; a per-unit set and a ZIP | FR-36.1, FR-36.4, FR-36.5 | UC-25 | P2 | M | — | F-FEE-06, F-SYS-01 | web | Cut 5 (ZIP) |
| F-FEE-08 | Manual payment | Cash or bank transfer for whole charges the Manager selects; the amount is computed, never typed; no partial payment | FR-05.1, FR-05.2, FR-05.3, FR-05.4, FR-05.5, FR-05.6, FR-05.7, FR-05.8 | UC-02 | P2 | M | — | F-FEE-06 | web | Never cut (allocation statements) |
| F-FEE-09 | Receipts | One receipt per charge paid, PDF with a snapshot, "Biên lai thu tiền / Payment receipt"; a mistaken entry is voided, not edited, with a reason and an audit row | FR-05.1, FR-06.1, FR-06.2, FR-06.3, FR-06.4, FR-06.5, FR-36.2, FR-36.3 | UC-02 | P2 | M | — | F-FEE-08 | web | — |
| F-FEE-10 | Debt tracking | Debt per unit and per fee month with aging buckets in building time; collected against outstanding | FR-12.1, FR-12.2, FR-12.3, FR-12.5 | UC-05 | P2 | M | — | F-FEE-06 | web, staff | — |
| F-FEE-11 | Debt reminders | Push and inbox reminder to selected units, once per unit per building day | FR-12.4 | UC-05 | P2 | S | — | F-FEE-10, F-NOT-07 | web | — |
| F-FEE-12 | Revoke and republish | Recall a published batch with no payment, then re-issue it as a new draft with `replaces_batch_id` | FR-04.1, FR-04.2, FR-04.3, FR-04.4, FR-04.5 | UC-04 | P2 | M | — | F-FEE-06 | web | Never cut (allocation statements) |
| F-FEE-13 | Fee list | The resident sees open charges of the unit grouped by fee month with their lines; a tenant without `can_pay` sees them read-only | FR-03.3, FR-16.2, FR-17.6 | UC-03 | P2 | M | — | F-FEE-06, F-ACC-08 | resident | — |
| F-FEE-14 | History and debt | Published batches, paid history and debt status; paid history starts at the membership | FR-12.3, FR-17.6 | UC-03 | P2 | M | — | F-FEE-13 | resident | — |
| F-FEE-15 | Receipts (resident) | View and download the receipt PDF; the app moves to the receipt when a payment is posted | FR-08.7, FR-17.6, FR-36.2 | UC-03 | P2 | M | — | F-FEE-09 | resident | — |
| F-FEE-16 | (added) Extend a due date | Later date only, version-guarded, audited; residents are notified | FR-44.1, FR-44.2, FR-44.3 | UC-04 | P2 | M | — | F-FEE-06 | web | — |
| F-FEE-17 | (added) Void a single open charge | Manager or Admin voids one open charge with a reason of at least 5 characters; intents holding it are cancelled as a whole | FR-49.1, FR-49.2, FR-49.3, FR-49.4, FR-49.5 | UC-04 | P2 | M | — | F-FEE-06 | web | Never cut (allocation statements) |

## 9. PAY · Online payment

Proposal §3.8. Online payment is P3 (M3, EXP-01, EXP-02). The settlement core `settle()` is built in P2 for manual entries (DR-76) and used here. **F-PAY-12** is P2 because the money log is first filled by manual-versus-online races of P2 (EXP-03). **F-PAY-05** is not built (DR-91).

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-PAY-01 | Gateway configuration | Admin sets the payOS credentials and the receiving account (one encrypted blob) with step-up; refused while an intent is active; secrets returned masked; VNPay is later | FR-38.3, FR-50.2 | UC-17 | P3 | M | — | F-ACC-12, F-SYS-01 | web | — |
| F-PAY-02 | Payment result handling | A signed confirmation of the exact amount posts one payment, allocations and receipts in one transaction and updates debt; duplicates, forged calls and late calls are safe | FR-08.1, FR-08.2, FR-08.5, FR-08.6, FR-08.8, FR-09.1, FR-09.7 | UC-18 | P3 | M | — | F-FEE-08, F-PAY-08 | api | Never cut (settle(), webhook hardening) |
| F-PAY-03 | Abnormal transactions | Re-query pending links every 5 min for 60 min, expire, cancel at the gateway, settle a lost webhook, avoid duplicate recording | FR-08.3, FR-10.1, FR-10.2, FR-10.4, FR-10.5, FR-10.6 | UC-18 | P3 | M | — | F-PAY-02 | api | Never cut (re-query job) |
| F-PAY-04 | Transaction history | Online payment intents and gateway confirmations searchable by unit, status, time and reference | FR-47.1, FR-47.2 | UC-21 | P3 | M | — | F-PAY-02 | web | — |
| F-PAY-05 | Payment links | The Manager creates and sends a payment link to a resident (proposal); not built, the resident creates the link in the app and the Manager sends a debt reminder instead | — | — | Not built | C | — | — | web, staff | — |
| F-PAY-06 | Reconciliation | Import a bank statement, match by order code after the gateway confirms, link a manual transfer of whole charges, list payments not seen in the bank | FR-11.1, FR-11.2, FR-11.3, FR-11.4, FR-11.5, FR-11.6, FR-11.7, FR-11.8 | UC-06 | P3 | M | — | F-PAY-02, F-FEE-08 | web | Cut 3 (bank-specific parsers) |
| F-PAY-07 | Refund and cancellation | Cancelling or changing an online payment is built (the intent is cancelled at the gateway; a late exact confirmation is still posted); a refund is not, it is done outside the system | FR-07.4, FR-09.7, FR-10.6 | UC-03, UC-18 | P3 | M | — | F-PAY-08 | resident, web | — |
| F-PAY-08 | Online payment | VietQR payment link from payOS for the selected open charges; limits, abuse guard, "I have transferred" re-query, result by polling | FR-07.1, FR-07.3, FR-07.5, FR-07.6, FR-07.7, FR-10.3 | UC-03 | P3 | M | — | F-FEE-13, F-PAY-01 | resident | — |
| F-PAY-09 | Pay per batch | Select whole charges (1–10), several at once; no partial payment; a second member meets the open payment | FR-07.2, FR-07.4 | UC-03 | P3 | M | — | F-PAY-08, F-UNI-11 | resident | — |
| F-PAY-10 | Dynamic payment QR | VietQR code for the intent with amount, receiving account and transfer content, valid 30 min; the app moves to the receipt without a refresh | FR-07.3, FR-08.4, FR-08.7 | UC-03 | P3 | M | — | F-PAY-08 | resident | — |
| F-PAY-11 | (added) Money log viewer | Every confirmation, posted or not, and the unmatched statement lines with filters, detail drawer and a per-unit panel; a mismatched transfer is shown to the resident only as a neutral message in the app | FR-47.1, FR-47.2, FR-47.3, FR-09.2, FR-09.3, FR-09.4, FR-09.5, FR-09.6, FR-09.8, FR-29.7 | UC-21 | P3 | M | — | F-PAY-02 | web | — |
| F-PAY-12 | (added) Review money that was not posted | Mark a log row reviewed once with a note of at least 5 characters; new open rows alert every Manager and Admin; the ledger does not change | FR-46.1, FR-46.2, FR-46.3, FR-46.4 | UC-21 | P2 | M | — | F-PAY-11 | web | — |

## 10. WIK · Document library

Proposal §3.9. All of P5 (M5). **F-WIK-09** is not built (DR-92). **F-WIK-06** and **F-WIK-07** are first in the cut order.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-WIK-01 | Folder tree | Nested folders up to 5 levels with manual ordering | FR-32.1 | UC-23 | P5 | M | — | F-ACC-03 | web | — |
| F-WIK-02 | Compose and publish | Titles, tables, lists, images, links, attachments, Vietnamese and English; draft or publish | FR-32.1, FR-32.3 | UC-23 | P5 | M | — | F-WIK-01, F-SYS-03 | web | — |
| F-WIK-03 | Video and attachments | YouTube links through the no-cookie embed; PDF and image preview, Office files download; 20 MB each | FR-32.4 | UC-23 | P5 | S | — | F-WIK-02 | web | — |
| F-WIK-04 | View permissions | Roles per folder and page; a page inherits the nearest folder unless it overrides; computed at read time | FR-32.2 | UC-23 | P5 | M | — | F-WIK-01 | web | — |
| F-WIK-05 | Search | By title and content, accent-insensitive, within what the reader's role may read | FR-33.1, FR-33.2 | UC-24 | P5 | M | — | F-WIK-04 | web, staff, resident | — |
| F-WIK-06 | Version history | Keep the last 50 versions; view them and restore one by copying it into a new version | FR-32.3, FR-32.5 | UC-23 | P5 | C | — | F-WIK-02 | web | Cut 1 |
| F-WIK-07 | PDF export of a page | Export a page to PDF | FR-32.5 | UC-23 | P5 | C | — | F-WIK-02 | web | Cut 1 |
| F-WIK-08 | Browse and download | Browse folders, view pages and video, download files according to role | FR-32.2, FR-32.4, FR-33.2 | UC-24 | P5 | M | — | F-WIK-04 | staff, resident | — |
| F-WIK-09 | Pin favorites | Pin house rules, emergency contacts or frequent pages (resident) | — | — | Not built | C | — | — | resident | — |

## 11. DSH · Home, dashboard and reports

Proposal §3.10. Numbers and reports are P6 (M6), except where an earlier screen already shows them: debt per unit is P2, the unit switcher P1, the resident home P4 and the Manager's staff home P5. **F-DSH-13** is added by DR-55.

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-DSH-01 | Overview dashboard | Collection rate per fee month, total debt, open and unassigned tickets, vehicles pending, latest notice read rate, money to check | FR-34.1, FR-34.2, FR-34.3, FR-34.4 | UC-25 | P6 | M | — | F-FEE-10, F-TIC-01, F-VEH-02, F-NOT-03, F-PAY-11 | web | — |
| F-DSH-02 | Collection by unit | Collected against outstanding per unit and fee month on the debt screen | FR-12.1, FR-12.3 | UC-05, UC-25 | P2 | S | — | F-FEE-10 | web | — |
| F-DSH-03 | Collection by fee item | Sum of line amounts of paid charges per fee item; an adjustment is its own item | FR-35.1, FR-35.2 | UC-25 | P6 | M | — | F-FEE-09 | web | — |
| F-DSH-04 | Debt aging | Buckets not yet due, 1–30, 31–60, 61–90 and over 90 days past due, in building time | FR-12.1, FR-35.1 | UC-05, UC-25 | P6 | M | — | F-FEE-10 | web | — |
| F-DSH-05 | Ticket report | Counts, handling time and satisfaction | FR-35.1 | UC-25 | P6 | M | — | F-TIC-20 | web | — |
| F-DSH-06 | Online transaction report | Online payments by period | FR-35.1 | UC-25 | P6 | M | — | F-PAY-02 | web | — |
| F-DSH-07 | Staff report | Workload and handling time per Technician and Guard | FR-35.1 | UC-25 | P6 | M | — | F-TIC-02 | web | — |
| F-DSH-08 | Report export | Filter by fee month or item; Excel (streamed, 50,000 rows) and PDF (landscape A4) | FR-35.3, FR-35.4 | UC-25 | P6 | M | — | F-DSH-13 | web | Cut 2 (PDF) |
| F-DSH-09 | Report template | A per-building choice of report columns and the logo, set once at set-up (`reportColumns`) | FR-38.1, FR-35.1 | UC-17, UC-25 | P6 | S | — | F-SYS-01 | web | — |
| F-DSH-10 | Staff home | New tickets, unassigned tickets and vehicles pending for the Manager | FR-34.2 | UC-25 | P5 | M | — | F-TIC-01, F-VEH-02 | staff | — |
| F-DSH-11 | Unit switcher | Shown when the account has several units; the choice sets `X-Unit-Id` | FR-16.1, FR-25.3 | UC-14 | P1 | M | — | F-ACC-08 | resident | — |
| F-DSH-12 | Quick info | Pinned notices, fees due, shortcuts to payment, new request and documents, by member type | FR-12.3, FR-27.5, FR-16.2 | UC-14 | P4 | M | — | F-FEE-13, F-NOT-06 | resident | — |
| F-DSH-13 | (added) Export center | Request an export, get `report.export_ready` and a 15-minute link; files kept 7 days; 2 running exports per user | FR-48.1, FR-48.2 | UC-25 | P6 | M | — | F-SYS-03, F-NOT-07 | web | — |

## 12. SYS · Configuration, language and system operations

Proposal §3.11. Building settings, language and the demo building are P1. The audit viewer, file quota alert, security hardening, backup and the production environment finish in P6. **F-SYS-13** is added by NFR-09 (the nightly check has no proposal row).

| ID | Feature | Description | FR | UC | Phase | MoSCoW | Flag | Depends on | App | Cut step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-SYS-01 | Building and company info | Names, address, hotline, hours, logo, time zone, default language, due days, lockout, car limit, notice language; Admin only, audited | FR-38.1, FR-38.2 | UC-17 | P1 | M | — | F-ACC-01 | web | — |
| F-SYS-02 | Audit log | Every staff mutation audited in its own transaction with actor, IP, object and before and after; searchable by the Admin; append-only | FR-37.1, FR-37.2, FR-37.3, FR-37.4, FR-37.5, FR-37.6 | UC-17 | P6 | M | — | F-ACC-01 | web | — |
| F-SYS-03 | File management | Presigned upload, verification, per-building quota with an 80% alert, orphan cleanup, signed downloads | FR-40.1, FR-40.2, FR-40.3, FR-40.4 | UC-17 | P6 | M | — | F-SYS-01 | web | — |
| F-SYS-04 | Trial account | A demo building with its own staff and resident accounts and the fixed OTP only for `is_demo` accounts; nightly reset | FR-15.6 | UC-14 | P1 | M | `is_demo` | F-ACC-07 | web, resident | — |
| F-SYS-05 | Contact the Manager | Hotline, hours and email from the building settings, shown on login and in the account | — | UC-26 | P1 | S | — | F-SYS-01 | resident | — |
| F-SYS-06 | Vietnamese and English UI | Switch and remember the language; locale-aware dates, numbers and currency; keys and placeholders match in both catalogs | NFR-13 | — | P1 | M | — | — | web, staff, resident | — |
| F-SYS-07 | Bilingual content | Notices, library pages, ticket types and fee notices in two languages; Vietnamese is the fallback | FR-27.1, FR-36.1, NFR-13 | UC-11 | P4 | M | — | F-SYS-06 | web, staff, resident | — |
| F-SYS-08 | Localized notifications | Push and email from templates in the recipient's language; no amounts or names in push text | FR-29.3, FR-29.4 | UC-19 | P2 | M | — | F-SYS-06 | api | — |
| F-SYS-09 | System notifications | Push, SMS OTP for residents, password-reset and invite email for staff, step-up code mail | FR-13.3, FR-15.1, FR-15.7, FR-29.6 | UC-14, UC-17, UC-19 | P2 | M | — | F-SYS-08 | api | — |
| F-SYS-10 | Security and monitoring | HTTPS at the edge, hashed passwords, lockout and rate limits, error logs, metrics and alerts, scans in CI | FR-13.1, FR-13.2, FR-15.5, NFR-07, NFR-08, NFR-10 | UC-30 | P6 | M | — | F-ACC-03 | api | Never cut (authorization matrix, webhook hardening) |
| F-SYS-11 | Backup and restore | Continuous archive and base backups with point-in-time recovery, weekly portable dump, a restore drill each quarter | NFR-11 | UC-29 | P6 | M | — | — | api | Never cut (PITR) |
| F-SYS-12 | Environments | Local, staging and production, each with its own Tunnel, buckets and secrets | NFR-10 | — | P6 | M | — | — | api | — |
| F-SYS-13 | (added) Nightly invariant check | At 03:00 building time the payment and charge invariants are checked on every unit and a difference raises an alert | NFR-09 | UC-20 | P2 | M | — | F-FEE-08 | api | Never cut (nightly invariant check) |

## 13. Features with no FR, changed by a decision, or not built

DR-79 requires every feature to map to an FR or to be recorded with a reason.

### 13.1 Features without a full FR

| Feature | Disposition | Reason | Documents |
| --- | --- | --- | --- |
| F-ACC-04 | Covered by design only | Self-edit of name and avatar is `PATCH /me` with `W-Profile`, `S-Account` and `Account`; no rule beyond the audit and masking rules needs acceptance criteria | DOC-26, DOC-51, DOC-57, DOC-61, DOC-64 |
| F-SYS-05 | Covered by design only | A read of the building settings (`GET /me/contact`, `GET /public/config`); no rule to test beyond FR-38.1 | DOC-36, DOC-51, DOC-60 |
| F-TIC-07 | Later (DR-47) | Ticket deadlines are phase 2; `ticket.due_at` and `ticket_type.resolution_hours` exist, nothing reads them, flag `FEATURE_TICKET_DEADLINES=false`; the FR is written when the phase starts | DOC-28, DOC-01 §5.3 |
| F-PAY-05 | Out of scope for phase 1 (DR-91) | See §13.2 | DOC-01 §5.2 |
| F-WIK-09 | Out of scope for phase 1 (DR-92) | See §13.2 | DOC-01 §5.2 |
| F-PAY-07 | Changed (DR-84) | The proposal's "Refund / cancellation" is split: cancelling an intent is built (FR-07.4, FR-10.6); a refund is not (the Manager refunds outside the system and the money log keeps the transfer) | DOC-22, DOC-23 |

All other features cite at least one FR or NFR in the group tables. A few read-side features (F-FEE-13…15, F-UNI-09, F-DSH-12) have no FR of their own: their rule is the member-type policy table (FR-16.2), the history rule (FR-17.6) and the debt rules (FR-12.3), and their screens and endpoints are specified in DOC-57, DOC-58, DOC-59 and DOC-51.

### 13.2 Decisions made while writing

| Decision | Content | Reason |
| --- | --- | --- |
| DR-89 | Correct the feature count to 113 proposal rows (131 row × app deliveries) and keep "139" out of new text; DOC-01, DOC-03, the master plan (§3.2 DOC-05, P0-07) and DR-79 are updated by the main agent | The figure is not reproducible from the proposal file (§0.1) |
| DR-90 | **F-UNI-06**: the Excel export of units and residents is a kind of the export center (kinds `units` and `residents`, FR-48), logged as one `pii.read` row per export with the record count (FR-37.5); no separate download endpoint | The export center already exists (DR-55); FR-37.5 already assumes an export of residents; one mechanism is simpler |
| DR-91 | **F-PAY-05**: a payment link created by the Manager for a resident is not built. The resident creates the link in the app (FR-07) and the Manager sends a debt reminder (FR-12.4) | An intent belongs to a member who selects the charges and holds the app session; a link sent to a phone would need a second creation path with its own race rules |
| DR-92 | **F-WIK-09**: pinning favorite library pages is not built | No endpoint, screen or FR in the SDD or the design; the tree and search (FR-33) reach every page |

### 13.3 Where the proposal's wording changed

| Feature | The proposal says | This system | Source |
| --- | --- | --- | --- |
| F-FEE-08 Manual payment | "including partial payments" | Whole charges only; the amount is computed from the selection | DR-84, FR-05 |
| F-FEE-09 Receipts | "edit or cancel mistaken entries" | A mistaken entry is voided with a reason; it is not edited | DR-24, FR-06 |
| F-FEE-05 Batch management | draft / published / closed | Adds `recalled`; "closed" is a manual freeze and charges stay payable | DR-20 |
| F-FEE-12 Revoke and republish | Revoke an incorrect notice and republish | Recall only while no charge is paid; re-issue as a new draft; a single open charge can be voided | DR-20, FR-04, FR-49 |
| F-FEE-14 History and debt | Published batches and debt status | Paid history only from the start of the viewer's membership | DR-40, FR-17.6 |
| F-PAY-01 Gateway configuration | "VNPay or VietQR" | One provider, payOS with VietQR links; VNPay is later | DR-25, DR-72 |
| F-PAY-05 Payment links | Create and send links | Not built | DR-91 |
| F-PAY-06 Reconciliation | Match against gateway files and statements | A line settles a charge only after the gateway confirms it, and only for the exact amount | DR-35, FR-11 |
| F-PAY-07 Refund / cancellation | Manual refund or cancel | Cancel an intent: built; refund: outside the system | DR-84 |
| F-PAY-09 Pay per batch | Several batches at once | 1–10 whole charges, which may belong to several batches | FR-07.2 |
| F-PAY-10 Dynamic payment QR | QR per unit and fee batch | One QR per payment intent (the selected charges) | FR-07.3 |
| F-UNI-06 Search and export | Export units and residents to Excel | Through the export center | DR-90 |
| F-ACC-09 Change phone number | Instructions only | Instructions in the app; the Manager changes the number | FR-18.4 |
| F-NOT-02 Recipients and sending | Target by role | Target by role and member type; a person in two units gets one notice | FR-27.3 |
| F-NOT-06 News list and detail | Helpers see only general news | Helpers receive the notices whose audience includes residents, and no entries about fees, tickets or vehicles | FR-27.6 |
| F-TIC-07 SLA and overdue alerts | Due time and alerts per type | Later; flag `FEATURE_TICKET_DEADLINES=false` | DR-47 |
| F-TIC-12 Extension / waiting for materials | Flag need for time or materials | A hold with a reason; no cost or material record | FR-22.1, proposal §5.2 |
| F-DSH-04 Debt aging | 0–30, 31–60, 61–90, 90+ | Not yet due, 1–30, 31–60, 61–90, over 90 days past due, in building time | FR-12.1, DR-18 |
| F-DSH-09 Report template | One-time template setup | A per-building choice of columns and logo kept in the building settings | original SDD §14, FR-38.1 |
| F-SYS-04 Trial account | Trial account for demos | A demo building with flagged accounts and a fixed OTP, in staging and production | DR-60, FR-15.6 |
| F-SYS-11 Backup and restore | Daily automatic backup | Continuous archive and point-in-time recovery, RPO ≤ 5 min | DR-66, NFR-11 |

## 14. The cut order and the features

Master plan §4.3 and DOC-01 §8 fix the order. A milestone more than 50% late starts it.

| Step | What is cut | Features | What stays |
| --- | --- | --- | --- |
| 1 | Library version restore and PDF export of pages | F-WIK-06, F-WIK-07 | Version history is kept (50 versions), reading and search |
| 2 | Report exports beyond Excel | F-DSH-08 (PDF part, FR-35.4) | Excel export of every report |
| 3 | Statement parsers beyond the company's own bank | F-PAY-06 (FR-11.8) | The generic profile, FR-11.1…11.7 |
| 4 | Ticket deadlines | F-TIC-07 | Nothing is built in phase 1 anyway (DR-47) |
| 5 | Bulk ZIP of fee notices beyond the per-unit PDF | F-FEE-07 (FR-36.5) | Fee notice PDFs per unit (FR-36.1, FR-36.4) |
| 6 | Maestro flows beyond the critical ones | none | A test cut, not a feature cut |

**Never cut** (F-ACC-03, F-FEE-08, F-FEE-12, F-FEE-17, F-PAY-02, F-PAY-03, F-SYS-10, F-SYS-11, F-SYS-13): the allocation statements (F-FEE-08, F-FEE-12, F-FEE-17), `settle()` and the webhook hardening (F-PAY-02), the re-query job (F-PAY-03), the nightly invariant check (F-SYS-13), point-in-time recovery (F-SYS-11) and the authorization matrix (F-ACC-03, F-SYS-10).

## 15. Reverse check: every requirement has a feature

Every FR-01…50 is cited by at least one feature (checked with a script on 2026-10-19; the FR column of the group tables is the source). Every sub-requirement `FR-xx.y` of [DOC-03](requirements.md) is cited by at least one feature. Every UC-01…30 has at least one feature (§15.2).

### 15.1 Functional requirements

| FR | Features |
| --- | --- |
| FR-01 | F-FEE-02, F-FEE-03, F-FEE-04 |
| FR-02 | F-FEE-03, F-FEE-04, F-FEE-05 |
| FR-03 | F-FEE-05, F-FEE-06, F-FEE-13 |
| FR-04 | F-FEE-05, F-FEE-12 |
| FR-05 | F-FEE-08, F-FEE-09 |
| FR-06 | F-FEE-09 |
| FR-07 | F-UNI-11, F-PAY-07, F-PAY-08, F-PAY-09, F-PAY-10 |
| FR-08 | F-FEE-15, F-PAY-02, F-PAY-03, F-PAY-10 |
| FR-09 | F-PAY-02, F-PAY-07, F-PAY-11 |
| FR-10 | F-PAY-03, F-PAY-07, F-PAY-08 |
| FR-11 | F-PAY-06 |
| FR-12 | F-FEE-10, F-FEE-11, F-FEE-14, F-DSH-02, F-DSH-04, F-DSH-12 |
| FR-13 | F-ACC-01, F-ACC-02, F-SYS-09, F-SYS-10 |
| FR-14 | F-ACC-02, F-ACC-03 |
| FR-15 | F-ACC-07, F-SYS-04, F-SYS-09, F-SYS-10 |
| FR-16 | F-ACC-03, F-ACC-08, F-UNI-04, F-UNI-09, F-QRC-01, F-FEE-13, F-DSH-11, F-DSH-12 |
| FR-17 | F-UNI-04, F-UNI-05, F-UNI-10, F-UNI-11, F-FEE-13, F-FEE-14, F-FEE-15 |
| FR-18 | F-ACC-09, F-UNI-01, F-UNI-02, F-UNI-03, F-UNI-04, F-UNI-05, F-UNI-06, F-UNI-07 |
| FR-19 | F-TIC-06, F-TIC-16, F-TIC-19 |
| FR-20 | F-TIC-01, F-TIC-02, F-TIC-08, F-TIC-14, F-TIC-15 |
| FR-21 | F-TIC-08, F-TIC-09, F-TIC-10, F-TIC-14 |
| FR-22 | F-TIC-03, F-TIC-09, F-TIC-11, F-TIC-12, F-TIC-14, F-TIC-17 |
| FR-23 | F-TIC-05, F-TIC-13, F-TIC-17, F-TIC-20, F-TIC-21 |
| FR-24 | F-TIC-04, F-TIC-18 |
| FR-25 | F-ACC-08, F-QRC-01, F-QRC-02, F-DSH-11 |
| FR-26 | F-QRC-03 |
| FR-27 | F-NOT-01, F-NOT-02, F-NOT-04, F-NOT-05, F-NOT-06, F-DSH-12, F-SYS-07 |
| FR-28 | F-NOT-03, F-NOT-05, F-NOT-06 |
| FR-29 | F-ACC-05, F-VEH-03, F-NOT-02, F-NOT-07, F-PAY-11, F-SYS-08, F-SYS-09 |
| FR-30 | F-VEH-01, F-VEH-02, F-VEH-03 |
| FR-31 | F-UNI-08, F-VEH-04 |
| FR-32 | F-WIK-01, F-WIK-02, F-WIK-03, F-WIK-04, F-WIK-06, F-WIK-07, F-WIK-08 |
| FR-33 | F-WIK-05, F-WIK-08 |
| FR-34 | F-DSH-01, F-DSH-10 |
| FR-35 | F-DSH-03, F-DSH-04, F-DSH-05, F-DSH-06, F-DSH-07, F-DSH-08, F-DSH-09 |
| FR-36 | F-FEE-07, F-FEE-09, F-FEE-15, F-SYS-07 |
| FR-37 | F-UNI-03, F-UNI-06, F-SYS-02 |
| FR-38 | F-FEE-01, F-PAY-01, F-DSH-09, F-SYS-01 |
| FR-39 | F-ACC-06, F-UNI-05 |
| FR-40 | F-SYS-03 |
| FR-41 (added) | F-ACC-10 |
| FR-42 (added) | F-TIC-22 |
| FR-43 (added) | F-VEH-05 |
| FR-44 (added) | F-FEE-16 |
| FR-45 (added) | F-ACC-05, F-ACC-11 |
| FR-46 (added) | F-PAY-12 |
| FR-47 (added) | F-PAY-04, F-PAY-11 |
| FR-48 (added) | F-UNI-06, F-DSH-13 |
| FR-49 (added) | F-FEE-17 |
| FR-50 (added) | F-ACC-12, F-PAY-01 |

### 15.2 Use cases

| UC | Features |
| --- | --- |
| UC-01 | F-FEE-01, F-FEE-02, F-FEE-03, F-FEE-04, F-FEE-05, F-FEE-06 |
| UC-02 | F-FEE-08, F-FEE-09 |
| UC-03 | F-FEE-13, F-FEE-14, F-FEE-15, F-PAY-07, F-PAY-08, F-PAY-09, F-PAY-10 |
| UC-04 | F-FEE-05, F-FEE-12, F-FEE-16, F-FEE-17 |
| UC-05 | F-FEE-10, F-FEE-11, F-DSH-02, F-DSH-04 |
| UC-06 | F-PAY-06 |
| UC-07 | F-TIC-06, F-TIC-16, F-TIC-17, F-TIC-18, F-TIC-19, F-TIC-21 |
| UC-08 | F-TIC-01, F-TIC-02, F-TIC-15 |
| UC-09 | F-TIC-03, F-TIC-04, F-TIC-08, F-TIC-09, F-TIC-10, F-TIC-11, F-TIC-12, F-TIC-13, F-TIC-14 |
| UC-10 | F-TIC-03, F-TIC-04, F-TIC-05, F-TIC-17, F-TIC-20 |
| UC-11 | F-NOT-01, F-NOT-02, F-NOT-03, F-NOT-04, F-NOT-05, F-NOT-06, F-SYS-07 |
| UC-12 | F-VEH-01, F-VEH-02, F-VEH-03, F-VEH-05 |
| UC-13 | F-ACC-09, F-UNI-01, F-UNI-02, F-UNI-03, F-UNI-04, F-UNI-05, F-UNI-06, F-UNI-07 |
| UC-14 | F-ACC-03, F-ACC-06, F-ACC-07, F-ACC-08, F-UNI-04, F-DSH-11, F-DSH-12, F-SYS-04, F-SYS-09 |
| UC-15 | F-UNI-05, F-UNI-09, F-UNI-10, F-UNI-11 |
| UC-16 | F-QRC-01, F-QRC-02, F-QRC-03 |
| UC-17 | F-ACC-01, F-ACC-02, F-ACC-03, F-ACC-12, F-FEE-01, F-PAY-01, F-DSH-09, F-SYS-01, F-SYS-02, F-SYS-03, F-SYS-09 |
| UC-18 | F-PAY-02, F-PAY-03, F-PAY-07 |
| UC-19 | F-NOT-02, F-NOT-07, F-SYS-08, F-SYS-09 |
| UC-20 | F-SYS-13 |
| UC-21 | F-PAY-04, F-PAY-11, F-PAY-12 |
| UC-22 | F-TIC-22 |
| UC-23 | F-WIK-01, F-WIK-02, F-WIK-03, F-WIK-04, F-WIK-06, F-WIK-07 |
| UC-24 | F-WIK-05, F-WIK-08 |
| UC-25 | F-UNI-06, F-FEE-07, F-DSH-01, F-DSH-02, F-DSH-03, F-DSH-04, F-DSH-05, F-DSH-06, F-DSH-07, F-DSH-08, F-DSH-09, F-DSH-10, F-DSH-13 |
| UC-26 | F-ACC-04, F-ACC-05, F-ACC-11, F-SYS-05 |
| UC-27 | F-ACC-06, F-ACC-10, F-UNI-05 |
| UC-28 | F-UNI-08, F-VEH-04 |
| UC-29 | F-SYS-11 |
| UC-30 | F-SYS-10 |

### 15.3 Non-functional requirements

An NFR is a property of features, not a feature. The features that carry it:

| NFR | Features | Property |
| --- | --- | --- |
| NFR-01 | F-FEE-08, F-PAY-02, F-PAY-03 | Settlement paths with one arbiter per charge |
| NFR-02 | F-PAY-02, F-PAY-10 | Accept-to-commit and polling latency |
| NFR-03 | every feature | API latency is a property of the whole API |
| NFR-04 | F-NOT-02 | Fan-out of a notice |
| NFR-05 | F-FEE-07 | Bulk PDF |
| NFR-06 | F-QRC-02, F-QRC-03 | QR revocation |
| NFR-07 | F-ACC-07, F-SYS-10 | OTP abuse |
| NFR-08 | F-ACC-03, F-SYS-10 | Isolation and the authorization matrix |
| NFR-09 | F-SYS-13 | Nightly invariant check |
| NFR-10 | F-SYS-10, F-SYS-12 | Availability |
| NFR-11 | F-SYS-11 | Backup and restore |
| NFR-12 | F-UNI-02, F-FEE-03 | Import time |
| NFR-13 | F-SYS-06, F-SYS-07 | Two languages |
| NFR-14 | F-UNI-03, F-UNI-08, F-QRC-03, F-SYS-02 | Personal data |

## 16. Not in this document

| Topic | Lives in |
| --- | --- |
| Acceptance criteria | [DOC-03](requirements.md) |
| Use case flows | DOC-04 |
| Goals, scope, the "later" table and the cut order | [DOC-01](vision-and-scope.md) |
| Screens of each feature | DOC-56…DOC-67 |
| Endpoints of each feature | DOC-51 |
| Tasks that build a feature | Master plan §5 and §6 |
| Terms | [DOC-06](../02-glossary.md) |

## Open questions

- **DR-91 (no Manager-created payment link) and DR-92 (no pinned favorites)** are decided by the Owner (2026-10-21, accepted as proposed); F-PAY-05 and F-WIK-09 stay "Not built". DR-89 and DR-90 are decided (Claude, delegated by Owner).
- **Propagation done with DR-89:** "139 features" is corrected to 113 in DOC-01, DOC-03 §3, the master plan (§3.2 DOC-05, P0-07) and DR-79. `references/` keeps the proposal's own wording and is not edited. DR-90 widens FR-48 in DOC-03 (kinds of export).
