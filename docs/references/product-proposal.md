# Product Proposal: Residential Management System

**Proposed product structure and features**

| | |
| --- | --- |
| Version | v1.0 |
| Author | Hà Duy Khánh |
| Date | 10/10/2026 |
| Note | Covers product, user groups and feature scope only. Timeline and cost are in a separate quotation. |

## 1. Product Overview

A residential management system consisting of one management web app and two mobile apps, so the management company can run day-to-day operations of a building on a single platform.

| Product | Users | Purpose |
| --- | --- | --- |
| **Web CMS** | Admin, Management Board | Manage data, announcements, support tickets, fees, reports and shared content. |
| **Staff app** | Management Board, Technician, Security | Role-based UI: notifications, lookup, ticket handling, news, documents. |
| **Resident app** | Owner, Tenant, Long-term worker/helper | Receive announcements, track and pay fees, submit support requests, manage unit info. |

### 1.1. Goals

- Centralize unit, resident, vehicle and operations data in one system.
- Let the Management Board broadcast announcements and track who has read them.
- Digitize ticket intake, assignment and resolution.
- Support fee notices, payment recording and per-batch debt tracking.
- Give residents and staff a role-based channel for information and documents.

### 1.2. Baseline Scope

- One building, one management company.
- One web CMS and two mobile apps.
- Predefined roles; no custom permission matrix.

## 2. User Groups

| Group | Main role |
| --- | --- |
| **Admin** | Manages staff accounts, configuration and administrative functions. |
| **Management Board** | Manages units, residents, vehicles, news, tickets, fees and operational content. |
| **Technician** | Handles assigned tickets; updates status, photos and results. |
| **Security** | Looks up residents/vehicles, verifies via QR, handles assigned tickets. |
| **Owner** | Manages unit members, fees, payments, support requests and vehicles. |
| **Tenant** | Uses unit features within granted permissions; fee payment depends on the Owner's setting. |
| **Long-term worker/helper** | Views general news and uses a personal QR code. |

**Login:** staff use email and password; residents use phone number and OTP. Owner accounts are pre-created by the Management Board; there is no self-registration.

## 3. Modules and Features

Each feature lists where it is delivered (Web = Web CMS, Staff = Staff app, Resident = Resident app) and which roles use it. "All" means all users of that app.

### 3.1. Accounts, Login and Settings

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Staff login and password reset | Email/password login; reset via emailed link opened in a browser. | Web, Staff | Admin, MB, Technician, Security |
| Staff account management | Create, edit, lock/unlock accounts, assign roles, send set-password email. | Web | Admin |
| Fixed roles | Admin, Management Board, Technician, Security, Resident with predefined permissions. | Web | Admin |
| Profile | View/update personal info (name, avatar). | Web, Staff, Resident | All |
| Settings | Vietnamese/English, push on/off, logout. | Staff, Resident | All |
| Terms and account deletion | Record terms acceptance on first login; support account deletion requests. | Web, Resident | Admin, MB, all residents |
| OTP login | Phone number + OTP login. | Resident | All residents |
| One account, multiple units | Switch between units; data and permissions follow the selected unit. | Resident | All residents |
| Change phone number | Shows instructions to contact the Management Board; not changeable in-app. | Resident | All residents |

### 3.2. Units, Residents and Members

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Unit management | Unit code, floor (as an attribute), area, type, status (occupied/rented/vacant). | Web | MB |
| Excel import | Import units and residents/owners; row-level errors; duplicate phone check. | Web | MB |
| Resident profile | Name, phone, email, ID number, date of birth. | Web | MB |
| Resident–unit linking | Each unit has one owner and members; one phone number may link to multiple units with different roles. | Web | MB |
| Member and account management | View, lock or delete members/accounts; update login phone on request. | Web | MB |
| Search and export | Search, filter and export units/residents to Excel. | Web | MB |
| Unit change history | Track owner changes, move-ins and move-outs. | Web | MB |
| Unit/resident lookup | Find a unit, view owner/members, quick call. | Staff | MB, Security |
| Unit info | View unit info and member list. | Resident | Owner, Tenant |
| Member management | Add, edit, lock or delete members by phone number. | Resident | Owner |
| Member types | Tenant and long-term worker/helper; Owner sets whether a tenant may pay fees. | Resident | Owner |

