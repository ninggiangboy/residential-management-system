# Project documentation: Residential Management System

Original design document: [`../residential-management-sdd.md`](../residential-management-sdd.md) (the **original SDD**). Documents are written in English; see master plan §0.1.

## Start here

1. [00-master-plan.md](00-master-plan.md): the master plan. Documents to write with required content and gates, roadmap, tasks per phase, traceability.
2. [00-decision-register.md](00-decision-register.md): the decision register. 84 gaps and policies of the original SDD, each with one proposed decision; the Owner reviews them first.
3. `references/`: the inputs kept with the SDD (product proposal, design screen catalog, architecture reference).

Reading order for a newcomer: master plan §1 → §4 → the current phase in §5 → the documents that phase lists.

## Documents

The "Not written" rows have no file yet; paths are shown as code and become links when the document is written (`docs-project` skill).

| DOC | Document | Status |
| --- | --- | --- |
| DOC-01 | [Vision and scope](01-product/vision-and-scope.md) | Review |
| DOC-02 | [Personas and journeys](01-product/personas-and-journeys.md) | Review |
| DOC-03 | [Requirements](01-product/requirements.md) | Review |
| DOC-04 | [Use cases](01-product/use-cases.md) | Review |
| DOC-05 | [Feature catalog](01-product/feature-catalog.md) | Review |
| DOC-06 | [Glossary](02-glossary.md) | Review |
| DOC-07 | [System context and containers](03-architecture/system-context-and-containers.md) | Review |
| DOC-08 | Data flows (`03-architecture/data-flows.md`) | Not written |
| DOC-09 | Messaging contracts (`03-architecture/messaging-contracts.md`) | Not written |
| DOC-10 | Quality attributes (`03-architecture/quality-attributes.md`) | Not written |
| DOC-11 | [Tech stack and versions](03-architecture/tech-stack-and-versions.md) | Review |
| DOC-12 | Code architecture (`03-architecture/code-architecture.md`) | Not written |
| DOC-13 | ADR index (`04-adr/README.md`) | Not written |
| DOC-14 | Data conventions (`05-data/data-conventions.md`) | Not written |
| DOC-15 | Finance model (`05-data/finance-model.md`) | Not written |
| DOC-16 | Identity and residency model (`05-data/identity-and-residency-model.md`) | Not written |
| DOC-17 | Operations model (`05-data/operations-model.md`) | Not written |
| DOC-18 | Data quality rules (`05-data/data-quality-rules.md`) | Not written |
| DOC-19 | DB roles and grants (`05-data/db-roles-and-grants.md`) | Not written |
| DOC-20 | Data lifecycle (`05-data/data-lifecycle.md`) | Not written |
| DOC-21 | Fee batches and import (`06-design/fee-batches-and-import.md`) | Not written |
| DOC-22 | Ledger, allocation and the money log (`06-design/ledger-and-allocation.md`) | Not written |
| DOC-23 | Payment intents and settlement (`06-design/payment-intents-and-settlement.md`) | Not written |
| DOC-24 | payOS gateway adapter (`06-design/payos-gateway-adapter.md`) | Not written |
| DOC-25 | Bank-statement reconciliation (`06-design/bank-statement-reconciliation.md`) | Not written |
| DOC-26 | Identity and sessions (`06-design/identity-and-sessions.md`) | Not written |
| DOC-27 | Residency and memberships (`06-design/residency-and-memberships.md`) | Not written |
| DOC-28 | Tickets (`06-design/tickets.md`) | Not written |
| DOC-29 | Resident QR (`06-design/resident-qr.md`) | Not written |
| DOC-30 | Vehicles (`06-design/vehicles.md`) | Not written |
| DOC-31 | Notices and notifications (`06-design/notices-and-notifications.md`) | Not written |
| DOC-32 | Document library (`06-design/document-library.md`) | Not written |
| DOC-33 | Reports and exports (`06-design/reports-and-exports.md`) | Not written |
| DOC-34 | PDF rendering (`06-design/pdf-rendering.md`) | Not written |
| DOC-35 | Audit, privacy and terms (`06-design/audit-privacy-and-terms.md`) | Not written |
| DOC-36 | Building configuration and demo (`06-design/building-configuration-and-demo.md`) | Not written |
| DOC-37 | Files and uploads (`06-design/files-and-uploads.md`) | Not written |
| DOC-38 | Jobs and outbox runtime (`06-design/jobs-and-outbox-runtime.md`) | Not written |
| DOC-39 | Security (`06-design/security.md`) | Not written |
| DOC-40 | Observability (`06-design/observability.md`) | Not written |
| DOC-41 | Configuration reference (`06-design/configuration-reference.md`) | Not written |
| DOC-42 | Error handling (`06-design/error-handling.md`) | Not written |
| DOC-43 | Flows index (`06-design/flows/README.md`) | Not written |
| DOC-44 | Fees and payments (ledger level) (`06-design/flows/fees-and-payments.md`) | Not written |
| DOC-45 | Online payment (`06-design/flows/online-payment.md`) | Not written |
| DOC-46 | Identity and household (`06-design/flows/identity-and-household.md`) | Not written |
| DOC-47 | Tickets (`06-design/flows/tickets.md`) | Not written |
| DOC-48 | Notices, access, vehicles (`06-design/flows/notices-access-vehicles.md`) | Not written |
| DOC-49 | Admin, reports, library (`06-design/flows/admin-reports-library.md`) | Not written |
| DOC-50 | API guidelines (`07-api/api-guidelines.md`) | Not written |
| DOC-51 | API endpoints (`07-api/api-endpoints.md`) | Not written |
| DOC-52 | SSE and webhooks (`07-api/sse-and-webhooks.md`) | Not written |
| DOC-53 | UX principles and information architecture (`08-ux-ui/ux-principles-and-ia.md`) | Not written |
| DOC-54 | Design system (`08-ux-ui/design-system.md`) | Not written |
| DOC-55 | Client architecture (`08-ux-ui/client-architecture.md`) | Not written |
| DOC-56 | Screens index (`08-ux-ui/screens/README.md`) | Not written |
| DOC-57 | Resident: sign-in and home (`08-ux-ui/screens/resident-signin-home.md`) | Not written |
| DOC-58 | Resident: fees and payment (`08-ux-ui/screens/resident-fees-payment.md`) | Not written |
| DOC-59 | Resident: requests, unit, members, vehicles (`08-ux-ui/screens/resident-requests-unit.md`) | Not written |
| DOC-60 | Resident: QR, notices, account (`08-ux-ui/screens/resident-qr-notices-account.md`) | Not written |
| DOC-61 | Staff app: shared and Manager (`08-ux-ui/screens/staff-shared-and-manager.md`) | Not written |
| DOC-62 | Staff app: Technician (`08-ux-ui/screens/staff-technician.md`) | Not written |
| DOC-63 | Staff app: Guard (`08-ux-ui/screens/staff-guard.md`) | Not written |
| DOC-64 | Web: sign-in, dashboard, operations (`08-ux-ui/screens/web-auth-dashboard-operations.md`) | Not written |
| DOC-65 | Web: residents (`08-ux-ui/screens/web-residents.md`) | Not written |
| DOC-66 | Web: finance (`08-ux-ui/screens/web-finance.md`) | Not written |
| DOC-67 | Web: system (`08-ux-ui/screens/web-system.md`) | Not written |
| DOC-68 | UI states and copy (`08-ux-ui/ui-states-and-copy.md`) | Not written |
| DOC-69 | Local development (`09-operations/local-dev.md`) | Not written |
| DOC-70 | Deploy: staging and production (`09-operations/deploy-staging-and-production.md`) | Not written |
| DOC-71 | CI/CD (`09-operations/ci-cd.md`) | Not written |
| DOC-72 | Backup and restore (`09-operations/backup-restore.md`) | Not written |
| DOC-73 | Mobile release (`09-operations/mobile-release.md`) | Not written |
| DOC-74 | Runbook index (`09-operations/runbooks/README.md`) | Not written |
| DOC-75 | RB 01: ledger invariant (`09-operations/runbooks/RB-01-ledger-invariant.md`) | Not written |
| DOC-76 | RB 02: payments stuck (`09-operations/runbooks/RB-02-payments-stuck.md`) | Not written |
| DOC-77 | RB 03: webhook signatures (`09-operations/runbooks/RB-03-webhook-signatures.md`) | Not written |
| DOC-78 | RB 04: outbox lag (`09-operations/runbooks/RB-04-outbox-lag.md`) | Not written |
| DOC-79 | RB 05: dead letters (`09-operations/runbooks/RB-05-dead-letters.md`) | Not written |
| DOC-80 | RB 06: sms failures (`09-operations/runbooks/RB-06-sms-failures.md`) | Not written |
| DOC-81 | RB 07: backup missing (`09-operations/runbooks/RB-07-backup-missing.md`) | Not written |
| DOC-82 | RB 08: storage quota (`09-operations/runbooks/RB-08-storage-quota.md`) | Not written |
| DOC-83 | RB 09: api errors (`09-operations/runbooks/RB-09-api-errors.md`) | Not written |
| DOC-84 | RB 10: restore from backup (`09-operations/runbooks/RB-10-restore-from-backup.md`) | Not written |
| DOC-85 | RB 11: money to check (`09-operations/runbooks/RB-11-money-to-check.md`) | Not written |
| DOC-86 | RB 12: rotate secrets and keys (`09-operations/runbooks/RB-12-rotate-secrets-and-keys.md`) | Not written |
| DOC-87 | RB 13: payos outage or credential change (`09-operations/runbooks/RB-13-payos-outage-or-credential-change.md`) | Not written |
| DOC-88 | Test strategy (`10-testing/test-strategy.md`) | Not written |
| DOC-89 | Experiments: common protocol (`10-testing/experiments/README.md`) | Not written |
| DOC-90 | EXP 01: duplicate and late webhooks (`10-testing/experiments/EXP-01-duplicate-and-late-webhooks.md`) | Not written |
| DOC-91 | EXP 02: webhook vs requery (`10-testing/experiments/EXP-02-webhook-vs-requery.md`) | Not written |
| DOC-92 | EXP 03: online vs manual baseline (`10-testing/experiments/EXP-03-online-vs-manual-baseline.md`) | Not written |
| DOC-93 | EXP 04: recall vs payment (`10-testing/experiments/EXP-04-recall-vs-payment.md`) | Not written |
| DOC-94 | EXP 05: qr revocation (`10-testing/experiments/EXP-05-qr-revocation.md`) | Not written |
| DOC-95 | EXP 06: notice fan out (`10-testing/experiments/EXP-06-notice-fan-out.md`) | Not written |
| DOC-96 | EXP 07: api load (`10-testing/experiments/EXP-07-api-load.md`) | Not written |
| DOC-97 | EXP 08: bulk pdf (`10-testing/experiments/EXP-08-bulk-pdf.md`) | Not written |
| DOC-98 | EXP 09: otp abuse (`10-testing/experiments/EXP-09-otp-abuse.md`) | Not written |
| DOC-99 | EXP 10: authorization matrix (`10-testing/experiments/EXP-10-authorization-matrix.md`) | Not written |
| DOC-100 | EXP 11: ledger drift detection (`10-testing/experiments/EXP-11-ledger-drift-detection.md`) | Not written |
| DOC-101 | EXP 12: restore drill (`10-testing/experiments/EXP-12-restore-drill.md`) | Not written |
| DOC-102 | Demo script (`10-testing/demo-script.md`) | Not written |
| DOC-103 | Go-live checklist and UAT (`10-testing/go-live-checklist-and-uat.md`) | Not written |

