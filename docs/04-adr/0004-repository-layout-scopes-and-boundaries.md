# ADR-0004: One Bun workspace with four package scopes, with module boundaries enforced by dependency-cruiser and a building-scope lint

- Status: Accepted
- Date: 2026-10-19 · Related: DR-04, DR-12, DR-99, DR-100, DR-02, DR-42, NFR-08, DOC-12 §2, §5–§7, ADR-0002, ADR-0003, ADR-0014

## Context

ADR-0002 promises that modules talk only through `contracts/` and that every query on a business table carries the building. Original SDD §23 draws a tree but gives no workspace globs, scopes, per-module layout, root tooling or rule for how the web and mobile apps import API types. The SDD also says every row carries `building_id` and "a lint rule" checks it, yet its own DDL gives `allocation` no `building_id`, and it does not say how soft or hard deletion works (DR-12). A rule that is not checked fails silently when one person is moving fast.

## Options considered

1. **Bun workspaces `apps/*`, `modules/*`, `packages/*` with four scopes and CI-enforced rules.** Pros: boundaries are machine-checked on every PR; same shape as the reference. Cons: three rule files and one custom lint to maintain.
2. **A single `src/` tree with folders per module.** Pros: least setup. Cons: nothing stops a deep import; the boundary is a convention only.
3. **Publish each module as its own versioned package (with changesets).** Pros: strict contracts. Cons: release overhead for a private application with one consumer.
4. **Convention and code review only.** Pros: no tooling. Cons: unreviewed at 2 a.m.; the building scope is the isolation guarantee of NFR-08.

## Decision

Option **1** is chosen.

- **Layout** (DOC-12 §2.1): Bun workspaces `apps/*`, `modules/*`, `packages/*`; no changesets. Module layout `src/{presentation,application,domain,infrastructure,contracts}`.
- **Scopes**: `@core/*` vendored infrastructure (ADR-0003), `@mod/<module>` business modules (entry points `contracts`, `manifest`, `integrations/<consumer>`), `@rms/*` project-owned shared packages (`shared-types`, `i18n-catalog`, `design-tokens`, `ui-native`, `mobile-core`, `pdf-assets`), `@app/*` apps.
- **Enforcement**: three dependency-cruiser configs (`.dependency-cruiser.{apps,modules,packages}.cjs`), plus Biome, knip and jscpd at the root. Rule snippets are in DOC-12 §6. Clients import the API type with `import type { App } from '@app/api'` only; a CI check fails on a value import (DR-04).
- **Building scope** (DR-12): every business table has `building_id uuid NOT NULL` (including `allocation`, `charge_line`, `payment_intent_item`, `receipt`, `ticket_message`…), `created_at`, `updated_at` where rows change and an integer `version` on aggregates edited by several actors. Deletion: units and ledger rows are never deleted; drafts are hard-deleted; everything else changes `status`. The scope guard is a Biome GritQL rule if it can express "a query on a scoped table without a `building_id` predicate or `BuildingScope` argument", otherwise an AST script (decided in P1-01). Tables global by nature are on an explicit allow-list (DOC-12 §7.3).
- **Guards** are built in the composition root and injected as `host.guards`; every route declares an `audience` as route metadata, and a route without one fails the build (DR-99).
- **Shared primitives**: `Money`, `QtyMilli`, `LocalDate`, `buildingToday` and the branded ids live in `@rms/shared-types`, a leaf with no workspace dependency (DR-100).

## Consequences

**Positive**
- A forbidden import or an unscoped query fails the PR, not production.
- The authorization-matrix generator (EXP-10) reads the `audience` metadata, so the matrix cannot drift from the routes.
- Clients cannot pull server code into a bundle.

**Negative**
- Four extra columns across the finance DDL compared with SDD §16.1; every composite index starts with `building_id`.
- The scope lint may need a custom AST script; until P1-01 decides, the cost is unknown.
- Rule configs are code that can be wrong; a loose rule gives false confidence.

**Follow-up work**
- P1-01: choose GritQL or the AST script for the scope lint; verify the three configs against the pinned tool versions (DOC-11).
- DOC-14: the allow-list and the schema list; DOC-39: the matrix from `audience`.