**Permissions in the unit:**
- **Owner:** full rights, including member management.
- **Tenant:** same as Owner except member management; payment depends on the Owner's setting.
- **Worker/helper:** general Management Board news and personal QR only.

### 3.3. Vehicles

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Vehicle management | Add/edit/delete plate, type, vehicle photo and registration photo (both photos required). | Web, Resident | MB, Owner, Tenant |
| Vehicle approval | Review pending vehicles, photos and the unit's current vehicle count; approve, or reject with a reason. Search by plate. | Web, Staff | MB |
| Approval result notification | Push notification on approval/rejection; residents also see the status and reason. | Staff, Resident | MB, Owner, Tenant |
| Plate lookup | Unit, owner, phone and vehicle type of approved vehicles; view a unit's vehicles. | Staff | Security |

### 3.4. Resident QR Code

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Per-unit, per-role QR | Each selected unit has its own code tied to the user and role. | Resident | All residents |
| 15-minute dynamic QR | New code on opening the screen, valid 15 minutes, countdown shown; generating a new code invalidates the old one. | Resident | All residents |
| QR scan | Shows unit, name, role and permissions. Expired/invalid codes show the reason and reveal no resident data. | Staff | Security |

### 3.5. News and Notifications

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Compose news | Rich text, images, attachments; types: general, maintenance, urgent, event. Drafts and preview. | Web | Admin, MB |
| Recipients and sending | Target by role; send now or schedule; in-app plus push. | Web | Admin, MB |
| Read tracking | Read/unread stats and list of unread users. | Web | Admin, MB |
| Pin and expiry | Pin news and set a display expiry date. | Web | Admin, MB |
| Quick news | Compose/send news to a recipient group and view read rate. | Staff | MB |
| News list and detail | Filter by type and read status; view content, images, download attachments. Workers/helpers see only general news. | Resident | All residents |
| Notification center | Notifications with unread count (fees, tickets, payments, vehicles, news for residents). | Staff, Resident | All |

### 3.6. Support Tickets

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Ticket list and filters | Filter by status, type, assignee and time. | Web, Staff | MB |
| Assignment | Assign to Technician or Security; view their workload. | Web, Staff | MB |
| Progress tracking | Update status, attach result photos. | Web, Staff | MB |
| Communication | Internal notes (staff only) and comments with residents. | Web, Staff | MB |
| Close and reopen | Close a ticket or reopen it. | Web | MB |
| Ticket types | Repair, cleaning, security, complaint, other. | Web | Admin, MB |
| SLA and overdue alerts | Due time and overdue alerts per ticket type. | Web | Admin, MB |
| My tasks | View assigned tickets; filter by status and urgency. | Staff | Technician |
| Ticket detail | Description, photos/video, unit location, contact phone, quick call. | Staff | Technician |
| Accept or return | Accept, or decline with a reason for reassignment. | Staff | Technician |
| Progress and results | Status: accepted → in progress → done; before/after photos, result notes, resident chat. | Staff | Technician |
| Extension / waiting for materials | Flag need for more time or materials with a reason. | Staff | Technician |
| Handling history | Past tickets and resident ratings. | Staff | Technician |
| Ticket handling | Accept/update assigned tickets, before/after photos, notes; can view Technician tickets for support. | Staff | Security |
| New-task push | Push notification when a ticket is assigned. | Staff | Technician, Security |
| Create request | Type, title/description, location, photos/video. | Resident | Owner, Tenant |
| Track status | New, accepted, in progress, done. | Resident | Owner, Tenant |
| Chat with MB | Comment on the ticket. | Resident | Owner, Tenant |
| Cancel | Cancel while not yet being handled. | Resident | Owner, Tenant |
| Rating | Star rating and comment after completion. | Resident | Owner, Tenant |
| History and push | Ticket history; push on status change. | Resident | Owner, Tenant |