## Structure

| Folder | Content |
| --- | --- |
| `references/` | Product proposal, design screen catalog, architecture reference (inputs, not written by the plan) |
| `01-product/` | Vision and scope, personas, requirements, use cases, feature catalog |
| `02-glossary.md` | Glossary (written first) |
| `03-architecture/` | Context and containers, data flows, messaging contracts, quality attributes, tech stack, code architecture |
| `04-adr/` | Architecture decision records `NNNN-*.md` and their index |
| `05-data/` | Data conventions, finance model, identity and residency model, operations model, quality rules, DB roles, lifecycle |
| `06-design/` | One design document per module or mechanism, cross-cutting documents, `flows/` with detailed flows |
| `07-api/` | API guidelines, endpoint catalog, SSE and webhooks |
| `08-ux-ui/` | UX principles, design system, client architecture, screens by area, states and copy |
| `09-operations/` | Local development, deploy, CI/CD, backup, mobile release, `runbooks/` |
| `10-testing/` | Test strategy, `experiments/` EXP-01…12, demo script, go-live checklist |

## Conventions

- The first lines of every file give its status (`Draft | Review | Approved | Superseded`) and update date.
- Diagrams are Mermaid.
- Identifiers follow master plan §0.2; a number once assigned is never reused.
- A behavior change edits the docs in the same PR. A decision change gets a new ADR that supersedes the old one.
- File and folder names are English kebab-case.
