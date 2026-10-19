# ADR-0010: Keep staff and resident accounts apart and authorize a resident by the active membership on every request

- Status: Accepted
- Date: 2026-10-19 · Related: DR-36, DR-40, DR-48, DR-99, FR-14, FR-16, FR-17, NFR-06, NFR-08, EXP-10

## Context

Two very different people sign in. Staff (Admin, Manager, Technician, Guard) work in one building, sign in with email and password, and have a fixed role. Residents sign in with a phone and an SMS code, and what they may do depends on their relation to a unit: owner, family member, tenant (with or without `can_pay`) or helper. One phone can be owner of one unit and tenant of another, and later belong to two buildings (original SDD §7.1–§7.4). The owner can lock a helper, and the effect must be immediate: the helper's next request and next QR scan must fail.

## Options considered

1. **One account table with roles and unit lists.** One sign-in, one token — but it mixes two credential policies, and a staff endpoint could be reached with a resident credential by a bug in a role check.
2. **Permissions carried in the token** (unit ids, member types). No lookup per request — but a lock takes effect only when the token expires (15 minutes) and a token would need a building claim that is meaningless for an account spanning buildings.
3. **A cache of memberships.** Fast, with the same staleness and an invalidation to get right.
4. **Two account kinds, two tables, tokens with a `kind` claim; the membership read from the database on every resident request.**

## Decision

Option **4** is chosen.

- **Two tables and two token kinds.** `identity.staff_account` and `identity.resident_account` are separate; a staff member who is also a resident has two accounts, one per app, and the same email or phone may exist in both (DR-36). A resident token is rejected by every staff endpoint and the reverse, independently of any role check (FR-16.4).
- **Membership per request.** The resident app sends `X-Unit-Id`. The request guard loads the membership by primary key `(account_id, unit_id)` through `ResidencyApi.getMembership` and builds `UnitContext { buildingId, unitId, membershipId, memberType, canPay }`. A missing, locked or removed membership answers 403 `membership_inactive` and the app returns to unit selection. Tokens carry no unit permission and a resident token no building (ADR-0011).
- **One policy function.** Use cases receive the context and ask a single function for the capability table (owner, family, tenant, helper × capability); the table is written once (DOC-27, [DOC-12](../03-architecture/code-architecture.md) §11). The guards are built in the composition root and injected into modules (DR-99).
- **Staff.** Role and account status are re-read from the database on each staff request; every staff query is scoped to the token's `bid`.
- **Membership rules that make it work** (DR-40): exactly one active owner per unit and one membership per account and unit (unique indexes); no limit on members or helpers; a membership locked by the Manager is unlocked only by the Manager; any change of status, member type or ownership increments `credential_version` in the same transaction, which is how the QR scan (ADR-0012) revokes without a cross-module transaction.
- **History follows the membership.** Open charges always show; paid history and receipts only from `membership.created_at`; Manager and Admin see all.

## Consequences

**Positive**

- A lock, a removal or a type change is effective on the very next request, with no token to wait out and no cache to invalidate.
- The isolation claim (NFR-08) is testable as a matrix: endpoint × role and member type × own and foreign unit.

**Negative**

- One primary-key lookup on every resident request (planned well under 1 ms). A request already in flight when the owner locks the member still completes.
- Two accounts for a staff member who is also a resident; no single sign-in.
- Staff `building_id` is single-valued in phase 1; staff in several buildings later needs a membership table for staff.
- Policy errors are logic errors, not configuration: the capability table needs an exhaustive table test and EXP-10.

**Follow-up work**

- Write DOC-26 (identity and sessions), DOC-27 (residency, policy table, `RM-` tests) and EXP-10 (authorization matrix generated from route `audience` metadata).
- Containers and ownership: [DOC-07](../03-architecture/system-context-and-containers.md); requirements: [DOC-03](../01-product/requirements.md) FR-16, FR-17.
