# API endpoints

> Status: **Approved** (Owner, 2026-10-21, for the P1 groups (auth, public, residency, platform); the other groups are specified before their phase) · Updated: 2026-10-28 (DR-279: E-173 `POST /usage-events`, §10A) · 2026-10-26 (DR-268: presigned URLs name the files host `files.<domain>`, no R2; DR-265: E-170…E-172 for draft charges and discard, P2 group; earlier: DR-226: E-169 `GET /staff/imports`, catalog E-01…E-169; DR-96: `unmatchedTransfer` on E-86; DR-225: `client` in E-20 and E-32; DR-202, 212, 213: E-13 cooling-off fields, E-57 and E-63 list fields, E-72 `unitCode`) · DOC-51
> Depends on: original SDD §17.1, §17.2, [DR](../00-decision-register.md) (DR-36…39, 40, 41, 42, 59, 61, 73, 74, 75, 123, 127, DR-142…, 202, 212, 213, DR-96, DR-226, DR-228), [ADR-0023](../04-adr/0023-api-conventions.md), [DOC-50](api-guidelines.md), [DOC-42](../06-design/error-handling.md) §5, [DOC-26](../06-design/identity-and-sessions.md), [DOC-27](../06-design/residency-and-memberships.md), [DOC-35](../06-design/audit-privacy-and-terms.md) §9, §10, [DOC-36](../06-design/building-configuration-and-demo.md), [DOC-37](../06-design/files-and-uploads.md), [DOC-04](../01-product/use-cases.md), [DOC-06](../02-glossary.md)
> Main readers: P1-04, P1-10, P1-11, P1-12, P1-13, P1-14, P1-15 (route metadata and the authorization matrix), P1-16, P1-17 (the clients), every later task that adds an endpoint, DOC-39, DOC-52, DOC-56…67, EXP-10

This document numbers every endpoint of the API (`E-01…E-173`) and specifies, one section each, the endpoints of the groups the first phase builds: public and health, auth, the resident account, the household, the staff account, staff administration, building administration and residency (`E-01…E-74` and `E-169`, the import history added by DR-226). The later groups (`E-75…E-168`) already have their number, method, path, audience and use case in §2, so screens, tests and the authorization matrix can refer to them; their sections are written before the phase that builds them (§11). The rules every endpoint follows (formats, headers, idempotency, pagination, errors) are DOC-50 and are not repeated. The behavior behind an endpoint (statements, state machines, rate buckets) is in the design document the section cites.

Every new decision in this document is recorded as DR-142…DR-14x and summarized in §13. Sample requests and responses use the sample building (DOC-01): unit `A-1508`, owner Nguyễn Văn An, tenant Trần Thị Bình.

## 1. Reading guide

### 1.1 How a section reads

Each section follows template A.4 of the master plan, with these fixed rows. A row that does not apply is left out, never filled with "none".

| Row | Content |
| --- | --- |
| Heading | `### E-xx \`METHOD /path\` · \`operationId\`` (the path is relative to `/api/v1`) |
| Purpose / UC | One sentence; the use case and the screens that call it |
| Authorization | The audience of the route metadata (§1.2); the guard and the capability; the step-up action if any |
| Headers | Only the headers beyond the defaults of DOC-50 §4: `Idempotency-Key` (required or not), `If-Match`, `X-Unit-Id`, `X-Requested-With` |
| Parameters | Table `Name · In · Type · Required · Default · Constraints` for path, query and body fields |
| Request example | Only when there is a body |
| Response | Status and a complete JSON example with every field, in the formats of DOC-50 §6 |
| Errors | `status code` pairs, each a code of DOC-42 §5; the situation if not obvious |
| Data source | The tables, the main statement and the index it uses |
| Cache | The `Cache-Control` and `ETag` rule when it differs from DOC-50 §9 |
| Performance | A p95 target in milliseconds (default 300 ms, NFR-03) |
| Events | The outbox events written and the real-time events (DOC-09, DOC-52) |
| Tests | The IDs of the tests that prove it (`AU-`, `RM-`, `BD-`, `FS-`) |

### 1.2 Audience, as the route metadata says it

The `audience` metadata of DOC-12 §5.3 is what the authorization-matrix generator reads (EXP-10). Here it is written in one notation:

| Notation | Metadata | Guard | Refused with |
| --- | --- | --- | --- |
| `public` | `{ kind: 'public' }` | none; an IP bucket where the section says so | 429 |
| `refresh` | `{ kind: 'public' }` and the credential is a refresh token | none (the token is consumed by the use case) | 401 |
| `resident` | `{ kind: 'resident' }` | `resident` (a valid access token of `kind = resident`); no `X-Unit-Id`, no terms gate | 401 |
| `unit: <capability>` | `{ kind: 'resident', capability }` | `unit(capability)`: the membership of `X-Unit-Id`, the terms gate, the policy function (DOC-27 §3) | 403 `membership_inactive`, `terms_required`, `forbidden` |
| `staff: <roles>` | `{ kind: 'staff', roles }` | `staff(...roles)`: the role and status read from the database on every request | 401, 403 |
| `webhook` | `{ kind: 'webhook', provider }` | the HMAC of the provider | 401 `invalid_signature` |

A resident token never passes a `staff` guard and the reverse (FR-16.4). An object outside the caller's building or unit is 404, never 403.

### 1.3 Not in this document

| Topic | Lives in |
| --- | --- |
| Formats, headers, idempotency, cursors, `If-Match`, caching, localization | DOC-50 |
| Error codes, their HTTP status, `details` and messages | DOC-42 §5 |
| Tables, DDL, statements | DOC-14, DOC-16, DOC-17, DOC-20 |
| Behavior of sign-in, sessions, step-up and the OTP | DOC-26 |
| Policy table, household, transfer, lookup | DOC-27 |
| The endpoint × role matrix as a test | DOC-39, DOC-99 (generated from §2) |
| The SSE stream and the payOS webhook contract | DOC-52 |
| Screens that call an endpoint | DOC-56…67 (each screen names its `E-xx`) |
| The detailed sequence of a user action | `06-design/flows/` (each flow names its `E-xx`) |

## 2. Catalog

Method and path are relative to `/api/v1`. `Detail` is the section that specifies the endpoint, or the document and phase that will. "Idem" is `R` when `Idempotency-Key` is required (DOC-50 §7). "Step-up" names the action of the sensitive staff action (DOC-26 §4.5).

### 2.1 Phase 1 groups (specified in this document)

| ID | Method and path | `operationId` | Audience | Idem | Step-up | UC | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | `GET /health/live` | `getHealthLive` | public (ops port only, not under `/api/v1`) | | | | §3 |
| E-02 | `GET /health/ready` | `getHealthReady` | public (ops port, and `/api/v1/health/ready` through the Tunnel) | | | | §3 |
| E-03 | `GET /public/config` | `getPublicConfig` | public | | | UC-14 | §3 |
| E-04 | `POST /client-errors` | `reportClientError` | public | | | | §3 |
| E-05 | `POST /auth/staff/login` | `loginStaff` | public | | | UC-17 | §4 |
| E-06 | `POST /auth/staff/password-reset` | `requestStaffPasswordReset` | public | | | UC-17 | §4 |
| E-07 | `POST /auth/staff/password` | `setStaffPassword` | public | | | UC-17 | §4 |
| E-08 | `POST /auth/staff/invite/resend` | `resendStaffInvite` | staff: admin, manager | | | UC-17 | §4 |
| E-09 | `POST /auth/otp` | `requestOtp` | public | | | UC-14 | §4 |
| E-10 | `POST /auth/otp/verify` | `verifyOtp` | public | | | UC-14 | §4 |
| E-11 | `POST /auth/refresh` | `refreshSession` | refresh | | | UC-26 | §4 |
| E-12 | `POST /auth/logout` | `logout` | refresh | | | UC-26 | §4 |
| E-13 | `GET /me` | `getMe` | resident | | | UC-14, UC-26 | §5 |
| E-14 | `PATCH /me` | `updateMe` | resident | | | UC-26 | §5 |
| E-15 | `GET /me/contact` | `getBuildingContact` | resident | | | UC-14 | §5 |
| E-16 | `GET /me/terms` | `getMyTerms` | resident | | | UC-27 | §5 |
| E-17 | `POST /me/terms` | `acceptTerms` | resident | | | UC-27 | §5 |
| E-18 | `POST /me/account/deletion` | `requestAccountDeletion` | resident | | | UC-27 | §5 |
| E-19 | `DELETE /me/account/deletion` | `cancelAccountDeletion` | resident | | | UC-27 | §5 |
| E-20 | `GET /me/sessions` | `listMySessions` | resident | | | UC-26 | §5 |
| E-21 | `DELETE /me/sessions/{id}` | `revokeMySession` | resident | | | UC-26 | §5 |
| E-22 | `POST /me/devices` | `registerMyDevice` | resident | | | UC-14 | §5 |
| E-23 | `DELETE /me/devices/{id}` | `removeMyDevice` | resident | | | UC-26 | §5 |
| E-24 | `POST /me/uploads` | `registerMyUpload` | unit: by purpose (DOC-37 §4) | R | | UC-07, UC-12 | §5 |
| E-25 | `POST /me/uploads/{id}/verify` | `verifyMyUpload` | unit: by purpose | | | UC-07, UC-12 | §5 |
| E-26 | `GET /me/members` | `listMembers` | unit: manage_members | | | UC-15 | §6 |
| E-27 | `POST /me/members` | `addMember` | unit: manage_members | R | | UC-15 | §6 |
| E-28 | `PATCH /me/members/{id}` | `updateMember` | unit: manage_members | | | UC-15 | §6 |
| E-29 | `DELETE /me/members/{id}` | `removeMember` | unit: manage_members | | | UC-15 | §6 |
| E-30 | `GET /staff/me` | `getStaffMe` | staff: any | | | UC-26 | §7 |
| E-31 | `PATCH /staff/me` | `updateStaffMe` | staff: any | | | UC-26 | §7 |
| E-32 | `GET /staff/sessions` | `listStaffSessions` | staff: any | | | UC-26 | §7 |
| E-33 | `DELETE /staff/sessions/{id}` | `revokeStaffSession` | staff: any | | | UC-26 | §7 |
| E-34 | `POST /staff/devices` | `registerStaffDevice` | staff: any | | | UC-26 | §7 |
| E-35 | `DELETE /staff/devices/{id}` | `removeStaffDevice` | staff: any | | | UC-26 | §7 |
| E-36 | `POST /staff/uploads` | `registerStaffUpload` | staff: by purpose (DOC-37 §4) | R | | UC-17 | §7 |
| E-37 | `POST /staff/uploads/{id}/verify` | `verifyStaffUpload` | staff: by purpose | | | UC-17 | §7 |
| E-38 | `POST /staff/step-up` | `requestStepUp` | staff: admin | | | UC-17 | §7 |
| E-39 | `GET /staff/accounts` | `listStaffAccounts` | staff: admin, manager | | | UC-17 | §8 |
| E-40 | `POST /staff/accounts` | `createStaffAccount` | staff: admin, manager | R | `admin_change` when the role is `admin` | UC-17 | §8 |
| E-41 | `GET /staff/accounts/{id}` | `getStaffAccount` | staff: admin, manager | | | UC-17 | §8 |
| E-42 | `PATCH /staff/accounts/{id}` | `updateStaffAccount` | staff: admin, manager | | `admin_change` for a promotion to `admin`; `staff_email` for an email | UC-17 | §8 |
| E-43 | `POST /staff/accounts/{id}/lock` | `lockStaffAccount` | staff: admin, manager | | | UC-17 | §8 |
| E-44 | `POST /staff/accounts/{id}/unlock` | `unlockStaffAccount` | staff: admin, manager | | | UC-17 | §8 |
| E-45 | `POST /staff/accounts/{id}/disable` | `disableStaffAccount` | staff: admin | | | UC-17 | §8 |
| E-46 | `POST /staff/accounts/{id}/enable` | `enableStaffAccount` | staff: admin | | | UC-17 | §8 |
| E-47 | `GET /staff/settings` | `getSettings` | staff: admin | | | UC-17 | §9 |
| E-48 | `PATCH /staff/settings` | `updateSettings` | staff: admin | | | UC-17 | §9 |
| E-49 | `GET /staff/gateway` | `getGateway` | staff: admin | | | UC-17 | §9 |
| E-50 | `PUT /staff/gateway` | `putGateway` | staff: admin | | `gateway_config` | UC-17 | §9 |
| E-51 | `POST /staff/gateway/check` | `checkGateway` | staff: admin | | | UC-17 | §9 |
| E-52 | `GET /staff/terms` | `listTermsVersions` | staff: admin | | | UC-17, UC-27 | §9 |
| E-53 | `POST /staff/terms` | `publishTermsVersion` | staff: admin | | | UC-17, UC-27 | §9 |
| E-54 | `GET /staff/audit` | `listAudit` | staff: admin, manager (a Manager reads a narrowed set, DOC-35 §5) | | | UC-17 | §9 |
| E-55 | `GET /staff/storage` | `getStorage` | staff: admin | | | UC-17 | §9 |
| E-56 | `POST /staff/demo/reset` | `resetDemo` | staff: admin | | | | §9 |
| E-57 | `GET /staff/units` | `listUnits` | staff: admin, manager | | | UC-13 | §10 |
| E-58 | `POST /staff/units` | `createUnit` | staff: admin, manager | R | | UC-13 | §10 |
| E-59 | `GET /staff/units/{id}` | `getUnit` | staff: admin, manager | | | UC-13 | §10 |
| E-60 | `PATCH /staff/units/{id}` | `updateUnit` | staff: admin, manager | | | UC-13 | §10 |
| E-61 | `POST /staff/units/{id}/owner` | `transferOwnership` | staff: admin, manager | | | UC-13 | §10 |
| E-62 | `GET /staff/units/{id}/history` | `listUnitHistory` | staff: admin, manager | | | UC-13 | §10 |
| E-63 | `GET /staff/residents` | `listResidents` | staff: admin, manager | | | UC-13, UC-27 | §10 |
| E-64 | `POST /staff/residents` | `createResident` | staff: admin, manager | R | | UC-13 | §10 |
| E-65 | `GET /staff/residents/{accountId}` | `getResident` | staff: admin, manager | | | UC-13 | §10 |
| E-66 | `PATCH /staff/residents/{accountId}` | `updateResidentProfile` | staff: admin, manager | | | UC-13 | §10 |
| E-67 | `PATCH /staff/residents/{accountId}/phone` | `changeResidentPhone` | staff: admin, manager | | | UC-13 | §10 |
| E-68 | `POST /staff/residents/{accountId}/deletion/approve` | `approveAccountDeletion` | staff: admin, manager | | | UC-27 | §10 |
| E-69 | `PATCH /staff/memberships/{id}` | `updateMembership` | staff: admin, manager | | | UC-13, UC-15 | §10 |
| E-70 | `GET /staff/lookup` | `lookup` | staff: admin, manager, guard | | | UC-28 | §10 |
| E-71 | `GET /staff/imports/templates/{kind}` | `downloadImportTemplate` | staff: admin, manager | | | UC-13, UC-01 | §10 |
| E-72 | `POST /staff/imports` | `createImport` | staff: admin, manager | R | | UC-13, UC-01 | §10 |
| E-73 | `GET /staff/imports/{id}` | `getImport` | staff: admin, manager | | | UC-13, UC-01 | §10 |
| E-74 | `POST /staff/imports/{id}/commit` | `commitImport` | staff: admin, manager | | | UC-13, UC-01 | §10 |
| E-169 | `GET /staff/imports` | `listImports` | staff: admin, manager | | | UC-13, UC-01 | §10 |
| E-170 | `POST /staff/fee-batches/{id}/charges` | `addDraftCharge` | staff: admin, manager | | UC-01 | DOC-21 §3.2 (DR-265, P2) |
| E-171 | `DELETE /staff/charges/{id}` | `removeDraftCharge` | staff: admin, manager | | UC-01 | DOC-21 §3.2 (DR-265, P2) |
| E-172 | `DELETE /staff/fee-batches/{id}` | `discardFeeBatch` | staff: admin, manager | | UC-01 | DOC-21 §3.8 (DR-265, P2) |
| E-173 | `POST /usage-events` | `recordUsageEvents` | staff: any; unit: any member | | | DOC-104 | §10A |

### 2.2 Later groups (numbered now, specified before their phase)

| ID | Method and path | `operationId` | Audience | Idem | UC | Written in |
| --- | --- | --- | --- | --- | --- | --- |
| E-75 | `GET /staff/events` | `streamStaffEvents` | staff: any | | UC-19, UC-26 | DOC-52 (P1-26) |
| E-76 | `GET /staff/inbox` | `listStaffInbox` | staff: any | | UC-19 | DOC-31 (P1-26) |
| E-77 | `POST /staff/inbox/read-all` | `readAllStaffInbox` | staff: any | | UC-19 | DOC-31 |
| E-78 | `GET /me/inbox` | `listMyInbox` | unit: personal_notifications | | UC-19 | DOC-31 |
| E-79 | `POST /me/inbox/read-all` | `readAllMyInbox` | unit: personal_notifications | | UC-19 | DOC-31 |
| E-80 | `GET /me/fees` | `listMyFees` | unit: view_fees | | UC-03 | DOC-22, DOC-58 (P2) |
| E-81 | `GET /me/fees/{chargeId}` | `getMyFee` | unit: view_fees | | UC-03 | P2 |
| E-82 | `GET /me/fees/history` | `listMyFeeHistory` | unit: view_fees | | UC-03 | P2 |
| E-83 | `GET /me/receipts` | `listMyReceipts` | unit: view_fees | | UC-03 | P2 |
| E-84 | `GET /me/receipts/{id}/pdf` | `downloadMyReceipt` | unit: view_fees | | UC-03 | P2 |
| E-85 | `POST /me/payments/intents` | `createPaymentIntent` | unit: pay | R | UC-03 | DOC-23 (P3); **sample owed** |
| E-86 | `GET /me/payments/intents/{id}` | `getPaymentIntent` | unit: view_fees | | UC-03 | P3 (the response carries `unmatchedTransfer {amount, receivedAt}` for the outcomes `amount_short`, `amount_over`, `charge_already_paid`, `charge_recalled`, DR-96) |
| E-87 | `POST /me/payments/intents/{id}/cancel` | `cancelPaymentIntent` | unit: pay | | UC-03 | P3 |
| E-88 | `POST /me/payments/intents/{id}/check` | `checkPaymentIntent` | unit: pay | | UC-18 | P3 |
| E-89 | `GET /staff/fee-batches` | `listFeeBatches` | staff: admin, manager | | UC-01 | DOC-21 (P2) |
| E-90 | `POST /staff/fee-batches` | `createFeeBatch` | staff: admin, manager | R | UC-01 | P2 |
| E-91 | `GET /staff/fee-batches/{id}` | `getFeeBatch` | staff: admin, manager | | UC-01 | P2 |
| E-92 | `PATCH /staff/fee-batches/{id}` | `updateFeeBatch` | staff: admin, manager | | UC-01, UC-04 | P2 |
| E-93 | `GET /staff/fee-batches/{id}/charges` | `listBatchCharges` | staff: admin, manager | | UC-01 | P2 |
| E-94 | `PUT /staff/charges/{id}` | `replaceDraftCharge` | staff: admin, manager | | UC-01 | P2 |
| E-95 | `POST /staff/fee-batches/{id}/publish` | `publishFeeBatch` | staff: admin, manager | | UC-01 | P2; **sample owed** |
| E-96 | `POST /staff/fee-batches/{id}/recall` | `recallFeeBatch` | staff: admin, manager | | UC-04 | P2; **sample owed** |
| E-97 | `POST /staff/fee-batches/{id}/close` | `closeFeeBatch` | staff: admin, manager | | UC-04 | P2 |
| E-98 | `POST /staff/fee-batches/{id}/reissue` | `reissueFeeBatch` | staff: admin, manager | | UC-04 | P2 |
| E-99 | `POST /staff/fee-batches/{id}/pdf` | `requestBatchPdf` | staff: admin, manager | | UC-01 | P2 |
| E-100 | `POST /staff/charges/{id}/void` | `voidCharge` | staff: admin, manager | | UC-04 | P2; **sample owed** |
| E-101 | `GET /staff/debts` | `listDebts` | staff: admin, manager | | UC-05 | P2 |
| E-102 | `GET /staff/units/{id}/debt` | `getUnitDebt` | staff: admin, manager | | UC-05 | P2 |
| E-103 | `POST /staff/debts/reminders` | `sendDebtReminders` | staff: admin, manager | R | UC-05 | P2 |
| E-104 | `POST /staff/payments` | `recordManualPayment` | staff: admin, manager | R | UC-02 | P2; **sample owed** |
| E-105 | `POST /staff/payments/{id}/void` | `voidPayment` | staff: admin, manager | | UC-02 | P2 |
| E-106 | `GET /staff/receipts/{id}/pdf` | `downloadStaffReceipt` | staff: admin, manager | | UC-02 | P2 |
| E-107 | `GET /staff/payments/intents` | `listPaymentIntents` | staff: admin, manager | | UC-18 | P3 |
| E-108 | `GET /staff/money-log` | `listMoneyLog` | staff: admin, manager | | UC-21 | P2 |
| E-109 | `POST /staff/money-log/{kind}/{id}/review` | `reviewMoneyLogRow` | staff: admin, manager | | UC-21 | P2 |
| E-110 | `GET /staff/units/{id}/money-log` | `getUnitMoneyLog` | staff: admin, manager | | UC-21 | P2 |
| E-111 | `POST /staff/statements` | `uploadStatement` | staff: admin, manager | R | UC-06 | DOC-25 (P3) |
| E-112 | `GET /staff/statements/{id}` | `getStatement` | staff: admin, manager | | UC-06 | P3 |
| E-113 | `POST /staff/statements/{id}/lines/{lineId}/assign` | `assignStatementLine` | staff: admin, manager | | UC-06 | P3 |
| E-114 | `POST /staff/statements/{id}/lines/{lineId}/dismiss` | `dismissStatementLine` | staff: admin, manager | | UC-06 | P3 |
| E-115 | `POST /staff/statements/{id}/lines/{lineId}/confirm` | `confirmStatementLine` | staff: admin, manager | | UC-06 | P3 |
| E-116 | `GET /staff/statements/{id}/not-seen` | `listStatementNotSeen` | staff: admin, manager | | UC-06 | P3 |
| E-117 | `POST /payments/webhooks/{provider}/{gatewayConfigId}` | `receivePaymentWebhook` | webhook | | UC-18 | DOC-52, DOC-24 (P3) |
| E-118 | `GET /me/ticket-types` | `listTicketTypes` | unit: tickets | | UC-07 | DOC-28 (P4) |
| E-119 | `GET /me/tickets` | `listMyTickets` | unit: tickets | | UC-07 | P4 |
| E-120 | `POST /me/tickets` | `createTicket` | unit: tickets | R | UC-07 | P4 |
| E-121 | `GET /me/tickets/{id}` | `getMyTicket` | unit: tickets | | UC-07 | P4 |
| E-122 | `POST /me/tickets/{id}/messages` | `addMyTicketMessage` | unit: tickets | R | UC-07 | P4 |
| E-123 | `POST /me/tickets/{id}/cancel` | `cancelMyTicket` | unit: tickets | | UC-07 | P4 |
| E-124 | `POST /me/tickets/{id}/rating` | `rateTicket` | unit: tickets | | UC-10 | P4 |
| E-125 | `GET /staff/tickets` | `listStaffTickets` | staff: admin, manager, technician | | UC-08 | P4 |
| E-126 | `GET /staff/tickets/{id}` | `getStaffTicket` | staff: admin, manager, technician | | UC-08 | P4 |
| E-127 | `POST /staff/tickets/{id}/assign` | `assignTicket` | staff: admin, manager | | UC-08 | P4; **sample owed** |
| E-128 | `POST /staff/tickets/{id}/transition` | `transitionTicket` | staff: admin, manager, technician | | UC-09, UC-10 | P4 |
| E-129 | `POST /staff/tickets/{id}/messages` | `addStaffTicketMessage` | staff: admin, manager, technician | R | UC-09 | P4 |
| E-130 | `POST /staff/tickets/{id}/cancel` | `cancelTicketAsStaff` | staff: admin, manager | | UC-22 | P4 |
| E-131 | `GET /staff/ticket-types` | `listStaffTicketTypes` | staff: admin, manager | | UC-08 | P4 |
| E-132 | `PATCH /staff/ticket-types/{id}` | `updateTicketType` | staff: admin, manager | | UC-08 | P4 |
| E-133 | `GET /me/vehicles` | `listMyVehicles` | unit: vehicles | | UC-12 | DOC-30 (P5) |
| E-134 | `POST /me/vehicles` | `registerVehicle` | unit: vehicles | R | UC-12 | P5 |
| E-135 | `PATCH /me/vehicles/{id}` | `updateMyVehicle` | unit: vehicles | | UC-12 | P5 |
| E-136 | `GET /staff/vehicles` | `listStaffVehicles` | staff: admin, manager, guard | | UC-12 | P5 |
| E-137 | `PATCH /staff/vehicles/{id}` | `updateStaffVehicle` | staff: admin, manager | | UC-12 | P5 |
| E-138 | `POST /staff/vehicles/{id}/review` | `reviewVehicle` | staff: admin, manager | | UC-12 | P5 |
| E-139 | `POST /staff/vehicles/{id}/retire` | `retireVehicle` | staff: admin, manager | | UC-12 | P5 |
| E-140 | `GET /staff/plates` | `lookupPlate` | staff: admin, manager, guard | | UC-28 | P5 |
| E-141 | `POST /me/qr` | `rotateQr` | unit: broadcast_notices | | UC-16 | DOC-29 (P5) |
| E-142 | `POST /staff/access/scans` | `scanQr` | staff: admin, manager, guard | | UC-16 | P5; **sample owed** |
| E-143 | `GET /me/notices` | `listMyNotices` | unit: broadcast_notices | | UC-11 | DOC-31 (P4) |
| E-144 | `POST /me/notices/{id}/read` | `markNoticeRead` | unit: broadcast_notices | | UC-11 | P4 |
| E-145 | `GET /staff/notices` | `listStaffNotices` | staff: admin, manager, technician, guard | | UC-11 | P4 |
| E-146 | `POST /staff/notices` | `createNotice` | staff: admin, manager | R | UC-11 | P4 |
| E-147 | `PATCH /staff/notices/{id}` | `updateNotice` | staff: admin, manager | | UC-11 | P4 |
| E-148 | `POST /staff/notices/{id}/send` | `sendNotice` | staff: admin, manager | | UC-11 | P4 |
| E-149 | `GET /staff/notices/{id}/stats` | `getNoticeStats` | staff: admin, manager | | UC-11 | P4 |
| E-150 | `GET /me/docs/tree` | `getMyLibraryTree` | unit: library | | UC-24 | DOC-32 (P5) |
| E-151 | `GET /me/docs/pages/{id}` | `getMyLibraryPage` | unit: library | | UC-24 | P5 |
| E-152 | `GET /me/docs/search` | `searchMyLibrary` | unit: library | | UC-24 | P5 |
| E-153 | `GET /staff/docs/tree` | `getStaffLibraryTree` | staff: admin, manager, technician, guard | | UC-23 | P5 |
| E-154 | `GET /staff/docs/search` | `searchStaffLibrary` | staff: admin, manager, technician, guard | | UC-24 | P5 |
| E-155 | `POST /staff/docs/folders` | `createLibraryFolder` | staff: admin, manager | | UC-23 | P5 |
| E-156 | `PATCH /staff/docs/folders/{id}` | `updateLibraryFolder` | staff: admin, manager | | UC-23 | P5 |
| E-157 | `DELETE /staff/docs/folders/{id}` | `hideLibraryFolder` | staff: admin, manager | | UC-23 | P5 (semantics in DOC-32: library content is never destroyed, DR-115) |
| E-158 | `POST /staff/docs/pages` | `createLibraryPage` | staff: admin, manager | | UC-23 | P5 |
| E-159 | `GET /staff/docs/pages/{id}` | `getStaffLibraryPage` | staff: admin, manager, technician, guard | | UC-23 | P5 |
| E-160 | `PATCH /staff/docs/pages/{id}` | `updateLibraryPage` | staff: admin, manager | | UC-23 | P5 |
| E-161 | `DELETE /staff/docs/pages/{id}` | `hideLibraryPage` | staff: admin, manager | | UC-23 | P5 (as E-157) |
| E-162 | `GET /staff/docs/pages/{id}/versions` | `listLibraryPageVersions` | staff: admin, manager | | UC-23 | P5 |
| E-163 | `POST /staff/docs/pages/{id}/restore` | `restoreLibraryPage` | staff: admin, manager | | UC-23 | P5 |
| E-164 | `PUT /staff/docs/order` | `putLibraryOrder` | staff: admin, manager | | UC-23 | P5 |
| E-165 | `GET /staff/dashboard` | `getDashboard` | staff: admin, manager | | UC-25 | DOC-33 (P6) |
| E-166 | `GET /staff/reports/{kind}` | `getReport` | staff: admin, manager | | UC-25 | P6 |
| E-167 | `POST /staff/exports` | `createExport` | staff: admin, manager | R | UC-25 | P6 |
| E-168 | `GET /staff/exports/{id}` | `getExport` | staff: admin, manager | | UC-25 | P6 |

