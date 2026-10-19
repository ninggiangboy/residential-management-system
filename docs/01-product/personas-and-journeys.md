# Personas and journeys

> Status: **Review** · Updated: 2026-10-20 (DR-128: no "tries left" on the staff login) · DOC-02
> Depends on: original SDD §3.1, §7.4, §18, [DR](../00-decision-register.md) (DR-40, 46, 48, 72, 81, 84), [DOC-01](vision-and-scope.md), [DOC-06](../02-glossary.md), `references/design-screens.md`
> Main readers: DOC-03, DOC-04, DOC-53, DOC-56…67 (screen specifications cite a journey step), P0-18…P0-34

This document describes the eight kinds of people who use the system and one journey for each. It does not define permissions (the policy table is in DOC-27 and DOC-39), requirements (DOC-03) or screens (DOC-57…67); it names the screens and endpoints each journey touches so that those documents can point back ("J-5 steps 4–7").

Persona names and details are illustrative: the sample building has no real people in these documents. Device, technical level and frequency are assumptions to confirm with the client during UAT (P6). Endpoints are written as method and path; their `E-xx` numbers come from DOC-51. Screen names are the artboard names of the design canvas, new screens from DR-72 included.

## 1. Overview

| ID | Persona | System role | Main device | Technical level | Frequency |
| --- | --- | --- | --- | --- | --- |
| PS-1 | Admin | `admin` (staff account) | Desktop browser (web CMS) | High | Weekly; daily around setup and gateway changes |
| PS-2 | Manager | `manager` (staff account) | Desktop browser; phone for the staff app | Medium | Daily, with a peak at the start and end of each fee month |
| PS-3 | Technician | `technician` (staff account) | Phone (staff app) | Low to medium | Several times a day on working days |
| PS-4 | Guard | `guard` (staff account) | Phone (staff app), at the gate | Low | Continuous during a shift |
| PS-5 | Owner | Member type `owner` (resident account) | Phone (resident app) | Medium | A few times a week; more around the due date |
| PS-6 | Family member | Member type `family` | Phone | Low to medium | Occasional |
| PS-7 | Tenant | Member type `tenant`, with or without `can_pay` | Phone | Medium | Weekly |
| PS-8 | Helper | Member type `helper` | Phone, often a basic Android | Low | At the gate; rare otherwise |

One phone number is one resident account. The same person can be the owner of one unit and a tenant of another, and the resident app works in the context of the selected unit (original SDD §3.1). A person who is both staff and resident has two accounts, one per app.

## 2. Personas

### PS-1 · Admin: "Hà, the person who configures the building"

- **System role:** Admin. Every Manager right, plus staff accounts, building settings, the payment gateway, the audit log and storage.
- **Goals:** Set up the building once and keep it safe. Create the Manager and the other staff. Connect the payment gateway so that residents' money lands in the right bank account. Know who changed what.
- **Pain points:** A mistake in the gateway configuration or the receiving account sends money to the wrong place. A stolen session could do the same. Having no record of who changed a setting.
- **Needs from the system:** A step-up check (password plus a code mailed to the Admin) before any sensitive action (FR-50). Masked secrets after they are saved. A searchable audit log. An alert at 80% of storage. A notice in the inbox when another Admin completes a step-up.
- **Does not need:** Day-to-day fees, tickets and notices (the Manager does them). The resident app.
- **Screens:** `W-Login`, `W-Profile`, `W-Staff`, `W-Staff-New`, `W-Building`, `W-Gateway`, `W-Step-Up`, `W-Audit`, `W-System`, plus every Manager screen.

### PS-2 · Manager: "Lan, the building management office"

- **System role:** Manager. Runs units and residents, vehicles, notices, tickets, fee batches, payments, debt and reports. Creates and locks Technician and Guard accounts only.
- **Goals:** Publish the month's fees without retyping them. Know on any day who has paid and who has not. Stop reading bank statements line by line. Give every request an owner and a status. Tell residents things once and know who read them.
- **Pain points:** Matching transfers to units by hand, a typo costing an evening. Chasing a technician by phone. Residents who say they paid. Not knowing whether an announcement was read.
- **Needs from the system:** An Excel import with row-level errors. A money log that lists only the transfers that need a human. A single place for tickets with workload per assignee. Read statistics per notice. Reports to Excel and PDF.
- **Does not need:** Gateway secrets, the audit log, storage (Admin). Any credit or partial-payment bookkeeping: the system has none (DR-84).
- **Screens:** Web `W-Dashboard`, `W-Fees`, `W-Fee-Import`, `W-Fee-Batch`, `W-Fee-Record`, `W-Fee-Recall`, `W-Charge-Void`, `W-Fee-Reissue`, `W-Debts`, `W-Transactions`, `W-Money-Log`, `W-Statement`, `W-Tickets`, `W-Ticket-Detail`, `W-Ticket-Assign`, `W-Notices`, `W-Notice-Edit`, `W-Notice-Stats`, `W-Units`, `W-Unit-Detail`, `W-Residents`, `W-Resident-Add`, `W-Import`, `W-Vehicles`, `W-Docs`, `W-Reports`, `W-Export-Center`. Staff app `B-Home`, `B-Tickets`, `B-Ticket-Detail`, `B-Assign`, `B-Ticket-Close`, `B-Vehicles`, `B-Vehicle-Review`, `B-Units`, `B-Notice-New`, `B-Notice-Stats`.