### 3.7. Fees and Debt

Flexible fee batches, fee notice publishing, manual payment recording and debt tracking.

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Payment due date setting | Default payment deadline. | Web | Admin |
| Fee import | Template download and per-batch import: unit, applicable month, item, quantity, unit price, amount, note. | Web | MB |
| Validation | Preview before saving, row-level errors; re-import/overwrite while the batch is unpublished. | Web | MB |
| Fee adjustment | Add/edit/delete a unit's fee items before publishing. | Web | MB |
| Batch management | Status: draft / published / closed; per-batch due date. | Web | MB |
| Publish fee notice | In-app + push: applicable month, items, total, due date, payment instructions. | Web | MB |
| PDF export | Bulk export fee notices as PDF. | Web | MB |
| Manual payment | Record cash or bank transfer payments, including partial payments. | Web | MB |
| Receipts | View/download PDF; edit or cancel mistaken entries, with audit log. | Web | MB |
| Debt tracking | Collected vs. outstanding by unit and fee month. | Web, Staff | MB |
| Debt reminders | Send push reminders to selected units. | Web | MB |
| Revoke and republish | Revoke an incorrect fee notice and republish. | Web | MB |
| Fee list | Fee items grouped by applicable month, with item details. | Resident | Owner, Tenant |
| History and debt | Published batches and debt status. | Resident | Owner, Tenant |
| Receipts | View/download receipt PDF. | Resident | Owner, Tenant |

### 3.8. Online Payment

One payment gateway (VNPay or VietQR) for the first release; payments update debt automatically.

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Gateway configuration | Merchant settings for VNPay or VietQR; one gateway for release 1. | Web | Admin |
| Payment result handling | Receive transaction results; auto-update debt on success. | Web | MB |
| Abnormal transactions | Re-query failed/pending transactions; prevent duplicate recording. | Web | MB |
| Transaction history | Search by unit, status, time, transaction ID. | Web | MB |
| Payment links | Create and send payment links to residents. | Web, Staff | MB |
| Reconciliation | Match transactions against gateway files/statements. | Web | MB |
| Refund / cancellation | Manual refund or cancel process. | Web | MB |
| Online payment | Pay through the chosen gateway. | Resident | Owner, Tenant (if permitted) |
| Pay per batch | Pay a batch in full (no partial online payment); multiple batches at once if each is paid in full. | Resident | Owner, Tenant (if permitted) |
| Dynamic payment QR | QR per unit and fee batch. | Resident | Owner, Tenant (if permitted) |

### 3.9. Document Library (Wiki)

The Management Board/Admin author content; other groups browse according to permissions.

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Folder tree | Nested folders with ordering. | Web | Admin, MB |
| Compose and publish | Titles, tables, lists, images, links, attachments; draft or publish. | Web | Admin, MB |
| Video and attachments | Video link preview; PDF, image and Office preview within size limits. | Web | Admin, MB |
| View permissions | Choose roles per folder/page; only MB and Admin can edit. | Web | Admin, MB |
| Search | By title and content. | Web, Staff, Resident | All |
| Version history | View and restore earlier versions. | Web | Admin, MB |
| PDF export | Export a page to PDF. | Web | Admin, MB |
| Browse and download | Browse folders, view pages/video, download files per role. | Staff, Resident | MB, Technician, Security, Owner, Tenant |
| Pin favorites | Pin house rules, emergency contacts or frequent pages. | Resident | Owner, Tenant |

