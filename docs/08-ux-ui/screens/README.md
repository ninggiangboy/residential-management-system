# Screens index

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-21 (DR-226: recent-imports table of `W-Import`; earlier: §4.1: pieces with no artboard; DR-174, 202, 204, 210, 216, 218) · DOC-56
> Depends on: original SDD §18, [DR](../../00-decision-register.md) (DR-27, 33, 38, 39, 40, 41…47, 48, 59, 69…72, 74, 75, 84, 128), [DOC-03](../../01-product/requirements.md), [DOC-04](../../01-product/use-cases.md), [DOC-14](../../05-data/data-conventions.md) (human codes), [DOC-27](../../06-design/residency-and-memberships.md) §3.2 (policy table), [DOC-51](../../07-api/api-endpoints.md), DOC-53, DOC-54, DOC-55, [design screens catalog](../../references/design-screens.md)
> Main readers: the writers of DOC-57…67 and DOC-68, P1-16, P1-17 (the client shells), P1-09 (i18n catalog), every task that builds or tests a screen

This document lists every screen of the three clients, tells which document specifies it, in which phase, and whether the Owner's prototype already draws it. It also fixes how a screen document is written, so that DOC-57…67 read alike. It does not specify any screen: that is the job of the area files listed in §2. Tokens and components are DOC-54, navigation is DOC-53, client structure is DOC-55, and all microcopy is collected in DOC-68.

The visual source of truth is the Owner's prototype, the design canvas <https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj> (design system "Hiên"). The screen documents do not redraw it (DR-194): they name the artboard, list its regions, and add what the canvas cannot show (data, interactions, states, copy keys, acceptance criteria).

## 1. What the three sources say

Sources reconciled on 2026-10-20: the canvas file list and `project/canvas.json` (version `1792510891-47a9`), the catalog `docs/references/design-screens.md`, and the "Required content" rows of DOC-57…67 in master plan §3.2.

| Source | Count | Remark |
| --- | --- | --- |
| Canvas boards (`*.dc.html` listed in `canvas.json`) | **110** | Resident app, Staff app and Web CMS: Resident app 42, Staff app 35, Web CMS 33. Every board is named in a plan row |
| Catalog `design-screens.md` | 110 names | Same set as the canvas; the catalog lags the canvas in wording only (see §5) |
| Plan rows of DOC-57…67 | 123 names | 110 designed + 13 to design (DR-72) |
| "115 artboards" | 115 | Original SDD §18.1, master plan §3.2 DOC-56 and P0-33, DR-72. **A miscount**: the canvas has 110. Propagation: correct the number where it is written (see the report of this change) |

Reconciliation result: no board is missing from the plan, no board is missing from the catalog, and 13 plan rows have no board (§4). Inside an area file the screens are ordered by phase, then by the order of the plan row, so that a gate takes a prefix of the file.

The Owner's prototype has moved on since the catalog was written. The canvas is the truth for what is drawn: staff screens say "Phiếu" and "Đợt phí", residents say "Yêu cầu", the whole canvas uses the Hiên tokens and components, and the web sidebar has the groups Vận hành, Cư dân, Tài chính and Hệ thống. Where the canvas disagrees with a decided DR, the DR wins and the difference is listed in §5.

## 2. The screen documents

| DOC | File | Area | Sections | Designed | To design | Phases | What the P1 gate (P1-00) requires |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-57 | `08-ux-ui/screens/resident-signin-home.md` | Resident app: Sign-in and home | 11 | 10 | 1 | P1 | All 11 sections |
| DOC-58 | `08-ux-ui/screens/resident-fees-payment.md` | Resident app: Fees and payment | 8 | 7 | 1 | P2, P3 | Not gated by P1 |
| DOC-59 | `08-ux-ui/screens/resident-requests-unit.md` | Resident app: Requests, unit, members, vehicles | 12 | 12 | 0 | P4, P5 | Not gated by P1 |
| DOC-60 | `08-ux-ui/screens/resident-qr-notices-account.md` | Resident app: QR, notices, docs, account | 15 | 13 | 2 | P1, P4, P5 | 6 sections: `Account`, `Account-Phone`, `Account-Helper`, `Account-Deletion`, `Sessions`, `Contact` |
| DOC-61 | `08-ux-ui/screens/staff-shared-and-manager.md` | Staff app: Shared screens and Manager | 20 | 20 | 0 | P1, P4, P5 | 5 sections: `S-Login`, `S-Login-Error`, `S-Forgot`, `S-Forgot-Sent`, `S-Account` |
| DOC-62 | `08-ux-ui/screens/staff-technician.md` | Staff app: Technician | 6 | 6 | 0 | P4 | Not gated by P1 |
| DOC-63 | `08-ux-ui/screens/staff-guard.md` | Staff app: Guard | 9 | 9 | 0 | P4, P5 | Not gated by P1 |
| DOC-64 | `08-ux-ui/screens/web-auth-dashboard-operations.md` | Web CMS: Sign-in, dashboard, operations | 14 | 13 | 1 | P1, P4, P5, P6 | 4 sections: `W-Login`, `W-Forgot-Sent`, `W-Reset`, `W-Profile` |
| DOC-65 | `08-ux-ui/screens/web-residents.md` | Web CMS: Residents, units, import | 6 | 6 | 0 | P1, P5 | 5 sections: `W-Residents`, `W-Resident-Add`, `W-Units`, `W-Unit-Detail`, `W-Import` |
| DOC-66 | `08-ux-ui/screens/web-finance.md` | Web CMS: Finance | 15 | 8 | 7 | P2, P3, P6 | Not gated by P1 |
| DOC-67 | `08-ux-ui/screens/web-system.md` | Web CMS: System administration | 7 | 6 | 1 | P1, P3, P6 | 4 sections: `W-Staff`, `W-Staff-New`, `W-Building`, `W-Step-Up` |