### PS-3 · Technician: "Phúc, who fixes things in the building"

- **System role:** Technician. Sees only tickets assigned to them.
- **Goals:** Know what to fix, where and when. Report the result with photos without paperwork.
- **Pain points:** Jobs arriving by phone call with a half-remembered unit number. Being blamed for a delay they did not cause. A job that needs a part they do not have.
- **Needs from the system:** A push when a job is assigned. The unit, location, photos and contact in one screen. A way to reject a job with a reason and a way to put it on hold. Before/after photos.
- **Does not need:** Fees, notices composing, residents' personal data beyond the unit contact on the job, vehicles.
- **Screens:** `S-Login`, `S-Forgot`, `S-Account`, `S-Inbox`, `S-Docs`, `K-Jobs`, `K-Job-New`, `K-Job-Reject`, `K-Job-Working`, `K-Job-Done`, `K-History`.

### PS-4 · Guard: "Quân, at the gate"

- **System role:** Guard. Scans QR codes, looks up units and approved plates, handles security tickets, sees Technician tickets read-only with the resident's name, phone and messages hidden (DR-46).
- **Goals:** Let in who lives or works here and stop who does not, in seconds, without arguing.
- **Pain points:** A new helper or a tenant's car is stopped or waved through with no record. A resident who shows an old screenshot. Having to phone the office to confirm a name.
- **Needs from the system:** A scan result that says valid, expired or invalid and, when valid, the unit, person, member type and rights. A search by unit, resident or any three characters of a plate over approved vehicles only. The owner's phone masked with a Call button.
- **Does not need:** Any resident data after an expired or invalid scan (it is never shown). Fees, notices composing, full phone numbers.
- **Screens:** `S-Login`, `S-Account`, `S-Inbox`, `S-Docs`, `G-Lookup`, `G-Scan`, `G-Scan-OK`, `G-Scan-Expired`, `G-Scan-Invalid`, `G-Unit`, `G-Plate`, `G-Jobs`, `G-Jobs-Tech`.

### PS-5 · Owner: "Trần Minh Anh, owns A-1508"

- **System role:** Member type `owner`. One per unit. Every unit feature, including adding, locking and removing members and granting a tenant the right to pay.
- **Goals:** Know what the unit owes and pay it from the phone. Get a receipt. Report a problem and see it fixed. Let the family and a helper in without calling the office.
- **Pain points:** Paper notices that get lost. Not knowing whether a tenant paid. Typing transfer content by hand. Paying a bill that someone else in the household already paid.
- **Needs from the system:** The amount due on the home screen. One QR for several batches. A receipt per charge paid. A member list with lock and remove. Push for fees and tickets.
- **Does not need:** Other units' data. The staff or web apps.
- **Screens:** `Login`, `OTP`, `Terms`, `Terms-Update`, `Unit-Pick`, `Main`, `Fees`, `Fee-Detail`, `Fee-History`, `Pay-Select`, `Pay-VietQR`, `Pay-Done`, `Pay-Mismatch`, `Requests`, `Request-New`, `Request-Detail`, `Request-Cancel`, `Request-Done`, `Unit-Owner`, `Members`, `Member-Add`, `Member-Actions`, `Vehicles`, `Vehicle-Add`, `QR`, `Notices`, `Notice-Detail`, `Inbox`, `Docs`, `Doc-Page`, `Account`, `Account-Phone`, `Account-Deletion`, `Sessions`, `Contact`.

### PS-6 · Family member: "Trần Minh Khoa, lives in A-1508"

