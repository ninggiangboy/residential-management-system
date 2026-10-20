# Design screens: catalog and rules

Source: the design canvas <https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj> (115 artboards, Vietnamese UI, sample building "Mộc Miên Residence", 24 floors, 240 units). This file is a condensed copy: the artboard list per app and role, and the business rules the screens imply. Open the canvas for the visuals. Names, phone numbers and amounts in the design are sample data.

Artboard prefixes: `W-` web CMS, `B-` staff app as Manager, `K-` staff app as Technician, `G-` staff app as Guard, `S-` staff app screens shared by every staff role, no prefix: resident app.

## 1. Web CMS (Admin, Manager)

| Area | Artboard | Screen |
| --- | --- | --- |
| Auth | `W-Login` | Email + password sign-in; wrong-password message without a counter, then "Too many attempts. Try again in 15 minutes." once locked (*revised 2026-10-20, DR-128: the design showed "2 tries left"*) |
| | `W-Forgot-Sent` | Reset link sent; valid 30 minutes; resend after 45 s |
| | `W-Reset` | Set new password in the browser (min 8 chars, letters and digits) |
| | `W-Profile` | Name, avatar, UI language, send password-reset link, recent sessions |
| Overview | `W-Dashboard` | Collection rate of the current batch, total debt, open tickets, vehicles pending, latest notice read rate, collection rate per fee month |
| Operations | `W-Tickets` | Ticket list: status, type, assignee, time filters; urgent and unassigned flags |
| | `W-Ticket-Detail` | Ticket detail: resident comments vs internal notes, assignee and workload, status change, result photos, timeline |
| | `W-Ticket-Assign` | Assign dialog: department (Technician / Guard), staff with open-ticket count, appointment time, note to assignee |
| | `W-Ticket-Types` | 5 fixed ticket types, bilingual names, enable/disable; SLA per type marked "phase 2" |
| | `W-Notices` | Notice list: sent, scheduled, draft; read percentage |
| | `W-Notice-Edit` | Rich-text editor, VI/EN content, category, audience (residents and staff roles) with recipient count, send now or schedule, up to 5 attachments |
| | `W-Notice-Stats` | Read rate per member type, unread list with last app open, push failures |
| | `W-Docs` | Wiki: folder tree with drag ordering, page editor, video and file embeds, visibility inherited from folder, VI/EN versions, storage used (3.4 / 10 GB) |
| Residents | `W-Residents` | 612 resident accounts; filters by member type and account status (active, never signed in, deletion requested, locked) |
| | `W-Resident-Add` | Create owner by phone; an existing phone links the new unit to the existing account instead of creating one |
| | `W-Units` | 240 units: code, floor, type, area, status (occupied, rented, vacant), owner, member count |
| | `W-Unit-Detail` | Unit members (change login phone, lock, delete), current debt, vehicles |
| | `W-Import` | Excel import of units/residents: validate, row errors, rows that update existing units, save valid rows only |
| | `W-Vehicles` | Vehicle review: photos, registration paper, sender and owner, the unit's existing vehicles, max 2 cars per unit warning, approve/reject with reason |
| Finance | `W-Fees` | Fee batches (no fixed cycle, each tagged with a fee month): code, status draft/published/closed, units, total, collected, due date |
| | `W-Fee-Import` | Batch import from Excel: batch name, fee month, due date (default publish + 10 days), valid/invalid rows, re-import overwrites while draft |
| | `W-Fee-Batch` | Draft batch: units without charges, per-unit line editing, bulk PDF, preview, publish |
| | `W-Fee-Notice` | Fee notice template: VI, EN or bilingual, company logo and info, lines, total, due date, how to pay |
| | `W-Fee-Record` | Unit debt: unpaid batches, manual payment (cash or transfer, partial allowed), receipt history; edits and voids go to the audit log |
| | `W-Debts` | Debt per unit or per fee month, overdue > 30 days, select units and send push reminders |
| | `W-Transactions` | Online transactions: success (settled), pending (no IPN yet), duplicate blocked, signature failures; automatic re-query every 5 minutes for 1 hour |
| | `W-Reports` | Aging buckets 0–30 / 31–60 / 61–90 / > 90 days, collection per fee item, ticket stats (count, average handling time, satisfaction); income only, no expenses |
| System (Admin) | `W-Staff`, `W-Staff-New` | Staff accounts, 4 staff roles; invite email with a 24-hour set-password link; Manager may create/lock only Technician and Guard |
| | `W-Building` | Building and company info (VI/EN names, address, hotline, hours, logo), default resident language, default due days (10), login lockout (5 tries, 15 minutes), terms version |
| | `W-Gateway` | Payment gateway: choose VNPay or VietQR; merchant fields Client ID, API key, Checksum key; IPN URL; sandbox toggle; connection and signature check |
| | `W-Audit` | Audit log of every staff data change: time, actor, action, object, IP, before/after fields, reason |
| | `W-System` | Daily backup at 02:00, keep 5; file storage 38.2 / 50 GB with an 80% alert; notification channels; staging and production environments |