Paths are under `docs/`. They are written as code until the file exists, then become links (docs README rule). One file per area, one `##` section per screen, the section heading being the artboard name exactly.

Phase counts by the first phase that needs the screen:

| Phase (first phase that needs the screen) | Designed | To design | Total |
| --- | --- | --- | --- |
| P1 | 31 | 4 | 35 |
| P2 | 10 | 4 | 14 |
| P3 | 5 | 3 | 8 |
| P4 | 39 | 1 | 40 |
| P5 | 21 | 0 | 21 |
| P6 | 4 | 1 | 5 |
| **All** | **110** | **13** | **123** |

Rule for a document gated by several phases (master plan §0.1): the sections of the earlier phase are Approved before that phase starts; the later sections stay `Draft` with their endpoints possibly open (§6.6).

## 3. Catalog

Role or member type is who can open the screen, from the policy table of DOC-27 §3.2 (capabilities `broadcast_notices`, `personal_notifications`, `view_fees`, `pay`, `tickets`, `vehicles`, `library`, `manage_members`) and from the `staff(...roles)` guard (DOC-12 §5.3). "Tenant with `can_pay`" is a tenant whose owner allowed payment. Status is `designed` when the canvas has the artboard, `to design` when it has not (DR-72). Notes point to §5.

### DOC-57 · Resident: sign-in and home