### 3.10. Home, Dashboard and Reports

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Overview dashboard | Collection rate by fee month, total debt, open tickets. | Web | Admin, MB |
| Collection by unit | Fee collection per unit. | Web | Admin, MB |
| Collection by fee item | Collected amounts (no expense reports). | Web | Admin, MB |
| Debt aging | Buckets: 0–30, 31–60, 61–90, 90+ days. | Web | Admin, MB |
| Ticket report | Ticket counts, handling time, satisfaction. | Web | Admin, MB |
| Online transaction report | Online payment transactions. | Web | Admin, MB |
| Staff report | Workload and handling time per Technician/Security. | Web | Admin, MB |
| Report export | Filter by fee month/item type; export Excel or PDF. | Web | Admin, MB |
| Report template | One-time template setup at initialization. | Web | Admin, MB |
| Staff home | New tickets, unassigned tickets, vehicles pending approval. | Staff | MB |
| Unit switcher | Shown when the account is linked to multiple units. | Resident | All residents |
| Quick info | Pinned news, fees due, shortcuts to payment, new request, documents. | Resident | Owner, Tenant |

### 3.11. Configuration, Language and System Operations

| Feature | Description | App | Roles |
| --- | --- | --- | --- |
| Building and company info | Name, address, hotline, working hours, logo (used on fee notices). | Web | Admin |
| Audit log | Search and filter operation history. | Web | Admin |
| File management | File storage, quota and near-full warning. | Web | Admin |
| Trial account | Trial account for demos. | Web | Admin |
| Contact MB | Hotline, working hours, email. | Resident | All residents |
| Vietnamese/English UI | Switch and remember language; locale-aware date, number and currency formats. | All | All |
| Bilingual content | News, wiki, ticket types and fee notices in two languages; falls back to the original if no translation. | All | All |
| Localized notifications | Push and email in the recipient's language. | All | All |
| System notifications | Push, SMS OTP for residents, password-reset email for staff. | All | All |
| Security and monitoring | HTTPS, password protection, login attempt limits, error logging, monitoring. | All | — |
| Backup and restore | Daily automatic backup and a restore procedure. | All | — |
| Environments | Staging and production. | All | — |

## 4. Main Flows

**4.1. Fee publishing and payment**
1. MB prepares fee data per batch (Excel or direct entry).
2. The system validates and shows errors before saving.
3. MB publishes the batch and notifies residents.
4. Residents view fee items and due dates, and may pay online.
5. On a successful transaction, the system updates payment status and debt; residents can view/download the receipt.
6. For cash or manual bank transfers, MB records the payment and the outstanding balance updates.

**4.2. Support ticket handling**
1. Resident creates a ticket with a description and optional photos/video.
2. MB reviews and assigns it to Technician or Security.
3. Staff accept, update status and record photos/results.
4. MB and the resident communicate via comments as needed.
5. After completion, the resident may rate the service.

**4.3. Vehicle registration and approval**
1. Resident submits vehicle info, vehicle photo and registration photo.
2. MB approves, or rejects with a reason.
3. Resident is notified of the result.
4. Security looks up vehicles by plate; only approved vehicles appear.

**4.4. QR lookup**
1. Resident opens the QR screen of the selected unit to generate a dynamic code.
2. The code is valid for 15 minutes; a new code invalidates the old one.
3. Security scans it to see information appropriate to the person's role in the unit.
4. If the code is expired or invalid, the app shows the reason and no resident data.

## 5. Scope and Open Points

### 5.1. Scope principles

- One building, one management company; one web CMS and two mobile apps.
- Fixed roles and permissions; no custom permission matrix.
- Fees are managed per batch with an applicable-month label; no mandatory fixed fee cycle.
- No partial online payment for a fee batch.
- Technicians and Security are employees of the management company; outsourced vendors do not use the Staff app.

### 5.2. Out of scope

- Viettel e-invoicing.
- Branding.
- Patrol function.
- Accounting roles and custom permission matrix.
- Income/expense reports.
- Floor management as a separate module.
- Resident self-registration.
- Partial online payment of a fee batch.
- Recording materials/repair costs on tickets.

### 5.3. To confirm with the client

- Actual scale: number of units and expected users, and how users are counted.
- Payment gateway for release 1: VNPay or VietQR.
- Status of the gateway merchant account.
- Specific business details to settle during requirements confirmation.

### 5.4. Quotation

Timeline, development and operating costs, SMS OTP fees, gateway fees, storage, maintenance, training and commercial terms are in a separate quotation, which must reference this confirmed scope version.