## 2. Staff app

| Role | Artboard | Screen |
| --- | --- | --- |
| All staff | `S-Login`, `S-Login-Error` | Email + password; "5 wrong tries lock sign-in for 15 minutes" |
| | `S-Forgot`, `S-Forgot-Sent` | Reset link by email, opened in the browser; no password change inside the app |
| | `S-Account` | Name, avatar, language, push toggle, sign out |
| | `S-Inbox` | Notifications: ticket rejected by technician, resident comment, new unassigned ticket, vehicle to review, internal notice |
| | `S-Docs`, `S-Doc-Page` | Wiki filtered to the staff role |
| Manager | `B-Home` | Today: new tickets, unassigned tickets, vehicles pending; tickets to assign; shortcuts |
| | `B-Tickets`, `B-Ticket-Detail`, `B-Assign`, `B-Ticket-Close` | Ticket list, detail with internal notes, assign by workload, close or reopen after the technician reports done |
| | `B-Vehicles`, `B-Vehicle-Review`, `B-Vehicle-Reject` | Pending vehicles, review with photos and the unit's vehicles, reject with a reason code and note |
| | `B-Units`, `B-Unit-Detail` | Unit lookup by code, name or phone; members with call buttons, vehicles, open tickets |
| | `B-Notice-New`, `B-Notice-Stats` | Quick notice, read statistics |
| Technician | `K-Jobs` | My jobs: awaiting acceptance, in progress, urgent flag |
| | `K-Job-New`, `K-Job-Reject` | Job detail (description, media, location, contact, Manager note); accept or reject with a reason (wrong skill, busy, needs equipment, other) |
| | `K-Job-Working`, `K-Job-Done` | Before/after photos, result note visible to the resident, comments, report done |
| | `K-History` | Completed jobs and ratings |
| Guard | `G-Lookup` | Scan resident QR or look up by unit/plate; recent lookups |
| | `G-Scan`, `G-Scan-OK`, `G-Scan-Expired`, `G-Scan-Invalid` | Scanner; valid result shows unit, person, member type and permissions; expired and invalid results show no resident data |
| | `G-Unit`, `G-Plate` | Unit with active members and approved vehicles; plate search over approved vehicles only |
| | `G-Jobs`, `G-Jobs-Tech` | My security tickets; read-only view of Technician tickets |

## 3. Resident app

