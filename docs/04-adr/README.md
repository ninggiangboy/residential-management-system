# ADR index

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-28 (ADR-0028, DR-279) · DOC-13
> Depends on: [DR](../00-decision-register.md), [master plan](../00-master-plan.md) §3.2, [ADR-0001](0001-record-architecture-decisions.md)
> Main readers: every task `Pn-00` (doc gate), reviewers of pull requests that touch an architecture decision

This index lists the 28 architecture decision records of the project. An ADR is written for a decision that is hard to reverse and touches many modules; every other decision stays in the decision register. Detail lives in the design documents; an ADR gives the reason and the rejected options (ADR-0001).

## 1. How to read this index

| Column | Meaning |
| --- | --- |
| ADR | The record. Unwritten ones have no link yet |
| Title | The decision, as the ADR states it (unwritten: the subject from master plan §3.2) |
| Status | `Proposed`, `Accepted`, `Superseded by ADR-yyyy`, or `Not written` |
| Gate | The phase that needs the ADR `Accepted` before it starts |
| Source | The decision register entries (`DR-xx`) and original SDD sections it records |

## 2. The 28 ADRs

| ADR | Title | Status | Gate | Source |
| --- | --- | --- | --- | --- |
| [ADR-0001](0001-record-architecture-decisions.md) | Record architecture decisions as short ADRs sourced from the decision register | Accepted | P1 | Convention |
| [ADR-0002](0002-modular-monolith.md) | One modular monolith on Bun, Elysia, Drizzle and PostgreSQL, built like the reference | Accepted | P1 | original SDD §4, DR-01, DR-03 |
| [ADR-0003](0003-vendor-the-core-packages.md) | Copy the reference's infrastructure packages into the repository as `core-*` and sync them by hand | Accepted | P1 | DR-02 |
| [ADR-0004](0004-repository-layout-scopes-and-boundaries.md) | One Bun workspace with four package scopes, with module boundaries enforced by dependency-cruiser and a building-scope lint | Accepted | P1 | DR-04, DR-12 |
| [ADR-0005](0005-ledger-charges-and-allocations-paid-in-full.md) | Ledger of charges and append-only allocations, paid in full only, with a money log for everything else | Accepted | P2 | original SDD §5.9, DR-13, DR-84 |
| [ADR-0006](0006-allocation-write-path-all-or-nothing.md) | One conditional update per charge decides every payment race, all or nothing | Accepted | P2 | DR-14, DR-84 |
| [ADR-0007](0007-payment-gateway-port-and-payment-link.md) | Take online payments through a gateway port with one payOS payment link per intent | Proposed | P3 | original SDD §6.6, DR-25, DR-26 |
| [ADR-0008](0008-settlement-idempotency.md) | Settle each confirmation once through `gateway_event`, then the intent claim; failed calls go to a rejection log | Accepted | P2 | DR-29, DR-32 |
| [ADR-0009](0009-transactional-outbox-inbox-and-contracts.md) | Deliver events through a per-module transactional outbox and inbox; modules talk through contracts only | Accepted | P1 | DR-42, DR-62 |
| [ADR-0010](0010-two-account-kinds-membership-scoped-authorization.md) | Keep staff and resident accounts apart and authorize a resident by the active membership on every request | Accepted | P1 | original SDD §7, DR-36 |
| [ADR-0011](0011-tokens-refresh-families-and-cookies.md) | Sign short-lived ES256 access tokens, rotate refresh families with reuse detection, and keep the web refresh token in a SameSite=Strict cookie | Accepted | P1 | DR-38 |
| ADR-0012 | Resident QR: signed token + nonce + membership credential version (option B) | Not written | P5 | original SDD §9.2, DR-48 |
| [ADR-0013](0013-time-zones-and-calendar-day-semantics.md) | Store everything in UTC and compute every business day in the building's time zone | Accepted | P1 | DR-09 |
| [ADR-0014](0014-schema-per-module-no-cross-module-foreign-keys.md) | Give each module its own schema, with no cross-module foreign keys, per-module counters and reports composed through contracts | Accepted | P1 | DR-03, DR-10, DR-42, DR-55 |
| [ADR-0015](0015-jobs-and-worker-topology.md) | Run jobs in a separate worker role with in-process timers and transaction-level advisory locks | Accepted | P1 | DR-62 |
| [ADR-0016](0016-files-on-r2-presigned-put.md) | Store files on R2, upload with a presigned PUT, verify with `HEAD` and a magic-byte check, and track every object in `file_object` under a per-building quota | Superseded in part by ADR-0027 (kept as the global reference) | P1 | DR-61, DR-83 |
| [ADR-0017](0017-backup-with-point-in-time-recovery.md) | Back up PostgreSQL with pgBackRest to R2 for point-in-time recovery, on a self-hosted database, and accept the single-provider risk | Superseded in part by ADR-0027 (kept as the global reference) | P1 | DR-66, DR-67, DR-83 |
| [ADR-0018](0018-audit-in-the-mutation-transaction.md) | Write the audit row in the same transaction as the mutation, append-only for the runtime role | Accepted | P1 | DR-57 |
| [ADR-0019](0019-mobile-and-web-client-stacks.md) | Build the web CMS and the two Expo apps on one React and Tailwind token set, with the latest stable stack and the New Architecture only | Accepted | P1 | DR-70 |
| [ADR-0020](0020-deployment-topology.md) | Deploy behind Cloudflare to one VPS per environment, with the API and worker in Docker and PostgreSQL installed natively | Superseded in part by ADR-0027 (kept as the global reference) | P1 | DR-05, DR-06, DR-07, DR-83 |
| [ADR-0021](0021-observability-stack-and-alert-delivery.md) | Observe each host with Prometheus, Alertmanager, Grafana and Loki, without traces, and send alerts by email and Telegram | Accepted | P1 | DR-63 |
| [ADR-0022](0022-personal-data-protection.md) | Classify personal data, protect it by field, keep push payloads generic and send no error data to a third-party tracker | Accepted | P1 | DR-52, DR-58 |
| [ADR-0023](0023-api-conventions.md) | Keep the design's error shape, store idempotency keys in PostgreSQL for every create, and page with opaque cursors | Accepted | P1 | DR-74 |
| ADR-0024 | Real-time for the web CMS with the reference `realtime` module | Not written | P2 | DR-75 |
| ADR-0025 | Notice fan-out, heartbeat reclaim and single-source read state; allowed rich-text subset | Not written | P4 | DR-50, DR-51 |
| [ADR-0026](0026-demo-building-and-fake-payment-driver.md) | Run the demo as a flagged building in the same deployment, with a fake payment driver and a fixed OTP that only flagged accounts accept | Proposed | P1 | DR-26, DR-60 |
| [ADR-0027](0027-seaweedfs-on-the-vps-for-files-and-backups-in-vietnam.md) | In Vietnam, keep files and backups in SeaweedFS on the VPS instead of Cloudflare R2, and keep the Cloudflare domain, HTTPS and Tunnel | Accepted | P1 | DR-268 |
| [ADR-0028](0028-self-hosted-usage-analytics-without-an-identifier.md) | Record screen views, taps, opening and closing of the app as allowlisted events without an account or device identifier, in an `analytics` schema on the same PostgreSQL, and read them through a counter | Accepted | P1 | DR-279 |

## 3. Rules

- A number is never reused. A changed decision gets a new DR and a new ADR; the old ADR is marked `Superseded by ADR-yyyy` and never edited in substance (ADR-0001).
- Writing or superseding an ADR updates this table and the ADR table of the master plan in the same change.
- An ADR whose source DR is still open stays `Proposed`: ADR-0007 waits for the gateway sandbox (DR-25, 26, 27, 28, 30, 31).

## 4. Order of writing

| Task | ADRs |
| --- | --- |
| P0-22 | ADR-0001…0011 and this index |
| P0-23 (done) | ADR-0013…0023 and ADR-0026 |
| 2026-10-28 | ADR-0028 (with DR-279) |
| Before P2 / P4 / P5 | ADR-0024 (P2); ADR-0025 (P4); ADR-0012 (P5) |

## Open questions

None.