- **System role:** Member type `family`. Every unit feature except member management; may pay.
- **Goals:** Pay a bill when the owner is away. Open a request when something breaks. Use their own QR code.
- **Pain points:** Not knowing whether the bill was already paid. Starting a payment that collides with another household member's.
- **Needs from the system:** To see an open payment started by another member instead of creating a second one. Fees, tickets and vehicles of the unit.
- **Does not need:** Member management (owner only). Staff features.
- **Screens:** `Home-Member`, `Unit-Member`, `Fees`, `Pay-Select`, `Pay-VietQR`, `Requests`, `Vehicles`, `QR`, `Notices`, `Inbox`, `Account`.

### PS-7 · Tenant: "Nguyễn Hồng Nhung, rents A-0907"

Two variants share one persona: a tenant whose owner enabled `can_pay`, and a tenant whose owner did not.

- **System role:** Member type `tenant`. Every unit feature except member management; pays only if `can_pay` is on.
- **Goals:** See the monthly bill and, when allowed, pay it. Report a problem to the office. Reach the building rules.
- **Pain points:** Not knowing what the owner already paid. Having to ask the owner every time for the QR or the amount. A tenant without `can_pay` who cannot pay at all.
- **Needs from the system:** A clear read-only fee view when `can_pay` is off, with a hint to ask the owner. The same payment flow as the owner when it is on. Open (unpaid) charges of the unit, and paid history only from the day their membership began (DR-40).
- **Does not need:** Other tenants' data. The paid history from before the tenancy.
- **Screens:** `Home-Tenant-Pay`, `Home-Tenant-NoPay`, `Fees`, `Fees-NoPay`, `Fee-Detail`, `Pay-Select`, `Pay-VietQR`, `Pay-Done`, `Requests`, `Request-New`, `Vehicles`, `QR`, `Notices`, `Docs`, `Account`.

### PS-8 · Helper: "Lê Thị Mai, long-term domestic worker in A-1508"

- **System role:** Member type `helper`. Broadcast notices and a personal QR code only.
- **Goals:** Enter the building without being stopped. Know about a water shutdown.
- **Pain points:** Being stopped at the gate because the guard does not know them. Notices posted in the lobby in a language or format they do not read.
- **Needs from the system:** A QR code that works, with a countdown. General notices.
- **Does not need:** Fees, tickets, vehicles, members, documents, personal notifications. None of these is shown (original SDD §7.4).
- **Screens:** `Login`, `OTP`, `Terms`, `Unit-Pick`, `Home-Helper`, `QR-Helper`, `Notices-Helper`, `Notice-Detail`, `Account-Helper`.

## 3. Journeys

Each journey is one realistic path. Emotions are the persona's likely state at that step.

### J-1 · Admin changes the receiving account (PS-1)

Use case UC-17, requirements FR-50, FR-38. The Admin must change the bank account that receives transfers.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Signs in with email and password | `W-Login`; `POST /auth/staff/login` | Routine | Show the lock message only after the lock ("Too many attempts. Try again in 15 minutes."); a wrong password never says how many tries are left, so an unknown email cannot be told from a known one *Revised 2026-10-20 (DR-128):* the earlier text showed a counter |
| 2 | Opens the gateway settings and edits the receiving account | `W-Gateway`; `GET /staff/gateway` | Careful | Secrets appear masked (`••••` plus the last 4) |
| 3 | Presses Save; the app asks for a step-up | `W-Step-Up`; `POST /staff/step-up {action: "gateway_config"}` | Slightly annoyed | Say why: money is redirected, a code was mailed |
| 4 | Reads the 6-digit code from the Admin's own email, enters it with the password | `W-Step-Up` | Focused | The code is valid 10 minutes and works once |
| 5 | Saves | `PUT /staff/gateway` with `stepUp {password, code}` | Relieved | A refusal while an intent is active (409) names the reason |
| 6 | Checks the connection | `POST /staff/gateway/check` | Reassured | A clear pass or fail |
| 7 | Every Admin receives an email and an inbox entry | Web CMS inbox (`GET /staff/inbox`); template `staff.step_up_done` | — | A second Admin can see that the change was intended |

### J-2 · Manager on the 1st of the month (PS-2)