| Area | Artboard | Screen |
| --- | --- | --- |
| Sign-in | `Login`, `Login-Error` | Phone number, OTP by SMS; unknown phone shows how to contact Manager (no self sign-up) |
| | `OTP` | 6-digit code valid 5 minutes, resend after 45 s |
| | `Terms` | Terms and privacy consent on first sign-in |
| | `Unit-Pick` | One phone in several units: pick the unit; data is separated per unit |
| Home | `Main` | Owner home: amount due, pinned notices, open requests, shortcuts |
| | `Home-Member`, `Home-Tenant-Pay`, `Home-Tenant-NoPay`, `Home-Helper` | Home per member type: family member, tenant allowed to pay, tenant not allowed to pay, helper (QR and general notices only) |
| Fees | `Fees`, `Fees-NoPay`, `Fee-Detail`, `Fee-History` | Batches due, detail with lines and how to pay, history and receipts; tenant without pay permission sees fees read-only |
| Payment | `Pay-Select` | Select batches (each paid in full, no partial online), method VietQR or VNPay |
| | `Pay-VietQR` | QR for the unit and the selected batches, transfer content such as `MM A1508 T10 D1D2 8F3K`; app moves to the receipt when the bank confirms |
| | `Pay-Done` | One receipt per batch (`BL-2610-0153`), bank reference, payer |
| Requests | `Requests`, `Request-New`, `Request-Detail`, `Request-Cancel`, `Request-Done` | List, create (type, title, description, location, photos/video), timeline and comments, cancel only before the Manager accepts, rate after completion |
| Notices | `Notices`, `Notices-Helper`, `Notice-Detail`, `Inbox` | Notice list with filters and pinned items, detail with attachments, notification center |
| Unit | `Unit-Owner`, `Unit-Member` | Unit info, members, vehicles |
| | `Members`, `Member-Add`, `Member-Actions` | Owner-only: add by phone (family, tenant with optional pay permission, helper), edit, lock, remove |
| | `Vehicles`, `Vehicle-Add` | Vehicles with status; add or edit needs Manager approval; photos of vehicle and both sides of the registration paper |
| QR | `QR`, `QR-Expired`, `QR-Helper` | Dynamic QR per unit, 15-minute countdown, "new code" invalidates the old one |
| Account | `Account`, `Account-Phone`, `Account-Helper`, `Contact` | Units list, language, push, phone change via the Manager only, delete request, contact the Manager |
| Docs | `Docs`, `Doc-Page` | Wiki for residents |

## 4. Rules the design implies

| Topic | Rule |
| --- | --- |
| Member types | Owner, family member, tenant, helper. Family member and tenant have every unit feature except member management; tenant pays only if the owner allows it; helper sees general notices and their QR only |
| Phone identity | One phone = one resident account across units; adding a phone that exists links a unit instead of creating an account; only Manager changes a login phone |
| Owner | Exactly one owner per unit |
| Tickets | Statuses seen: sent (awaiting acceptance), accepted, in progress, done awaiting close, closed, cancelled. Technician may reject an assignment with a reason and it returns to the Manager. Resident cancels only before acceptance. Manager closes after checking the result and may reopen |
| Ticket SLA | Due time and overdue alerts per type are marked phase 2 on `W-Ticket-Types` |
| Vehicles | New or edited vehicles wait for review; max 2 cars per unit is a warning to the Manager, not a hard block; guards see approved vehicles only |
| QR | 15 minutes from creation; a new code invalidates the old one; locked or removed members fail; invalid or expired codes reveal no resident data |
| Fee batches | Code `PH-YYMM-NN`; draft → published → closed; re-import overwrites only while draft; default due date publish + 10 days |
| Payments | Online: full batch only, several batches at once; manual: cash or transfer, partial allowed; receipts `BL-YYMM-NNNN` per batch; transactions `TT-MMDD-NNNN`; duplicates blocked; pending re-queried every 5 minutes for 1 hour |
| Notices | Categories general, maintenance, urgent, event; audiences residents and each staff role; schedule editable until sent; read tracking per recipient; push failure count |
| i18n | VI/EN UI; bilingual content falls back to Vietnamese |
| Security | Staff lockout after 5 wrong tries for 15 minutes; reset link 30 minutes; invite link 24 hours; OTP 5 minutes |
| Operations | Daily backup 02:00 keeping 5; storage alert at 80%; staging and production |