## 3. Public and health (E-01…E-04)

These four endpoints answer without a credential. None of them is behind the terms gate. `E-01` and `E-02` are also exempt from the maintenance gate, the app-version gate and the CORS rule, and are logged at `debug` (DOC-42 §8.2). Cloudflare has one rule on `/api/v1/auth/*` as the outer rate net (DR-64); `E-03` and `E-04` have no rule of their own besides the ones written below.

### E-01 `GET /health/live` · `getHealthLive`

- **Purpose / UC:** Liveness: the process is up and its event loop answers. Called by the container orchestrator and the monitoring scrape, never by a client.
- **Authorization:** `public`, **ops port only** (`OPS_PORT`, DOC-38 §5.2). The path is `/health/live`, **not** under `/api/v1`. Caddy and the Tunnel never route it (DOC-07 §5, TB10, DR-07), so it does not exist on the public hostname: `GET https://api.<domain>/api/v1/health/live` is 404 `not_found`. Both the `api` and the `worker` processes serve it.
- **Parameters:** none.
- **Response 200:**

  ```json
  { "status": "ok" }
  ```

- **Errors:** none. A process that cannot answer is dead; the orchestrator restarts it.
- **Data source:** none; no database access, no allocation beyond the response.
- **Cache:** `Cache-Control: no-store`.
- **Performance:** p99 under 20 ms (planned); it must stay fast when the database is slow.
- **Events:** none.
- **Tests:** AG-xx (DOC-50 §14: the route exists on the ops port only), P1-04 acceptance.

### E-02 `GET /health/ready` · `getHealthReady`

- **Purpose / UC:** Readiness: the process can do its work. The only health route that is public, so the external uptime probe and the deploy script's smoke test can reach it (DOC-07 §5).
- **Authorization:** `public`. Served on **two paths** by the same handler:

  | Path | Port | Routed by Caddy and the Tunnel | Body |
  | --- | --- | --- | --- |
  | `/api/v1/health/ready` | `PORT` (3000) | yes (the uptime probe, the deploy smoke test) | `status` and `maintenance` only |
  | `/health/ready` | `OPS_PORT` | no | the same plus `checks` |

  No access token, no `X-App-Id`, no maintenance gate (it must answer during maintenance), no terms gate. The public path never lists the failing dependency: an outsider learns only that the service is up or degraded (DR-145).
- **Parameters:** none.
- **Response 200** (ops port; the public path omits `checks`):

  ```json
  { "status": "ok", "maintenance": false,
    "checks": { "database": { "ok": true, "latencyMs": 3 } } }
  ```

  During maintenance (the flag of DOC-38 §5.3) the answer stays 200 with `"maintenance": true`, so the probe does not page for a planned window.
- **Response 503:**

  ```json
  { "status": "degraded", "maintenance": false,
    "checks": { "database": { "ok": false, "latencyMs": 2000 } } }
  ```

  `"status": "stopping"` (also 503) is answered from the moment shutdown starts until the process exits, so the load balancer drains it first (DOC-38 §5.4). The 503 does not use the error shape (DOC-42 §6) and carries no `Retry-After`.
- **Errors:** 503 as above is the only non-200.
- **Data source:** one `SELECT 1` with a 2 s timeout, outside any transaction. The `worker` also checks that the relay finished a pass in the last `max(10 × OUTBOX_POLL_INTERVAL_MS, 10 s)` (DOC-38 §5.2); its entry is `checks.relay` on the ops port. The `api` process runs no relay, so it has no `relay` check.
- **Cache:** `Cache-Control: no-store`.
- **Performance:** p99 under 100 ms when healthy; at most 2 s, the ping timeout, when not.
- **Events:** none. The gauge `readiness_ok` and the logs are DOC-40's.
- **Tests:** P1-04 (`/health/ready` is 503 when the database is down), ER-14 (an exhausted pool fails readiness), AG-xx.

### E-03 `GET /public/config` · `getPublicConfig`

- **Purpose / UC:** What an app needs before anyone signs in: the minimum supported version, the languages, and the Manager's contact for the screens that show it to a person who cannot sign in (`Login-Error`, UC-14 2a). Also read at app start to show "Update the app" without a first failing call (UC-14 E6).
- **Authorization:** `public`. Subject to the maintenance gate. Not subject to the app-version gate (a too-old app must still be able to read the minimum).
- **Headers:** `X-App-Id`, `X-App-Version` are optional here (the answer does not depend on them).
- **Parameters:** none.
- **Response 200:**

  ```json
  {
    "serverTime": "2026-10-20T03:10:00.000Z",
    "languages": ["vi", "en"],
    "defaultLanguage": "vi",
    "apps": {
      "resident": { "minVersion": "1.0.0", "storeUrl": { "ios": "https://apps.apple.com/app/id0000000000", "android": "https://play.google.com/store/apps/details?id=vn.example.rms.resident" } },
      "staff":    { "minVersion": "1.0.0", "storeUrl": { "ios": "https://apps.apple.com/app/id0000000001", "android": "https://play.google.com/store/apps/details?id=vn.example.rms.staff" } }
    },
    "contact": {
      "name": { "vi": "Chung cư Sunrise A", "en": "Sunrise A Apartments" },
      "hotline": "1900 1234",
      "workingHours": { "vi": "Thứ 2 – Thứ 6, 8:00 – 17:00", "en": null },
      "email": "bql@sunrise.example"
    }
  }
  ```

  `contact` is the block DOC-36 §4 keeps on the building row (`name`, `hotline`, `workingHours`, `email`); a bilingual value has `en: null` when only Vietnamese was entered, and the client falls back to `vi`. It holds no address, no company data, no tax code and no secret. The building is the deployment's real building; when the deployment has only a demo building (`local`, review builds) it is the demo one (`BuildingApi.listBuildings`, DR-145). `storeUrl` is per platform; the `details.storeUrl` of a 426 answer is the string for the caller's platform, read from the `User-Agent` of the app (DOC-26 §3.7) (DR-145).
- **Errors:** 503 `maintenance`, 503 `service_unavailable`.
- **Data source:** `BuildingApi.getBuilding`/`getSettings`-style read of `building.building` (cached 60 s per process, DOC-36 §3.1); the minimum versions and store URLs are environment configuration, not database rows: `MIN_APP_VERSION_RESIDENT`, `MIN_APP_VERSION_STAFF`, `STORE_URL_RESIDENT_IOS`, `STORE_URL_RESIDENT_ANDROID`, `STORE_URL_STAFF_IOS`, `STORE_URL_STAFF_ANDROID` (owed to DOC-41).
- **Cache:** `Cache-Control: public, max-age=60`. The only cacheable JSON of the API (DOC-50 §9); Cloudflare still bypasses `/api/*`, so the 60 seconds are the client's and the browser's.
- **Performance:** p95 under 50 ms (no database read when the 60 s cache is warm).
- **Events:** none.
- **Tests:** AG-xx (headers), BD-xx for the contact block; the version gate is AG-xx.

### E-04 `POST /client-errors` · `reportClientError`

- **Purpose / UC:** The apps report a crash or an unexpected error because there is no hosted tracker (DR-103, DR-127 (6), DOC-42 §10). Called by `@rms/mobile-core` and the web CMS, possibly before sign-in.
- **Authorization:** `public`. A bearer token, if present and valid, is read only to add `accountKind` and `accountId` to the log line; an invalid token is ignored, never a 401. Not subject to the app-version gate (an old app must be able to report why it fails).
- **Parameters** (body, at most 8 KB, `additionalProperties: false`, DOC-42 §10):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `app` | body | string | yes | | `resident`, `staff`, `web` |
  | `appVersion` | body | string | yes | | semver, at most 20 characters |
  | `platform` | body | string | yes | | `ios`, `android`, `web` |
  | `kind` | body | string | yes | | `crash`, `unhandled_rejection`, `render`, `network` |
  | `screen` | body | string | no | `null` | at most 60 characters; a screen name, never a URL with a query |
  | `errorName` | body | string | yes | | 1…100 characters |
  | `message` | body | string | yes | | 1…500 characters |
  | `stack` | body | string | no | `null` | at most 4,096 bytes |
  | `requestId` | body | string | no | `null` | the `X-Request-Id` of the failed call, at most 64 characters |

- **Request example:**

  ```http
  POST /api/v1/client-errors
  Content-Type: application/json

  { "app": "resident", "appVersion": "1.0.3", "platform": "ios", "kind": "unhandled_rejection",
    "screen": "Fees", "errorName": "TypeError", "message": "Cannot read properties of undefined (reading 'amount')",
    "stack": "TypeError: Cannot read properties of undefined (reading 'amount')\n    at FeeRow (…)", "requestId": "0192f3c4-9d02-7000-8000-00000000f001" }
  ```

- **Response 204:** no body.
- **Errors:** 400 `validation_failed` (an unknown key, `stack` over 4 KB, the whole body over 8 KB is a bare 413 `payload_too_large` from the body limit), 429 `rate_limited` with `Retry-After` (`scope: "client_errors"`; the app drops the report silently), 503 `maintenance`.
- **Data source:** none stored. Two PostgreSQL buckets (DR-64): `client-errors:ip:<ip>` 10 per minute and `client-errors:account:<id>` 30 per hour when a valid token was sent (DOC-42 §10). One `warn` log line `client_error` with the body fields, the account id when known and the route-free `screen`; `message` and `stack` pass through `maskPhone` and the redact list (DOC-42 §8.3); the counter `client_errors_total{app,kind}` increases.
- **Cache:** `no-store`.
- **Performance:** p95 under 50 ms (two bucket statements, no other write).
- **Events:** none.
- **Tests:** ER-43 (5 KB stack, unknown key, a phone in `message`), ER-44 (the 11th in a minute is 429).
- *As built (P1-16, DR-264):* `identity` owns it (`ReportClientError`, `presentation/client-error-routes.ts`) because the unauthenticated bucket table and the token verifier are its. The bucket keys are `client_errors:ip:<ip>` (`identity.rate_bucket`) and `client_errors:account:<id>` (`platform.rate_bucket`), so the `scope` of a 429 is `client_errors`. The 8 KB limit reads `Content-Length` in `transform`, before validation (a body over it is 413 `payload_too_large`, never a list of 400 findings); `stack` is checked in bytes (400 `max_bytes`). The `warn` line has the fields `app`, `appVersion`, `platform`, `kind`, `screen`, `errorName`, `message`, `stack`, `clientRequestId`, `accountKind` and `accountId`; a phone-shaped run of 8 to 15 digits in `message` and `stack` is masked as the audit log masks it. `client_errors_total{app,kind}` waits for the metrics of P1-18. The app-version gate, when it is built, must skip this path. Tests: `apps/api/tests/integration/client-errors.integration.test.ts` and `report-client-error.test.ts`.

## 4. Auth (E-05…E-12)

Rules shared by the group (DOC-26). All are under `/api/v1/auth`. The IP in every bucket is the one the trusted-proxy rule provides (DOC-39, DR-07). Two clients exist (DR-130): `client: "web"` (the web CMS: the refresh token travels only in a cookie, the access token in the body) and `client: "app"` (the refresh token travels only in the body). The cookie is

```
__Secure-rms_refresh=<256-bit token>; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=<seconds to the token's expiry>
```

host-only on `api.<domain>`, so it is sent only to `/api/v1/auth/*` (DOC-26 §3.3). A sign-in writes no audit row and logs `auth.staff_login`/`auth.otp_verified` with the outcome and never the email, phone or code. The app-version gate applies to `X-App-Id: resident|staff` on every route of this group.

### E-05 `POST /auth/staff/login` · `loginStaff`

- **Purpose / UC:** A staff member signs in with email and password (UC-17 A, FL-17). Screens `W-Login`, `S-Login`.
- **Authorization:** `public`; IP bucket `staff-login:ip:<ip>` (30 per 15 minutes, every attempt spends one).
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `email` | body | string | yes | | valid address, at most 254 characters, case-insensitive |
  | `password` | body | string | yes | | 1…128 characters (longer is refused before any hashing) |
  | `client` | body | string | yes | | `web` or `app` |

- **Request example:**

  ```http
  POST /api/v1/auth/staff/login
  Content-Type: application/json
  X-App-Id: web

  { "email": "minh.le@sunrise.example", "password": "Sunrise2026!", "client": "web" }
  ```

- **Response 200, `client: "web"`:** the refresh token is in the cookie only.

  ```http
  HTTP/1.1 200 OK
  Set-Cookie: __Secure-rms_refresh=ZmFrZS1yZWZyZXNoLXRva2Vu…; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000
  X-Request-Id: 0192f3c4-9d02-7000-8000-00000000f101

  { "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900,
    "staff": { "id": "0192f3c4-5a1e-7000-8000-000000000051", "fullName": "Lê Minh", "role": "manager",
               "buildingId": "0192f3c4-5a1e-7000-8000-000000000001", "language": "vi" } }
  ```

- **Response 200, `client: "app"`:** the same body plus `"refreshToken": "bmV4dC10b2tlbg…"`, and no `Set-Cookie`.
- **Errors:** 400 `validation_failed` (`email` format, `password` over 128, `client`); 401 `invalid_credentials` (identical body for a wrong password, an unknown email and an account that is `invited`, `locked` or `disabled`, DOC-26 §4.1); 423 `account_locked` with `details.retryAfter` and `Retry-After` (a temporary lock; the correct password is refused during it); 429 `rate_limited`; 426 `upgrade_required` (apps).
- **Data source:** `identity.staff_account` by `email` (`citext` unique index), the lockout `UPDATE … failed_attempts + 1 … RETURNING` of DOC-16 §4.1 with the building's `lockout.maxAttempts`/`minutes`, then `refresh_family` and `refresh_token` inserts after the 10-family cap statement (DOC-26 §3.6). Argon2id verify (measured 19 ms, planned on staging).
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms (one Argon2id verify plus 4 statements); a failed attempt costs the same (dummy verify).
- **Events:** `identity.session_revoked.v1` for each family evicted at the cap (`cap_exceeded`).
- **Tests:** AU-01…AU-04, AU-09, AU-10, AU-11, AU-39.

### E-06 `POST /auth/staff/password-reset` · `requestStaffPasswordReset`

- **Purpose / UC:** A staff member asks for a reset link (UC-17 B, FL-18). Screens `W-Login` ("Forgot"), `W-Forgot-Sent`, `S-Forgot`, `S-Forgot-Sent`.
- **Authorization:** `public`; buckets `reset:email:<lower(email)>` (3 per hour) and `reset:ip:<ip>` (10 per hour), both keyed by the input, not by whether the account exists.
- **Parameters** (body): `email` (string, required, valid address, at most 254 characters).
- **Request example:**

  ```http
  POST /api/v1/auth/staff/password-reset
  { "email": "minh.le@sunrise.example" }
  ```

- **Response 202:** `{}` for a known `active` account, an unknown email, and a `locked`, `disabled` or `invited` one: same body, same time class (DOC-26 §4.3).
- **Errors:** 400 `validation_failed`; 429 `rate_limited` with `Retry-After`; 426 `upgrade_required` (apps).
- **Data source:** `identity.staff_account` by `email`; for an `active` account the older live reset token is consumed and a new `identity.password_token` (`kind = 'reset'`, SHA-256 of 256 random bits, valid `RESET_TTL_MINUTES` = 30) is inserted; outbox `identity.mail_requested.v1` kind `password_reset` (the raw token only in `secretEnc`, DR-117). Index `password_token_one_live`.
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms for every input (the unknown-email path does the same bucket work).
- **Events:** `identity.mail_requested.v1`.
- **Tests:** AU-05, AU-06.

### E-07 `POST /auth/staff/password` · `setStaffPassword`

- **Purpose / UC:** Set a password from an invite link or a reset link (UC-17 main flow step 3, B; FL-18). Screen `W-Reset`.
- **Authorization:** `public`; the single-use token in the body is the credential.
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `token` | body | string | yes | | the raw token of the link, 43 characters base64url |
  | `password` | body | string | yes | | 8…128 characters after NFC, at least one letter and one digit (DOC-26 §4.2) |

- **Request example:**

  ```http
  POST /api/v1/auth/staff/password
  { "token": "k3Jx9Qm2…", "password": "Sunrise2026!" }
  ```