Use cases UC-01, UC-05, UC-02, UC-21; requirements FR-01…03, FR-05, FR-12, FR-47. The Manager publishes October fees and follows the money for a day.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Downloads the template and fills it from the office spreadsheet | `W-Fee-Import`; `GET /staff/imports/templates/fee_batch` | Tired | Vietnamese and English header aliases are accepted |
| 2 | Uploads; the preview shows 236 valid rows and 4 errors | `W-Fee-Import`; `POST /staff/imports` | Tense | Each error has row, column and a message in the UI language |
| 3 | Fixes one unit by hand in the draft and saves the valid rows | `W-Fee-Batch`; `PUT /staff/charges/{id}`; `POST /staff/imports/{id}/commit` | Better | Pressing Save twice saves once |
| 4 | Publishes the batch | `W-Fee-Batch`; `POST /staff/fee-batches/{id}/publish` | Anxious | Residents get "October fees published" |
| 5 | Watches the collection rate and the online transactions during the first hour | `W-Dashboard`, `W-Transactions` | Curious | About 150 units pay online without any action from the Manager |
| 6 | A resident pays cash at the office; the Manager selects the whole charge and records it | `W-Fee-Record`; `POST /staff/payments` | Routine | The amount is computed; there is no amount field to mistype |
| 7 | Opens the money log: a transfer arrived for a charge already paid in cash | `W-Money-Log`; `GET /staff/money-log` | Concerned | The row says `charge_already_paid`; the Manager refunds outside the system, then marks it reviewed with a note |
| 8 | Sends reminders to units that are overdue after the due date | `W-Debts`; `POST /staff/debts/reminders` | Resigned | One reminder per unit per 24 hours |

### J-3 · Technician fixes a leak (PS-3)

Use cases UC-09, UC-10; requirements FR-20…23. A ticket for a leaking pipe has been assigned.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Receives a push with generic template text and opens the app | `S-Inbox`, `K-Jobs` | Alert | The push carries no resident details (DR-52) |
| 2 | Reads the job: description, photos, unit, location, contact, Manager's note | `K-Job-New`; `GET /staff/tickets/{id}` | Focused | One screen has everything |
| 3 | Accepts | `K-Job-New`; `POST /staff/tickets/{id}/transition` | Ready | If busy: rejects with a reason (`K-Job-Reject`) and the Manager reassigns |
| 4 | Starts work; needs a part and puts the job on hold with a reason | `K-Job-Working`; `POST /staff/tickets/{id}/transition` | Frustrated | The resident sees the reason on the timeline |
| 5 | Resumes, finishes, adds before/after photos and the result note | `K-Job-Working`, `K-Job-Done`; `POST /staff/uploads` | Satisfied | The resident sees the after photos only after the Manager closes |
| 6 | The Manager closes; the resident rates | `K-History` | Proud | Ratings visible to the Technician |

### J-4 · Guard at the gate (PS-4)

Use cases UC-16, UC-28; requirements FR-26, FR-31. Four people arrive within ten minutes.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | A helper shows a QR code; the Guard scans it | `G-Scan`; `POST /staff/access/scans` | Neutral | Result in under a second |
| 2 | Valid: the Guard sees unit, name, member type and rights, and the owner's name with a masked phone | `G-Scan-OK` | Confident | The Call button dials the owner through `tel:`; the view is logged |
| 3 | A resident shows a screenshot taken yesterday | `G-Scan-Expired` | Patient | Only creation and expiry times appear; advice to ask for a new code |
| 4 | The owner locked a former helper a minute ago; that helper shows the old code | `G-Scan-Invalid` | Firm | A generic "invalid code" with possible causes; no resident data, and no hint whether the person still lives there |
| 5 | A car arrives with a plate the Guard half remembers | `G-Plate`; `GET /staff/plates?q=` | Hurried | Any 3 or more characters match among approved vehicles only |
| 6 | A visitor asks for a unit | `G-Lookup`, `G-Unit`; `GET /staff/lookup?q=` | Routine | Results labelled unit, resident or plate, at most 20 each |

### J-5 · Owner pays two batches (PS-5)

Use cases UC-14, UC-03; requirements FR-07, FR-08, FR-15. A1508 owes charge A (management fee, 2,488,000 đ) and charge B (parking, 350,000 đ).

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Receives "October fees published" and opens the app; signs in with the phone and a 6-digit OTP | `Login`, `OTP`; `POST /auth/otp`, `POST /auth/otp/verify` | Patient | Resend after 45 s; an unregistered phone gets contact instructions and no SMS |
| 2 | First sign-in: accepts the terms | `Terms`; `POST /me/terms` | Reluctant | Readable, short text |
| 3 | Owns two units: picks A-1508 | `Unit-Pick` | Routine | Data and permissions follow the selected unit |
| 4 | Home shows the amount due; opens Fees | `Main`, `Fees`; `GET /me/fees?status=open` | Alert | The total outstanding is one number |
| 5 | Selects both batches and chooses VietQR | `Pay-Select`; `POST /me/payments/intents` | Confident | Each charge is paid in full; there is no amount to edit |
| 6 | Sees the QR for 2,838,000 đ with the content `TT2FMZ9` and pays in the bank app | `Pay-VietQR`; polling `GET /me/payments/intents/{id}` | Anxious | Polls every 2 s for the first minute, then 3 s |
| 7 | The app moves to the receipts | `Pay-Done` | Relieved | Two receipts, one per charge (`BL-2610-0153`), with the bank reference |
| 8 | Alternative: the Owner edits the amount in the bank app and sends 2,000,000 đ | `Pay-Mismatch` | Worried | A neutral message that a transfer of another amount was received and the Manager will check (wording in DOC-68, DR-84 item 8); nothing is posted and no push is sent |

