# ADR-0002: One modular monolith on Bun, Elysia, Drizzle and PostgreSQL, built like the reference

- Status: Accepted
- Date: 2026-10-19 · Related: DR-01, DR-03, DR-05, DR-42, NFR-01, NFR-08, DOC-07 §5, DOC-11, DOC-12, ADR-0003, ADR-0014

## Context

The money invariant (`payment.amount = Σ live allocation.amount`, a charge is paid whole, DR-84) is only cheap to keep when the charge, the payment, the allocation and the receipt change in one local database transaction. The system is built and run by one person for one building (240 units) with a design scale of 5,000 units and 20 buildings (DOC-01). A reference repository already solves the hard cross-cutting parts on the chosen stack: outbox and inbox, refresh families, SSE over `LISTEN/NOTIFY`, `SKIP LOCKED` claiming (original SDD §4, DR-03). The decision is the shape of the deployable and where its boundaries lie.

## Options considered

1. **Modular monolith on the reference's stack and patterns.** One deployable API (image run as `api` and `worker`, DR-05), modules with their own PostgreSQL schema and public `contracts/`, a transactional outbox for every side effect. Pros: local transactions for money; one deploy and one VPS; the reference supplies tested building blocks. Cons: module boundaries are a convention until tooling enforces them (ADR-0004).
2. **Microservices (finance, identity, tickets… as separate services).** Pros: hard isolation. Cons: settlement would span services and need sagas; one person would run many deployables and a message broker; no scale need at 240 units.
3. **A monolith without module schemas or contracts.** Pros: least ceremony. Cons: cross-module table access, no building-scope boundary, and every later split becomes a rewrite.
4. **Design the architecture from scratch instead of following the reference.** Pros: no inherited choices. Cons: re-solves outbox, inbox, token rotation and realtime with no safety net, on a money-handling system.

## Decision

Option **1** is chosen.

- One modular monolith: Bun runtime, Elysia HTTP, Drizzle ORM, PostgreSQL, laid out as the reference. Versions are pinned in DOC-11 under the currency policy (DR-82); they are not repeated here.
- The module list (DR-03, details in DOC-07 §5.1): `identity`, `building`, `residency`, `finance`, `tickets`, `access`, `vehicles`, `notices`, `notification`, `wiki`, `audit`, `reporting`, `realtime`. `identity` and `notification` are forks of the reference modules, `realtime` is reused as is, and `reporting` is new (owns `export_job`, composes the dashboard through contracts). The reference modules `privacy`, `profile` and `billing` are skipped on purpose.
- Each module owns one schema and is reachable by other modules only through `contracts/` (sync interfaces and versioned events, DR-42); the rule is enforced by tooling (ADR-0004, ADR-0014).
- Compatibility of the whole stack (Elysia, Drizzle, PostgreSQL, Vite, Expo, Eden types in one Bun workspace) is verified in P1-01/P1-02 in the real repository. The fallback is the previous stable of one package, or Expo as a second workspace root (DR-01).

## Consequences

**Positive**
- Money moves in one transaction; every race has a single arbiter row in one database.
- One image, one deploy path, one place to read logs.
- The module boundary is the future seam if a module ever has to be extracted.

**Negative**
- Two forked modules (`identity`, `notification`) diverge from upstream by choice and are maintained here (ADR-0003).
- A single process and a single database are a single point of failure per environment (DR-83); recovery is a restore, not a failover.
- Boundary discipline depends on CI rules (dependency-cruiser, scope lint); a gap in the rules is a gap in the architecture.

**Follow-up work**
- P1-01/P1-02: toolchain compatibility table in DOC-11 §10.
- ADR-0003 (how the reference packages are consumed), ADR-0004 (layout and enforcement), ADR-0009 (outbox and contracts), ADR-0014 (schemas, counters, reporting).