- **Response 204:** no body. The person signs in on the next screen; an invite sets `invited → active`, a reset clears `failed_attempts` and `locked_until` (never a manual `locked`) and revokes every refresh family (`password_changed`).
- **Errors:** 400 `validation_failed` rule `password_weak` (checked first, so a weak password does not burn the link); 400 `token_invalid` (unknown, expired and used links answer the same); 429 `rate_limited` (an IP bucket shared with E-06 is not used; the token's 256 bits are the guard, Cloudflare the outer net).
- **Data source:** the atomic `UPDATE identity.password_token SET consumed_at = now() WHERE token_hash = :hash AND kind IN ('reset','invite') AND consumed_at IS NULL AND expires_at > now() RETURNING staff_id, kind` (DOC-26 §4.3), then `staff_account`; index `password_token_link_hash_key`.
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms (one Argon2id hash 28 ms).
- **Events:** `identity.session_revoked.v1` per family for a reset.
- **Tests:** AU-05, AU-07, AU-08, AU-13.

### E-08 `POST /auth/staff/invite/resend` · `resendStaffInvite`

- **Purpose / UC:** Send a new invite link to a staff member who is still `invited`, typically after the 24-hour link expired (UC-17 C). Screen `W-Staff`.
- **Authorization:** `staff: admin, manager`. The route is under `/auth/` for historical reasons (original SDD §17.1) but the audience is staff: it needs a staff access token. A Manager may resend only for a Technician or a Guard; for an Admin or a Manager account it is 403 `forbidden` (DOC-26 §4.4 rule 1).
- **Parameters** (body): `staffId` (UUID, required).
- **Request example:**

  ```http
  POST /api/v1/auth/staff/invite/resend
  Authorization: Bearer eyJhbGciOiJFUzI1NiIs…

  { "staffId": "0192f3c4-5a1e-7000-8000-000000000071" }
  ```

- **Response 204:** no body.
- **Errors:** 400 `validation_failed`; 403 `forbidden`; 404 `not_found` (an id of another building); 409 `invalid_transition` (`details {entity: "staff_account", status, action: "resend_invite"}` when the status is not `invited`).
- **Data source:** `identity.staff_account` by id and `building_id`; consumes the older invite token and inserts a new one (valid `INVITE_TTL_HOURS` = 24); outbox `identity.mail_requested.v1` kind `staff_invite`. Audit `identity.staff.update` with `details.invite = "resent"` in the same transaction.
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms.
- **Events:** `identity.mail_requested.v1`.
- **Tests:** AU-13, AU-19.

### E-09 `POST /auth/otp` · `requestOtp`

- **Purpose / UC:** A resident asks for a sign-in code (UC-14 steps 1–2, FL-19). Screen `Login` ("Continue"), `OTP` ("Resend").
- **Authorization:** `public`; the order of the checks is part of the contract (DOC-26 §5.1): IP bucket `otp:ip:<ip>` (20 per hour, every request), account lookup, resend gate, phone bucket `otp:phone:<e164>` (5 per hour), SMS-provider check, rolling 24-hour cap (3,000), issue. The app-version gate applies.
- **Parameters** (body): `phone` (string, required, parsed with region `VN`; `0901234567` and `+84901234567` are the same number; a number valid nowhere is 400 rule `phone_invalid`).
- **Request example:**

  ```http
  POST /api/v1/auth/otp
  X-App-Id: resident
  X-App-Version: 1.0.3

  { "phone": "0901234567" }
  ```

- **Response 202:**

  ```json
  { "challengeId": "0192f3c4-5a1e-7000-8000-000000000071", "resendAfter": 45, "expiresIn": 300 }
  ```

- **Response 404** (an unregistered phone; no challenge, no SMS):

  ```json
  { "error": { "code": "phone_not_registered", "message": "This number is not registered." } }
  ```

- **Response 429** (a resend before `resendAfter`, or a bucket is empty):

  ```http
  HTTP/1.1 429 Too Many Requests
  Retry-After: 15
  X-Request-Id: 0192f3c4-9d02-7000-8000-00000000f102

  { "error": { "code": "rate_limited", "message": "Too many attempts. Try again later.", "details": { "scope": "otp" } } }
  ```

- **Errors:** 400 `validation_failed` (`phone_invalid`); 404 `phone_not_registered`; 429 `rate_limited` (`Retry-After` is the seconds to wait); 503 `sms_unavailable` with `Retry-After: 60` (three failing commands and none delivered in 10 minutes, or the daily cap reached); 426 `upgrade_required`.
- **Data source:** `identity.resident_account` by `phone` (`resident_account_phone_key`), `identity.otp_challenge` (consume the live one, insert the new one; partial unique index `otp_challenge_one_live_per_phone`, DOC-16 §4.3), `identity.rate_bucket`, the count of challenges in the last 24 hours, the SMS-down query over `identity.outbox_messages` (DOC-26 §5.4). For an `is_demo` account a real challenge row is created and **no** SMS command is written.
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms (6 to 8 indexed statements, no provider call: the SMS is an outbox command).
- **Events:** `identity.sms_requested.v1` kind `otp` (`secretEnc` holds the code, `expiresAt` +5 minutes).
- **Tests:** AU-20, AU-21, AU-24, AU-25, AU-26, AU-29, AU-30; EXP-09.

### E-10 `POST /auth/otp/verify` · `verifyOtp`

- **Purpose / UC:** The resident enters the code and signs in (UC-14 step 3, FL-19). Screen `OTP`. The answer carries the active memberships so the app can go to `Main` or `Unit-Pick` without another call (an empty list is the "No unit is linked" case, UC-14 E7).
- **Authorization:** `public`. One transaction; a code is single use (DOC-26 §5.2).
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `challengeId` | body | string (UUID) | yes | | from E-09 |
  | `code` | body | string | yes | | exactly 6 digits |

- **Request example:**

  ```http
  POST /api/v1/auth/otp/verify
  Content-Type: application/json
  X-App-Id: resident
  X-App-Version: 1.0.3
  User-Agent: rms-resident/1.0.3 (iOS 19.1; iPhone17,1)

  { "challengeId": "0192f3c4-5a1e-7000-8000-000000000071", "code": "482913" }
  ```

- **Response 200:**

  ```json
  {
    "accessToken": "eyJhbGciOiJFUzI1NiIs…",
    "expiresIn": 900,
    "refreshToken": "Zm9vYmFy…",
    "account": {
      "id": "0192f3c4-5a1e-7000-8000-000000000041", "phone": "+84901234567", "displayName": "Trần Thị Hoa",
      "language": "vi", "pushEnabled": true
    },
    "memberships": [
      { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "buildingId": "0192f3c4-5a1e-7000-8000-000000000001",
        "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "unitCode": "A-1508", "memberType": "owner", "canPay": true },
      { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "buildingId": "0192f3c4-5a1e-7000-8000-000000000001",
        "unitId": "0192f3c4-5a1e-7000-8000-000000000022", "unitCode": "A-0703", "memberType": "tenant", "canPay": false }
    ]
  }
  ```

  `memberships` are the **active** ones, ordered by unit code (`ResidencyApi.listActiveMemberships`, DOC-27 §2.1); a locked membership is not offered. Residents always get `refreshToken` in the body (the resident client is `app`).
- **Response 400** (a wrong code; `attemptsLeft` counts 4, 3, 2, 1, 0 and the fifth consumes the challenge):

  ```json
  { "error": { "code": "otp_invalid", "message": "Wrong code. 3 tries left.", "details": { "attemptsLeft": 3 } } }
  ```

  An unknown, expired or already consumed challenge answers the same code with `attemptsLeft: 0`.
- **Errors:** 400 `validation_failed` (`code` not 6 digits), 400 `otp_invalid`, 426 `upgrade_required`. The terms are not checked here: `Terms` follows (E-16, E-17).
- **Data source:** the consume `UPDATE identity.otp_challenge … WHERE code_hmac = … AND consumed_at IS NULL AND expires_at > now() AND attempts < 5 RETURNING phone` (DOC-16 §4.3; for `is_demo` accounts and the fixed code the variant of DOC-26 §5.3), the attempts statement committed before the 400, then `resident_account`, the 10-family cap, `refresh_family` (365-day absolute limit, `user_agent`), `refresh_token`, the throttled `last_app_open_at` update (at most hourly).
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms.
- **Events:** `identity.session_revoked.v1` for families evicted at the cap.
- **Tests:** AU-21, AU-22, AU-23 (two parallel verifies, one 200), AU-26, AU-34, AU-54; EXP-09.

### E-11 `POST /auth/refresh` · `refreshSession`

- **Purpose / UC:** Rotate the tokens before or after the access token expires (UC-26 race branches, FL-17 step "refresh"). Called by `apiClient` once on a 401 and replayed (DOC-42 §9).
- **Authorization:** `refresh`: the credential is the refresh token, not the access token. The credential is the body field `refreshToken` when present, else the cookie `__Secure-rms_refresh`; a cookie request must carry `X-Requested-With: rms`, else 403 `forbidden`; with neither, 401 `unauthenticated`; with both, the body wins (DOC-26 §3.3).
- **Headers:** `X-Requested-With: rms` (cookie mode only; it forces a CORS preflight, the CSRF defense). `User-Agent` of the app.
- **Parameters** (body): `refreshToken` (string, optional; required unless the cookie is sent). An empty body `{}` is valid in cookie mode.
- **Request example, `app` mode:**

  ```http
  POST /api/v1/auth/refresh
  X-App-Id: staff
  X-App-Version: 1.0.3

  { "refreshToken": "Zm9vYmFy…" }
  ```

- **Request example, `web` mode:**

  ```http
  POST /api/v1/auth/refresh
  Origin: https://admin.example.vn
  X-Requested-With: rms
  Cookie: __Secure-rms_refresh=ZmFrZS1yZWZyZXNoLXRva2Vu…
  ```

- **Response 200, `app` mode:**

  ```json
  { "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900, "refreshToken": "bmV4dC10b2tlbg" }
  ```

- **Response 200, `web` mode:** `{ "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900 }` and a new `Set-Cookie: __Secure-rms_refresh=…` with the same attributes as E-05; no `refreshToken` in the body.
- **Errors:** 401 `unauthenticated` (unknown, expired or revoked token; a family revoked for reuse is committed first and then answered 401; a locked, disabled or deleted account revokes the family); 403 `forbidden` (cookie without the header); 400 `validation_failed`.
- **Data source:** the rotation `UPDATE` of DOC-16 §4.5 on `identity.refresh_token`/`refresh_family`, the classification `SELECT` and the grace sibling insert (DOC-26 §3.5), the account status check. A token rotated within `REFRESH_GRACE_SECONDS` (10) gets a sibling token; after the window it is reuse and revokes the family (`token_reuse`).
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms (no hashing; two to four indexed statements, one ES256 signature).
- **Events:** `identity.session_revoked.v1` on reuse or on an inactive account.
- **Tests:** AU-32, AU-33, AU-35, AU-36, AU-37, AU-38, AU-40.

### E-12 `POST /auth/logout` · `logout`

- **Purpose / UC:** End this session (UC-26 3a). Screens `Account`, `S-Account`, `W-Profile`.
- **Authorization:** `refresh`: the credential is the refresh token, in the body or the cookie, as E-11 (the cookie needs `X-Requested-With: rms`).
- **Parameters** (body): `refreshToken` (string, optional in cookie mode).
- **Request example:**

  ```http
  POST /api/v1/auth/logout
  { "refreshToken": "Zm9vYmFy…" }
  ```

- **Response 204:** whether or not the token is known (a repeated logout is not an error). In web mode: `Set-Cookie: __Secure-rms_refresh=; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=0`.
- **Errors:** 403 `forbidden` (cookie without `X-Requested-With`), 400 `validation_failed`.
- **Data source:** the family revoke statement of DOC-26 §3.7 (reason `sign_out`) and its live tokens.
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** `identity.session_revoked.v1` (reason `sign_out`): `notification` deletes the session's device token, `realtime` closes its stream.
- **Tests:** AU-31, AU-39.

## 5. Resident account (E-13…E-25)

Rules shared by the group. The routes `E-13` to `E-23` have audience `resident`: a valid resident access token, **no** `X-Unit-Id` and **no** terms gate by construction (the gate lives in `unit(capability)`, DOC-35 §9.2), so a person who has not accepted the terms can still read the account, accept, delete, or sign out. `E-24` and `E-25` need a unit because the object key carries the building (DOC-37 §5). A resident token on a `/staff/*` route is 401 (FR-16.4). The account comes from the token's `sub`; there is no `{accountId}` in these paths.

### E-13 `GET /me` · `getMe`

- **Purpose / UC:** The signed-in resident's account and active memberships (UC-14 step 5, UC-26 step 1). Called at app start, after a unit switch and when the app returns to the foreground. Screens `Unit-Pick`, `Account`, `Main`.
- **Authorization:** `resident`.
- **Parameters:** none.
- **Response 200:**

  ```json
  {
    "account": {
      "id": "0192f3c4-5a1e-7000-8000-000000000041", "phone": "+84901234567", "displayName": "Nguyễn Văn An",
      "avatarUrl": "https://files.<domain>/…?X-Amz-Expires=900&…",
      "language": "vi", "pushEnabled": true, "status": "active",
      "deletion": { "requestedAt": null, "approvedAt": null, "cooloffDays": 30, "executeAfter": null }
    },
    "memberships": [
      { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "buildingId": "0192f3c4-5a1e-7000-8000-000000000001",
        "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "unitCode": "A-1508", "memberType": "owner", "canPay": true }
    ]
  }
  ```

  `avatarUrl` is `null` without an avatar, else a 480 px thumbnail URL valid 15 minutes (regenerated on every response, never stored by a client, DOC-37 §8). `status` is `active` or `deletion_requested` (a `deleted` account cannot hold a session). `memberships` is `ResidencyApi.listActiveMemberships` (DOC-27 §2.1, `ActiveMembershipDto`): active only, ordered by unit code, `[]` when none. A removed or locked unit simply disappears from the list; the app clears the cache of that unit (UC-14 E5).
  *Revised 2026-10-20 (DR-202):* `deletion.cooloffDays` is the building setting `accountDeletionDays` (integer, the only setting a resident reads) and `deletion.executeAfter` is `approvedAt` plus that many days, `null` until the Manager approves the request; both are computed on read (`Account-Deletion`, DOC-60, DOC-35 §10).
- **Errors:** 401 `unauthenticated`.
- **Data source:** `identity.resident_account` by primary key; `residency.membership` joined to `residency.unit` through `membership_one_per_account_unit` (prefix `account_id`) (DOC-27 §17.1 S11).
- **Cache:** `Cache-Control: private, no-cache`; no `ETag` (the document mixes two modules).
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** RM-49, AU-41, AD-32 (exempt from the gate).

### E-14 `PATCH /me` · `updateMe`

- **Purpose / UC:** Change language, the push toggle or the avatar (UC-26 step 4). Screen `Account`.
- **Authorization:** `resident`. When `avatarFileId` is present the request also carries `X-Unit-Id` (the building of the file comes from the unit, DR-146).
- **Headers:** no `If-Match`: a person edits their own preferences, last write wins (DR-146).
- **Parameters** (body, at least one key, unknown keys refused):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `language` | body | string | no | untouched | `vi`, `en` |
  | `pushEnabled` | body | boolean | no | untouched | |
  | `avatarFileId` | body | string (UUID) or `null` | no | untouched | a `verified` file of purpose `avatar` registered by this account (E-24, E-25); `null` removes the avatar |

  The **name and the login phone are not editable here**: the name that staff keep is the Manager's record and the phone changes only through the Manager (UC-13, DOC-26 §7); a body with `displayName` or `phone` is 400 `unknown_key`.
- **Request example:**

  ```http
  PATCH /api/v1/me
  Authorization: Bearer eyJhbGciOiJFUzI1NiIs…
  X-Unit-Id: 0192f3c4-5a1e-7000-8000-000000000021

  { "language": "en", "pushEnabled": false, "avatarFileId": "0192f3c4-9d02-7000-8000-00000000f003" }
  ```

- **Response 200:** the `account` object of E-13 (not the memberships):

  ```json
  { "id": "0192f3c4-5a1e-7000-8000-000000000041", "phone": "+84901234567", "displayName": "Nguyễn Văn An",
    "avatarUrl": "https://files.<domain>/…?X-Amz-Expires=900&…",
    "language": "en", "pushEnabled": false, "status": "active", "deletion": { "requestedAt": null, "approvedAt": null, "cooloffDays": 30, "executeAfter": null } }
  ```

- **Errors:** 400 `validation_failed` (`unknown_key`, enum, a body with no key); 403 `membership_inactive` (the `X-Unit-Id` is not an active membership); 422 `file_not_verified` (the file is not verified, belongs to another account or is already attached); 401.
- **Data source:** `UPDATE identity.resident_account SET … version = version + 1 WHERE id = :id`; for an avatar, `FilesApi.attach(actor, fileId, 'account:<id>')` and `FilesApi.remove` of the previous avatar in the same transaction (DOC-37 §6.4). Inbox entries and push are rendered in the new language from their templates (DR-71). Resident actions are not audited (DOC-35 §4.3).
- **Cache:** `no-store`.
- **Performance:** p95 under 200 ms.
- **Events:** `building.file_delete_requested.v1` for the replaced avatar (DOC-37 §14).
- **Tests:** FS-08, FS-09, FS-13; AG-xx (an unknown key).
- *As built (P1-17, DR-265):* `UpdateResidentMe` in `identity`. Only `language` and `pushEnabled` are accepted for now (the body schema is strict, so `avatarFileId`, like `displayName` and `phone`, is 400 `validation_failed`); an empty body is 400. The guarded statement names the status only (last write wins) and moves `version`. The answer is the `account` object `GET /me` returns (`id`, `phone`, `displayName`, `language`, `pushEnabled`). Tested in `resident-auth.integration.test.ts` and `resident-account.test.ts`. The avatar comes with the avatar upload of the resident app.

### E-15 `GET /me/contact` · `getBuildingContact`

- **Purpose / UC:** The Manager's contact for a signed-in resident who cannot do something themselves: change a phone, fix a name, "No unit is linked" (UC-14 E7, UC-26 3b). Screens `Contact`, `Account-Phone`.
- **Authorization:** `resident` (token only, no `X-Unit-Id`).
- **Parameters:** none.
- **Response 200:** the same `contact` block as E-03.

  ```json
  { "name": { "vi": "Chung cư Sunrise A", "en": "Sunrise A Apartments" }, "hotline": "1900 1234",
    "workingHours": { "vi": "Thứ 2 – Thứ 6, 8:00 – 17:00", "en": null }, "email": "bql@sunrise.example" }
  ```

  The building is that of the account's first active membership (by unit code); an account with none gets the deployment's real building, as in E-03.
- **Errors:** 401 `unauthenticated`.
- **Data source:** `ResidencyApi.listActiveMemberships` for the building id, then `BuildingApi.getBuilding` (cache 60 s).
- **Cache:** `private, max-age=60`.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** AG-xx; the contact fields are BD-07.
- *As built (P1-17, DR-265):* `residentContactRoutes` in `building` (beside E-16); the block is the one E-03 builds (`contactOf`); the building of the first active membership, or the deployment's real building when the account has none; `Cache-Control: private, max-age=60`. Tested in `resident-auth.integration.test.ts`.

### E-16 `GET /me/terms` · `getMyTerms`

- **Purpose / UC:** The current terms of use and privacy notice with the resident's acceptance state (UC-27, FL-19). Screens `Terms`, `Terms-Update`.
- **Authorization:** `resident` (exempt from the terms gate, DOC-35 §9.2).
- **Parameters:** none. The text is in the account's language, with `vi` as the fallback (DR-71).
- **Response 200:** the latest version of each kind for the building of the account's active memberships (with phase 1's single building, one block; a deployment with several would list one block per building, DOC-35 §9.3):

  ```json
  {
    "items": [
      { "buildingId": "0192f3c4-5a1e-7000-8000-000000000001", "kind": "terms", "version": 4,
        "versionId": "018f0000-0000-7000-8000-0000000000c4", "publishedAt": "2026-10-15T02:00:00.000Z",
        "accepted": false, "text": "## 1. Phạm vi\nBan quản lý …" },
      { "buildingId": "0192f3c4-5a1e-7000-8000-000000000001", "kind": "privacy", "version": 1,
        "versionId": "018f0000-0000-7000-8000-0000000000c3", "publishedAt": "2026-09-01T02:00:00.000Z",
        "accepted": true, "text": "## 1. Dữ liệu được lưu\n…" }
    ]
  }
  ```

  `text` is the restricted Markdown of DOC-36 §8; the client renders it with `parseTermsMarkdown` of `@rms/shared-types`. An account with no membership, or a building with no published version of a kind, returns no item for it (nothing is required, AD-37).
- **Errors:** 401.
- **Data source:** `building.terms_version` (`uq_terms_version_building_kind_version`) left-joined to `building.terms_acceptance` (`pk_terms_acceptance`) (DOC-35 §9.2).
- **Cache:** `Cache-Control: private, no-cache` with an `ETag` of the sorted `versionId` list and the acceptance flags; `If-None-Match` answers 304.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** AD-32, AD-34, AD-37.

### E-17 `POST /me/terms` · `acceptTerms`

- **Purpose / UC:** The resident accepts the latest terms and privacy versions (UC-27 main flow). Screens `Terms`, `Terms-Update`.
- **Authorization:** `resident` (exempt from the terms gate).
- **Headers:** no `Idempotency-Key`: the acceptance is idempotent by its key `(account_id, version_id)`. The client IP and `X-App-Version` are stored with the row.
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `versionIds` | body | array of UUID | yes | | 1…2 items; each the `versionId` of a version of a building where the account has an active membership |

- **Request example:**

  ```http
  POST /api/v1/me/terms
  { "versionIds": ["018f0000-0000-7000-8000-0000000000c4", "018f0000-0000-7000-8000-0000000000c3"] }
  ```

- **Response 204:** every listed version is now accepted (a version already accepted keeps its earlier acceptance).
- **Errors:** 400 `validation_failed`; 404 `not_found` (an unknown id, or one of a building where the account has no membership); 409 `terms_version_superseded` with `details.current` (`[{kind, version, versionId}]`) when a listed version is no longer the latest of its kind: the app reloads E-16 and shows the new text. The whole call is atomic: if one id is superseded, none is stored.
- **Data source:** the conditional `INSERT … SELECT … ON CONFLICT (account_id, version_id) DO NOTHING RETURNING version_id` of DOC-35 §9.3, one per version, in one transaction.
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none (no audit: a resident action, DOC-35 §4.3).
- **Tests:** AD-33, AD-35, AD-36.

### E-18 `POST /me/account/deletion` · `requestAccountDeletion`

- **Purpose / UC:** The resident asks to delete the account (UC-27 deletion flow step 1, FL-24). Screen `Account-Deletion`. The account stays usable.
- **Authorization:** `resident` (exempt from the terms gate: a person who does not accept new terms must still be able to leave, DR-125).
- **Parameters:** none; no body.
- **Response 204:** the account is `deletion_requested`. A repeat request is also 204 (idempotent).
- **Errors:** 401 `unauthenticated`; 404 `not_found` if the account is already `deleted` (the token cannot normally exist then).
- **Data source:** `UPDATE identity.resident_account SET status = 'deletion_requested', deletion_requested_at = now(), … WHERE id = :id AND status = 'active'` (DOC-35 §10.1). Zero rows: already requested → 204.
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none; no audit (a resident action). The owner check (`owner_must_transfer`) happens at the Manager's approval (E-68), not here: an owner may request.
- **Tests:** AD-38, RM-48.

### E-19 `DELETE /me/account/deletion` · `cancelAccountDeletion`

- **Purpose / UC:** The resident cancels the request before the job runs, even after the Manager approved it (UC-27 1a, FL-24). Screen `Account-Deletion`.
- **Authorization:** `resident` (exempt from the terms gate).
- **Parameters:** none.
- **Response 204:** the account is `active` again with both dates cleared. Nothing to cancel is also 204.
- **Errors:** 404 `not_found` when the job already deleted the account (UC-27 race).
- **Data source:** `UPDATE … SET status = 'active', deletion_requested_at = NULL, deletion_approved_at = NULL … WHERE id = :id AND status = 'deletion_requested'` (DOC-35 §10.1).
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** AD-38, AD-40.

### E-20 `GET /me/sessions` · `listMySessions`

- **Purpose / UC:** The live sessions of this account, the current one marked (UC-26 step 2). Screen `Sessions`.
- **Authorization:** `resident`.
- **Parameters:** none. At most 10 items (`MAX_FAMILIES_PER_ACCOUNT`).
- **Response 200:**

  ```json
  { "items": [
    { "id": "0192f3c4-5a1e-7000-8000-000000000062", "client": "app", "device": "iPhone17,1, iOS 19.1", "createdAt": "2026-10-14T03:12:08.000Z",
      "lastUsedAt": "2026-10-20T01:02:11.000Z", "current": true },
    { "id": "0192f3c4-5a1e-7000-8000-000000000063", "client": "app", "device": "Pixel 9, Android 16", "createdAt": "2026-09-02T10:20:44.000Z",
      "lastUsedAt": "2026-10-18T16:59:08.000Z", "current": false } ] }
  ```

  `client` is `web` or `app`, stored on the family at sign-in (DR-225); `device` is computed on read from the stored `User-Agent` (DOC-26 §3.7); `id` is the refresh family id and the `sid` claim of the token.
- **Errors:** 401.
- **Data source:** the session list `SELECT` of DOC-26 §3.7 on `identity.refresh_family` (live families only), index on `(kind, account_id)`.
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** AU-55.

### E-21 `DELETE /me/sessions/{id}` · `revokeMySession`

