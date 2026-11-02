# ADR-0026: Run the demo as a flagged building in the same deployment, with a fake payment driver and a fixed OTP that only flagged accounts accept

- Status: Accepted (2026-11-02, DR-26 decided by the Owner) · The driver names and the simulator follow DR-326 for the first version: `stripe` and `fake`, `bun run pay:sim` (ADR-0029)
- Date: 2026-10-19 · Related: DR-26, DR-60, DR-37, DR-36, DR-25, DR-62, ADR-0007, ADR-0010, DOC-07, DOC-12

## Context

The demo building (original SDD §15) has to work in three places: app-store review needs a working login against the production backend, the demo script needs payments that can be replayed five times (original SDD §21), and local development and staging need to sign in and pay without SMS or a bank. A nightly reset that deletes rows by `building_id` is dangerous if it ever targets a real building, and a fixed OTP is a backdoor if it can reach a real account.

This ADR was `Proposed` until DR-26 (the fake driver's surface, the simulator CLI and the environments where `fake` may run) was decided; the Owner decided it on 2026-11-02. The rest rests on DR-60, DR-37 and DR-36: the demo building in staging and production, the `is_demo` flags, the fixed OTP, the boot guard and the guarded reset.

## Options considered

1. **A separate demo environment** (its own VPS, database and domain). Clean isolation, but store review needs the production API, and a second environment doubles hosting and operations for one person. Rejected.
2. **A demo mode switch on a real building.** No second building, but real and demo data share rows and every query needs a flag. Rejected: one mistake exposes real residents.
3. **A demo building in the same deployment, flagged, with guarded seed and reset.** The SDD's choice, made safe by flags and a boot guard. Chosen.
4. **A fixed OTP controlled by an environment variable.** Simple, but one misconfigured variable opens every account. Rejected; the flag is on the account (DR-37).
5. **Only the real gateway for the demo.** Needs a bank and a sandbox that may not exist (DR-25), and cannot replay a webhook five times. Rejected.

## Decision

Option **3**.

- **The building.** `building.building.is_demo = true` marks the demo building. It exists in staging and production (production needs it for store review) with its own staff and resident accounts. The seed is versioned (`scripts/seed-demo`) and shared with local development (DR-60).
- **The OTP.** The seeded resident accounts have `resident_account.is_demo = true`. The fixed code `123456` is accepted only for such an account; it sends no SMS. The API refuses to boot in production if a flagged account has a membership in a non-demo building (DR-37, DR-60, FR-15.6).
- **The payment driver.** `PaymentGateway` has two drivers chosen per gateway configuration: `payos` and `fake` (DR-26, ADR-0007). The fake driver stores links in a table, lets a test set a link `PAID`, `CANCELLED` or `EXPIRED`, and answers `getStatus`. `fake` is allowed only for a building with `is_demo = true`, in `local` and `staging`; production boot fails if a non-demo building has a `fake` configuration. The simulator `bun run payos:sim` signs payloads with the configured Checksum Key and posts them to the real webhook route (`--repeat`, `--shuffle`, `--delay`, `--wrong-signature`, `--amount`). Contract tests replay fixtures recorded in a payOS sandbox when one exists; otherwise the fake driver is the contract.
- **Mail and push.** No real mail from the demo building; push may reach real test devices.
- **The reset.** Every module exposes `resetDemo(buildingId)` that first asserts `building.is_demo`, then deletes in dependency order and reseeds. It runs at 04:00 local (DR-62) and can be run by the Admin of the demo building only. A CI test calls it on a non-demo building and expects a refusal.

## Consequences

**Positive**

- Store review, the demo and development all use the same seed and the same code paths as production, except at the flagged seams.
- Races can be replayed on demand: duplicates, late and out-of-order confirmations, wrong signatures.
- No bank, SMS or mail is needed to demonstrate or test a payment.

**Negative**

- Demo and real data share one database, backups and quota. A bug in a scope guard or in `resetDemo` touches real data; the safety is the `is_demo` assertion, the boot guard and their tests, not physical separation.
- The fixed OTP and the fake driver are code that must never be reachable in production for a real building; every release depends on the boot guard and CI tests staying green.
- If no payOS sandbox ever exists, the fake driver is the only automated contract for the gateway, and its fidelity to payOS is unverified until one real minimum-amount payment before go-live (P6-09).
- The production demo building is visible in counts, exports and alerts unless every report filters it.

**Follow-up work**

- DOC-36 (seed, reset guard, boot guard, `BD-` tests), DOC-24 (fake driver, simulator CLI), DOC-26 (OTP and the flag), DOC-102 (demo script and reset).
- ~~Decide DR-26, then move this ADR to `Accepted`~~ (done 2026-11-02). Record fixtures from the Stripe sandbox for the `stripe` adapter (P2-21), and from a payOS sandbox when that driver is built.
- Tests: the fixed OTP refused for a non-demo account, boot refused for a flagged account in a non-demo building, `resetDemo` refused on a real building.