### J-6 · Family member meets an open payment (PS-6)

Use case UC-03 alternative 2a; requirement FR-07. The owner started a payment 5 minutes ago and left the phone at work.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Opens Fees and selects the same batch | `Fees`, `Pay-Select` | Purposeful | |
| 2 | The app returns the existing payment "started by Trần Minh Anh at 09:12" | `Pay-VietQR`; `POST /me/payments/intents` returns the same intent | Surprised | No second QR for the same charges |
| 3 | Pays from the same QR | `Pay-VietQR` | Relieved | Whoever transfers, the charge settles once |
| 4 | If the selection differs from the open payment: told that a payment is in progress and may continue or cancel it | `Pay-Select`; 409 `payment_in_progress` | Slightly blocked | The message names the holder and the time |
| 5 | Later opens a request for a broken shutter | `Request-New`; `POST /me/tickets` | Routine | Up to 5 photos and 1 video |

### J-7 · Tenant without the right to pay (PS-7)

Use cases UC-03, UC-15; requirements FR-17, FR-07. The tenant needs to pay but the owner has not enabled `can_pay`.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Opens Fees | `Home-Tenant-NoPay`, `Fees-NoPay` | Neutral | Fees are visible read-only; the open charges of the unit are always shown |
| 2 | Looks for a pay button and finds none | `Fees-NoPay` | Confused | A line explains that the owner decides who can pay |
| 3 | Asks the owner outside the app | — | Mildly annoyed | |
| 4 | The owner enables `can_pay` | `Member-Actions`; `PATCH /me/members/{id}` | — | Takes effect on the tenant's next request |
| 5 | The tenant pays as in J-5 | `Home-Tenant-Pay`, `Pay-Select`, `Pay-VietQR` | Satisfied | Paid history before the tenancy is not shown (DR-40) |

### J-8 · Helper and the revoked code (PS-8)

Use cases UC-16, UC-15; requirements FR-25, FR-26, FR-16. The helper enters daily; then the owner ends the arrangement.

| Step | Action | Touchpoint | Emotion | Opportunity |
| --- | --- | --- | --- | --- |
| 1 | Opens the app; sees the QR with a 15-minute countdown | `Home-Helper`, `QR-Helper`; `POST /me/qr` | Routine | A new code is made on opening; the old one dies |
| 2 | Shows the code to the Guard | (J-4 step 1–2) | Neutral | |
| 3 | Reads a general notice about a water shutdown | `Notices-Helper` | Informed | Helpers see broadcast notices only |
| 4 | The owner locks the membership | `Member-Actions`; `PATCH /me/members/{id}` | — | `credential_version` increases in the same transaction |
| 5 | The helper opens the app again | any `/me/*` request answers 403 `membership_inactive` | Confused | The app returns to `Unit-Pick` with a neutral explanation |
| 6 | A screenshot taken before the lock is shown at the gate | `G-Scan-Invalid` (J-4 step 4) | — | Rejected on the first scan after the change |

## 4. Journey coverage

| Journey | Persona | Use cases | Requirements | Experiment or test |
| --- | --- | --- | --- | --- |
| J-1 | PS-1 | UC-17 | FR-38, FR-50 | `AU-` step-up tests; EXP-10 |
| J-2 | PS-2 | UC-01, UC-02, UC-05, UC-21 | FR-01…03, FR-05, FR-12, FR-46, FR-47 | EXP-03, EXP-08 |
| J-3 | PS-3 | UC-09, UC-10 | FR-20…23 | `TK-` tests |
| J-4 | PS-4 | UC-16, UC-28 | FR-26, FR-31 | EXP-05 |
| J-5 | PS-5 | UC-03, UC-14, UC-18 | FR-07…10, FR-15 | EXP-01, EXP-02 |
| J-6 | PS-6 | UC-03, UC-07 | FR-07, FR-19 | `IN-` tests |
| J-7 | PS-7 | UC-03, UC-15 | FR-07, FR-17 | `RM-` policy table |
| J-8 | PS-8 | UC-15, UC-16 | FR-16, FR-25, FR-26 | EXP-05 |

## Open questions

None.