- **Purpose / UC:** End another session, or this one (UC-26 step 3). Screen `Sessions`.
- **Authorization:** `resident`.
- **Parameters:** `id` (path, UUID, a session id from E-20).
- **Response 204.** Revoking the current session equals a logout.
- **Errors:** 404 `not_found` (another account's session looks like a missing one, UC-26 E3).
- **Data source:** the conditional `UPDATE identity.refresh_family … WHERE id = :id AND kind = :kind AND account_id = :account_id AND revoked_at IS NULL RETURNING id`, then the family's tokens (DOC-26 §3.7).
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** `identity.session_revoked.v1` (reason `user_revoked`): its device token is deleted; the access token of that session lives at most 15 minutes more.
- **Tests:** AU-31, AU-S11.

### E-22 `POST /me/devices` · `registerMyDevice`

- **Purpose / UC:** The app registers its Expo push token so the account can receive push (UC-14 step 6). Called after sign-in and when the OS issues a new token. The device endpoints are not in DOC-26; their shape is DR-146 and the table is DOC-31's (P1-26).
- **Authorization:** `resident`. The token is bound to the calling session (`sid`), so a revoked session drops it (`identity.session_revoked.v1`).
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `expoPushToken` | body | string | yes | | an Expo push token (`ExponentPushToken[…]` or `ExpoPushToken[…]`); the pattern is verified against the Expo documentation in P1-26 |
  | `platform` | body | string | yes | | `ios`, `android` |
  | `appVersion` | body | string | yes | | semver, at most 20 characters |

- **Request example:**

  ```http
  POST /api/v1/me/devices
  { "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "ios", "appVersion": "1.0.3" }
  ```

- **Response 200:** the id to remove it with; the call is an upsert on the token.

  ```json
  { "id": "0192f3c4-5a1e-7000-8000-0000000000d1" }
  ```

- **Errors:** 400 `validation_failed`; 401.
- **Data source:** `notification.device_token` upsert on the unique token: `ON CONFLICT (expo_push_token) DO UPDATE SET account_kind, account_id, session_id, platform, app_version, updated_at` (a token registered by another account is **reassigned**, glossary "device token"). The table's DDL is **owed to DOC-17 (notification tables) and DOC-31, P1-26**; the table is denied to `rms_readonly` (DOC-19).
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** owed to DOC-31 (`NT-`); P1-17 acceptance: an EAS development build registers a token.

### E-23 `DELETE /me/devices/{id}` · `removeMyDevice`

- **Purpose / UC:** Remove this device's push token, for example when the user turns push off in the OS or signs out of this app (UC-26 3a; a logout already drops it by event).
- **Authorization:** `resident`.
- **Parameters:** `id` (path, UUID, from E-22).
- **Response 204:** also when the id is unknown or belongs to another account (nothing is deleted and nothing is revealed).
- **Errors:** 401.
- **Data source:** `DELETE FROM notification.device_token WHERE id = :id AND account_kind = 'resident' AND account_id = :account_id` (DDL owed to DOC-17/DOC-31).
- **Cache:** `no-store`.
- **Performance:** p95 under 100 ms.
- **Events:** none.
- **Tests:** owed to DOC-31 (`NT-`).

### E-24 `POST /me/uploads` · `registerMyUpload`

- **Purpose / UC:** Ask for a presigned `PUT` URL for a photo or a file (FR-40, DOC-37 §6.1). Called by `Request-New` for ticket media, `Vehicle-Add` for plate photos and papers, and `Account` for the avatar.
- **Authorization:** `unit: <capability by purpose>`. The unit supplies the building of the object key (`{env}/{building_id}/…`, DOC-37 §5) and the terms gate applies. A resident may register only these purposes; any other (`logo`, `import`, `statement`, `notice_*`, `wiki_*`, generated purposes) is 403 `forbidden`:

  | `purpose` | Module of the key | Capability needed | Maximum | Types |
  | --- | --- | --- | --- | --- |
  | `avatar` | `identity` | `broadcast_notices` (every member type has it) | 10 MB | image |
  | `ticket_media` | `tickets` | `tickets` | 10 MB image, 50 MB video | image, `video/mp4`, `video/quicktime` |
  | `vehicle_plate_photo` | `vehicles` | `vehicles` | 10 MB | image |
  | `vehicle_paper` | `vehicles` | `vehicles` | 10 MB | image |

  "image" is `image/jpeg`, `image/png`, `image/webp` (DOC-37 §4). The module is derived from the purpose, so the body does not carry it. A helper has only `broadcast_notices`, so can register only an avatar.
- **Headers:** `X-Unit-Id` (required), `Idempotency-Key` (**required**: a retried registration returns the same `fileId` and URL).
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `purpose` | body | string | yes | | one of the four above |
  | `mime` | body | string | yes | | in the purpose's list |
  | `size` | body | integer | yes | | bytes, 1 to the purpose maximum |

- **Request example:**

  ```http
  POST /api/v1/me/uploads
  Authorization: Bearer eyJhbGciOiJFUzI1NiIs…
  X-Unit-Id: 0192f3c4-5a1e-7000-8000-000000000021
  Idempotency-Key: 3a6b0c1e-77d2-4f56-9d08-1e2f3a4b5c6d

  { "purpose": "ticket_media", "mime": "image/jpeg", "size": 812345 }
  ```

- **Response 201:** (`headers` must be sent exactly; the URL expires in `FILES_UPLOAD_URL_TTL_SECONDS` = 900)

  ```json
  {
    "fileId": "0192f3c4-9d02-7000-8000-00000000f001",
    "method": "PUT",
    "url": "https://files.<domain>/rms-production-files/production/0192f3c4-5a1e-7000-8000-000000000001/tickets/2026/10/0192f3c4-9d02-7000-8000-00000000f001.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=…",
    "headers": { "Content-Type": "image/jpeg" },
    "expiresAt": "2026-10-20T03:25:12.000Z",
    "maxBytes": 10485760
  }
  ```

- **Errors:** 400 `validation_failed` rules `file_type_not_allowed`, `file_too_large`; 403 `forbidden` (a purpose the caller may not register), `membership_inactive`, `terms_required`; 413 `quota_exceeded` (`details {usedBytes, quotaBytes}`); 429 `rate_limited` (bucket `upload:account:<id>`, 60 per hour); 422 `idempotency_key_reuse`.
- **Data source:** `building.file_object` insert (`status = 'pending'`, `account_kind`, `account_id`, declared `size`), the quota sum over `ix_file_object_building_live` (DOC-37 §11), the presign (a local signature, no store call).
- **Cache:** `no-store`.
- **Performance:** p95 under 200 ms.
- **Events:** none.
- **Tests:** FS-01, FS-02, FS-03.

### E-25 `POST /me/uploads/{id}/verify` · `verifyMyUpload`

- **Purpose / UC:** After the `PUT`, the client asks the server to check the object (size, type, magic bytes) before it uses the `fileId` in an owning action (DOC-37 §6.3, DR-123). Called once per photo, right after its upload.
- **Authorization:** `unit: <capability by purpose>`: the capability needed is that of the file's purpose (the table of E-24), read from the row; the use case loads the row of this account and building first, so another account's file is 404.
- **Headers:** `X-Unit-Id` (required).
- **Parameters:** `id` (path, UUID, the `fileId` of E-24); no body.
- **Response 200:**

  ```json
  { "fileId": "0192f3c4-9d02-7000-8000-00000000f001", "purpose": "ticket_media", "mime": "image/jpeg",
    "size": 812345, "status": "verified", "createdAt": "2026-10-20T03:10:12.000Z" }
  ```

  `size` is the real size of the object. A repeat call on a file that is already `verified` returns the same 200 (a retry after a lost response must not fail, DR-146); on an `attached` or `deleted` file it is 404.
- **Errors:** 404 `not_found` (another account's file, another building's); 422 `file_not_verified` with `details [{code}]`, `code` ∈ `missing` (the object is not there yet; the row stays `pending` and the client may retry within the window), `too_large`, `empty`, `wrong_type`, `bad_content` (the row becomes `deleted` and the worker removes the object); 503 `service_unavailable` (the store or the database; the row stays `pending`, retry).
- **Data source:** `building.file_object` by id; **no transaction is open** during the `HEAD` and the ranged `GET` of the store; then one short transaction sets `status = 'verified'` (or `'deleted'`) and writes `building.thumbnail_requested.v1` for an image purpose with a thumbnail, or `building.file_delete_requested.v1` on failure.
- **Cache:** `no-store`.
- **Performance:** p95 under 500 ms (one `HEAD`, one ranged `GET`, one short transaction; 150 to 250 ms planned, measured in P1-07).
- **Events:** `building.thumbnail_requested.v1`, `building.file_delete_requested.v1`.
- **Tests:** FS-04…FS-09, FS-18.

## 6. Household, resident side (E-26…E-29)

Rules shared by the group (DOC-27 §6). All four are `unit: manage_members`, so only the **owner** of the selected unit passes (DOC-27 §3.2); every other member type is 403 `forbidden`, and a locked or removed membership is 403 `membership_inactive`. `X-Unit-Id` is required and names the unit; a membership id of another unit is 404 `not_found`. A membership has no `version` (DR-139), so these endpoints take no `If-Match`: a conditional `UPDATE` on `status`, `locked_by` and `member_type` decides every race, and the loser gets 409 `invalid_transition`. Every status or type change increases `credential_version` in the same row update, so a QR code issued before it fails at the gate (DR-48). Resident actions are not audited; the unit history is `unit_history` with `actor_kind = 'resident'` (DOC-35 §4.3).

The membership object returned by E-27 and E-28 and listed by E-26:

```json
{ "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
  "displayName": "Trần Thị Bình", "phone": "+84912345678", "memberType": "tenant", "canPay": false,
  "status": "active", "lockedBy": null, "createdAt": "2026-10-20T03:10:00.000Z" }
```

### E-26 `GET /me/members` · `listMembers`

- **Purpose / UC:** The members of the selected unit (UC-15 step 1). Screen `Members`.
- **Authorization:** `unit: manage_members`.
- **Headers:** `X-Unit-Id` (required).
- **Parameters:** none. There is no limit on memberships per unit (DR-40, FR-17.5), so the list is not paginated; it returns every non-removed membership, the owner first and then by `createdAt`.
- **Response 200:**

  ```json
  { "items": [
    { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "accountId": "0192f3c4-5a1e-7000-8000-000000000041",
      "displayName": "Nguyễn Văn An", "phone": "+84901234567", "memberType": "owner", "canPay": true,
      "status": "active", "lockedBy": null, "createdAt": "2026-01-05T00:00:00.000Z" },
    { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
      "displayName": "Trần Thị Bình", "phone": "+84912345678", "memberType": "tenant", "canPay": false,
      "status": "locked", "lockedBy": "manager", "createdAt": "2026-10-01T03:00:00.000Z" } ] }
  ```

  `lockedBy` (`owner` or `manager`) lets the screen hide "Unlock" for a lock the Manager set (`Member-Actions`, FR-17.4). A member sees the phones of their own unit's members and never another unit's (NFR-14).
- **Errors:** 403 `forbidden`, `membership_inactive`, `terms_required`; 400 `validation_failed` (missing or malformed `X-Unit-Id`, `details [{path: "header.X-Unit-Id", code: "required"}]`).
- **Data source:** `residency.membership` for the unit, names and phones from `IdentityApi.getResidentAccounts(ids)` (one call); index `membership_one_per_account_unit` and the unit index of DOC-16 §5.3.
- **Cache:** `no-store`.
- **Performance:** p95 under 150 ms for 30 members (two statements).
- **Events:** none.
- **Tests:** RM-07 (a helper is refused), RM-14, RM-05.

### E-27 `POST /me/members` · `addMember`

- **Purpose / UC:** The owner adds a family member, a tenant or a helper by phone (UC-15 steps 1–2, FL-21). Screen `Member-Add`. One SMS invitation goes to the new member.
- **Authorization:** `unit: manage_members`.
- **Headers:** `X-Unit-Id` (required), `Idempotency-Key` (**required**).
- **Parameters** (body):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `phone` | body | string | yes | | parsed with region `VN`; valid nowhere is 400 rule `phone_invalid` |
  | `displayName` | body | string | yes | | 1…100 characters; used only when the account is created (an existing account keeps its name, FR-18.1) |
  | `memberType` | body | string | yes | | `family`, `tenant`, `helper`; `owner` is 400 `validation_failed` (an owner is set by transfer) |
  | `canPay` | body | boolean | no | `false` | only with `tenant`; with another type 422 rule `can_pay_tenant_only` |

- **Request example:**

  ```http
  POST /api/v1/me/members
  Authorization: Bearer eyJhbGciOiJFUzI1NiIs…
  X-Unit-Id: 0192f3c4-5a1e-7000-8000-000000000021
  Idempotency-Key: 7f1c2b8e-1d2a-4c55-9a77-3b0c9e7d1f20

  { "phone": "0912345678", "displayName": "Trần Thị Bình", "memberType": "tenant", "canPay": false }
  ```

- **Response 201:** the membership object above plus `accountCreated`; no `Location` (there is no `GET` by id).

  ```json
  { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
    "displayName": "Trần Thị Bình", "phone": "+84912345678", "memberType": "tenant", "canPay": false,
    "status": "active", "lockedBy": null, "createdAt": "2026-10-20T03:10:00.000Z", "accountCreated": true }
  ```

- **Errors:** 400 `validation_failed` (`phone_invalid`, `owner` as type); 422 `validation_failed` rule `can_pay_tenant_only`; 403 `forbidden`, `membership_inactive`, `terms_required`; 409 `member_exists` with `details {membershipId}` (the same account and unit with another key; a replay of the same key returns the first response instead); 429 `rate_limited` with `Retry-After` (the owner's 10 invitations per building day, counted under an advisory lock including removed memberships, UI "You can invite 10 people a day."; or the phone's bucket `otp:phone:<e164>` of 5 per hour, which rolls back the whole add); 422 `idempotency_key_reuse`.
- **Data source:** the steps of DOC-27 §6.2 in one transaction: `pg_advisory_xact_lock` on the owner and the day count over `residency.membership` (`added_by_kind = 'resident'`, `invited_at` in the building day); `IdentityApi.findOrCreateResidentAccount`; the profile `INSERT … ON CONFLICT DO NOTHING` (`resident_profile`); `INSERT INTO residency.membership … ON CONFLICT (account_id, unit_id) WHERE status <> 'removed' DO NOTHING RETURNING id, created_at` (unique `membership_one_per_account_unit`); `IdentityApi.queueMemberInvitation`; `unit_history` `member_added`.
- **Cache:** `no-store`.
- **Performance:** p95 under 300 ms.
- **Events:** `residency.membership_changed.v1` (`added`), `identity.sms_requested.v1` kind `member_invitation` (`expiresAt` +5 minutes); the inbox entry `member.added` is for the new owner only.
- **Tests:** RM-14…RM-20, RM-22 (no SMS when the Manager adds), AU-53.

### E-28 `PATCH /me/members/{id}` · `updateMember`

- **Purpose / UC:** The owner changes a member's type, `canPay`, or locks or unlocks them (UC-15 step 4, 4a, 4b). Screen `Member-Actions`.
- **Authorization:** `unit: manage_members`. The owner cannot act on their own row (403 `forbidden`, FR-17.3).
- **Headers:** `X-Unit-Id` (required).
- **Parameters:** `id` (path, the membership id). Body: **exactly one** of the keys below; two keys, or none, is 400 `validation_failed` (DR-139):

  | Name | In | Type | Allowed | Effect |
  | --- | --- | --- | --- | --- |
  | `memberType` | body | string | `family` ↔ `tenant` only | The predicate names the type the client saw: a change to `family` applies only to a row that is `tenant`, and the reverse. A `helper` cannot be retyped (409 `invalid_transition`); an `owner` row never (409 `owner_must_transfer`) |
  | `canPay` | body | boolean | tenant only | On another type 422 rule `can_pay_tenant_only`. Does not change `credential_version` |
  | `status` | body | string | `locked`, `active` | `locked` locks a non-owner member (`locked_by = 'owner'`); `active` unlocks, but only a lock the owner set; a lock the Manager set stays (409 `invalid_transition`, FR-17.4) |

- **Request example:**

  ```http
  PATCH /api/v1/me/members/0192f3c4-5a1e-7000-8000-000000000062
  X-Unit-Id: 0192f3c4-5a1e-7000-8000-000000000021

  { "status": "locked" }
  ```

- **Response 200:** the membership object after the change.

  ```json
  { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
    "displayName": "Trần Thị Bình", "phone": "+84912345678", "memberType": "tenant", "canPay": false,
    "status": "locked", "lockedBy": "owner", "createdAt": "2026-10-01T03:00:00.000Z" }
  ```

- **Errors:** 400 `validation_failed`; 403 `forbidden` (the owner's own row, or a capability), `membership_inactive`, `terms_required`; 404 `not_found` (an id of another unit, or removed); 409 `invalid_transition` with `details {entity: "membership", status, action}`, `owner_must_transfer`; 422 `validation_failed` rule `can_pay_tenant_only`.
- **Data source:** the conditional `UPDATE residency.membership … WHERE id = :id AND building_id = :b AND unit_id = :u AND … RETURNING …` of DOC-27 §6.3 (lock, unlock, retype, `can_pay`); on zero rows one `SELECT` chooses between 404, the refusal and 409. Index `membership_one_per_account_unit`.
- **Cache:** `no-store`.
- **Performance:** p95 under 150 ms.
- **Events:** `residency.membership_changed.v1` (`locked`, `unlocked`, `type_changed`, `can_pay_changed`).
- **Tests:** RM-01, RM-08, RM-09, RM-10, RM-13, RM-21.

### E-29 `DELETE /me/members/{id}` · `removeMember`

- **Purpose / UC:** The owner removes a non-owner member (UC-15 step 4). Screen `Member-Actions`. The membership row stays, with status `removed`; a person added again gets a new row and a new history window.
- **Authorization:** `unit: manage_members`. Never the owner's own row.
- **Headers:** `X-Unit-Id` (required).
- **Parameters:** `id` (path, the membership id).
- **Response 204.**
- **Errors:** 403 `forbidden` (own row), `membership_inactive`, `terms_required`; 404 `not_found` (another unit, or already removed); 409 `owner_must_transfer` (an owner row is removed only by transfer, E-61).
- **Data source:** the removal `UPDATE residency.membership SET status = 'removed', locked_by = NULL, removed_at = now(), credential_version = credential_version + 1 … WHERE id = :id AND building_id = :b AND unit_id = :u AND member_type <> 'owner' AND status <> 'removed'` (DOC-27 §6.3); `unit_history` `member_removed` (`actor_kind = 'resident'`).
- **Cache:** `no-store`.
- **Performance:** p95 under 150 ms.
- **Events:** `residency.membership_changed.v1` (`removed`); the removed member's next request is 403 `membership_inactive`.
- **Tests:** RM-01, RM-12, RM-13.

## 7. Staff account, session, uploads and step-up (E-30…E-38)

These endpoints belong to the signed-in staff member and need no capability beyond a valid staff token: the `staff(...)` guard lists every role. Sessions, devices and uploads work as the resident versions (E-20…E-25) with the audience changed; this group states only what differs. The staff app and the web CMS both call them; a push device is registered only by the staff app (`X-App-Id: staff`).

### E-30 `GET /staff/me` · `getStaffMe`

- **Purpose / UC:** The signed-in staff member's own account, for the shell of the web CMS and the staff app (UC-26; `W-Profile`, `S-Account`, role layout of `W-*`).
- **Authorization:** `staff: admin, manager, technician, guard`.
- **Parameters:** none.
- **Response 200:** the `staff` object of DOC-26 §3.4 plus the profile settings. `ETag: "5"` is `staff_account.version`.

  ```json
  {
    "id": "0192f3c4-5a1e-7000-8000-000000000051",
    "email": "minh.le@sunrise.example",
    "fullName": "Lê Minh",
    "role": "manager",
    "status": "active",
    "buildingId": "0192f3c4-5a1e-7000-8000-000000000001",
    "language": "vi",
    "pushEnabled": true,
    "avatarUrl": "https://files.<domain>/…?X-Amz-Expires=900&…",
    "lastLoginAt": "2026-10-20T01:02:11.000Z",
    "version": 5
  }
  ```

  `avatarUrl` is the 480 px thumbnail, or the original while the thumbnail does not exist (DOC-37 §8); `null` without an avatar. `role` and `status` come from the database row of this request, not from the token (DOC-26 §3.1).
- **Errors:** 401 `unauthenticated`.
- **Data source:** `IdentityApi.getStaff` (primary key of `identity.staff_account`); `FilesApi.signedUrl` for the avatar (local signature, no store call).
- **Cache:** `Cache-Control: private, no-cache` with the `ETag`; `If-None-Match` answers 304.
- **Performance:** p95 ≤ 100 ms (one key read; the shell calls it at every start).
- **Tests:** AU-41 (token kinds), AU-55 (shape of the neighbouring sessions list).

### E-31 `PATCH /staff/me` · `updateStaffMe`

- **Purpose / UC:** The staff member edits their own name, language, push setting and avatar (UC-26; `W-Profile`, `S-Account`). The email and the role are never changed here: the email only through E-42 with step-up, the role only by an Admin.
- **Authorization:** `staff: admin, manager, technician, guard`.
- **Headers:** `If-Match: "<version>"` required (428 `precondition_required` without it).
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `fullName` | body | string | no | untouched | 1…120 characters after trimming |
  | `language` | body | string | no | untouched | `vi` or `en`; decides the language of mail and push (FR-29) |
  | `pushEnabled` | body | boolean | no | untouched | |
  | `avatarFileId` | body | uuid or null | no | untouched | A `verified` file of purpose `avatar` registered by this account (E-36, E-37); `null` removes the avatar |

  At least one key is required; any other key (`email`, `role`, `status`) is 400 `validation_failed` rule `unknown_key`.
- **Request example:**

  ```http
  PATCH /api/v1/staff/me
  Authorization: Bearer eyJ…
  If-Match: "5"
  Content-Type: application/json

  { "language": "en", "avatarFileId": "0192f3c4-9d02-7000-8000-00000000f011" }
  ```
- **Response 200:** the object of E-30 with `language: "en"`, the new `avatarUrl`, `version: 6` and `ETag: "6"`.
- **Errors:** 400 `validation_failed` (`unknown_key`, `type`, `min_length`, `max_length`, `enum`); 409 `version_conflict` (`details.current` is the fresh object); 428 `precondition_required`; 422 `file_not_verified` (the file is not verified, belongs to someone else, or is already attached).
- **Data source:** `UPDATE identity.staff_account SET …, version = version + 1 WHERE id = :id AND version = :expected RETURNING *`. A new avatar is attached with `FilesApi.attach(file, 'staff:<id>')` and the old one removed with `FilesApi.remove`, in the same transaction (DOC-37 §6.4, §14); a rollback leaves the old avatar.
- **Performance:** p95 ≤ 300 ms.
- **Events:** `building.file_delete_requested.v1` for the old avatar and `building.thumbnail_requested.v1` for the new one (DOC-37). Audit: `identity.staff.update` with `details.self = true` and the changed fields in `changes` (`fullName` as `[masked]`, DOC-35 §3.4) (`DR-147`).
- **Tests:** AU-12 (neighbour), FS-08, FS-09; a stale `If-Match` is 409 as in BD-06.

### E-32 `GET /staff/sessions` · `listStaffSessions`

- **Purpose / UC:** The live sessions (refresh families) of the signed-in staff member, with the current one marked (UC-26 step 2; `W-Profile`, `S-Account`).
- **Authorization:** `staff: admin, manager, technician, guard`.
- **Parameters:** none. The list is not paginated: an account has at most 10 live families (DOC-26 §3.6).
- **Response 200:** exactly the list of DOC-26 §3.7.

  ```json
  { "items": [
    { "id": "0192f3c4-5a1e-7000-8000-000000000062", "client": "web", "device": "Chrome on macOS", "createdAt": "2026-10-14T03:12:08.000Z",
      "lastUsedAt": "2026-10-20T01:02:11.000Z", "current": true },
    { "id": "0192f3c4-5a1e-7000-8000-000000000063", "client": "app", "device": "iPhone17,1, iOS 19.1", "createdAt": "2026-09-02T10:20:44.000Z",
      "lastUsedAt": "2026-10-18T16:59:08.000Z", "current": false } ] }
  ```
- **Errors:** 401 `unauthenticated`.
- **Data source:** the session list statement of DOC-26 §3.7 (`identity.refresh_family`, `kind = 'staff'`, live only); `client` is a column; `device` is computed from `user_agent` on read.
- **Performance:** p95 ≤ 100 ms (at most 10 rows).
- **Tests:** AU-55, AU-S11.

### E-33 `DELETE /staff/sessions/{id}` · `revokeStaffSession`

- **Purpose / UC:** The staff member ends one of their own sessions (UC-26 step 3), including the current one, which equals a sign-out.
- **Authorization:** `staff: admin, manager, technician, guard`.
- **Parameters:** `id` (path, uuid, required): the `id` of E-32.
- **Response 204:** no body.
- **Errors:** 404 `not_found` (an unknown session and a session of another account look the same, UC-26 E3).
- **Data source:** the conditional `UPDATE … SET revoked_at = now(), revoked_reason = 'user_revoked' WHERE id, kind, account_id AND revoked_at IS NULL RETURNING id`, then its tokens (DOC-26 §3.7).
- **Events:** one `identity.session_revoked.v1` (reason `user_revoked`); consumers close the SSE streams of that session (`session.revoked`) and drop its device token (DOC-09 §5.2).
- **Tests:** AU-31, AU-S11.

### E-34 `POST /staff/devices` · `registerStaffDevice`

- **Purpose / UC:** The staff app registers its Expo push token after sign-in (UC-26; P1-17).
- **Authorization:** `staff: admin, manager, technician, guard`; meaningful only with `X-App-Id: staff`.
- **Parameters:** the same body as E-22.

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `expoPushToken` | body | string | yes | | `ExponentPushToken[…]` or `ExpoPushToken[…]`, at most 200 characters (the exact rule is DOC-31's) |
  | `platform` | body | string | yes | | `ios` or `android` |
  | `appVersion` | body | string | yes | | semver, at most 20 characters |

- **Request example:**

  ```json
  { "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "android", "appVersion": "1.0.0" }
  ```
- **Response 200:** `{ "id": "0192f3c4-5a1e-7000-8000-000000000071" }`. The call is an upsert on the token: the same token again returns the same `id`; a token registered to another account is reassigned to this session (glossary "device token"). The row is tied to the session (`sid`), so E-33, a logout and any revocation of that session delete it (DOC-09 §5.2).
- **Errors:** 400 `validation_failed` (`pattern`, `enum`).
- **Data source:** `notification.device_token` (DOC-17, written with DOC-31 in P1-26); `ON CONFLICT (expo_push_token) DO UPDATE SET account_kind, account_id, session_id, platform, app_version, updated_at`.
- **Performance:** p95 ≤ 100 ms.
- **Tests:** owed to DOC-31 (`NT-`); AU-31 covers the deletion on revoke.

### E-35 `DELETE /staff/devices/{id}` · `removeStaffDevice`

- **Purpose / UC:** The staff app removes its push token, for instance when the user turns push off on the device (UC-26). Sign-out removes it without this call.
- **Authorization:** `staff: admin, manager, technician, guard`.
- **Parameters:** `id` (path, uuid, required): the `id` that E-34 returned.
- **Response 204:** no body.
- **Errors:** 404 `not_found` (unknown, already removed, or another account's device).
- **Data source:** `DELETE FROM notification.device_token WHERE id = :id AND account_kind = 'staff' AND account_id = :account_id`.
- **Tests:** owed to DOC-31.

### E-36 `POST /staff/uploads` · `registerStaffUpload`

- **Purpose / UC:** Registers a file and returns a presigned `PUT` URL (UC-17 for the logo; P1-07; `W-Building`, `W-Import`, `W-Profile`). It is step 1 of the upload flow of DOC-37 §6; E-37 is step 2.
- **Authorization:** `staff: <by purpose>`. The purposes a staff member may register (DOC-37 §4):

  | Purpose | Admin | Manager | Technician | Guard | Module |
  | --- | --- | --- | --- | --- | --- |
  | `avatar` | yes | yes | yes | yes | `identity` |
  | `logo` | yes | | | | `building` |
  | `import` | yes | yes | | | `residency` or `finance` (named in the body) |
  | `statement` | yes | yes | | | `finance` |
  | `ticket_media` | yes | yes | yes | | `tickets` |
  | `vehicle_plate_photo`, `vehicle_paper` | yes | yes | | | `vehicles` |
  | `notice_attachment`, `notice_image` | yes | yes | | | `notices` |
  | `wiki_attachment`, `wiki_image` | yes | yes | | | `wiki` |

  A system purpose (`fee_notice_pdf`, `receipt_pdf`, `bulk_zip`, `export`, `thumbnail`) or a purpose the role may not use is 403 `forbidden`. There is no purpose for a CCCD image (DOC-37 §6.1).
- **Headers:** `Idempotency-Key` required (a retried registration after a lost response returns the first ticket).
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `purpose` | body | string | yes | | A value of the table above |
  | `module` | body | string | only for `import` | the module of the table | `residency` or `finance`; for any other purpose the field is optional and must equal the table's module |
  | `mime` | body | string | yes | | In the purpose's list (DOC-37 §4); a CSV is `text/csv` |
  | `size` | body | integer | yes | | `1 ≤ size ≤` the purpose's maximum (bytes) |

- **Request examples:**

  ```http
  POST /api/v1/staff/uploads
  Authorization: Bearer eyJ…
  Idempotency-Key: 4a7d2f10-8c1b-4e6a-9d53-0b8e1c7a2f44
  Content-Type: application/json

  { "purpose": "logo", "mime": "image/png", "size": 184322 }
  ```

  ```json
  { "purpose": "import", "module": "residency",
    "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size": 412736 }
  ```
- **Response 201:** the `UploadTicket` of DOC-37 §6.1 (the headers must be sent exactly):

  ```json
  {
    "fileId": "0192f3c4-9d02-7000-8000-00000000f021",
    "method": "PUT",
    "url": "https://files.<domain>/rms-production-files/production/0192f3c4-5a1e-7000-8000-000000000001/building/2026/10/0192f3c4-9d02-7000-8000-00000000f021.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=…",
    "headers": { "Content-Type": "image/png" },
    "expiresAt": "2026-10-20T03:25:12.000Z",
    "maxBytes": 1048576
  }
  ```
- **Errors:** 400 `validation_failed` (`file_type_not_allowed`, `file_too_large`, `required` for `module`); 403 `forbidden`; 413 `quota_exceeded` (`details {usedBytes, quotaBytes}`); 429 `rate_limited` (60 per hour per account, bucket `upload:account:<id>`); 422 `idempotency_key_reuse`.
- **Data source:** `building.file_object` insert (`status = 'pending'`), the quota sum `ix_file_object_building_live` (DOC-37 §11); no store call (the URL is signed locally).
- **Performance:** p95 ≤ 150 ms.
- **Events:** none; an unverified file is removed by `orphan_uploads` after 24 h (DOC-37 §14).
- **Tests:** FS-01, FS-02, FS-03, FS-20.

### E-37 `POST /staff/uploads/{id}/verify` · `verifyStaffUpload`

- **Purpose / UC:** After the client's `PUT`, the server checks the object (size, type, magic bytes) and marks the file `verified` (DR-123; step 2 of DOC-37 §6). Called outside any transaction.
- **Authorization:** `staff: <by purpose>`; the file must be the caller's own (`account_kind`, `account_id`).
- **Parameters:** `id` (path, uuid, required): the `fileId` of E-36. No body.
- **Response 200:** the `FileDto` of DOC-37 §3.

  ```json
  { "fileId": "0192f3c4-9d02-7000-8000-00000000f021", "purpose": "logo", "mime": "image/png", "size": 184322,
    "status": "verified", "createdAt": "2026-10-20T03:10:12.000Z" }
  ```
- **Errors:** 404 `not_found` (another account's file); 422 `file_not_verified` with `details [{ "code": "missing" | "too_large" | "empty" | "wrong_type" | "bad_content" }]`. On `missing` the row stays `pending` and the client may retry within the 15-minute window; on any other code the row is `deleted` and a delete command is queued (DOC-37 §6.5). 503 when the store or the database is unavailable (the row stays `pending`).
- **Data source:** `HEAD` and a ranged `GET` (`bytes=0-4095`) on the store, then one short transaction on `building.file_object` (DOC-37 §6.3).
- **Performance:** p95 ≤ 400 ms (one `HEAD` and one ranged `GET`; planned 150 to 250 ms from the VPS, measured in P1-07).
- **Events:** `building.thumbnail_requested.v1` for an image purpose that has a thumbnail; `building.file_delete_requested.v1` on a failure.
- **Tests:** FS-04, FS-05, FS-06, FS-07, FS-08, FS-18.

### E-38 `POST /staff/step-up` · `requestStepUp`

- **Purpose / UC:** The Admin asks for the one-time code that proves a sensitive action (UC-17 "change the receiving account, with step-up"; `W-Step-Up`). The code is mailed to the Admin's own address, is valid 10 minutes, single use, and is bound to the Admin and to the action (DOC-26 §4.5, DR-132).
- **Authorization:** `staff: admin`. A Manager is 403 `forbidden`.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `action` | body | string | yes | | `gateway_config`, `admin_change` or `staff_email` (DOC-16 §4.4) |

- **Request example:**

  ```http
  POST /api/v1/staff/step-up
  Authorization: Bearer eyJ…
  Content-Type: application/json

  { "action": "gateway_config" }
  ```
- **Response 204:** no body. The code arrives as mail (kind `step_up_code`, subject "Your confirmation code") within the outbox delay; a second request for the same action consumes the first code (one live code per staff member and action).
- **Errors:** 400 `validation_failed` (`enum` for an unknown action); 403 `forbidden`; 429 `rate_limited` (`details.scope = "step_up"`, 5 per hour per staff member, bucket `stepup:staff:<id>`), for example:

  ```http
  HTTP/1.1 429 Too Many Requests
  Retry-After: 1174
  ```
  ```json
  { "error": { "code": "rate_limited", "message": "Too many attempts. Try again later.", "details": { "scope": "step_up" } } }
  ```
- **Data source:** one transaction: consume the live `identity.password_token` of `(staff_id, 'step_up', action)`, insert the new row (HMAC of the code), write `identity.mail_requested.v1` kind `step_up_code` (DOC-16 §4.4, AU-S01).
- **Performance:** p95 ≤ 150 ms (no password hash is computed).
- **Events:** `identity.mail_requested.v1` (`step_up_code`).
- **Tests:** AU-43, AU-50, AU-S01.

**The sensitive request that consumes the code.** The Admin reads the code from the mail and repeats the action with `stepUp`. The example changes only one secret of the gateway configuration (the full change of the receiving account is E-50):

```http
PUT /api/v1/staff/gateway
Authorization: Bearer eyJ…
If-Match: "3"
Content-Type: application/json

{
  "provider": "payos",
  "secrets": { "apiKey": "7d3f9a1c-4b2e-4a8d-9c11-5e6f7a8b9c0d" },
  "stepUp": { "password": "Sunrise2026!", "code": "482913" }
}
```

```http
HTTP/1.1 200 OK
ETag: "4"
```
```json
{
  "id": "018f0000-0000-7000-8000-0000000000a1", "provider": "payos", "driver": "payos", "status": "active",
  "receivingAccount": { "bankBin": "970436", "bankName": "Vietcombank", "accountNumber": "0011001234567", "accountName": "CONG TY QUAN LY SUNRISE" },
  "secrets": { "clientId": "••••a1b2", "apiKey": "••••9c0d", "checksumKey": "••••4d5e" },
  "lastCheckAt": null, "lastCheckOk": null, "version": 4
}
```

The failure answers (no change is made; the code is not consumed by a wrong password):

```json
{ "error": { "code": "step_up_required", "message": "Confirm with your password and the code we emailed you.",
             "details": { "action": "gateway_config" } } }
```
```json
{ "error": { "code": "step_up_failed", "message": "The password or code is not correct.",
             "details": { "attemptsLeft": 4 } } }
```

`step_up_required` (403) is answered by the route before any database work when `stepUp` is missing. `step_up_failed` (403) is the same body for a wrong password, a wrong, expired, used or foreign code; `attemptsLeft` is `5 − attempts` of the live code, or 0 when there is none (FR-50.2, AU-44). After five wrong codes the live code is consumed and the next proof answers `attemptsLeft: 0` until the Admin asks for a new code (AU-46).

## 8. Staff accounts (E-39…E-46)

The rules of DOC-26 §4.4 (DR-133) apply to every endpoint of this group: a Manager touches only Technician and Guard accounts (403 `forbidden` otherwise); nobody locks, disables or changes the role of their own account (403 `forbidden` with `details: { "reason": "self" }`); the last active Admin is protected (409 `last_admin`); open tickets block a lock, a disable and a role change (409 `staff_has_open_tickets`). Every mutation writes its audit row and its session events in its own transaction (DOC-35 §4.2). A staff account is addressed by its `id`; an id of another building is 404.

*As built (P1-14, 2026-10-23, DR-261):* (1) one `stepUp` per request: a `PATCH` that is both a promotion to `admin` and an email change is 400 `validation_failed` rule `one_step_up_action`, and a body that names `role: "admin"` asks for `admin_change` even when the person is an Admin already; (2) a Manager who sends `reassignTo` (E-42, E-43) is 403 `forbidden`, and `reassignTo` without `role` on E-42 is 400 rule `requires_role`; (3) a lock, unlock, disable or enable that finds the row moved by another request decides again on the new state, so the loser is 409 `invalid_transition`; (4) E-45 accepts `invited` as a source state, so a disabled account may have no password and E-46 returns it to `invited`; (5) `page × pageSize > 10000` and `pageSize` above 50 are 400 on E-39; (6) the account object of a create carries `invite.expiresAt` and the route marks `idempotent` and `stepUp` in its audience metadata, which the generator of P1-15 reads.

All responses of a single account use the object below; `ETag` is `version`.

```json
{
  "id": "0192f3c4-5a1e-7000-8000-000000000053",
  "email": "tuan.do@sunrise.example",
  "fullName": "Đỗ Văn Tuấn",
  "role": "technician",
  "status": "active",
  "language": "vi",
  "lockedUntil": null,
  "lastLoginAt": "2026-10-19T07:41:30.000Z",
  "createdAt": "2026-08-03T02:00:00.000Z",
  "version": 4
}
```

`status` is `invited`, `active`, `locked` or `disabled`. `lockedUntil` is the end of a temporary sign-in lock (the status stays `active`, DR-107); it is `null` otherwise. The password hash, the attempt counter and the avatar key are never returned.

### E-39 `GET /staff/accounts` · `listStaffAccounts`

- **Purpose / UC:** The staff list of the building with its filters (UC-17; `W-Staff`).
- **Authorization:** `staff: admin, manager`. A Manager reads the whole list (read only; the restrictions above apply to actions) (`DR-147`).
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `page` | query | integer | no | 1 | ≥ 1; `page × pageSize ≤ 10000` |
  | `pageSize` | query | integer | no | 10 | 1…50 |
  | `role` | query | string | no | all | `admin`, `manager`, `technician`, `guard` |
  | `status` | query | string | no | all | `invited`, `active`, `locked`, `disabled` |
  | `q` | query | string | no | | At most 100 characters; matches the name (case and diacritics ignored) or the email prefix |

- **Response 200:** a page-number list, ordered by `lower(full_name), id`.

  ```json
  { "items": [
      { "id": "0192f3c4-5a1e-7000-8000-000000000053", "email": "tuan.do@sunrise.example", "fullName": "Đỗ Văn Tuấn",
        "role": "technician", "status": "active", "language": "vi", "lockedUntil": null,
        "lastLoginAt": "2026-10-19T07:41:30.000Z", "createdAt": "2026-08-03T02:00:00.000Z", "version": 4 } ],
    "page": 1, "pageSize": 10, "total": 1 }
  ```
- **Errors:** 400 `validation_failed` (`minimum`, `maximum`, `enum`).
- **Data source:** `identity.staff_account WHERE building_id = :b` with the filters; `staff_account_building_role_idx` serves the role and status filters; the table holds tens of rows, so the sort needs no index.
- **Performance:** p95 ≤ 100 ms.

### E-40 `POST /staff/accounts` · `createStaffAccount`

- **Purpose / UC:** Creates a staff account in the status `invited` and mails the set-password link (UC-17 "create a staff account"; `W-Staff-New`, `W-Reset`).
- **Authorization:** `staff: admin, manager`. An Admin creates any role; a Manager creates only `technician` and `guard` (403 `forbidden` for `admin` or `manager`, answered before any step-up is asked, FR-14.1). Step-up action `admin_change` when `role` is `admin`.
- **Headers:** `Idempotency-Key` required.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `fullName` | body | string | yes | | 1…120 characters |
  | `email` | body | string | yes | | A valid address, at most 254 characters; unique across buildings (case ignored) |
  | `role` | body | string | yes | | `admin`, `manager`, `technician`, `guard` |
  | `language` | body | string | no | the building's `defaultLanguage` | `vi` or `en` |
  | `stepUp` | body | object | when `role` is `admin` | | `{ password, code }` (E-38) |

- **Request example:**

  ```http
  POST /api/v1/staff/accounts
  Authorization: Bearer eyJ…
  Idempotency-Key: 9b1e5c7a-2d4f-4a60-8e13-6c0f2a9d7b58
  Content-Type: application/json

  { "fullName": "Vũ Văn Long", "email": "long.vu@sunrise.example", "role": "guard", "language": "vi" }
  ```
- **Response 201:** `Location: /api/v1/staff/accounts/0192f3c4-5a1e-7000-8000-000000000054`, `ETag: "1"`.

  ```json
  {
    "id": "0192f3c4-5a1e-7000-8000-000000000054", "email": "long.vu@sunrise.example", "fullName": "Vũ Văn Long",
    "role": "guard", "status": "invited", "language": "vi", "lockedUntil": null, "lastLoginAt": null,
    "createdAt": "2026-10-20T03:10:00.000Z", "version": 1,
    "invite": { "expiresAt": "2026-10-21T03:10:00.000Z" }
  }
  ```
- **Errors:** 400 `validation_failed`; 403 `forbidden` (a Manager creating `admin` or `manager`); 403 `step_up_required`, `step_up_failed` (role `admin`); 409 `email_in_use`; 422 `idempotency_key_reuse`.
- **Data source:** insert into `identity.staff_account` (unique `staff_account_email_key`, mapped to `email_in_use`); the invite token in `identity.password_token` (24 h, `INVITE_TTL_HOURS`); the raw token travels only in the mail command (DOC-26 §4.3).
- **Performance:** p95 ≤ 300 ms.
- **Events:** `identity.mail_requested.v1` kind `staff_invite`; for `admin`, one `step_up_notice` per active Admin (DOC-26 §4.5). Audit: `identity.staff.create` (`role`, `status`; `email` and `fullName` masked).
- **Tests:** AU-12, AU-13, AU-16, AU-19, AU-S05.

### E-41 `GET /staff/accounts/{id}` · `getStaffAccount`

- **Purpose / UC:** One staff account with its `ETag`, the value sent in `If-Match` by E-42 (UC-17; `W-Staff`).
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `id` (path, uuid, required).
- **Response 200:** the account object above, `ETag: "4"`.
- **Errors:** 404 `not_found` (unknown id or another building).
- **Data source:** primary key of `identity.staff_account`, scoped by `building_id`.
- **Cache:** `Cache-Control: private, no-cache` with the `ETag`; `If-None-Match` answers 304.
- **Performance:** p95 ≤ 100 ms.

### E-42 `PATCH /staff/accounts/{id}` · `updateStaffAccount`

- **Purpose / UC:** Edits the name, language, role or email of a staff account (UC-17 alternative D; `W-Staff`).
- **Authorization:** `staff: admin, manager`. An Admin edits any account; a Manager edits only `fullName` and `language` of a Technician or Guard (any other field, or any account of another role, is 403 `forbidden`). Step-up actions: `admin_change` when the new `role` is `admin`; `staff_email` when `email` is present. A role change and an email change are the Admin's alone (DOC-26 §4.4).
- **Headers:** `If-Match: "<version>"` required.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `id` | path | uuid | yes | | |
  | `fullName` | body | string | no | untouched | 1…120 |
  | `language` | body | string | no | untouched | `vi` or `en` |
  | `role` | body | string | no | untouched | `admin`, `manager`, `technician`, `guard`; not on one's own account |
  | `email` | body | string | no | untouched | A valid address, unique |
  | `reassignTo` | body | uuid | no | | With `role`: an active Technician or Guard who takes the open tickets (Admin only) |
  | `reason` | body | string | with `reassignTo` | | 5…500 characters |
  | `stepUp` | body | object | when a step-up action applies | | `{ password, code }` |

  At least one of `fullName`, `language`, `role`, `email` is required.
- **Request example (promotion to Admin):**

  ```http
  PATCH /api/v1/staff/accounts/0192f3c4-5a1e-7000-8000-000000000051
  Authorization: Bearer eyJ…
  If-Match: "5"
  Content-Type: application/json

  { "role": "admin", "stepUp": { "password": "Sunrise2026!", "code": "715204" } }
  ```
- **Response 200:** the account object with `role: "admin"`, `version: 6`, `ETag: "6"`.
- **Errors:** 400 `validation_failed`; 403 `forbidden` (the Manager rules; `details: { "reason": "self" }` for a role change of one's own account); 403 `step_up_required`, `step_up_failed`; 404 `not_found`; 409 `email_in_use`; 409 `last_admin` (demoting the last active Admin); 409 `staff_has_open_tickets` (a role change with open tickets and no `reassignTo`):

  ```json
  { "error": { "code": "staff_has_open_tickets",
               "message": "This person still has open requests. Reassign them first.",
               "details": { "tickets": [ { "ticketId": "0192f3c4-7a10-7000-8000-000000000a01", "code": "YC-261012-004", "status": "in_progress" },
                                         { "ticketId": "0192f3c4-7a10-7000-8000-000000000a02", "code": "YC-261015-002", "status": "accepted" } ] } } }
  ```

  409 `version_conflict`; 428 `precondition_required`; 422 `validation_failed` rule `reason_too_short`.
- **Data source:** the row locks and the conditional update of DOC-26 §4.4 rule 3 (`SELECT … FOR UPDATE` on the building's active Admin rows, then `UPDATE … WHERE version = :expected`); `OpenTicketsProbe.openTicketsOf` and `reassignAll` (rule 4).
- **Performance:** p95 ≤ 300 ms.
- **Events:** a role change revokes every refresh family (`role_changed`) with one `identity.session_revoked.v1` each; an email change revokes nothing and a later invite resend or reset goes to the new address (DR-133); `step_up_notice` to every active Admin when a step-up was used. Audit: `identity.staff.update` (`role`, `email` masked, `fullName` masked); with `reassignTo`, `details.reassignedTo` and the `reason` (`DR-147`).
- **Tests:** AU-12, AU-14, AU-15, AU-16, AU-17, AU-18, AU-19.

### E-43 `POST /staff/accounts/{id}/lock` · `lockStaffAccount`

- **Purpose / UC:** Locks a staff account so it cannot sign in and every session ends (UC-17 alternative D; `W-Staff`).
- **Authorization:** `staff: admin, manager`. A Manager locks only Technician and Guard accounts; an Admin locks any account except their own.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `id` | path | uuid | yes | | |
  | `reassignTo` | body | uuid | no | | Admin only; an active Technician or Guard; moves every open ticket of the locked person in the same transaction |
  | `reason` | body | string | with `reassignTo` | | 5…500 characters (DOC-35 §3.5 lists `identity.staff.force_lock` as a reason action) |

  The body may be empty.
- **Request example (forced lock):**

  ```json
  { "reassignTo": "0192f3c4-5a1e-7000-8000-000000000056", "reason": "Left the company; tickets move to Phan Quốc Bảo" }
  ```
- **Response 200:** the account object with `status: "locked"` and the new `version`.
- **Errors:** 403 `forbidden` (the Manager rules; `details.reason = "self"`); 404 `not_found`; 409 `last_admin`; 409 `staff_has_open_tickets` (no `reassignTo`; a Manager cannot force); 409 `invalid_transition` (`details {entity: "staff_account", status, action: "lock"}`) unless the status is `active`; 422 `validation_failed` (`reason_too_short`, or `assignee_locked` when `reassignTo` is not an active Technician or Guard).
- **Data source:** DOC-26 §4.4 rule 3 and 4; `UPDATE identity.staff_account SET status = 'locked' WHERE id AND status = 'active'`; every refresh family revoked (`account_locked`).
- **Performance:** p95 ≤ 300 ms (a forced lock of a person with many tickets is bounded by the ticket count; planned ≤ 1 s for 50 tickets).
- **Events:** one `identity.session_revoked.v1` per family. Audit: `identity.staff.lock`, or `identity.staff.force_lock` with `reassignTo` (`changes`: `status`, `reassignedTo`; reason).
- **Tests:** AU-14, AU-15, AU-17, AU-18, AU-19.

### E-44 `POST /staff/accounts/{id}/unlock` · `unlockStaffAccount`

- **Purpose / UC:** Lifts either kind of lock at once: the manual `locked` status and the temporary lock after failed sign-ins (UC-17 alternative A; FR-13.6).
- **Authorization:** `staff: admin, manager`; a Manager only for Technician and Guard.
- **Parameters:** `id` (path, uuid, required). No body.
- **Response 200:** the account object with `status: "active"`, `lockedUntil: null`.
- **Errors:** 403 `forbidden`; 404 `not_found`; 409 `invalid_transition` when the account is neither `locked` nor inside a temporary lock (`locked_until > now()`) (`DR-147`).
- **Data source:** `UPDATE identity.staff_account SET status = CASE WHEN status = 'locked' THEN 'active' ELSE status END, failed_attempts = 0, locked_until = NULL WHERE id AND (status = 'locked' OR locked_until > now())`.
- **Performance:** p95 ≤ 150 ms.
- **Events:** none (sessions were revoked at the lock). Audit: `identity.staff.unlock`.
- **Tests:** AU-08.

### E-45 `POST /staff/accounts/{id}/disable` · `disableStaffAccount`

- **Purpose / UC:** Deactivates a former staff member; the email stays reserved (UC-17; DOC-20 §2.1).
- **Authorization:** `staff: admin`. Not on one's own account.
- **Parameters:** as E-43 (`id`; optional `reassignTo` and `reason`).
- **Response 200:** the account object with `status: "disabled"`.
- **Errors:** as E-43 (`forbidden` with `reason: "self"`, `last_admin`, `staff_has_open_tickets`, `invalid_transition` from a status already `disabled`).
- **Data source:** as E-43; every family revoked with `account_disabled`.
- **Performance:** p95 ≤ 300 ms.
- **Events:** `identity.session_revoked.v1` per family. Audit: `identity.staff.disable` (with `details.reassignedTo` and the reason when forced, `DR-147`).
- **Tests:** AU-14, AU-15, AU-18, AU-37.

### E-46 `POST /staff/accounts/{id}/enable` · `enableStaffAccount`

- **Purpose / UC:** Re-activates a disabled account (UC-17).
- **Authorization:** `staff: admin`.
- **Parameters:** `id` (path, uuid, required). No body.
- **Response 200:** the account object with `status: "active"`, or `status: "invited"` when the person never set a password (the table's check `staff_account_password_when_not_invited`); in that case the Admin resends the invite with E-08.
- **Errors:** 404 `not_found`; 409 `invalid_transition` unless the status is `disabled`.
- **Data source:** `UPDATE identity.staff_account SET status = CASE WHEN password_hash IS NULL THEN 'invited' ELSE 'active' END WHERE id AND status = 'disabled'`.
- **Performance:** p95 ≤ 150 ms.
- **Events:** none. Audit: `identity.staff.enable`.
- **Tests:** AU-10 (a disabled account cannot sign in), AU-37.

## 9. Building administration (E-47…E-56)

All of this group is the Admin's, except the Manager's narrowed read of the audit log (E-54). They are the endpoints of `W-Building`, `W-Gateway`, `W-Audit` and `W-System`. The text of a setting that a screen shows is DOC-68's; the `message` in a `validation_failed` detail below is the generated English text and the catalog's key is `error.validation_failed` (DOC-42 §3).

### E-47 `GET /staff/settings` · `getSettings`

- **Purpose / UC:** The building row (name, company block, contact, logo) and the settings in one document (UC-17 alternative E; `W-Building`).
- **Authorization:** `staff: admin`. A Manager gets 403 `forbidden` (FR-38.1).
- **Parameters:** none.
- **Response 200:** the document of DOC-36 §4. `ETag: "3.8"` is `"<building.version>.<building_setting.version>"`.

  ```json
  {
    "building": {
      "id": "0192f3c4-5a1e-7000-8000-000000000001", "code": "SUNRISE-A",
      "name": { "vi": "Chung cư Sunrise A", "en": "Sunrise A Apartments" },
      "company": { "name": { "vi": "Công ty TNHH Quản lý Tòa nhà Sunrise", "en": null }, "taxCode": "0312345678",
                   "address": "12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", "phone": "028 3822 0000",
                   "email": "bql@sunrise.example", "representative": null },
      "address": "12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", "hotline": "1900 1234",
      "workingHours": { "vi": "Thứ 2 – Thứ 6, 8:00 – 17:00", "en": null }, "email": "bql@sunrise.example",
      "logoFileId": "0192f3c4-9d02-7000-8000-00000000f021", "logoUrl": "https://files.<domain>/…?X-Amz-Expires=900&…",
      "timeZone": "Asia/Ho_Chi_Minh", "isDemo": false
    },
    "settings": { "defaultLanguage": "vi", "defaultDueDays": 12, "accountDeletionDays": 30,
                  "lockout": { "maxAttempts": 5, "minutes": 15 }, "maxCarsPerUnit": 2,
                  "storageQuotaBytes": 53687091200, "feeNoticeLanguage": "vi", "reportColumns": {} },
    "saved": ["defaultDueDays"]
  }
  ```

  `settings` holds every key (defaults overlaid, DR-111); `saved` lists the keys that have a stored value, so the form can show "default" next to the others.
- **Errors:** 403 `forbidden`.
- **Data source:** `building.building` and `building.building_setting` by primary key (`BuildingApi.getBuilding`, `getSettings`; cached 60 s in the process, but this endpoint reads the rows to return fresh versions).
- **Cache:** `Cache-Control: private, no-cache` with the composite `ETag`; `If-None-Match` answers 304.
- **Performance:** p95 ≤ 100 ms.
- **Tests:** BD-01, BD-04.

### E-48 `PATCH /staff/settings` · `updateSettings`

- **Purpose / UC:** Edits the building row, the settings or both in one transaction (UC-17 alternative E; FR-38).
- **Authorization:** `staff: admin`.
- **Headers:** `If-Match: "<building.version>.<setting.version>"` required (the `ETag` of E-47): 428 `precondition_required` without it, 409 `version_conflict` with the fresh document in `details.current` when stale.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `building` | body | object | no | untouched | Only the fields to change (DOC-36 §4.2); `code`, `timeZone` and `isDemo` are rejected (400 `unknown_key`) |
  | `settings` | body | object | no | untouched | A shallow merge: a key present is set, a key `null` is removed (falls back to its default), a key absent is untouched; `lockout` is always sent whole |

  At least one of `building`, `settings`. The ranges of `settings` are `SETTING_RULES` (DOC-36 §5.1): `defaultLanguage` `vi`/`en`; `defaultDueDays` 1…60; `accountDeletionDays` 1…365; `lockout.maxAttempts` 3…10; `lockout.minutes` 5…120; `maxCarsPerUnit` 1…20; `storageQuotaBytes` 1 GiB…1 TiB; `feeNoticeLanguage` `vi`/`en`/`both`. A misspelled key or a wrong type is 400; a value outside its range is 422.
- **Request example** (`If-Match: "2.7"`):

  ```http
  PATCH /api/v1/staff/settings
  Authorization: Bearer eyJ…
  If-Match: "2.7"
  Content-Type: application/json

  { "building": { "hotline": "1900 5678", "workingHours": { "vi": "Hằng ngày, 7:30 – 18:00" }, "logoFileId": null },
    "settings": { "defaultDueDays": 15, "maxCarsPerUnit": null } }
  ```
- **Response 200:** the new document of E-47 with `ETag: "3.8"`: `hotline` "1900 5678", `logoFileId` and `logoUrl` `null`, `defaultDueDays` 15, `maxCarsPerUnit` back to its default 2, and `saved: ["defaultDueDays"]`.
- **Errors:** 400 `validation_failed` (`unknown_key`, `type`, `required`, `pattern`, `max_length`); 403 `forbidden`; 409 `version_conflict`; 428 `precondition_required`; 422 `validation_failed` rule `setting_invalid`:

  ```json
  { "error": { "code": "validation_failed", "message": "Some values are not valid.",
               "details": [ { "path": "settings.defaultDueDays", "code": "setting_invalid", "message": "Must be between 1 and 60." },
                            { "path": "settings.lockout.minutes", "code": "setting_invalid", "message": "Must be between 5 and 120." } ] } }
  ```

  Nothing changes when any value fails.
- **Data source:** the two conditional updates of DOC-36 §4.3 (`building.building … WHERE version = :building_version`, then `building_setting … data = (data || :set) - :remove … WHERE version = :setting_version`), in one transaction; a request that changes only one part leaves the other row and its version alone. The old logo goes through `FilesApi.remove` in the same transaction.
- **Performance:** p95 ≤ 300 ms.
- **Events:** none. Audit: `building.building.update` and/or `building.settings.update` with the changed fields. The process cache is cleared; another process sees the change within 60 s (DOC-36 §3.1, §5.2).
- **Tests:** BD-01, BD-02, BD-05, BD-06, BD-07, BD-08, BD-09, BD-10, BD-12.

### E-49 `GET /staff/gateway` · `getGateway`

- **Purpose / UC:** The gateway configurations with masked secrets, the drivers allowed for this building and the last connection check (UC-17; `W-Gateway`).
- **Authorization:** `staff: admin`.
- **Parameters:** none.
- **Response 200:** DOC-36 §7.1. A secret is `••••` plus its last four characters; one shorter than 8 characters shows `••••` only; the encrypted blob is never returned (BD-18). `version` is the value to send in `If-Match` of E-50.

  ```json
  {
    "configs": [ {
      "id": "018f0000-0000-7000-8000-0000000000a1", "provider": "payos", "driver": "payos", "status": "active",
      "receivingAccount": { "bankBin": "970436", "bankName": "Vietcombank", "accountNumber": "0011001234567", "accountName": "CONG TY QUAN LY SUNRISE" },
      "secrets": { "clientId": "••••a1b2", "apiKey": "••••9z8y", "checksumKey": "••••4d5e" },
      "lastCheckAt": "2026-10-19T03:10:00.000Z", "lastCheckOk": true, "version": 3 } ],
    "drivers": { "payos": { "fields": ["clientId", "apiKey", "checksumKey"], "allowed": true },
                 "fake": { "fields": [], "allowed": false } }
  }
  ```

  A building with no configuration returns `"configs": []`.
- **Errors:** 403 `forbidden`.
- **Data source:** `building.gateway_config` (the active row per provider); decrypt in memory only to mask (`SecretBox`, DOC-36 §6); no log line holds a secret.
- **Cache:** `Cache-Control: no-store`.
- **Performance:** p95 ≤ 150 ms (decrypts at most a few small blobs).
- **Tests:** BD-18.

### E-50 `PUT /staff/gateway` · `putGateway`

- **Purpose / UC:** Creates or changes the configuration of one payment provider: secrets, receiving account, driver, status (UC-17 "change the receiving account"; FR-38.3, FR-50; `W-Gateway`, `W-Step-Up`).
- **Authorization:** `staff: admin`. **Step-up action `gateway_config`**: every change of this resource carries `stepUp`, including an unchanged `PUT` that only re-saves (DOC-36 §7.2). The proof is verified in the same transaction as the change.
- **Headers:** `If-Match: "<version>"` of the existing configuration (E-49); required when a configuration of that `provider` exists, absent for the first creation. The row is addressed by `provider` (one active row per building and provider) (`DR-148`).
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `provider` | body | string | yes | | `payos` today (DR-25); the provider key of the driver registry |
  | `driver` | body | string | yes on create or when the driver changes | the stored driver | `payos`, `vietqr` or `fake`; `fake` only for a demo building |
  | `status` | body | string | no | stored (`active` on create) | `active` or `disabled` |
  | `receivingAccount.bankBin` | body | string | yes on create | stored | six digits |
  | `receivingAccount.accountNumber` | body | string | yes on create | stored | 6…20 digits |
  | `receivingAccount.accountName` | body | string | yes on create | stored | 1…50 upper-case ASCII letters, digits and spaces |
  | `secrets` | body | object | yes on create or a new driver | stored | The driver's fields (`clientId`, `apiKey`, `checksumKey` for `payos`). A field present replaces the stored one; a field absent keeps it |
  | `stepUp` | body | object | yes | | `{ password, code }` (E-38) |

- **Request example (receiving account change):**

  ```http
  PUT /api/v1/staff/gateway
  Authorization: Bearer eyJ…
  If-Match: "3"
  Content-Type: application/json

  {
    "provider": "payos", "driver": "payos", "status": "active",
    "receivingAccount": { "bankBin": "970422", "accountNumber": "0011009999999", "accountName": "CONG TY QUAN LY SUNRISE" },
    "secrets": { "apiKey": "7d3f9a1c-4b2e-4a8d-9c11-5e6f7a8b9c0d" },
    "stepUp": { "password": "Sunrise2026!", "code": "482913" }
  }
  ```
- **Response 200** (201 with a `Location` header when a configuration was created), `ETag: "4"`; `lastCheckAt` and `lastCheckOk` are reset to `null` because the configuration changed:

  ```json
  {
    "id": "018f0000-0000-7000-8000-0000000000a1", "provider": "payos", "driver": "payos", "status": "active",
    "receivingAccount": { "bankBin": "970422", "bankName": "MB Bank", "accountNumber": "0011009999999", "accountName": "CONG TY QUAN LY SUNRISE" },
    "secrets": { "clientId": "••••a1b2", "apiKey": "••••9c0d", "checksumKey": "••••4d5e" },
    "lastCheckAt": null, "lastCheckOk": null, "version": 4
  }
  ```
- **Errors:**

  | Status | Code | When |
  | --- | --- | --- |
  | 400 | `validation_failed` | A field of the driver is missing on create, a pattern fails, an unknown key |
  | 403 | `step_up_required`, `step_up_failed` | See E-38 |
  | 403 | `forbidden` | Not an Admin |
  | 409 | `gateway_in_use` | The receiving account, the driver or the status changes while an intent is `pending`, `creating` or `cancelling`; a change of secrets only does not ask (FR-38.3) |
  | 409 | `version_conflict` | Stale `If-Match`, or a race on the unique active row |
  | 422 | `validation_failed` rule `driver_not_allowed` | The `fake` driver for a building that is not a demo building (DR-26) |
  | 428 | `precondition_required` | A configuration exists and `If-Match` is missing |

  ```json
  { "error": { "code": "gateway_in_use", "message": "Online payments are in progress. Try again when none is open." } }
  ```

  ```json
  { "error": { "code": "validation_failed", "message": "Some values are not valid.",
               "details": [ { "path": "driver", "code": "driver_not_allowed", "message": "This driver is not available for this building." } ] } }
  ```
- **Data source:** the transaction of DOC-36 §7.3, in this order: guard and body validation; `IdentityApi.verifyStepUp`; `SELECT … FROM building.gateway_config WHERE id = :id AND version = :expected FOR UPDATE`; `ActiveIntentProbe.hasActive` when the account, driver or status changes; merge and re-seal the secrets (AAD bound to the row, DOC-36 §6.2); the conditional `UPDATE`; the audit row.
- **Performance:** p95 ≤ 500 ms (an Argon2id verify of the step-up password, about 20 ms, and the seal; the budget leaves room for the probe query).
- **Events:** `identity.mail_requested.v1` kind `step_up_notice` for every active Admin, written in this transaction so it exists only if the change commits (FR-50.4); inbox entry `staff.step_up_done`. Audit: `building.gateway.update`, `details.stepUp = true`, `changes` listing `secrets.apiKey` as `[masked]` and `receivingAccount.accountNumber` masked to the last four digits (E-54 shows the row).
- **Tests:** BD-18…BD-27, AU-16, AU-44…AU-49.

### E-51 `POST /staff/gateway/check` · `checkGateway`

- **Purpose / UC:** "Check connection": an authenticated call to the provider with no side effect, plus a self-signed sample webhook verified against the stored checksum key (UC-17 step 5; DR-33; `W-Gateway`). No step-up: it changes only `last_check_at` and `last_check_ok`.
- **Authorization:** `staff: admin`. Rate limit: 10 per hour per building (bucket `gateway-check:building:<id>`).
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `configId` | body | uuid | yes | | An `id` of E-49 |

- **Request example:** `{ "configId": "018f0000-0000-7000-8000-0000000000a1" }`
- **Response 200** (the check ran; a failed check is also 200):

  ```json
  { "ok": true, "checkedAt": "2026-10-20T03:12:44.000Z",
    "steps": [ { "name": "authenticate", "ok": true, "message": "Credentials accepted" },
               { "name": "webhook_signature", "ok": true, "message": "Sample signature verified" } ] }
  ```

  The `fake` driver answers `ok` with the single step `fake driver`. The step names and messages are the driver's (DOC-24).
- **Errors:** 404 `not_found` (an unknown config); 429 `rate_limited`; 502 `gateway_unavailable` when the provider cannot be reached.
- **Data source:** the driver's `check()` is called **outside any transaction**; one short transaction then stores `last_check_at` and `last_check_ok` (DOC-36 §7.4).
- **Performance:** p95 ≤ 3 s (dominated by the provider call; the provider timeout is 10 s).
- **Events:** none. No audit row: the check changes no business field (`DR-148`).
- **Tests:** BD-18, BD-24 (neighbours); the check itself is exercised in P3 with DOC-24.

### E-52 `GET /staff/terms` · `listTermsVersions`

- **Purpose / UC:** Every published version of both kinds, newest first, with the text and the number of residents who accepted it (UC-17 alternative E, UC-27; `W-Building`).
- **Authorization:** `staff: admin`.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `kind` | query | string | no | both | `terms` or `privacy` |

- **Response 200:** an `items` list (a handful of rows: no pagination).

  ```json
  { "items": [
    { "versionId": "018f0000-0000-7000-8000-0000000000c4", "kind": "terms", "version": 4,
      "text": { "vi": "## 1. Phạm vi\n…", "en": "## 1. Scope\n…" },
      "publishedBy": { "id": "0192f3c4-5a1e-7000-8000-000000000050", "name": "Phạm Thu Hà" },
      "publishedAt": "2026-10-18T02:30:00.000Z", "acceptedCount": 617 },
    { "versionId": "018f0000-0000-7000-8000-0000000000c3", "kind": "privacy", "version": 1,
      "text": { "vi": "## 1. Dữ liệu chúng tôi lưu\n…", "en": "## 1. Data we keep\n…" },
      "publishedBy": { "id": "0192f3c4-5a1e-7000-8000-000000000050", "name": "Phạm Thu Hà" },
      "publishedAt": "2026-09-01T02:00:00.000Z", "acceptedCount": 641 } ] }
  ```
- **Errors:** 403 `forbidden`; 400 `validation_failed` (`enum`).
- **Data source:** `building.terms_version` through `uq_terms_version_building_kind_version`; `acceptedCount` from `ix_terms_acceptance_building_version` (one count per version).
- **Cache:** `Cache-Control: no-store` (the counts change).
- **Performance:** p95 ≤ 200 ms (two counts over about 700 rows each).
- **Tests:** BD-44 (neighbour), AD-34.

### E-53 `POST /staff/terms` · `publishTermsVersion`

- **Purpose / UC:** Publishes the next version of the terms of use or the privacy notice; every resident is refused with 403 `terms_required` at their next request until they accept it (UC-17 alternative E, UC-27; FR-41.1; `W-Building`).
- **Authorization:** `staff: admin`. No step-up.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `kind` | body | string | yes | | `terms` or `privacy` |
  | `text.vi` | body | string | yes | | Non-empty, at most 100 KB, the Markdown subset below |
  | `text.en` | body | string | yes for a real building | | The same rules; the demo building may omit it |

  The Markdown subset (DR-126): headings `##` and `###` (no `#`), paragraphs, bullet and numbered lists (two levels), `**bold**`, `*italic*`, line breaks, and links `[text](https://…)` with the `https` scheme. HTML, images, tables, code, `http`, `javascript:` and relative links are refused. The rule is the pure function `parseTermsMarkdown(text)` of `@rms/shared-types`, the same one the web CMS uses for its preview.
- **Request example:**

  ```http
  POST /api/v1/staff/terms
  Authorization: Bearer eyJ…
  Content-Type: application/json

  { "kind": "terms", "text": { "vi": "## 1. Phạm vi\nHệ thống do Công ty … vận hành.", "en": "## 1. Scope\nThe system is run by …" } }
  ```
- **Response 201:** `Location: /api/v1/staff/terms?kind=terms`.

  ```json
  { "versionId": "018f0000-0000-7000-8000-0000000000c5", "kind": "terms", "version": 5,
    "text": { "vi": "## 1. Phạm vi\nHệ thống do Công ty … vận hành.", "en": "## 1. Scope\nThe system is run by …" },
    "publishedBy": { "id": "0192f3c4-5a1e-7000-8000-000000000050", "name": "Phạm Thu Hà" },
    "publishedAt": "2026-10-20T03:20:00.000Z", "acceptedCount": 0 }
  ```
- **Errors:** 400 `validation_failed` rule `terms_text`, with `path` naming the language and the line of the first violation:

  ```json
  { "error": { "code": "validation_failed", "message": "Some values are not valid.",
               "details": [ { "path": "text.vi:12", "code": "terms_text", "message": "HTML is not allowed." } ] } }
  ```

  400 `validation_failed` rule `required` (path `text.en` for a real building); 403 `forbidden`; 409 `version_conflict` (two Admins publish at once; the loser collides on `uq_terms_version_building_kind_version`).
- **Data source:** `INSERT INTO building.terms_version (…, version) SELECT …, coalesce(max(version), 0) + 1 FROM building.terms_version WHERE building_id AND kind`; write-once, never edited (a correction is a new version, DR-111).
- **Performance:** p95 ≤ 300 ms (the parser is linear in the text).
- **Events:** none (residents learn at their next request, DOC-35 §9.1). Audit: `building.terms.publish` (`kind`, `version`).
- **Tests:** BD-44, BD-45, BD-46, AD-32, AD-33.

### E-54 `GET /staff/audit` · `listAudit`

- **Purpose / UC:** Reads the audit log with filters, newest first (UC-17 alternative F; `W-Audit`, and the "history of this payment, charge, unit" tabs of UC-05). The read itself is not audited (DOC-35 §5).
- **Authorization:** `staff: admin, manager`. The Admin sees every row of the building. The Manager sees only rows whose action module is `finance`, `residency`, `tickets`, `vehicles`, `notices`, `wiki` or `reporting`, excluding `pii.read`; the response shape is the same. A Technician and a Guard are 403 `forbidden` (DOC-35 §5, AD-25). *The catalog of DOC-51 §2 lists the Admin only; the Manager's narrowed read is DOC-35 §5 and §2 is corrected with this section.*
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `cursor` | query | string | no | first page | Opaque (DR-74); invalid is 400 `invalid_cursor` |
  | `limit` | query | integer | no | 50 | 1…50 |
  | `actorId` | query | uuid | no | | A staff account id |
  | `action` | query | string | no | | An action or a prefix ending in `.` (`finance.payment.void`, `building.`); `^[a-z_]+(\.[a-z_]*)*$`, at most 80 characters |
  | `objectType` | query | string | no | | With `objectId` it is the history of one object |
  | `objectId` | query | uuid | no | | Requires `objectType` |
  | `from` | query | instant | no | | Inclusive; `at >= from` |
  | `to` | query | instant | no | | Exclusive; `at < to` |
  | `requestId` | query | string | no | | The `X-Request-Id` of the request that wrote the rows |

- **Response 200:** a keyset list on `(at, id)`, newest first. A row is the `audit.audit_log` row of DOC-17 §2 in API form; `changes` hold `before` and `after` with secrets, CCCD, dates of birth, names and notes shown as `[masked]` (DOC-35 §3.4). `ip` and `userAgent` are personal data for the Admin only (DOC-35 §7.1): a Manager receives them as `null`. A row whose actor or object no longer resolves is still returned; `actor.name` is then `null`.

  ```json
  {
    "items": [ {
      "id": "0192f3c4-a001-7000-8000-000000000b01",
      "at": "2026-10-20T03:12:40.000Z",
      "actor": { "kind": "staff", "id": "0192f3c4-5a1e-7000-8000-000000000050", "role": "admin", "name": "Phạm Thu Hà" },
      "action": "building.gateway.update",
      "object": { "type": "gateway_config", "id": "018f0000-0000-7000-8000-0000000000a1" },
      "changes": [
        { "field": "secrets.apiKey", "before": "[masked]", "after": "[masked]" },
        { "field": "receivingAccount.bankBin", "before": "970436", "after": "970422" },
        { "field": "receivingAccount.accountNumber", "before": "••••4567", "after": "••••9999" } ],
      "details": { "stepUp": true },
      "reason": null,
      "requestId": "0192f3c4-9d02-7000-8000-00000000f001",
      "ip": "203.0.113.24",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) …"
    } ],
    "nextCursor": "eyJhdCI6IjIwMjYtMTAtMjBUMDM6MTI6NDAuMDAwWiIsImlkIjoiMDE5MmYzYzQtYTAwMS03MDAwLTgwMDAtMDAwMDAwMDAwYjAxIn0"
  }
  ```
- **Errors:** 400 `validation_failed` (`pattern`, `required` for `objectId` without `objectType`, `format`); 400 `invalid_cursor`; 403 `forbidden`.
- **Data source:** the statement of DOC-35 §5 with the filters added as predicates (the Manager's has the two extra action predicates):

  ```sql
  SELECT id, at, actor_kind, actor_id, actor_role, action, object_type, object_id, changes, details, reason, request_id, ip, user_agent
    FROM audit.audit_log
   WHERE building_id = :building_id
     AND (:action_prefix IS NULL OR action LIKE :action_prefix || '%')
     AND (:object_type IS NULL OR (object_type = :object_type AND object_id = :object_id))
     AND (:actor_id IS NULL OR actor_id = :actor_id)
     AND at >= coalesce(:from, '-infinity') AND at < coalesce(:to, 'infinity')
     AND (at, id) < (:cursor_at, :cursor_id)
   ORDER BY at DESC, id DESC
   LIMIT 50;
  ```

  Indexes: `ix_audit_log_building_at` by default, `ix_audit_log_building_object` with an object, `ix_audit_log_building_actor` with an actor. The Manager's page on 80,000 rows used the first index and ran in 0.04 ms (AD-28). The actor names come from `IdentityApi.getStaff` for the page's distinct ids.
- **Cache:** `Cache-Control: no-store`.
- **Performance:** p95 ≤ 300 ms (default; the statement itself is well below it).
- **Tests:** AD-25, AD-26, AD-27, AD-28.

### E-55 `GET /staff/storage` · `getStorage`

- **Purpose / UC:** File usage against the quota, for the Admin's storage panel (UC-17 alternative G; FR-40.1; `W-System`).
- **Authorization:** `staff: admin`.
- **Parameters:** none.
- **Response 200:** `FilesApi.usage` and a breakdown by purpose (`DR-148`).

  ```json
  {
    "usedBytes": 21474836480,
    "quotaBytes": 53687091200,
    "ratio": 0.4,
    "alertAtRatio": 0.8,
    "byPurpose": [
      { "purpose": "ticket_media", "files": 5120, "bytes": 14173392076 },
      { "purpose": "vehicle_plate_photo", "files": 410, "bytes": 402653184 },
      { "purpose": "thumbnail", "files": 5530, "bytes": 1288490188 } ],
    "computedAt": "2026-10-20T03:00:00.000Z"
  }
  ```

  `usedBytes`, `quotaBytes` and `ratio` are live (the sum of DOC-37 §11, rows not `deleted`); `byPurpose` lists the purposes that have files, largest first. `alertAtRatio` is 0.8 (DOC-37 §11, DOC-40).
- **Errors:** 403 `forbidden`.
- **Data source:** `FilesApi.usage` (index-only scan `ix_file_object_building_live`) and `SELECT purpose, count(*), sum(size) FROM building.file_object WHERE building_id = :b AND status <> 'deleted' GROUP BY purpose` (a scan of one building's rows: about 20,000 after a year, planned from DOC-10 §5.3; no new index). `computedAt` is the time of the query.
- **Cache:** `Cache-Control: no-store`.
- **Performance:** p95 ≤ 300 ms (planned for 20,000 rows).
- **Tests:** FS-02, FS-16, BD-12 (quota); the breakdown has its own test in P1-07.

### E-56 `POST /staff/demo/reset` · `resetDemo`

- **Purpose / UC:** Resets the demo building to its seed before a presentation (DOC-36 §10.4; the demo script DOC-102). The nightly job `demo_reset` does the same at 04:00.
- **Authorization:** `staff: admin` of a **demo building**. For a building that is not a demo building the answer is 404 `not_found`, not 403: the endpoint does not reveal that it exists. Rate limit: 1 per minute per building (bucket `demo-reset:building:<id>`).
- **Parameters:** none; no body.
- **Response 200:** the counts per table; the figures below are illustrative.

  ```json
  { "durationMs": 6240,
    "deleted": { "finance.charge": 412, "finance.payment": 96, "residency.membership": 301, "tickets.ticket": 38, "identity.staff_account": 4 },
    "created": { "finance.charge": 412, "finance.payment": 96, "residency.membership": 301, "tickets.ticket": 38, "identity.staff_account": 4 } }
  ```
- **Errors:** 404 `not_found` (a real building); 409 `demo_reset_running` (the advisory lock `job:demo_reset` is held by another reset); 429 `rate_limited`.
- **Data source:** `DemoReset.run(buildingId)`: every module's `resetDemo` then `seedDemo`, in one transaction under `pg_try_advisory_xact_lock(hashtext('job:demo_reset'))` (DOC-36 §10.2). A failure rolls the whole transaction back and the old demo stays. Every module asserts `building.is_demo` itself (BD-37).
- **Performance:** ≤ 10 s on the staging host (planned, BD-40).
- **Events:** one `building.file_delete_requested.v1` per demo file. Every demo session is revoked (the accounts are deleted with their families, no event). Audit: `building.demo.reset` (`details {durationMs, units}`); the nightly job writes none (DOC-35 §3.6).
- **Tests:** BD-37…BD-43.
- **Built (P1-21, 2026-10-27, DR-270):** `ResetDemo` in `building` and `DemoReset.run`, over HTTP in `apps/api/tests/integration/demo.integration.test.ts`. The 404 comes first: before the rate limit, so the bucket of a real building is never created, and before anything is read. The answer is exactly `{durationMs, deleted, created}`, with the counts of the modules built so far (`building.*`, `identity.*`, `residency.*`; the others join with their modules); the Admin's own session ends with the reset. The matrix of EXP-10 expects 404 for this route, because both of its buildings are real (`DEMO_ONLY` in `tests/authz/expected.ts`). A reset took 81 ms on a laptop (BD-40 is the staging host).

## 10. Residency, staff side (E-57…E-74, E-169)

*Built in P1-14 (2026-10-23, DR-260):* E-57…E-67 and E-69, over HTTP in `apps/api/tests/integration/residency-staff.integration.test.ts`; E-71…E-74 and E-169 came with P1-13. Not built: E-68 (with the deletion task) and E-70 (with `access`, P5-05). Where the build differs from the text: E-65 writes its `pii.read` row after the read, in the same transaction, so a failed insert still returns no data; E-69 answers the `MembershipDto` after the change and `memberType` accepts only `family` or `tenant`; `neverSignedIn` and `deletion=requested` of E-63 restrict the page through `identity`.

Group notes. Every staff query takes the `BuildingScope` of the token's `bid` (DOC-12 §7); an id of another building answers 404 `not_found`, never 403. Every endpoint of this group is `staff: admin, manager` except E-70, which a Guard may call. A Manager and an Admin have the same rights here (DOC-27 §3.3). Personal data rules: a list or a search shows the full phone and a masked ID number (`•••• 1234`) and never a date of birth; only E-65 returns the full ID number and the date of birth, and it writes `pii.read` first (DOC-35 §6). Shared shapes used below:

```jsonc
// UnitDto (E-58, E-60, and the head of E-59)
{ "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "floor": 15, "bedrooms": 2, "areaM2": "68.50",
  "occupancy": "occupied", "note": null, "version": 3 }
// MembershipDto (E-59 members, E-69)
{ "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
  "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "memberType": "tenant", "canPay": false,
  "status": "active", "lockedBy": null, "startedAt": "2026-10-01T03:00:00.000Z" }
```

`occupancy` is `occupied`, `rented` or `vacant`; `status` is `active`, `locked` or `removed`; `lockedBy` is `owner`, `manager` or `null`. Until `finance` exists (P2) the `debt` object of E-59 is `{ "openChargeCount": 0, "openAmount": 0, "oldestDueDate": null }`.

### E-57 `GET /staff/units` · `listUnits`

- **Purpose / UC:** The unit list and the unit search of `W-Units` and of the pickers of `W-Resident-Add` (UC-13).
- **Authorization:** `staff: admin, manager`.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `q` | query | string | no | | 1…100 characters, NFC, trimmed. With `q` the answer is the search of DOC-27 §11.1 (unit code prefix, at least 2 characters, exact match first), capped at 20, with no cursor; with 1 character it is an empty list |
  | `occupancy` | query | enum | no | | `occupied`, `rented`, `vacant` |
  | `floor` | query | integer | no | | −5…150 |
  | `bedrooms` | query | integer | no | | 0…20 (DR-212; the "Loại" filter of `W-Units`) |
  | `cursor` | query | string | no | | Opaque; 400 `invalid_cursor` when it does not decode |
  | `limit` | query | integer | no | 50 | 1…200 |

- **Response 200:**

  ```json
  {
    "items": [
      { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "floor": 15, "bedrooms": 2, "areaM2": "68.50",
        "occupancy": "occupied", "note": null, "version": 3, "memberCount": 3,
        "owner": { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "accountId": "0192f3c4-5a1e-7000-8000-000000000041",
                   "fullName": "Nguyễn Văn An", "phone": "+84901234567" } },
      { "unitId": "0192f3c4-5a1e-7000-8000-000000000022", "code": "A-1509", "floor": 15, "bedrooms": 3, "areaM2": "82.00",
        "occupancy": "vacant", "note": null, "version": 1, "memberCount": 0, "owner": null }
    ],
    "nextCursor": "eyJjIjoiQS0xNTA5IiwiaSI6IjAxOTJmM2M0LTVhMWUifQ",
    "summary": { "total": 240, "occupied": 171, "rented": 52, "vacant": 17 }
  }

  *Revised 2026-10-20 (DR-212):* `memberCount` counts the non-removed memberships of the unit, the owner included. `summary` covers the whole building, whatever the filters, and is present on every page (one `GROUP BY occupancy` over `residency.unit`).
  ```

- **Errors:** 400 `validation_failed`, 400 `invalid_cursor`, 401, 403 `forbidden`.
- **Data source:** `residency.unit` left-joined to the active owner row of `residency.membership`; the owner's name from `resident_profile`, the phone from `IdentityApi.getResidentAccounts` (one call per page). Keyset in code order on `(code, id)` through `unit_code_key`, so `A-100` sorts before `A-20` (DOC-27 §4.2); search through `unit_code_prefix_idx`.

  ```sql
  SELECT u.id, u.code, u.floor, u.bedrooms, u.area_m2, u.occupancy, u.note, u.version, m.id AS owner_membership_id, m.account_id AS owner_account_id
    FROM residency.unit u
    LEFT JOIN residency.membership m ON m.building_id = u.building_id AND m.unit_id = u.id AND m.member_type = 'owner' AND m.status <> 'removed'
   WHERE u.building_id = :b AND (u.code, u.id) > (:after_code, :after_id)
   ORDER BY u.code, u.id LIMIT :limit + 1;
  ```

- **Performance:** p95 ≤ 300 ms for a page of 50 over 240 units (planned, NFR-03).
- **Tests:** RM-35, RM-36.

### E-58 `POST /staff/units` · `createUnit`

- **Purpose / UC:** The Manager adds one unit by hand (UC-13). A unit is never deleted (DR-12); a unit made by mistake is set `vacant`.
- **Authorization:** `staff: admin, manager`.
- **Headers:** `Idempotency-Key` required.
- **Parameters (body):**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `code` | body | string | yes | | `^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$`, trimmed, stored upper-case (DOC-27 §4.1 rule 2) |
  | `floor` | body | integer \| null | no | null | −5…150 |
  | `bedrooms` | body | integer \| null | no | null | 0…20 |
  | `areaM2` | body | string \| null | no | null | Decimal string above 0, at most `"2000"`, at most 2 decimals |
  | `occupancy` | body | enum | no | `vacant` | `occupied`, `rented`, `vacant` |
  | `note` | body | string \| null | no | null | at most 500 characters |

- **Request example:**

  ```json
  { "code": "a-1509", "floor": 15, "bedrooms": 3, "areaM2": "82.00", "occupancy": "vacant", "note": null }
  ```

- **Response 201** (`Location: /api/v1/staff/units/0192f3c4-5a1e-7000-8000-000000000022`, `ETag: "1"`): a `UnitDto`.

  ```json
  { "unitId": "0192f3c4-5a1e-7000-8000-000000000022", "code": "A-1509", "floor": 15, "bedrooms": 3, "areaM2": "82.00",
    "occupancy": "vacant", "note": null, "version": 1 }
  ```

- **Errors:** 400 `validation_failed` (`pattern` on `code`, `maximum`, `enum`, `unknown_key`), 409 `unit_code_in_use` (the unique index `unit_code_key`, matched case-insensitively), 422 `idempotency_key_reuse`, 403 `forbidden`.
- **Data source:** `INSERT INTO residency.unit … RETURNING`; a duplicate raises `23505` on `unit_code_key`, which the module maps to `unit_code_in_use`. Audit `residency.unit.create` in the same transaction.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-40.

### E-59 `GET /staff/units/{id}` · `getUnit`

- **Purpose / UC:** The unit detail of `W-Unit-Detail`: the unit, its owner, its members and the open debt in one answer (UC-13, DOC-27 §4.2). `ETag` is the value the Manager sends back as `If-Match` for an edit (E-60) and for a transfer (E-61).
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `id` (path, UUID).
- **Response 200** (`ETag: "3"`):

  ```json
  {
    "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "floor": 15, "bedrooms": 2, "areaM2": "68.50",
    "occupancy": "occupied", "note": null, "version": 3,
    "owner": { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "accountId": "0192f3c4-5a1e-7000-8000-000000000041",
               "fullName": "Nguyễn Văn An", "phone": "+84901234567", "status": "active", "lockedBy": null },
    "members": [
      { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
        "fullName": "Trần Thị Bình", "phone": "+84912345678", "memberType": "tenant", "canPay": false,
        "status": "active", "lockedBy": null, "startedAt": "2026-10-01T03:00:00.000Z" } ],
    "debt": { "openChargeCount": 2, "openAmount": 1850000, "oldestDueDate": "2026-10-10" }
  }
  ```

  `members` lists the non-removed memberships other than the owner's, oldest first. `fullName` is the profile's name, `phone` the account's.
- **Errors:** 404 `not_found` (unknown id, or a unit of another building).
- **Data source:** `residency.unit` by primary key; `residency.membership` by `membership_unit_idx` (unit, non-removed); names from `resident_profile`; phones from `IdentityApi.getResidentAccounts`; `FinanceApi.getOutstandingByUnit([id])`.
- **Cache:** `ETag: "<unit.version>"`, `Cache-Control: private, no-cache`. The `ETag` is the value for `If-Match`, not a validator of the whole answer (the owner, the members and the debt change without moving the version), so `If-None-Match` is never answered 304 (P1-16: a browser that kept the first answer showed an old household).
- **Performance:** p95 ≤ 300 ms (four reads, one call to `identity`, one to `finance`).
- **Tests:** RM-36.

### E-60 `PATCH /staff/units/{id}` · `updateUnit`

- **Purpose / UC:** The Manager edits the code (the typo case), floor, bedrooms, area, occupancy or note (UC-13, DOC-27 §4.1). `occupancy` is set by the Manager and never derived from memberships (DR-40).
- **Authorization:** `staff: admin, manager`.
- **Headers:** `If-Match: "<unit.version>"` required (428 `precondition_required` without it).
- **Parameters (body):** any of `code`, `floor`, `bedrooms`, `areaM2`, `occupancy`, `note` with the constraints of E-58; an absent key is kept; `null` clears `floor`, `bedrooms`, `areaM2` and `note` (not `code`, not `occupancy`). An empty body is 400 `validation_failed` rule `min_properties`.
- **Request example:**

  ```http
  PATCH /api/v1/staff/units/0192f3c4-5a1e-7000-8000-000000000021
  If-Match: "3"
  { "occupancy": "vacant", "note": "Owner moved out 2026-10-15" }
  ```

- **Response 200** (`ETag: "4"`): the `UnitDto` with the new `version`.

  ```json
  { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "floor": 15, "bedrooms": 2, "areaM2": "68.50",
    "occupancy": "vacant", "note": "Owner moved out 2026-10-15", "version": 4 }
  ```

- **Errors:** 400 `validation_failed`, 404 `not_found`, 409 `version_conflict` (`details.current` is the fresh `UnitDto`), 409 `unit_code_in_use`, 428 `precondition_required`.
- **Data source:** `UPDATE residency.unit SET …, version = version + 1 WHERE id = :id AND building_id = :b AND version = :expected RETURNING …` (DOC-27 §4.1 rule 5). A change of `occupancy` across the vacancy boundary writes a `unit_history` row in the same transaction: to `vacant` is `moved_out`, from `vacant` is `moved_in`; between `occupied` and `rented` none (DR-141). Audit `residency.unit.update` lists the changed fields.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-40, RM-41.

### E-61 `POST /staff/units/{id}/owner` · `transferOwnership`

- **Purpose / UC:** The Manager transfers the ownership of a unit to a person given by phone, with the other members removed by default (UC-13, FL-22, DOC-27 §7). One transaction removes the old owner and the other members (unless `keepMembers`), promotes or inserts the new owner, writes `unit_history`, the events and the audit row.
- **Authorization:** `staff: admin, manager`.
- **Headers:** `If-Match: "<unit.version>"` required: the first statement of the transaction bumps the version and arbitrates two transfers (DR-138).
- **Parameters (body):**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `phone` | body | string | yes | | Parsed with `libphonenumber-js/max`, region `VN`; invalid in every country is 400 `phone_invalid` |
  | `fullName` | body | string | yes | | 2…100 characters with a letter. Used for the profile; an existing account keeps its own name (DQ-44 rule) |
  | `keepMembers` | body | boolean | no | `false` | `true` removes only the old owner |
  | `reason` | body | string | yes | | 5…500 characters (DOC-35 §3.5) |

- **Request example:**

  ```http
  POST /api/v1/staff/units/0192f3c4-5a1e-7000-8000-000000000021/owner
  If-Match: "3"
  Content-Type: application/json

  { "phone": "0912345678", "fullName": "Trần Thị Bình", "keepMembers": false,
    "reason": "Sold on 2026-10-15; contract 15/2026" }
  ```

- **Response 200** (`ETag: "4"`):

  ```json
  { "unit": { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "version": 4 },
    "owner": { "membershipId": "0192f3c4-5a1e-7000-8000-000000000063", "accountId": "0192f3c4-5a1e-7000-8000-000000000042" },
    "removedMembers": 3, "accountCreated": false }
  ```

  `removedMembers` counts the old owner and every other member removed.
- **Errors:**

  | Status and code | When |
  | --- | --- |
  | 400 `validation_failed` rule `phone_invalid` | The number is valid in no country |
  | 422 `validation_failed` rule `reason_too_short` | `reason` under 5 characters |
  | 428 `precondition_required` | No `If-Match` |
  | 409 `version_conflict` | The unit changed since the Manager loaded it, or a second transfer won; `details.current` is the fresh unit summary. The transaction rolled back |
  | 409 `member_exists` | The phone is the unit's current owner (`details {membershipId, memberType: "owner"}`) |
  | 404 `not_found` | The unit is unknown or in another building |

- **Data source:** the statements of DOC-27 §7 in this order: the version `UPDATE` (arbiter), `findOrCreateResidentAccount`, the profile insert `ON CONFLICT DO NOTHING`, the removal `UPDATE … RETURNING`, the promote-or-insert, `unit_history`, outbox, audit. The unique index `membership_one_owner_per_unit` is the second net.
- **Events:** `residency.owner_changed.v1` once; `residency.membership_changed.v1` (`removed`) per removed row; `identity.sms_requested.v1` is **not** written (DR-137). Audit `residency.owner.transfer` with the reason. A QR code of every changed membership dies by `credential_version` (DR-48).
- **Performance:** p95 ≤ 300 ms for a unit with 29 memberships (the S7 case of DOC-27 §7).
- **Tests:** RM-23, RM-24, RM-25, RM-26, RM-27, RM-28.

### E-62 `GET /staff/units/{id}/history` · `listUnitHistory`

- **Purpose / UC:** The history tab of `W-Unit-Detail` (UC-13 3c, FR-18.6): who owned or lived in the unit and when.
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `id` (path); `cursor` (opaque), `limit` (1…100, default 50).
- **Response 200:**

  ```json
  {
    "items": [
      { "id": "0192f3c4-b001-7000-8000-000000000a11", "kind": "owner_changed",
        "actor": { "kind": "staff", "name": "Lê Minh" },
        "details": { "from": "0192f3c4-5a1e-7000-8000-000000000041", "to": "0192f3c4-5a1e-7000-8000-000000000042",
                     "keepMembers": false, "removedMembers": 3 },
        "at": "2026-10-20T03:10:00.000Z" },
      { "id": "0192f3c4-b001-7000-8000-000000000a10", "kind": "member_added",
        "actor": { "kind": "resident", "name": "Nguyễn Văn An" },
        "details": { "accountId": "0192f3c4-5a1e-7000-8000-000000000042", "memberType": "tenant" },
        "at": "2026-10-01T03:00:00.000Z" }
    ],
    "nextCursor": null
  }
  ```

  `kind` is `owner_changed`, `moved_in`, `moved_out`, `member_added` or `member_removed` (DOC-27 §10). `actor.kind` is `staff`, `resident` or `system` (`name` is `null` for `system`). The response never holds a phone.
- **Errors:** 404 `not_found`, 400 `invalid_cursor`.
- **Data source:** `residency.unit_history` newest first, keyset on `(at, id)` through `unit_history_unit_idx`; actor names from `IdentityApi.getStaff` or `getResidentAccounts`, one call per page.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-23, RM-41.

### E-63 `GET /staff/residents` · `listResidents`

- **Purpose / UC:** The resident list and search of `W-Residents` and `W-Resident-Add`, including the pending deletion requests (UC-13 3b, UC-27).
- **Authorization:** `staff: admin, manager`.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `q` | query | string | no | | 1…100 characters, NFC, trimmed. A name needs at least 3 characters after folding case and diacritics ("nguyen" finds "Nguyễn"); a phone needs at least 4 digits (after removing spaces, `+`, `.`, `-`) and is a suffix match; a shorter fragment does not search by that kind (FR-18.5). With `q` the page is capped at 20 and has no cursor |
  | `unitId` | query | UUID | no | | Residents with a non-removed membership of the unit |
  | `memberType` | query | enum | no | | `owner`, `family`, `tenant`, `helper` |
  | `status` | query | enum | no | | Membership status: `active`, `locked` |
  | `deletion` | query | enum | no | | `requested`: only accounts in `deletion_requested` (DR-149) |
  | `neverSignedIn` | query | boolean | no | | `true`: only accounts with `last_app_open_at IS NULL` (DR-212; the "Chưa đăng nhập" status of `W-Residents`) |
  | `cursor`, `limit` | query | string, integer | no | none, 50 | `limit` 1…200 |

- **Response 200:**

  ```json
  {
    "items": [
      { "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "fullName": "Nguyễn Văn An", "phone": "+84901234567",
        "cccdMasked": "•••• 2345", "accountStatus": "active", "lastAppOpenAt": "2026-10-20T01:02:11.000Z",
        "memberships": [ { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "unitId": "0192f3c4-5a1e-7000-8000-000000000021",
                           "unitCode": "A-1508", "memberType": "owner", "status": "active" } ],
        "deletion": { "requestedAt": null, "approvedAt": null } }
    ],
    "nextCursor": null,
    "summary": { "total": 612 }
  }

  *Revised 2026-10-20 (DR-212):* `lastAppOpenAt` is `resident_account.last_app_open_at` (set at most once an hour, DOC-26 §5.2), `null` when the account never opened the app. `summary.total` is the number of resident accounts of the building, whatever the filters. `q` stays a name or phone search; an email or a unit code is not searched here (use `unitId`).
  ```

- **Errors:** 400 `validation_failed`, 400 `invalid_cursor`.
- **Data source:** `residency.resident_profile` keyset on `account_id` (primary key `(building_id, account_id)`; UUIDv7 gives creation order); name search through `resident_profile_name_trgm_idx`; phone search through `IdentityApi.findResidentAccountsByPhoneFragment(digits, 50)` then the profiles of those ids (DOC-27 §11.1); `deletion` from `IdentityApi.listDeletionRequests` joined with the profile names (DOC-35 §10.2). The list writes no `pii.read` row (DOC-35 §6).
- **Performance:** p95 ≤ 300 ms at 5,000 profiles (the plan of DOC-27 §11.1, S13).
- **Tests:** RM-33, RM-34, RM-36.

### E-64 `POST /staff/residents` · `createResident`

- **Purpose / UC:** The Manager adds a person to a unit: an owner of an ownerless unit, or a family member, tenant or helper (UC-13 3a, `W-Resident-Add`, DOC-27 §5.1). An existing phone links the unit to the existing account; no invitation SMS is sent (DR-137).
- **Authorization:** `staff: admin, manager`.
- **Headers:** `Idempotency-Key` required.
- **Parameters (body):**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `unitId` | body | UUID | yes | | A unit of the building |
  | `phone` | body | string | yes | | As in E-61; 400 `phone_invalid` |
  | `fullName` | body | string | yes | | 2…100 characters with a letter |
  | `memberType` | body | enum | yes | | `owner`, `family`, `tenant`, `helper`; `owner` only for a unit without an active owner |
  | `canPay` | body | boolean | no | `false` | Only with `tenant`; otherwise 422 `can_pay_tenant_only` |
  | `email` | body | string \| null | no | null | A valid address, at most 254, stored lower-case |
  | `note` | body | string \| null | no | null | at most 500 characters |

- **Request example:**

  ```json
  { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "phone": "0912345678", "fullName": "Trần Thị Bình",
    "memberType": "tenant", "canPay": false, "email": "binh@example.com", "note": null }
  ```

- **Response 201** (`Location: /api/v1/staff/residents/0192f3c4-5a1e-7000-8000-000000000042`):

  ```json
  { "accountId": "0192f3c4-5a1e-7000-8000-000000000042", "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountCreated": true }
  ```

- **Errors:** 400 `validation_failed` (rule `phone_invalid`), 404 `not_found` (unit), 409 `unit_has_owner` (`details {ownerMembershipId}`: replacing an owner is a transfer, E-61), 409 `member_exists` (`details {membershipId}`), 422 `validation_failed` rule `can_pay_tenant_only`, 422 `idempotency_key_reuse`.
- **Data source:** DOC-27 §5.1 in one transaction: `IdentityApi.findOrCreateResidentAccount`, the profile insert `ON CONFLICT (building_id, account_id) DO NOTHING`, the membership insert `ON CONFLICT (account_id, unit_id) WHERE status <> 'removed' DO NOTHING`, `unit_history`, outbox, audit.
- **Events:** `residency.membership_changed.v1` (`added`) for a non-owner; `residency.owner_changed.v1` for an owner added to an ownerless unit. Audit `residency.membership.add` and `residency.profile.update` when the profile is filled.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-22, RM-29, RM-19.

### E-65 `GET /staff/residents/{accountId}` · `getResident`

- **Purpose / UC:** The resident detail with the full ID number and the date of birth (UC-13, DOC-27 §5.3). It is a `pii.read` view.
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `accountId` (path, UUID). The account must have a `resident_profile` in this building, else 404 (accounts are global; the profile is what ties a Manager to a person, DR-136).
- **Response 200** (`ETag: "2"`, the profile `version`):

  ```json
  {
    "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "phone": "+84901234567", "accountStatus": "active",
    "profile": { "fullName": "Nguyễn Văn An", "email": "an@example.com", "cccd": "079085012345", "dateOfBirth": "1985-04-03",
                 "note": null, "version": 2 },
    "memberships": [ { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "unitId": "0192f3c4-5a1e-7000-8000-000000000021",
                      "unitCode": "A-1508", "memberType": "owner", "status": "active", "startedAt": "2026-01-05T00:00:00.000Z" } ],
    "deletion": { "requestedAt": null, "approvedAt": null, "executeAfter": null }
  }
  ```

  `cccd` and `dateOfBirth` are `null` when not stored. `accountStatus` is `active` or `deletion_requested`. *Added 2026-10-25 (DR-264):* `deletion.executeAfter` is `approvedAt` plus `accountDeletionDays` (`BuildingApi.getSettings`), `null` until the approval, so the profile dialog shows the date after a reopen; the list items (E-63) carry the two dates only.
- **Errors:** 404 `not_found`, 500 `internal_error` when the `pii.read` insert fails (no data is returned).
- **Data source:** a short transaction first inserts the audit row `pii.read` (`object` `resident_profile`, `details {"view": "detail", "fields": ["cccd", "dateOfBirth"]}`) and then reads the profile, decrypts `cccd_enc` with `SecretBox` (AAD `cccd|<building_id>|<account_id>`), reads the memberships and the account (DOC-27 §5.3, DOC-35 §6).
- **Cache:** `Cache-Control: no-store` (personal data); no `If-None-Match` shortcut: every view writes its audit row.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-37.

### E-66 `PATCH /staff/residents/{accountId}` · `updateResidentProfile`

- **Purpose / UC:** The Manager edits the building's record of a person (UC-13, DOC-27 §5.3). The account's `display_name` is a different field and is not changed here.
- **Authorization:** `staff: admin, manager`.
- **Headers:** `If-Match: "<profile.version>"` required.
- **Parameters (body):** any of `fullName` (2…100), `email` (valid, ≤ 254), `cccd` (12 digits CCCD or 9 digits CMND, spaces removed; anything else is 400 `validation_failed` rule `format`), `dateOfBirth` (`YYYY-MM-DD`, 1900-01-01 to the building's today), `note` (≤ 500). An absent key is kept; `null` clears `email`, `cccd`, `dateOfBirth` and `note`. `cccd` and `cccd_last4` change together (constraint `resident_profile_cccd_pair`).
- **Request example:**

  ```http
  PATCH /api/v1/staff/residents/0192f3c4-5a1e-7000-8000-000000000041
  If-Match: "2"
  { "cccd": "079 085 012 345", "dateOfBirth": "1985-04-03" }
  ```

- **Response 200** (`ETag: "3"`). It returns neither the ID number nor the date of birth, so the edit is not a `pii.read` view; the Manager opens E-65 to see them.

  ```json
  { "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "fullName": "Nguyễn Văn An", "email": "an@example.com",
    "cccdMasked": "•••• 2345", "hasDateOfBirth": true, "note": null, "version": 3 }
  ```

- **Errors:** 400 `validation_failed`, 404 `not_found` (no profile in this building), 409 `version_conflict`, 428 `precondition_required`.
- **Data source:** `UPDATE residency.resident_profile … WHERE building_id = :b AND account_id = :id AND version = :expected`. Audit `residency.profile.update` lists the fields, all `[masked]` (DOC-35 §3.4).
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-38, RM-39.

### E-67 `PATCH /staff/residents/{accountId}/phone` · `changeResidentPhone`

- **Purpose / UC:** The Manager changes a resident's login phone (UC-13, FL-22, FR-18.4). Every session of the account is revoked; memberships and QR codes are unchanged.
- **Authorization:** `staff: admin, manager`.
- **Headers:** none beyond the defaults: the account row is identity's and has no `If-Match`.
- **Parameters (body):** `phone` (string, required; parsed with `libphonenumber-js/max`, region `VN`).
- **Request example:**

  ```json
  { "phone": "0987654321" }
  ```

- **Response 204.** A phone equal to the current one is also 204 and writes nothing.
- **Errors:** 400 `validation_failed` rule `phone_invalid`; 404 `not_found` (no profile of this account in the building); 409 `phone_in_use` (the number has an account; nothing changes).
- **Data source:** `IdentityApi.changeResidentPhone` in the same transaction (one conditional `UPDATE` of the phone, `23505` on `resident_account_phone_key` mapped to `phone_in_use`), then the revocation of every refresh family with reason `phone_changed` (DOC-26 §2.2, §3.8). Audit `residency.login_phone.change` with the masked old and new numbers (`+84•••••567`). The unit history has no row.
- **Events:** `identity.session_revoked.v1` per family; `notification` then drops the device tokens.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-30, RM-31, RM-32, AU-52.

### E-68 `POST /staff/residents/{accountId}/deletion/approve` · `approveAccountDeletion`

- **Purpose / UC:** The Manager approves a resident's request to delete their account; the `account_deletion` job executes it after `accountDeletionDays` (UC-27, FL-24, DOC-35 §10.1). There is no "reject": a Manager who does not approve leaves the account `deletion_requested`.
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `accountId` (path, UUID); no body.
- **Response 200:** the approval date and the earliest execution.

  ```json
  { "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "deletionRequestedAt": "2026-10-18T02:00:00.000Z",
    "deletionApprovedAt": "2026-10-20T03:15:00.000Z", "executeAfter": "2026-11-19T03:15:00.000Z" }
  ```

  `executeAfter` is `deletionApprovedAt` plus `accountDeletionDays` (30) as an interval of days; the job runs daily at 03:45 and executes within 24 hours after it. A second approval answers 200 with the existing dates.
- **Errors:** 404 `not_found` (no profile in this building, or a deleted account); 409 `deletion_not_requested` (the account is `active`); 409 `owner_must_transfer` (`details {unitIds}`: the account is the active owner of a unit, `ResidencyApi.ownedUnitIds`; UI for the Manager "Transfer ownership of the unit first.").
- **Data source:** `UPDATE identity.resident_account SET deletion_approved_at = now(), … WHERE id = :id AND status = 'deletion_requested' AND deletion_approved_at IS NULL RETURNING deletion_approved_at + make_interval(days => :days)` (DOC-35 §10.1). Zero rows: one `SELECT` chooses between 409 `deletion_not_requested` and the idempotent 200. The owner check runs first and again at execution.
- **Events:** none; audit `identity.account.deletion_approve` (written once, by the approval that set the date; the idempotent answer writes none).
- **Performance:** p95 ≤ 300 ms.
- **Tests:** AD-39, AD-41, AD-45 (`apps/api/tests/integration/residency-staff.integration.test.ts`, with three simultaneous approvals writing one audit row); AD-42 and RM-46, RM-47 belong to the execution (P6-04).
- *As built (P1-16, DR-264):* `ApproveAccountDeletion` (`residency`) checks the profile of the Manager's building, then the ownership (`details.unitIds` lists every unit the account owns), reads `accountDeletionDays` from `BuildingApi.getSettings` and calls `IdentityApi.approveResidentDeletion`; `ApproveResidentDeletion` (`identity`) runs the conditional `UPDATE` and the audit in the caller's transaction. A losing race reads the state again: the other approval's dates, or 409 `deletion_not_requested` after a cancel. The request and the cancel (E-18, E-19) and the job are P6-04.

### E-69 `PATCH /staff/memberships/{id}` · `updateMembership`

- **Purpose / UC:** The Manager locks, unlocks, removes or retypes one membership, or sets `canPay` (UC-13 3d, UC-15 4c, DOC-27 §6). The owner's own endpoints are E-28 and E-29.
- **Authorization:** `staff: admin, manager`.
- **Parameters (body):** **exactly one** of the keys below; two keys or none is 400 `validation_failed` rule `one_change_only` (new rule code, DR-139).

  | Key | Values | Meaning |
  | --- | --- | --- |
  | `status` | `locked` | Lock any membership, the owner's included. A lock the owner set becomes the Manager's (`lockedBy: "manager"`), which the owner cannot undo (FR-17.4) |
  | `status` | `active` | Unlock, always allowed for the Manager (from `locked` only; else 409 `invalid_transition`) |
  | `status` | `removed` | Remove a non-owner membership. The owner's row is removed only by transfer (E-61) |
  | `memberType` | `family`, `tenant` | Retype between family member and tenant. The statement names the type the client saw: a retype to `tenant` expects `family` and the reverse, so a second concurrent retype changes no row |
  | `canPay` | `true`, `false` | Tenant only |

- **Request examples:**

  ```json
  { "status": "locked" }
  ```
  ```json
  { "canPay": true }
  ```
  ```json
  { "status": "removed" }
  ```

- **Response 200:** the `MembershipDto` after the change (a Manager's lock shown):

  ```json
  { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "accountId": "0192f3c4-5a1e-7000-8000-000000000042",
    "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "memberType": "tenant", "canPay": false,
    "status": "locked", "lockedBy": "manager", "startedAt": "2026-10-01T03:00:00.000Z" }
  ```

- **Errors:**

  | Status and code | When |
  | --- | --- |
  | 400 `validation_failed` | Two keys or none (`one_change_only`); a value outside the enum (`memberType: "helper"` or `"owner"` is not in the enum) |
  | 404 `not_found` | An unknown id, or a membership of another building |
  | 409 `owner_must_transfer` | Removing, or retyping, the owner's row |
  | 409 `invalid_transition` | A state that does not allow the action: unlocking an `active` row, locking a row the Manager already locked, retyping a helper or a row that already has the type, a `removed` row (`details {entity: "membership", status, action}`) |
  | 422 `validation_failed` rule `can_pay_tenant_only` | `canPay` on a member who is not a tenant |

- **Data source:** the conditional `UPDATE`s of DOC-27 §6.3 (Manager variants, building predicate, no `unit_id`). Each status or type change adds `credential_version + 1` in the same row update; `canPay` does not. After zero rows one `SELECT` chooses between 404 and the refusals above.
- **Events:** `residency.membership_changed.v1` with `change` `locked`, `unlocked`, `removed`, `type_changed` or `can_pay_changed`; `unit_history` `member_removed` for a removal only (none for a lock, an unlock or a retype). Audit `residency.membership.lock`, `.unlock`, `.remove` or `.update`. The person's next request is 403 `membership_inactive` after a lock or removal.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** RM-09, RM-10, RM-13, RM-21.

### E-70 `GET /staff/lookup` · `lookup`

- **Purpose / UC:** One search box for a unit, a resident or a plate (UC-28, `G-` lookup screens and `W-Units`). The Guard's view is masked and logged. The route is hosted by the `access` module, which may call `residency` and `vehicles` while `residency` may not call `vehicles` (DR-140); its units and residents come from `ResidencyApi.lookup`. The route is mounted when `access` is built (P5-05); until then the Manager searches with E-57 and E-63.
- **Authorization:** `staff: admin, manager, guard`.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `q` | query | string | yes | | 1…100 characters, NFC, trimmed. Every strategy whose condition holds runs: unit code (at least 2 characters), resident name (at least 3 folded characters, not only digits), phone (at least 4 digits, one leading `0` allowed; suffix match). A `q` that satisfies none answers three empty lists, not an error (DOC-27 §11.1) |
  | `limitPerKind` | query | integer | no | 20 | 1…20 |

- **Response 200 (Manager, Admin):**

  ```json
  {
    "units": [ { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "code": "A-1508", "floor": 15, "occupancy": "occupied",
                 "owner": { "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "fullName": "Nguyễn Văn An", "phone": "+84901234567" } } ],
    "residents": [ { "accountId": "0192f3c4-5a1e-7000-8000-000000000041", "fullName": "Nguyễn Văn An", "phone": "+84901234567",
                     "memberships": [ { "unitId": "0192f3c4-5a1e-7000-8000-000000000021", "unitCode": "A-1508",
                                        "memberType": "owner", "status": "active" } ] } ],
    "vehicles": []
  }
  ```

  `vehicles` is the plate search of DOC-30 (shape owed there); it is `[]` until `vehicles` exists. **Response 200 (Guard):** the same shape with `"phone": "090••••567"` and no `accountId` in `residents` or in `owner`; each view is written to `access.lookup_log` (DR-48, FR-31.3; the mask and the log are DOC-29). A search never returns a full ID number or a date of birth and writes no `pii.read` row.
- **Errors:** 400 `validation_failed` (no `q`, `q` over 100 characters, `limitPerKind` out of range), 403 `forbidden` (Technician).
- **Data source:** the three statements of DOC-27 §11.1 (`unit_code_prefix_idx`, `resident_profile_name_trgm_idx`, `IdentityApi.findResidentAccountsByPhoneFragment` then the profiles and memberships of those ids). The Guard's plan is one index scan on `membership_one_per_account_unit` (RM-51).
- **Performance:** p95 ≤ 300 ms at 5,000 profiles.
- **Tests:** RM-33, RM-34, RM-35, RM-36, RM-51.

### E-71 `GET /staff/imports/templates/{kind}` · `downloadImportTemplate`

- **Purpose / UC:** The Manager downloads the Excel template for an import (UC-13 step 1, UC-01, `W-Import`).
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `kind` (path): `unit_owner` or `fee_batch`; any other value is 404 `not_found`. The headers are written in the requesting staff member's `language` (`vi` or `en`).
- **Response 200:** a generated workbook, not JSON.

  ```http
  HTTP/1.1 200 OK
  Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  Content-Disposition: attachment; filename="unit-owner-template-vi.xlsx"
  Cache-Control: no-store
  ```

  The first sheet is named `Căn hộ` (`Units` in English); row 1 is the header and there are no other rows. The cells of the phone, ID number and date-of-birth columns are formatted as Text, because Excel drops the leading zero of a number (DOC-18 §1.1). The file name of the English template is `unit-owner-template-en.xlsx`. The `fee_batch` template is specified in DOC-18 §2 and DOC-21 and is served by `finance` (P2).
- **The `unit_owner` columns** (DOC-18 §1.1; the reader matches a header by its folded key against the aliases there, so a Manager may rename a column within them):

  | Canonical column | Header (vi) | Header (en) | Required | Cell |
  | --- | --- | --- | --- | --- |
  | `unit_code` | Mã căn hộ | Unit code | Yes | Text |
  | `floor` | Tầng | Floor | No | Whole number |
  | `bedrooms` | Số phòng ngủ | Bedrooms | No | Whole number |
  | `area_m2` | Diện tích (m²) | Area (m²) | No | Number |
  | `occupancy` | Tình trạng | Occupancy | No | Text |
  | `owner_name` | Họ tên chủ hộ | Owner full name | If any owner cell is filled | Text |
  | `owner_phone` | SĐT chủ hộ | Owner phone | If any owner cell is filled | Text |
  | `owner_email` | Email chủ hộ | Owner email | No | Text |
  | `owner_id_number` | CCCD chủ hộ | Owner ID number | No | Text |
  | `owner_dob` | Ngày sinh chủ hộ | Owner date of birth | No | Text or date |

- **Errors:** 404 `not_found` (unknown `kind`), 403 `forbidden`.
- **Data source:** none: the workbook is written in memory with `exceljs` from the column table above; no file is stored.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** IM-41 (role), IM-06 (header matching).

### E-72 `POST /staff/imports` · `createImport`

- **Purpose / UC:** Validate an uploaded Excel file synchronously and store the preview for the commit (UC-13 step 2, UC-01, `W-Import`, FL-23, DR-21). Nothing is written to the units tables here.
- **Authorization:** `staff: admin, manager`.
- **Headers:** `Idempotency-Key` required (a retried request replays the stored preview instead of validating the file twice).
- **Who serves which kind.** The route is one; `kind` selects the module (DR-149). `unit_owner` is served by `residency` (`ValidateUnitOwnerImport`, table `residency.import_job`, rules DOC-18 §1). `fee_batch` is served by `finance` (table `finance.import_job`, rules DOC-18 §2, flow DOC-21) and takes its extra parameters in `params` (for example `{ "batchId": … }`, DR-109); DOC-21 specifies them. This document fixes only the dispatch and the common body. The host registers each module's `ImportHandler { kind, validate(actor, fileId, params), get(actor, id), commit(actor, id) }` in `apps/api` and routes E-72, E-73 and E-74 by `kind`; E-73 and E-74 find the job by asking each handler for the id (UUIDv7, two tables).
- **The file is named by `fileId`, not `fileKey`.** The original SDD and DOC-27 §9.1 write `fileKey`; DOC-37 registers and verifies a file by its `fileId` and keeps the object key private to `FilesApi` (DR-86). The body therefore carries the `fileId` of a **verified** upload of purpose `import` (E-36 with `module: "residency"` or `"finance"`, then the `PUT`, then E-37). The job stores the object key as `import_job.file_key` (DOC-16 §5.5) read through `FilesApi`.
- **Parameters (body):**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `kind` | body | enum | yes | | `unit_owner`, `fee_batch` |
  | `fileId` | body | UUID | yes | | A `verified` file of purpose `import`, registered by the caller for the module of this kind; otherwise 422 `file_not_verified` |
  | `fileName` | body | string | no | | 1…255 characters, the name of the file as the browser knows it (`file.name`); control characters are removed; answered as `fileName` here, in E-73 and in E-169 (DR-259) |
  | `params` | body | object | no | `{}` | Per kind; `unit_owner` takes none (unknown keys are 400) |

- **Request example:**

  ```http
  POST /api/v1/staff/imports
  Idempotency-Key: 3b1e4c7a-52d0-4c1f-9b2e-6a77d0c15e88
  Content-Type: application/json

  { "kind": "unit_owner", "fileId": "0192f3c4-9d02-7000-8000-00000000f001" }
  ```

- **Response 201** (`Location: /api/v1/staff/imports/0192f3c4-c001-7000-8000-000000000b01`). A file of 2,000 rows with 40 errors (the case of IM-30), lists truncated for this page: `counts` are complete, `validRows` has 50 entries (2 shown) and `issues` has 46 entries (4 shown: 40 errors then 6 warnings). `message` is rendered in the language of the request; the stored `jsonb` keeps `{code, params}` only (DR-22). The preview never holds an ID number or a date of birth (IM-32).

  ```json
  {
    "importId": "0192f3c4-c001-7000-8000-000000000b01", "kind": "unit_owner", "status": "validated",
    "fileName": "can-ho-chu-ho-2026-10.xlsx",
    "createdAt": "2026-10-20T03:20:00.000Z", "expiresAt": "2026-10-21T03:20:00.000Z", "committedAt": null,
    "preview": {
      "counts": { "rows": 2000, "valid": 1960, "errors": 40, "warnings": 6,
                  "unitsToCreate": 1800, "unitsToUpdate": 160,
                  "accountsToCreate": 1421, "accountsLinked": 439,
                  "ownersToAdd": 1830, "ownersUnchanged": 30 },
      "validRows": [
        { "row": 2, "unitCode": "A-1508", "ownerName": "Nguyễn Văn An", "ownerPhone": "+84901234567", "ownerIdNumber": "•••• 2345",
          "notes": [ { "code": "unit_will_update", "message": "Unit A-1508 exists and will be updated." },
                     { "code": "account_linked", "message": "This phone already has an account; the owner is linked to it and the name in the file is not used." } ] },
        { "row": 3, "unitCode": "A-1509", "ownerName": "Lê Thị Cúc", "ownerPhone": "+84933333333", "ownerIdNumber": null,
          "notes": [ { "code": "unit_will_create", "message": "Unit A-1509 will be created." },
                     { "code": "account_will_be_created", "message": "A new resident account will be created for this phone." } ] }
      ],
      "issues": [
        { "row": 4, "unitCode": "A-1510", "column": "owner_phone", "severity": "error", "code": "owner_conflict", "params": { "code": "A-1510" },
          "message": "Unit A-1510 already has another owner. Use ownership transfer." },
        { "row": 8, "unitCode": "A-1508", "column": "unit_code", "severity": "error", "code": "unit_code_duplicate", "params": { "code": "A-1508", "firstRow": 2 },
          "message": "Unit A-1508 already appears in row 2." },
        { "row": 17, "unitCode": "A-1515", "column": "owner_phone", "severity": "error", "code": "phone_invalid", "params": {},
          "message": "This phone number is not valid." },
        { "row": 23, "unitCode": "A-1520", "column": "owner_id_number", "severity": "warning", "code": "id_number_padded", "params": {},
          "message": "The ID number lost its leading zeros in Excel; it was padded to 12 digits. Check it." }
      ],
      "issuesTruncated": false
    }
  }
  ```

  *Revised 2026-10-20 (DR-213):* every entry of `issues` carries `unitCode`, the normalized code of the row (`null` when the row has none), so the screen can show a "Mã căn" column; the list of errors is downloaded as a CSV built in the browser, and E-73 is not a history list (`W-Import` reopens a job by `?importId=`).

  A file that fails a file-layer rule (not an `.xlsx`, no unit-code header, a duplicated column, no data rows: DQ-01…DQ-04) still creates a job, with `status: "failed"`, empty `validRows`, zero `counts` and one issue with `severity: "fail"` (for example `import_no_header`); the commit of it is 409 `import_not_ready`. With more than 500 issues `issues` holds the first 500, errors first, and `issuesTruncated` is `true`; `counts` stay complete (IM-31).
- **Limits and errors:**

  | Status and code | When |
  | --- | --- |
  | 400 `validation_failed` rule `too_many_rows` | More than 5,000 non-blank data rows; the reader stops at 5,001 (DQ-05, FR-01.2). No job is stored (DR-149) |
  | 400 `validation_failed` rule `file_too_large` | Over 5 MB. Normally refused earlier, at E-36, because the declared size is checked at register; the same rule applies if the verified object is larger |
  | 400 `validation_failed` | Unknown `kind`, a missing `fileId`, an unknown key |
  | 404 `not_found` | The `fileId` is unknown, or belongs to another account or building |
  | 422 `file_not_verified` | The file is not `verified`, is not of purpose `import`, or was registered for another module |
  | 422 `idempotency_key_reuse` | The key was used with another body |
  | 413 `quota_exceeded`, 429 | At E-36 (register), not here |

- **Data source:** `FilesApi` reads the object; the file, row, set and db layers of DOC-18 §1 run in memory with three set queries (Q-U, Q-M, Q-P of DOC-18 §1.5) and one `IdentityApi.findResidentAccountsByPhones` call, never one query per row; then one `INSERT INTO residency.import_job` (`status` `validated` or `failed`, `result` = the preview, `expires_at = created_at + 24 h`). The service attaches the file to the job (`owner_ref` `import:<id>`) in the same transaction.
- **Performance:** p95 ≤ 10 s for 2,000 rows with 40 errors from the accepted request to the response carrying the preview (NFR-12, IM-30). Planned 2 s (DOC-10); the measured read and rules alone were 77 to 83 ms (DOC-18 §1.1).
- **Tests:** IM-01…IM-06, IM-29, IM-30, IM-31, IM-32; RM-42.
- **As built (P1-13, 2026-10-23, DR-258):** `fileName` is the optional field of the body (`null` when absent: `file_object` keeps no name, DR-259); the body also carries `committed: null`; the `Idempotency-Key` is honoured in the `external` mode of DOC-50 §8 (P1-28): a retry answers the first preview with `Location` and `Idempotent-Replayed: true`, a duplicate while the first is validating is 409 `request_in_progress`; `kind: "fee_batch"` is 400 until `finance` serves it (P2-04). `message` is rendered from `Accept-Language` (`en`, else `vi`); a `column` or `field` in `params` is shown as the header of the template. Measured: 2,000 rows with 40 errors answer in 0.2 s.

### E-73 `GET /staff/imports/{id}` · `getImport`

- **Purpose / UC:** Reopen a preview or read the result of a commit (UC-13, UC-01; the import history of `W-Import`).
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `id` (path, UUID).
- **Response 200:** the body of E-72. `status` is `validated`, `failed`, `committed` or `expired`; a `validated` job whose `expiresAt` has passed is reported as `expired` at once, before the hourly `import_expire` job updates the row. For a committed job `committedAt` is set and `committed` holds the counts written, equal to the previewed `unitsToCreate`, `unitsToUpdate`, `accountsToCreate`, `accountsLinked` and `ownersToAdd` (the post-check DQ-60 guarantees it):

  ```json
  { "importId": "0192f3c4-c001-7000-8000-000000000b01", "kind": "unit_owner", "status": "committed",
    "fileName": "can-ho-chu-ho-2026-10.xlsx",
    "createdAt": "2026-10-20T03:20:00.000Z", "expiresAt": "2026-10-21T03:20:00.000Z", "committedAt": "2026-10-20T03:26:41.000Z",
    "committed": { "unitsCreated": 1800, "unitsUpdated": 160, "accountsCreated": 1421, "accountsLinked": 439, "ownersAdded": 1830 },
    "preview": { "counts": { "rows": 2000, "valid": 1960, "errors": 40, "warnings": 6, "unitsToCreate": 1800, "unitsToUpdate": 160,
                             "accountsToCreate": 1421, "accountsLinked": 439, "ownersToAdd": 1830, "ownersUnchanged": 30 },
                 "validRows": [], "issues": [], "issuesTruncated": false } }
  ```

  `committed` is `null` for the other statuses. After commit or expiry `preview.validRows` and `preview.issues` are returned as stored; the file is gone.
- **Errors:** 404 `not_found` (unknown id, another building's job).
- **Data source:** `residency.import_job` (or `finance.import_job`) by primary key.
- **Performance:** p95 ≤ 300 ms.
- **Tests:** IM-33, IM-35, IM-39.

### E-74 `POST /staff/imports/{id}/commit` · `commitImport`

- **Purpose / UC:** The Manager presses "Save valid rows": one transaction creates or updates the units, the resident profiles and the owner memberships of the valid rows (UC-13 step 4, FL-23, DOC-27 §9.2). Rows with an error are skipped. No invitation SMS is sent.
- **Authorization:** `staff: admin, manager`.
- **Parameters:** `id` (path, UUID); no body. No `Idempotency-Key`: the job's status is the arbiter, and a second press returns the first result.
- **Response 200:**

  ```json
  { "importId": "0192f3c4-c001-7000-8000-000000000b01", "status": "committed", "committedAt": "2026-10-20T03:26:41.000Z",
    "committed": { "unitsCreated": 1800, "unitsUpdated": 160, "accountsCreated": 1421, "accountsLinked": 439, "ownersAdded": 1830 } }
  ```

  A job already `committed` answers the same body again with 200 (IM-33).
- **Errors:**

  | Status and code | When |
  | --- | --- |
  | 404 `not_found` | Unknown id, or another building's job |
  | 409 `import_expired` | The job is older than 24 hours (DQ-51); nothing written |
  | 409 `import_not_ready` | The job is `failed` (DQ-52, `details {status}`) |
  | 409 `import_stale` | The data changed between the preview and the commit: the file is read and checked again and the counts differ (DQ-50); `details {rows}`; nothing written; the job stays `validated` |
  | 500 `internal_error` | The post-check DQ-60 found a difference (`import_integrity` in the log); rolled back, an alert fires |

- **Data source:** the commit claims the job with `UPDATE residency.import_job SET status = 'committed', committed_at = now() WHERE id = :id AND status = 'validated' AND expires_at > now() RETURNING result`; zero rows: one `SELECT` chooses between the first result, `import_expired` and `import_not_ready`. It then runs the steps of DOC-27 §9.2 (re-read and re-check, upsert units with blank cells keeping the stored value, `IdentityApi.findOrCreateResidentAccount` per new phone, profiles fill-empty-only, owner memberships, `unit_history`, audit, `FilesApi.remove`, DQ-60).
- **Events:** `residency.owner_changed.v1` per owner added and no `membership_changed` (DOC-27 §2.3). Audit `residency.import.commit` (bulk form, counts in `details`).
- **Performance:** planned under 5 s for the 2,000-row file (217 ms of statements server side plus about 3 s of round trips, DOC-27 §9.3); p95 ≤ 10 s.
- **Tests:** IM-33…IM-39, IM-40; RM-42, RM-43, RM-44, RM-45.
- **As built (P1-13, 2026-10-23, DR-258):** the 2,000-row commit takes 3.0 s (statements in batches of 500; the accounts one call per new phone). `details.rows` of `import_stale` is the number of rows of the file, and a file that no longer reads is `import_stale` too.

### E-169 `GET /staff/imports` · `listImports`

- **Purpose / UC:** The "recent imports" table of `W-Import`: the earlier import jobs of the building, newest first, so the Manager can reopen a preview that is still valid and see who imported what and when (UC-13, UC-01; DR-226). It lists; E-73 reads one job.
- **Authorization:** `staff: admin, manager`. Building-scoped: the statement filters on the `bid` of the token (DOC-12 §7), so another building's jobs never appear.
- **Parameters:**

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `kind` | query | enum | no | `unit_owner` | `unit_owner` in phase 1. `fee_batch` is served by `finance` from `finance.import_job` once that module exists (DR-149, DOC-21); the two tables are never merged in one page |
  | `status` | query | enum | no | | `validated`, `failed`, `committed`, `expired`. `validated` means not yet expired (`expires_at > now()`); `expired` includes a `validated` job whose `expires_at` has passed, as in E-73 |
  | `cursor` | query | string | no | | Opaque (DOC-50 §10); 400 `invalid_cursor` when it does not decode |
  | `limit` | query | integer | no | 20 | 1…100 |

- **Response 200:** a cursor page, newest first. A row holds no preview, no valid rows and no issues: they are read through E-73.

  ```json
  {
    "items": [
      { "importId": "0192f3c4-c001-7000-8000-000000000b02", "kind": "unit_owner", "status": "validated",
        "fileName": "can-ho-moc-mien-10-2026.xlsx",
        "counts": { "rows": 240, "valid": 236, "errors": 4, "warnings": 2 },
        "createdBy": { "staffId": "0192f3c4-5a1e-7000-8000-000000000011", "name": "Lê Minh" },
        "createdAt": "2026-10-21T02:24:00.000Z", "expiresAt": "2026-10-22T02:24:00.000Z", "committedAt": null },
      { "importId": "0192f3c4-c001-7000-8000-000000000b01", "kind": "unit_owner", "status": "committed",
        "fileName": "can-ho-chu-ho-2026-10.xlsx",
        "counts": { "rows": 2000, "valid": 1960, "errors": 40, "warnings": 6 },
        "createdBy": { "staffId": "0192f3c4-5a1e-7000-8000-000000000011", "name": "Lê Minh" },
        "createdAt": "2026-10-20T03:20:00.000Z", "expiresAt": "2026-10-21T03:20:00.000Z", "committedAt": "2026-10-20T03:26:41.000Z" }
    ],
    "nextCursor": null
  }
  ```

  `status` follows the rule of E-73: a `validated` job whose `expiresAt` has passed is reported as `expired` at once. `counts` are the four totals of the stored preview (`result.counts`); a `failed` job (a file that could not be read) has `counts` all `0`. `createdBy.name` comes from the staff account; it is `null` only if the account is unknown to `IdentityApi`. A job is kept 30 days by `import_purge` (DR-62), so the list reaches back 30 days at most; the screen says so.
- **Errors:** 400 `validation_failed` (unknown `kind` or `status`, `limit` out of range, an unknown key), 400 `invalid_cursor`, 401, 403 `forbidden` (Technician, Guard).
- **Data source:** `residency.import_job` keyset on `(created_at, id)` descending through `import_job_building_idx (building_id, created_at DESC)` (DOC-16 §5.5); no new table and no new index. Names from `IdentityApi.getStaff`, one call per page. `result->'counts'` is the only part of the `jsonb` read.

  ```sql
  SELECT id, kind, status, file_name, result->'counts' AS counts, created_by, created_at, expires_at, committed_at
    FROM residency.import_job
   WHERE building_id = :b AND kind = :kind
     AND (created_at, id) < (:after_created_at, :after_id)      -- absent on the first page
   ORDER BY created_at DESC, id DESC LIMIT :limit + 1;
  ```

  The `status` filter is applied with the `CASE` that derives `expired` from `expires_at`.
- **Cache:** `no-store`, the default of DOC-50 §12.
- **Performance:** p95 ≤ 300 ms. At most a few dozen rows exist in 30 days; the plan is an index scan on `import_job_building_idx` (the same index as DLC-15).
- **Tests:** IM-42, IM-43; UIWR-41, UIWR-42 (DOC-65).
- **As built (P1-13, 2026-10-23, DR-258):** `createdBy.name` is the staff member's full name from `IdentityApi.getStaff`, one call per page; `kind=fee_batch` is 400 until P2-04; `limit` is a string of up to three digits checked to 1…100 (400 `validation_failed`), a cursor that does not decode is 400 `invalid_cursor`.


## 10A. Usage events (E-173)

Added by DR-279 (2026-10-28); the behavior is DOC-104. Built in P1-29. The section is numbered 10A so that §11…§14 keep the numbers that other documents cite.

### E-173 `POST /usage-events` · `recordUsageEvents`

- **Purpose / UC:** The apps and the web CMS report which screens a signed-in person opened and which listed controls they pressed, so the Owner can see what is used (DR-279). No use case: it is not an act of a person on the building's data.
- **Authorization:** `staff: any` (every role) or `unit: any member` (a resident acting for a unit: `X-Unit-Id` with an active membership of any member type, a Helper included, and no capability); no step-up. The building is the `bid` of the staff token or the building of the active membership (`UnitContext`, DOC-12 §11), never the body. A resident app sends the header like every unit call, and sends nothing before a unit is chosen. Subject to the app-version gate (an app that must update is not tracked). Not exempt from the terms gate: a resident who has not accepted the latest terms cannot call it, which is why `Terms` and `Terms-Update` are not recorded either (DOC-104 §4.1).
- **Parameters** (body, at most 16 KB, `additionalProperties: false`):

  | Name | In | Type | Required | Default | Constraints |
  | --- | --- | --- | --- | --- | --- |
  | `app` | body | string | yes | | `resident`, `staff`, `web` |
  | `appVersion` | body | string | yes | | `x.y.z`, digits, each part 1…4 digits |
  | `platform` | body | string | yes | | `ios`, `android`, `web` |
  | `sessionId` | body | string | yes | | A UUID v4 that the client made in memory (DOC-104 §5.2) |
  | `events` | body | array | yes | | 1…50 items |
  | `events[].event` | body | string | yes | | `screen_view`, `tap` |
  | `events[].name` | body | string | yes | | At most 60 characters; a screen id (`screen_view`) or `<Screen>.<control>` (`tap`) from the lists of DOC-104 §4; a name outside the lists is dropped, not refused |
  | `events[].ageMs` | body | integer | yes | | 0…3,600,000: the age of the event when the batch is sent |

- **Request example:**

  ```http
  POST /api/v1/usage-events
  Authorization: Bearer <access token>
  Content-Type: application/json

  { "app": "resident", "appVersion": "1.0.3", "platform": "ios",
    "sessionId": "0192f3c4-9d02-4000-8000-00000000a001",
    "events": [
      { "event": "screen_view", "name": "Fees", "ageMs": 4200 },
      { "event": "tap", "name": "Account.language", "ageMs": 900 }
    ] }
  ```

- **Response 204:** no body, also when every event was dropped, when `USAGE_ENABLED` is false and when the building is a demo building.
- **Errors:** 400 `validation_failed` (an unknown key, a count or a value out of range, `sessionId` not a UUID v4; a missing or malformed `X-Unit-Id`, `header.X-Unit-Id`), 401, 403 `membership_inactive` (a membership that has ended), 403 `terms_required` (the terms gate, DOC-35 §9.2), 413 `payload_too_large` (the body limit, before validation), 426 `upgrade_required` (the version gate), 429 `rate_limited` with `Retry-After` (`scope: "usage_events"`; the app drops the batch silently), 503 `maintenance`. No new error code (DOC-42 §10).
- **Data source:** one `INSERT … SELECT FROM unnest(…)` into `analytics.usage_event` (DOC-104 §6.3); `audience` is `resident` or `staff` by the kind of the token. Two PostgreSQL buckets in `platform.rate_bucket` (DR-64): `usage-events:ip:<ip>` 30 a minute (`USAGE_EVENTS_PER_MINUTE_PER_IP`) and `usage-events:session:<sessionId>` 120 an hour (`USAGE_EVENTS_PER_HOUR_PER_SESSION`). The counters `usage_events_total` and `usage_events_dropped_total` (DOC-40 §4.7). Nothing identifies the account in a row, a bucket or a metric label; the request line carries the account id like any request line, and never the body (DOC-42 §8.4).
- **Cache:** `no-store`.
- **Idempotency:** none (not `R`): a repeated batch is counted twice, which DR-279 (9) accepts.
- **Performance:** p95 under 50 ms (two bucket statements and one insert of at most 50 rows).
- **Events:** none (no outbox row, no audit row; DOC-104 §6.3).
- **Tests:** UA-01…14, UA-28 (DOC-104 §13).

## 11. Later groups

`E-75…E-168` are numbered in §2.2 and not specified here. Each is specified in the document and phase below, in the same template, before the phase starts (P*n*-00 doc gate). The sample request and response that master plan §3.2 requires are owed as follows.

| Group | Endpoints | Written in | Before |
| --- | --- | --- | --- |
| Real-time and inbox | E-75…E-79 | DOC-52 (SSE), DOC-31 (inbox) | P2-00 |
| Resident fees and payment | E-80…E-88 | DOC-22, DOC-23, DOC-58 | P2-00 (E-80…E-84), P3-00 (E-85…E-88) |
| Staff fee batches, charges, debts, payments, money log | E-89…E-110 | DOC-21, DOC-22, DOC-66 | P2-00 |
| Statements, webhook | E-111…E-117 | DOC-25, DOC-24, DOC-52 | P3-00 |
| Tickets | E-118…E-132 | DOC-28 | P4-00 |
| Notices | E-143…E-149 | DOC-31 | P4-00 |
| Vehicles, QR, access, plates | E-133…E-142 | DOC-29, DOC-30 | P5-00 |
| Library | E-150…E-164 | DOC-32 | P5-00 |
| Dashboard, reports, exports | E-165…E-168 | DOC-33 | P6-00 |

| Sample owed (master plan §3.2) | Endpoint | Status |
| --- | --- | --- |
| Create intent | E-85 | owed (P3-00) |
| Manual payment | E-104 | owed (P2-00) |
| Publish | E-95 | owed (P2-00) |
| Recall | E-96 | owed (P2-00) |
| Void a single open charge | E-100 | owed (P2-00) |
| Step-up | E-38 (with E-50) | **written, §7** |
| OTP verify | E-10 | **written, §4** |
| Assign ticket | E-127 | owed (P4-00) |
| Scan QR | E-142 | owed (P5-00) |

An endpoint added after this document takes the next number after the last, whatever its group; a dropped endpoint is struck through with the reason and its number is not reused.

Endpoints this catalog adds to the list of DR-73 (DR-142):

| ID | Endpoint | Why |
| --- | --- | --- |
| E-04 | `POST /client-errors` | The apps' error reports (DR-127) |
| E-23, E-35 | `DELETE /me/devices/{id}`, `DELETE /staff/devices/{id}` | Device removal is by id (DR-146) |
| E-41 | `GET /staff/accounts/{id}` | The `ETag` for an edit with `If-Match` |
| E-73 | `GET /staff/imports/{id}` | Read the stored preview again |
| E-169 | `GET /staff/imports` | The import history of `W-Import` (DR-226, added after the catalog was numbered) |
| E-170 | `POST /staff/fee-batches/{id}/charges` | Add one unit's charge to a draft (DR-265) |
| E-171 | `DELETE /staff/charges/{id}` | Remove a draft charge (DR-265) |
| E-172 | `DELETE /staff/fee-batches/{id}` | Discard a draft batch (DR-265) |
| E-173 | `POST /usage-events` | The apps' record of screen views and taps, from closed lists and with no account stored (DR-279) |
| E-118 | `GET /me/ticket-types` | The resident form needs the types |
| E-132 | `PATCH /staff/ticket-types/{id}` | The id is in the path (DR-73 wrote the collection) |
| E-145 | `GET /staff/notices` | The Manager's list |
| E-159 | `GET /staff/docs/pages/{id}` | The editor loads one page |

## 12. Source of the authorization matrix

The column *Audience* of §2 is the source of the endpoint × role matrix of DOC-39 and of the generator of EXP-10 (DOC-99). The generator reads the `audience` metadata of the mounted `App`, not this table; test AG-02 (DOC-50 §17) fails when the two sets of `E-xx` differ. The sensitive routes (column *Step-up*) must also declare `stepUp`; the matrix test sends each of them without a valid proof and expects 0 unexpected 2xx (P1-15).

## 13. Decisions made while writing

Every new decision is a DR (decided, Claude delegated by the Owner) and is summarized here.

| ID | Decision | Where used |
| --- | --- | --- |
| DR-142 | The numbered catalog (E-01…E-168; E-169 added by DR-226), the `operationId` rule, the endpoints added to DR-73, the test prefixes of this batch (`AG-`, `FI-`, `FF-`, `FO-`, `FT-`, `FN-`, `FA-`) | §2 |
| DR-145 | Public endpoints: the public readiness route shows no dependency; the shape of `GET /public/config` and its keys | §3 |
| DR-146 | Resident account: `PATCH /me` rules (no `If-Match`, avatar needs `X-Unit-Id`), the device endpoints (E-22, E-23), a repeated verify of a verified upload is 200 | §5 |
| DR-147 | Staff accounts: a Manager reads the list, source states of every transition, `reassignTo` needs a reason, `PATCH /staff/me` is audited, a Manager asking for a step-up action gets `forbidden` | §7, §8 |
| DR-148 | Building administration: the storage breakdown, `PUT /staff/gateway` is addressed by `provider`, the connection check writes no audit row | §9 |
| DR-149 | Imports: one route dispatched by `kind` through an `ImportHandler`, the body carries `fileId`, over 5,000 rows is a 400 with no stored job, the `deletion=requested` filter of E-63 | §10 |
| DR-226 | `GET /staff/imports` (E-169): the import history of `W-Import`, Owner decision 2026-10-21; no new table | §10 |
| DR-143 and DR-144 are in [DOC-50](api-guidelines.md) §18. | | |

## 14. Traceability

| Section | Decisions | Use cases and requirements | Tests |
| --- | --- | --- | --- |
| §3 public and health | DR-74, DR-83, DR-127, DR-145 | UC-14; NFR-10 | AG-06, AG-07, AU-26, ER-43, ER-44 |
| §4 auth | DR-36…39, DR-128…135 | UC-14, UC-17, UC-26; FR-13, FR-15, FR-45 | AU-01…42 |
| §5 resident account | DR-59, DR-123, DR-125, DR-146 | UC-14, UC-26, UC-27; FR-39, FR-41, FR-45 | AU-31, AU-55, AD-32…40, FS-01…20 |
| §6 household | DR-40, DR-137, DR-139 | UC-15; FR-17 | RM-13…22 |
| §7, §8 staff | DR-39, DR-133, DR-147 | UC-17, UC-26; FR-14, FR-50 | AU-08…19, AU-43…50 |
| §9 building | DR-33, DR-111, DR-126, DR-148 | UC-17; FR-38, FR-40 | BD-01…46, FS-, AD-25…28 |
| §10 residency | DR-21, DR-22, DR-40, DR-41, DR-114, DR-136…141, DR-149, DR-226 | UC-13, UC-27, UC-28; FR-16…18 | RM-, IM-, DQ- |

## Open questions

- **Closed by DR-226 (Owner, 2026-10-21):** `GET /staff/imports` is built as E-169 for the `W-Import` history; it uses `import_job_building_idx` and adds no table.
- The shape of the plate search inside E-70 (`vehicles`) is DOC-30's; until then the array is empty.
- The final store URLs are an Owner input: a placeholder until the task that needs them (P6-10, DR-228). The `params` of a `fee_batch` import are DOC-21's.