File `08-ux-ui/screens/resident-signin-home.md` · Resident app · 11 sections (10 designed, 1 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `Login` | Phone number sign-in | Any resident (signed out) | P1 | designed |  |
| `Login-Error` | Phone not registered: how to reach the Manager | Any resident (signed out) | P1 | designed |  |
| `OTP` | Six-digit code, 5-minute lifetime, resend | Any resident (signed out) | P1 | designed |  |
| `Terms` | Terms and privacy consent at first sign-in | Owner, Family member, Tenant, Helper | P1 | designed |  |
| `Terms-Update` | Re-consent after a new terms version (DR-59, FR-41) | Owner, Family member, Tenant, Helper | P1 | to design |  |
| `Unit-Pick` | Pick a unit when the account has several memberships | Owner, Family member, Tenant, Helper | P1 | designed |  |
| `Main` | Home of an owner | Owner | P1 | designed | N10 |
| `Home-Member` | Home of a family member | Family member | P1 | designed | N10 |
| `Home-Tenant-Pay` | Home of a tenant allowed to pay | Tenant with `can_pay` | P1 | designed | N10 |
| `Home-Tenant-NoPay` | Home of a tenant not allowed to pay | Tenant without `can_pay` | P1 | designed | N10 |
| `Home-Helper` | Home of a helper: QR and general notices only | Helper | P1 | designed | N10, N11 |

### DOC-58 · Resident: fees and payment

File `08-ux-ui/screens/resident-fees-payment.md` · Resident app · 8 sections (7 designed, 1 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `Fees` | Charges due, grouped by batch | Owner, Family member, Tenant | P2 | designed | N6 |
| `Fees-NoPay` | Same list, read-only (no pay button) | Tenant without `can_pay` | P2 | designed |  |
| `Fee-Detail` | Fee notice of one batch: lines, how to pay | Owner, Family member, Tenant | P2 | designed | N1 |
| `Fee-History` | Paid batches and receipts | Owner, Family member, Tenant | P2 | designed | N1, N4 |
| `Pay-Select` | Select batches and the payment method | Owner, Family member, Tenant with `can_pay` | P3 | designed | N1 |
| `Pay-VietQR` | Dynamic VietQR for the selected batches | Owner, Family member, Tenant with `can_pay` | P3 | designed | N4 |
| `Pay-Done` | Payment confirmed, one receipt per batch | Owner, Family member, Tenant with `can_pay` | P3 | designed | N4 |
| `Pay-Mismatch` | State of `Pay-VietQR`: a transfer of another amount arrived (DR-84 item 8) | Owner, Family member, Tenant with `can_pay` | P3 | to design |  |

### DOC-59 · Resident: requests, unit, members, vehicles

File `08-ux-ui/screens/resident-requests-unit.md` · Resident app · 12 sections (12 designed, 0 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `Requests` | Ticket list (UI word "Yêu cầu") | Owner, Family member, Tenant | P4 | designed | N7 |
| `Request-New` | Create a ticket: type, title, description, location, up to 5 photos and 1 video | Owner, Family member, Tenant | P4 | designed |  |
| `Request-Detail` | Timeline and resident-visible comments | Owner, Family member, Tenant | P4 | designed |  |
| `Request-Cancel` | Cancel a ticket before the Manager accepts it | Owner, Family member, Tenant | P4 | designed |  |
| `Request-Done` | Ticket resolved: result photos, rating | Owner, Family member, Tenant | P4 | designed |  |
| `Unit-Owner` | My unit as owner: info, members, vehicles | Owner | P4 | designed |  |
| `Unit-Member` | My unit as family member or tenant (read-only members) | Family member, Tenant | P4 | designed |  |
| `Members` | Household members list | Owner | P4 | designed |  |
| `Member-Add` | Add a member by phone (family, tenant with `can_pay`, helper) | Owner | P4 | designed |  |
| `Member-Actions` | Edit, lock, remove a member | Owner | P4 | designed |  |
| `Vehicles` | Vehicles of the unit with review status | Owner, Family member, Tenant | P5 | designed |  |
| `Vehicle-Add` | Register or edit a vehicle: photos of the vehicle and the registration paper | Owner, Family member, Tenant | P5 | designed |  |

### DOC-60 · Resident: QR, notices, account

File `08-ux-ui/screens/resident-qr-notices-account.md` · Resident app · 15 sections (13 designed, 2 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `Account` | Account and settings: units, language, push, links | Owner, Family member, Tenant, Helper | P1 | designed |  |
| `Account-Phone` | Change login phone: Manager only, contact instructions | Owner, Family member, Tenant, Helper | P1 | designed |  |
| `Account-Helper` | Account of a helper (reduced) | Helper | P1 | designed |  |
| `Account-Deletion` | Request and cancel account deletion (DR-59) | Owner, Family member, Tenant, Helper | P1 | to design |  |
| `Sessions` | Signed-in devices, revoke one (DR-38; the staff variants are inside `W-Profile` and `S-Account`) | Owner, Family member, Tenant, Helper | P1 | to design | N9 |
| `Contact` | Contact the Manager: hotline, hours, email | Owner, Family member, Tenant, Helper | P1 | designed |  |
| `Notices` | Notice list with filters and pinned items | Owner, Family member, Tenant | P4 | designed |  |
| `Notices-Helper` | General notices only | Helper | P4 | designed |  |
| `Notice-Detail` | Notice with attachments | Owner, Family member, Tenant, Helper | P4 | designed |  |
| `Inbox` | Notification center | Owner, Family member, Tenant | P4 | designed | N11 |
| `QR` | Dynamic QR of the unit, 15-minute countdown | Owner, Family member, Tenant | P5 | designed |  |
| `QR-Expired` | Expired QR, regenerate | Owner, Family member, Tenant | P5 | designed |  |
| `QR-Helper` | QR of a helper | Helper | P5 | designed |  |
| `Docs` | Library folders for residents | Owner, Family member, Tenant | P5 | designed |  |
| `Doc-Page` | Library page | Owner, Family member, Tenant | P5 | designed |  |

### DOC-61 · Staff app: shared and Manager

File `08-ux-ui/screens/staff-shared-and-manager.md` · Staff app · 20 sections (20 designed, 0 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `S-Login` | Staff sign-in by email and password | Any staff (signed out) | P1 | designed | N2 |
| `S-Login-Error` | Wrong password and lock states | Any staff (signed out) | P1 | designed | N2 |
| `S-Forgot` | Request a reset link by email | Any staff (signed out) | P1 | designed |  |
| `S-Forgot-Sent` | Reset link sent | Any staff (signed out) | P1 | designed |  |
| `S-Account` | Name, avatar, language, push, sessions, sign out | Manager, Technician, Guard | P1 | designed | N9 |
| `S-Inbox` | Staff notification center | Manager, Technician, Guard | P4 | designed |  |
| `S-Docs` | Library filtered to the staff role | Manager, Technician, Guard | P5 | designed |  |
| `S-Doc-Page` | Library page, video, file | Manager, Technician, Guard | P5 | designed |  |
| `B-Home` | Today: new, unassigned, vehicles pending | Manager | P4 | designed | N7 |
| `B-Tickets` | Ticket list | Manager | P4 | designed | N7 |
| `B-Ticket-Detail` | Ticket detail with internal notes | Manager | P4 | designed | N7 |
| `B-Assign` | Assign to a Technician or Guard by workload | Manager | P4 | designed |  |
| `B-Ticket-Close` | Close or reopen after the result report | Manager | P4 | designed |  |
| `B-Units` | Unit lookup by code, name or phone | Manager | P4 | designed |  |
| `B-Unit-Detail` | Unit: members with call buttons, vehicles, open tickets | Manager | P4 | designed |  |
| `B-Notice-New` | Quick notice | Manager | P4 | designed |  |
| `B-Notice-Stats` | Read statistics | Manager | P4 | designed |  |
| `B-Vehicles` | Vehicles waiting for review | Manager | P5 | designed |  |
| `B-Vehicle-Review` | Review with photos and the unit's vehicles | Manager | P5 | designed |  |
| `B-Vehicle-Reject` | Reject with a reason code and note | Manager | P5 | designed |  |

### DOC-62 · Staff app: Technician

File `08-ux-ui/screens/staff-technician.md` · Staff app · 6 sections (6 designed, 0 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `K-Jobs` | My jobs: awaiting acceptance, in progress, urgent | Technician | P4 | designed | N7 |
| `K-Job-New` | Newly assigned job: accept or reject | Technician | P4 | designed |  |
| `K-Job-Reject` | Reject with a reason | Technician | P4 | designed |  |
| `K-Job-Working` | Work in progress: before/after photos, comments | Technician | P4 | designed |  |
| `K-Job-Done` | Report done with a result note | Technician | P4 | designed |  |
| `K-History` | Completed jobs and ratings | Technician | P4 | designed |  |

### DOC-63 · Staff app: Guard

File `08-ux-ui/screens/staff-guard.md` · Staff app · 9 sections (9 designed, 0 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `G-Lookup` | Scan entry and manual lookup, recent lookups | Guard | P5 | designed |  |
| `G-Scan` | QR scanner with torch | Guard | P5 | designed |  |
| `G-Scan-OK` | Valid code: unit, person, member type, permissions | Guard | P5 | designed |  |
| `G-Scan-Expired` | Expired code: no resident data, manual lookup | Guard | P5 | designed |  |
| `G-Scan-Invalid` | Invalid code: no resident data | Guard | P5 | designed |  |
| `G-Unit` | Unit with active members (masked phone, DR-48) and approved vehicles | Guard | P5 | designed |  |
| `G-Plate` | Plate search over approved vehicles | Guard | P5 | designed |  |
| `G-Jobs` | My security tickets | Guard | P4 | designed | N7 |
| `G-Jobs-Tech` | Read-only view of Technician tickets | Guard | P4 | designed | N7 |

### DOC-64 · Web: sign-in, dashboard, operations

File `08-ux-ui/screens/web-auth-dashboard-operations.md` · Web CMS · 14 sections (13 designed, 1 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `W-Login` | Email and password sign-in | Any staff (signed out) | P1 | designed | N2, N8 |
| `W-Forgot-Sent` | Reset link sent | Any staff (signed out) | P1 | designed |  |
| `W-Reset` | Set a new password in the browser | Any staff (link holder) | P1 | designed |  |
| `W-Profile` | Name, avatar, language, reset link, recent sessions | Admin, Manager | P1 | designed | N9 |
| `W-Tickets` | Ticket list with filters | Admin, Manager | P4 | designed | N7 |
| `W-Ticket-Detail` | Ticket detail: comments, internal notes, timeline | Admin, Manager | P4 | designed | N7 |
| `W-Ticket-Assign` | Assign dialog with workload | Admin, Manager | P4 | designed |  |
| `W-Ticket-Types` | Ticket types: names, enable or disable | Admin, Manager | P4 | designed |  |
| `W-Ticket-Cancel` | Manager cancels a ticket with a reason (DR-44) | Admin, Manager | P4 | to design |  |
| `W-Notices` | Notice list: sent, scheduled, draft | Admin, Manager | P4 | designed |  |
| `W-Notice-Edit` | Rich-text editor, audience, schedule, attachments | Admin, Manager | P4 | designed |  |
| `W-Notice-Stats` | Read rate per member type, unread list, push failures | Admin, Manager | P4 | designed |  |
| `W-Docs` | Library editor: folders, pages, visibility, VI/EN | Admin, Manager | P5 | designed |  |
| `W-Dashboard` | Collection rate, debt, open tickets, vehicles, latest notice | Admin, Manager | P6 | designed |  |

### DOC-65 · Web: residents

File `08-ux-ui/screens/web-residents.md` · Web CMS · 6 sections (6 designed, 0 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `W-Residents` | Resident accounts with filters | Admin, Manager | P1 | designed |  |
| `W-Resident-Add` | Create an owner by phone, or link an existing account | Admin, Manager | P1 | designed |  |
| `W-Units` | Unit list | Admin, Manager | P1 | designed |  |
| `W-Unit-Detail` | Unit: members, debt, vehicles; change phone, lock, transfer | Admin, Manager | P1 | designed | N12 |
| `W-Import` | Excel import of units and residents: validate, row errors, save, recent imports | Admin, Manager | P1 | designed | the recent-imports table has no artboard (DR-226) |
| `W-Vehicles` | Vehicle review with photos | Admin, Manager | P5 | designed |  |

### DOC-66 · Web: finance

File `08-ux-ui/screens/web-finance.md` · Web CMS · 15 sections (8 designed, 7 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `W-Fees` | Fee batches: code, status, units, total, collected | Admin, Manager | P2 | designed | N5 |
| `W-Fee-Import` | Import a batch from Excel | Admin, Manager | P2 | designed |  |
| `W-Fee-Batch` | Draft batch: check, edit lines, preview, publish | Admin, Manager | P2 | designed |  |
| `W-Fee-Notice` | Fee notice template, VI/EN | Admin, Manager | P2 | designed |  |
| `W-Fee-Record` | Unit debt and manual payment (cash or transfer) | Admin, Manager | P2 | designed | N4, N6 |
| `W-Fee-Recall` | Recall a published batch, with the 409 result | Admin, Manager | P2 | to design |  |
| `W-Charge-Void` | Dialog: void one open charge, reason of at least 5 characters | Admin, Manager | P2 | to design |  |
| `W-Fee-Reissue` | Re-issue a recalled batch as a new draft | Admin, Manager | P2 | to design |  |
| `W-Debts` | Debt per unit, aging, push reminders | Admin, Manager | P2 | designed |  |
| `W-Transactions` | Online transactions, pending, duplicates, re-query | Admin, Manager | P3 | designed | N3, N4 |
| `W-Money-Log` | Tab of `W-Transactions`: every confirmation and unmatched line, review (DR-16) | Admin, Manager | P2, P3 | to design |  |
| `UnitMoneyPanel` | Component: the log rows of one unit (DR-16) | Admin, Manager | P3 | to design |  |
| `W-Statement` | Bank-statement upload and reconciliation | Admin, Manager | P3 | to design |  |
| `W-Reports` | Aging, collection per item, ticket statistics | Admin, Manager | P6 | designed |  |
| `W-Export-Center` | Requested exports and downloads (DR-55) | Admin, Manager | P6 | to design |  |

### DOC-67 · Web: system

File `08-ux-ui/screens/web-system.md` · Web CMS · 7 sections (6 designed, 1 to design)

| Section | Screen | Role or member type | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `W-Staff` | Staff accounts, roles, lock, resend invite | Admin; Manager (Technician and Guard only) | P1 | designed |  |
| `W-Staff-New` | Create a staff account, invite email | Admin; Manager (Technician and Guard only) | P1 | designed |  |
| `W-Building` | Building and company info, defaults, terms | Admin | P1 | designed |  |
| `W-Step-Up` | Dialog: request a code, enter password and code (DR-39) | Admin | P1 | to design |  |
| `W-Gateway` | Payment gateway configuration and checks | Admin | P3 | designed | N3 |
| `W-Audit` | Audit log of staff data changes | Admin; Manager (narrowed set) | P6 | designed |  |
| `W-System` | Backups, storage, notification channels | Admin | P6 | designed |  |


## 4. Screens the prototype does not draw

DR-72 lists the screens to design before their phase. 13 rows, of which one is a component (`UnitMoneyPanel`). Until an artboard exists, the screen document carries an ASCII wireframe (DR-194) and the status stays `to design`.

| Screen | File | Purpose | Phase |
| --- | --- | --- | --- |
| `Terms-Update` | DOC-57 | Re-consent after a new terms version (DR-59, FR-41) | P1 |
| `Pay-Mismatch` | DOC-58 | State of `Pay-VietQR`: a transfer of another amount arrived (DR-84 item 8) | P3 |
| `Account-Deletion` | DOC-60 | Request and cancel account deletion (DR-59); the cooling-off days come from E-13 (DR-202); wireframe in DOC-60 | P1 |
| `Sessions` | DOC-60 | Signed-in devices, revoke one (DR-38; the staff variants are inside `W-Profile` and `S-Account`); wireframe in DOC-60 | P1 |
| `W-Ticket-Cancel` | DOC-64 | Manager cancels a ticket with a reason (DR-44) | P4 |
| `W-Fee-Recall` | DOC-66 | Recall a published batch, with the 409 result | P2 |
| `W-Charge-Void` | DOC-66 | Dialog: void one open charge, reason of at least 5 characters | P2 |
| `W-Fee-Reissue` | DOC-66 | Re-issue a recalled batch as a new draft | P2 |
| `W-Money-Log` | DOC-66 | Tab of `W-Transactions`: every confirmation and unmatched line, review (DR-16) | P2, P3 |
| `UnitMoneyPanel` | DOC-66 | Component: the log rows of one unit (DR-16) | P3 |
| `W-Statement` | DOC-66 | Bank-statement upload and reconciliation | P3 |
| `W-Export-Center` | DOC-66 | Requested exports and downloads (DR-55) | P6 |
| `W-Step-Up` | DOC-67 | Dialog: request a code, enter password and code (DR-39). It opens on a 403 `step_up_required` and, when the form knows its action, on submit (DR-216); the usage rule every web screen follows is in DOC-67 `W-Step-Up` | P1 |

### 4.1 Pages, dialogs and states with no artboard

The 13 rows above are the plan rows of DR-72 and stay the count of `to design` screens (§2: 110 designed, 13 to design, 123 in all). The screen documents also specify the pieces below, which the canvas does not draw and which are parts of a drawn screen or a page of its own. They are **not counted** in §2; each carries a small ASCII wireframe in its document (DR-194) and is owed an artboard before the P1 build of its screen.

| Piece | Part of | File | Phase | Source |
| --- | --- | --- | --- | --- |
| `/wrong-app` page (a Technician or Guard on the web CMS; an Admin in the staff app): which app to use and sign-out | web shell, staff app shell | DOC-64, DOC-61 | P1 | DR-174 |
| Forgot-password dialog (`/login?dialog=forgot`) | `W-Login` | DOC-64 | P1 | DR-210 |
| Read-only mode of `Terms` (`mode=view`), no consent button | `Terms` | DOC-57, DOC-60 | P1 | DR-204 |
| Sessions list of the staff app | `S-Account` | DOC-61 | P1 | N9 |
| Dialog "Thêm căn hộ" | `W-Units` | DOC-65 | P1 | DOC-65 |
| Dialogs edit unit, transfer ownership, change login phone, confirm lock, unlock and remove; the history tab; the row overflow menu | `W-Unit-Detail` | DOC-65 | P1 | DR-40, DR-212 |
| Resident profile dialog; the deletion approval | `W-Residents` | DOC-65 | P1 | DR-59 |
| Steps 1 and 3 of the import, the recent-imports table, the warnings section, the failed, expired and committed states | `W-Import` | DOC-65 | P1 | DR-21, DR-213, DR-226 |
| Edit mode of the create dialog; "Vô hiệu hóa tài khoản" and "Kích hoạt lại" | `W-Staff`, `W-Staff-New` | DOC-67 | P1 | DR-218 |

When an artboard arrives, move the piece to its screen's section header and delete the row here (§6.6).

Three more additions are not new screens but changes to drawn ones, and the screen documents of the owning screens must include them: the `recalled` status on `W-Fees` (N5), the whole-charge selection and the void entry on `W-Fee-Record` (N6), and `UnitMoneyPanel` on `W-Unit-Detail` and `W-Debts` (N12). The staff variants of `Sessions` are a section in `W-Profile` (drawn) and a new row in `S-Account` (not drawn: the artboard has settings and a password note only; N9).

The design owner (client or Owner) is asked to produce these artboards before the gate of the phase in the table. A screen whose artboard arrives later changes its status in this index and in its own section header in the same commit (§6.6).

## 5. Prototype deviations: what a screen document must not copy

Each note is a place where a drawn artboard contradicts a decided DR or another document. The screen document of that artboard writes the decided behavior and lists the note in its §3 under "Do not copy".

| Note | Artboards | The prototype shows | Write instead |
| --- | --- | --- | --- |
| N1 | `Pay-Select`, `Fee-Detail`, `Fee-History` | VNPay as a second payment method ("VNPay", "Qua VNPay hoặc VietQR", a sample row paid by VNPay) | Phase 1 offers VietQR only (DR-72). The method list comes from the configured provider; history rows show the recorded method as data |
| N2 | `W-Login`, `S-Login-Error` | "Còn 2 lần thử", "Bạn còn 2 lần thử" (a counter of tries left) | One 401 `invalid_credentials` body for every credential failure; no count anywhere; the locked state is 423 `account_locked` with `retryAfter` (DR-128). A static policy sentence (5 wrong tries, 15 minutes) may stay as copy owned by DOC-68, never as a number computed per account |
| N3 | `W-Gateway`, `W-Transactions` | A choice between VNPay and VietQR ("Chọn 1 cổng"), the word "IPN", an on-screen design note "Đang chờ chốt VNPay hoặc VietQR cho bản đầu" | One configured provider, fields defined by its driver and stored as one encrypted blob (DR-33, DR-72); provider-neutral "webhook" wording; design notes are not copy |
| N4 | `Fee-History`, `Pay-VietQR`, `Pay-Done`, `W-Fee-Record`, `W-Transactions` | Codes `TT-0910-0045` (MMDD), `PT-0915-0118` for a receipt, `YC-1009-010` | Human codes follow DOC-14: `BL-YYMM-NNNN` receipt, `PH-YYMM-NN` batch, `TT-YYMMDD-NNNN` intent, `YC-YYMMDD-NNN` ticket. There is no `PT-` code. The transfer content shown on `Pay-VietQR` follows DR-27, not the sample `MM A1508 T10 D1D2 8F3K` |
| N5 | `W-Fees` | Status tabs Nháp, Đã phát hành, Đã đóng | Add `recalled` (DR-72). "Closed" is the Manager's manual freeze for reporting; charges stay payable (DR-20) |
| N6 | `Fees`, `W-Fee-Record` | The sentence "nộp tiền mặt hoặc nộp một phần"; a record form that picks batches and a method | No partial payment and no credit (DR-84): remove "nộp một phần". The manual form selects whole charges and shows the computed sum, with no amount field; a wrong entry is voided from its own dialog (DR-72, DR-84) |
| N7 | Staff and web ticket screens (`B-*`, `K-*`, `G-Jobs*`, `W-Tickets`, `W-Ticket-*`, `Requests`) | Staff UI says "Phiếu" and "Phiếu hỗ trợ"; residents say "Yêu cầu" | The glossary and DR-41…47 fix the UI word "Yêu cầu" for a ticket. Decided in DR-197: residents see "Yêu cầu", staff screens and the web CMS keep "Phiếu"; the glossary records both |
| N8 | `Login`, `Login-Error`, `S-Login*`, `W-Login` | The app name "Hiên" and the sample company text and hotline hard-drawn on the sign-in screens | Display names are Owner inputs (DR-69, P0-03); company name, hotline and hours come from `GET /public/config` (E-03) or `GET /me/contact` (E-15), never hard-coded |
| N9 | `S-Account`, `W-Profile`, `Sessions` | `W-Profile` lists recent sessions; `S-Account` has none; the resident app has no `Sessions` | Every account kind lists its sessions and can revoke one (DR-38): resident `Sessions` (E-20, E-21), `W-Profile` and `S-Account` (E-32, E-33) |
| N10 | `Main`, `Home-*` | Tiles and cards for fees, requests, notices, QR, vehicles on one home | The home is a P1 screen but its widgets belong to later phases: a tile or card appears only when its module ships (DR-196) |
| N11 | `Home-Helper`, `Inbox` | A bell with an unread count on a helper's home | A helper has no `personal_notifications` (DOC-27 §3.2): no bell, no `Inbox`; general notices only |
| N12 | `W-Unit-Detail` | Debt block without the money log | From P3 it embeds `UnitMoneyPanel` (DR-72, DR-16) |

## 6. How a screen document is written

### 6.1 Layout of a file

Each file of DOC-57…67 has the ordinary header block (conventions §2), a short scope paragraph, a table "Screens in this file" copied from §3 of this document, and one `##` section per screen in the same order. The heading is the artboard name exactly (`## Pay-VietQR`), so the anchors are predictable (`#pay-vietqr`). A new screen takes the next free place in the table of this document first.

### 6.2 Skeleton of a screen section

Template A.5 of the master plan, with one change (DR-194): section 3 is "Prototype", not "Wireframe".

| § | Heading | Content |
| --- | --- | --- |
| line under the heading | status line | `> Status: Draft · Prototype: designed \| to design · Phase: Pn · DOC-xx` (same words as §3 of this document) |
| 1 | Persona, use cases, permissions | Persona `PS-x`, use cases `UC-xx`, requirements `FR-xx`; the capability or the staff roles that open the screen; what changes for each member type |
| 2 | URL and search params | Web: the route and its search params. Mobile: the expo-router path and the params. Deep link scheme where it applies (DR-69) |
| 3 | Prototype | The canvas artboard name and its canvas title; size (390 wide for mobile, 1440 for web); a compact list of regions top to bottom (top bar, hero, list, bottom bar) naming the design-system component of each; then "Do not copy" with the notes of §5 that apply. **No ASCII wireframe** for a `designed` screen. A `to design` screen carries an ASCII wireframe here instead, plus the design owner and the phase deadline |
| 4 | Regions and components | The components of DOC-54 each region uses, and the state each shows |
| 5 | Data | Every read as `E-xx` with the query keys (unit prefix, DR-70), polling interval, refetch triggers, and the real-time source (§6.5) |
| 6 | Interactions | Table `Action · E-xx · Success · Failure`: each write names its endpoint, the idempotency key if required (DOC-50), the result the user sees, and each error code from DOC-42 §5 the screen branches on |
| 7 | States | Loading, empty, error, stale, forbidden, offline: only what differs from the patterns of DOC-68; a screen with no money or no list says so |
| 8 | Microcopy | Table `Key · vi · en` for every string of the screen (§6.4). The Vietnamese text is quoted from the prototype where it is right, corrected where a note of §5 says so |
| 9 | Acceptance criteria | Table `ID · Given/When/Then · Level` with IDs of §6.3; Level is `api`, `unit`, `web-e2e` or `maestro` |
| 10 | E2E cases | The criteria that become Playwright or Maestro cases, grouped into the flows that will be files |
| 11 | Open questions | Each with a DR ID, or "None." |

### 6.3 Identifiers of acceptance criteria and E2E cases

Test IDs are `XX-nn` with one prefix per document (master plan §0.2, DOC-88). The eleven screen documents take these prefixes; none is used elsewhere (checked against `docs/` on 2026-10-20). The acceptance-criteria row is also the E2E case: the test title starts with the ID, as `check:test-ids` expects.

| DOC | Prefix | Covers |
| --- | --- | --- |
| DOC-57 | `UIRA-` | Resident sign-in and home |
| DOC-58 | `UIRF-` | Resident fees and payment |
| DOC-59 | `UIRU-` | Resident requests, unit, members, vehicles |
| DOC-60 | `UIRQ-` | Resident QR, notices, account |
| DOC-61 | `UISM-` | Staff app shared and Manager |
| DOC-62 | `UIST-` | Staff app Technician |
| DOC-63 | `UISG-` | Staff app Guard |
| DOC-64 | `UIWO-` | Web sign-in, dashboard, operations |
| DOC-65 | `UIWR-` | Web residents |
| DOC-66 | `UIWF-` | Web finance |
| DOC-67 | `UIWS-` | Web system |
| DOC-68 | `UICP-` | UI states and copy (reserved for its own tests, for example the catalog parity cases) |

Numbers run through the whole document (`UIRA-01`, `UIRA-02`…), two digits at least, never reused. The screen is named in the criterion, not in the ID. Playwright files live in `apps/cms-web/e2e/` and Maestro flows in `apps/resident-app/.maestro/` and `apps/staff-app/.maestro/` (DOC-88). The prefix index of DOC-88 owes one row per prefix above.

### 6.4 Microcopy keys

One key names one string. The shape is `<app>.<screen>.<element>`.

| Part | Rule | Examples |
| --- | --- | --- |
| `app` | `res` resident app · `staff` staff app · `web` web CMS · `common` shared by several screens | `res`, `staff`, `web`, `common` |
| `screen` | The artboard name in lower case without the app prefix `W-` or `S-`. The role prefixes `B-`, `K-`, `G-` of the staff app are kept, because `K-Jobs` and `G-Jobs` would clash | `W-Resident-Add` → `web.resident-add`; `S-Login` → `staff.login`; `Account-Phone` → `res.account-phone`; `B-Tickets` → `staff.b-tickets`; `G-Jobs` → `staff.g-jobs` |
| `element` | `title`, `subtitle`, `cta` (the main button) or `cta.<name>`, `action.<name>`, `tab.<name>`, `col.<name>` (table column), `banner.<name>`, `field.<name>.label`, `field.<name>.placeholder`, `field.<name>.hint`, `field.<name>.error`, `empty.title`, `empty.body`, `toast.<event>`, `dialog.<name>.title`, `dialog.<name>.body`, `dialog.<name>.confirm` | `res.otp.title`, `web.resident-add.field.phone.label`, `staff.login.cta` |

Rules shared with DOC-68:

- Error messages are `error.<code>` with the code of DOC-42 §5 (`error.invalid_credentials`). They are owned by DOC-68; a screen only refers to them and writes its own text only when the screen branches on the code and needs words the generic message lacks.
- Status labels are `status.<entity>.<value>` (`status.ticket-resident.sent` for a resident, `status.ticket.<status>` for staff (DR-222), `status.batch.recalled`), owned by DOC-68.
- Strings reused on three screens or more move to `common.<element>` (`common.action.cancel`, `common.unit.label`).
- Values use ICU placeholders (`{amount}`, `{dueDate}`); amounts and dates go through the two formatters of DR-71, never interpolated as text.
- Both languages exist for every key (NFR-13); the parity test of P1-09 fails the build on a missing key or a different placeholder. UI text is quoted in the document exactly as it appears on screen (Vietnamese from the prototype, English written here).

### 6.5 Citing endpoints and real-time channels

- A read or write is `E-xx` (DOC-51), once per use, never by path alone. A screen section may add the method and path in parentheses for readability, but the ID is the reference.
- Real-time on the web CMS is the SSE stream `GET /staff/events` (E-75; events in DOC-52, DR-75): the section names the event (`ticket.created`) and what it refetches. Mobile apps do not use SSE: they refetch on focus and on push, and name the push template. The payment screen names its polling interval (2 s for the first minute, 3 s after, DOC-58).
- Query keys start with the unit prefix on resident screens (DR-70) so that switching unit drops the previous unit's data.

### 6.6 Completeness and tracking

- **Complete for a gate** means: every item of §5 Data and §6 Interactions names an `E-xx`, or carries an open question with a DR ID. A section whose endpoint is not specified yet stays `Draft` and lists the question. The P1 gate (P1-00) needs the sections listed in §2.
- **Tracking `designed` and `to design`**: this document is the single place. When an artboard is added to the canvas, the same commit changes the status in §3 and §4, the status line of the section, and the count in §1. When the canvas changes a drawn screen, the screen section is revised in the same change and the date of its file is updated.
- **A new screen** (a decision adds one) is added to §3 with its notes, then to the master plan row of its DOC if the list there names artboards.

### 6.7 Composite screens

A home screen shows cards of several modules. It is built in P1 with the cards whose endpoints exist; a card of a later module stays hidden until its phase ships (DR-196). The screen section lists each card with its owning phase, so the later phase adds a row, not a rewrite.

## 7. Traceability: screen groups to use cases and requirements

Use cases are in DOC-04 and requirements in DOC-03; this view is by group, not by artboard.

| Screen group | Screens | Use cases | Requirements |
| --- | --- | --- | --- |
| Resident sign-in and terms | `Login`, `Login-Error`, `OTP`, `Terms`, `Terms-Update`, `Unit-Pick` | UC-14, UC-27 | FR-15, FR-16, FR-39, FR-41 |
| Resident home | `Main`, `Home-*` | UC-14, UC-26 | FR-16, FR-17 |
| Resident fees and payment | `Fees`, `Fees-NoPay`, `Fee-Detail`, `Fee-History`, `Pay-*` | UC-03 | FR-07, FR-08, FR-09, FR-36 |
| Resident requests | `Requests`, `Request-*` | UC-07, UC-10 | FR-19, FR-23 |
| Resident unit and members | `Unit-*`, `Members`, `Member-*` | UC-15 | FR-17 |
| Resident vehicles | `Vehicles`, `Vehicle-Add` | UC-12 | FR-30, FR-43 |
| Resident QR | `QR`, `QR-Expired`, `QR-Helper` | UC-16 | FR-25 |
| Resident notices and inbox | `Notices`, `Notices-Helper`, `Notice-Detail`, `Inbox` | UC-11, UC-19 | FR-27, FR-29 |
| Resident library | `Docs`, `Doc-Page` | UC-24 | FR-32, FR-33 |
| Resident account | `Account`, `Account-*`, `Sessions`, `Contact` | UC-26, UC-27 | FR-39, FR-45 |
| Staff sign-in and account | `S-Login`, `S-Login-Error`, `S-Forgot`, `S-Forgot-Sent`, `S-Account`, `S-Inbox` | UC-17, UC-26 | FR-13, FR-29, FR-45 |
| Manager in the staff app | `B-Home`, `B-Tickets`, `B-Ticket-*`, `B-Assign`, `B-Units`, `B-Unit-Detail`, `B-Notice-*` | UC-08, UC-10, UC-11, UC-28 | FR-20, FR-23, FR-24, FR-27, FR-28 |
| Manager vehicles | `B-Vehicles`, `B-Vehicle-*` | UC-12 | FR-30 |
| Technician | `K-*` | UC-09 | FR-21, FR-22 |
| Guard | `G-Lookup`, `G-Scan*`, `G-Unit`, `G-Plate` | UC-16, UC-28 | FR-26, FR-31 |
| Guard tickets | `G-Jobs`, `G-Jobs-Tech` | UC-09 | FR-21, FR-22 |
| Staff library | `S-Docs`, `S-Doc-Page` | UC-24 | FR-32, FR-33 |
| Web sign-in and profile | `W-Login`, `W-Forgot-Sent`, `W-Reset`, `W-Profile` | UC-17, UC-26 | FR-13, FR-45 |
| Web tickets | `W-Tickets`, `W-Ticket-*` | UC-08, UC-10, UC-22 | FR-20, FR-24, FR-42 |
| Web notices | `W-Notices`, `W-Notice-*` | UC-11, UC-19 | FR-27, FR-28 |
| Web library | `W-Docs` | UC-23 | FR-32 |
| Web dashboard and reports | `W-Dashboard`, `W-Reports`, `W-Export-Center` | UC-25 | FR-34, FR-35, FR-48 |
| Web residents | `W-Residents`, `W-Resident-Add`, `W-Units`, `W-Unit-Detail`, `W-Import` | UC-13 | FR-18 |
| Web vehicles | `W-Vehicles` | UC-12 | FR-30, FR-43 |
| Web fee batches | `W-Fees`, `W-Fee-Import`, `W-Fee-Batch`, `W-Fee-Notice`, `W-Fee-Recall`, `W-Fee-Reissue`, `W-Charge-Void` | UC-01, UC-04 | FR-01…04, FR-36, FR-44, FR-49 |
| Web payments and debt | `W-Fee-Record`, `W-Debts` | UC-02, UC-05 | FR-05, FR-06, FR-12 |
| Web online money | `W-Transactions`, `W-Money-Log`, `UnitMoneyPanel`, `W-Statement` | UC-18, UC-21, UC-06 | FR-10, FR-11, FR-46, FR-47 |
| Web system | `W-Staff`, `W-Staff-New`, `W-Building`, `W-Step-Up`, `W-Gateway`, `W-Audit`, `W-System` | UC-17 | FR-14, FR-37, FR-38, FR-41, FR-50 |

## 8. Decisions made while writing

Delegated by the Owner (the decision log of the register says design documents are Claude's call where the Owner left a choice). Recorded in the register as DR-194…197.

| Id | Decision |
| --- | --- |
| DR-194 | Wireframes are not duplicated. The prototype is the visual source of truth; a screen section has a "Prototype" part (artboard name, regions, "Do not copy"). ASCII wireframes only for `to design` screens (§6.2) |
| DR-195 | Screen documents use one test-ID prefix each (§6.3) and the microcopy key scheme `<app>.<screen>.<element>` (§6.4) |
| DR-196 | A composite screen is built in its first phase with the cards whose modules exist; later cards are hidden until their phase (§6.7, N10) |
| DR-197 | The UI word for a ticket: residents see "Yêu cầu" (DR-41…47), staff screens and the web CMS keep the prototype's "Phiếu" (a staff member handles a work slip, a resident files a request); the glossary records both |

## Open questions

None.
