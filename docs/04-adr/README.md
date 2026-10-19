# ADR index

> Status: **Review** · Updated: 2026-10-19 · DOC-13
> Depends on: [DR](../00-decision-register.md), [master plan](../00-master-plan.md) §3.2, [ADR-0001](0001-record-architecture-decisions.md)
> Main readers: every task `Pn-00` (doc gate), reviewers of pull requests that touch an architecture decision

This index lists the 26 architecture decision records of the project. An ADR is written for a decision that is hard to reverse and touches many modules; every other decision stays in the decision register. Detail lives in the design documents; an ADR gives the reason and the rejected options (ADR-0001).

## 1. How to read this index

| Column | Meaning |
| --- | --- |
| ADR | The record. Unwritten ones have no link yet |
| Title | The decision, as the ADR states it (unwritten: the subject from master plan §3.2) |
| Status | `Proposed`, `Accepted`, `Superseded by ADR-yyyy`, or `Not written` |
| Gate | The phase that needs the ADR `Accepted` before it starts |
| Source | The decision register entries (`DR-xx`) and original SDD sections it records |

## 2. The 26 ADRs

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
| ADR-0013 | Time zones and calendar-day semantics | Not written | P1 | DR-09 |
| ADR-0014 | Schema per module, no cross-module foreign keys, per-module counters, reporting through contracts | Not written | P1 | DR-03, DR-10, DR-42, DR-55 |
| ADR-0015 | Jobs and worker topology; transaction-level advisory locks | Not written | P1 | DR-62 |
| ADR-0016 | Files on R2: presigned PUT (R2 has no POST), `HEAD` verification, `file_object`, quota | Not written | P1 | DR-61, DR-83 |
| ADR-0017 | Backup with point-in-time recovery (pgBackRest to R2); self-hosted PostgreSQL | Not written | P1 | DR-66, DR-67, DR-83 |
| ADR-0018 | Audit written in the mutation's transaction | Not written | P1 | DR-57 |
| ADR-0019 | Mobile and web client stacks; shared tokens | Not written | P1 | DR-70 |
| ADR-0020 | Deployment topology: Cloudflare (Pages, Edge, Tunnel, R2) + VPS (Caddy, Elysia api/worker, native PostgreSQL); hosts, proxy trust | Not written | P1 | DR-05, DR-06, DR-07, DR-83 |
| ADR-0021 | Observability stack and alert delivery | Not written | P1 | DR-63 |
| ADR-0022 | Personal data protection; push payload privacy; no third-party error tracker | Not written | P1 | DR-52, DR-58 |
| ADR-0023 | API conventions: error shape, idempotency store, cursors | Not written | P1 | DR-74 |
| ADR-0024 | Real-time for the web CMS with the reference `realtime` module | Not written | P2 | DR-75 |
| ADR-0025 | Notice fan-out, heartbeat reclaim and single-source read state; allowed rich-text subset | Not written | P4 | DR-50, DR-51 |
| ADR-0026 | Demo building and fake payment driver | Not written | P1 | DR-26, DR-60 |

## 3. Rules

- A number is never reused. A changed decision gets a new DR and a new ADR; the old ADR is marked `Superseded by ADR-yyyy` and never edited in substance (ADR-0001).
- Writing or superseding an ADR updates this table and the ADR table of the master plan in the same change.
- An ADR whose source DR is still open stays `Proposed`: ADR-0007 waits for the gateway sandbox (DR-25, 26, 27, 28, 30, 31).

## 4. Order of writing

| Task | ADRs |
| --- | --- |
| P0-22 | ADR-0001…0011 and this index |
| P0-23 | ADR-0013…0023 and ADR-0026 |
| Before P2 / P4 / P5 | ADR-0024 (P2); ADR-0025 (P4); ADR-0012 (P5) |

## Open questions

None.
