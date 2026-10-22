# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A residential (apartment building) management system: an Elysia API, a web CMS for staff, and two Expo apps (resident and staff). It is a Bun monorepo written docs-first. The code is still mostly scaffolding (Phase 1, "Foundation"). The design lives in `docs/`, and the work is planned task by task.

- `residential-management-sdd.md` is the **original SDD**. `docs/00-master-plan.md` lists every document, phase and task (`Pn-xx`) with its acceptance criteria. `docs/00-decision-register.md` holds the decisions (`DR-xx`). `docs/README.md` is the index of documents with their status.
- Code comments, scripts and CI cite these IDs (`DOC-12 §6.2`, `DR-233`, `P1-04`). Keep doing that: when you add behavior, cite the document or decision behind it, and look up an ID in its document before you rely on it.
- The `docs-system-design`, `docs-master-plan` and `docs-project` skills maintain these documents. Use `docs-project` to write or review a `DOC-xx`.
- Everything is in English: docs, code, commits, logs and API errors. Text that residents and staff see goes through the `vi`/`en` catalog (`packages/i18n-catalog`), never into a literal string.

## Commands

The toolchain is pinned in `.tool-versions` (bun 1.4.3, node 24.22.0). Run every command from the repository root.

```sh
bun run setup              # fresh clone → running local stack (tools, install, keys, infra; later migrate, seed)
bun run keys:generate      # writes .env.local (throw-away local passwords); idempotent
bun run infra:up           # docker compose: postgres 18.6 :5432, SeaweedFS S3 :9000, Mailpit :1025/:8025
bun run infra:down | infra:reset   # reset DELETES the local database and object store

bun run check              # every `verify` check in one go (lint, typecheck, check:arch, fixtures, knip, jscpd, scope, audit, i18n, dependabot, test-ids)
bun run lint               # Biome; `bun run format` applies the fixes
bun run typecheck          # tsc in every workspace + scripts/
bun run check:arch         # dependency-cruiser, three configs (apps, modules, packages)
bun run check:scope        # every query on a table with building_id carries the scope (AST, TypeScript 6 of tools/depcruise)
bun run check:audit        # every audit action written in code is declared in its manifest and listed in DOC-35 §4
bun run check:layout       # module layout (DR-254): one command per file with one `execute`, reads in query services, one handler per file, repository interfaces in domain/
bun run test               # unit tests of every workspace (bun test, no database)
bun run test:coverage      # the same with lcov (CI `unit` job)
bun run dev:web            # Vite for apps/cms-web on :5173
bun run --filter @app/api dev      # API on :3000 (skeleton until P1-04)
bun run tokens:build       # regenerate packages/design-tokens/generated/ from tokens.json
```

Running tests:

- One file: `bun test packages/core-i18n/src/merge.test.ts`. One test by name: add `-t '<pattern>'`. One workspace: `bun run --filter @core/i18n test`.
- The `@core/db` tests skip themselves unless `TEST_ADMIN_DATABASE_URL=postgres://postgres:$RMS_POSTGRES_PASSWORD@localhost:$RMS_PG_PORT/postgres` is set and the stack is up.
- The design-tokens font test (DS-05) calls `uv run --with fontTools`, so it needs `uv` installed.
- Integration tests (`bun run test:integration`, `bun run test:grants`) need the stack and `.env.local`; each file clones a migrated template database. The files tests of `@mod/building` use SeaweedFS when `S3_ENDPOINT` answers and an in-memory store otherwise; `bun --env-file=.env.local test tools/compat/uploads.test.ts` runs the upload checks (U1…U11) against the store that `S3_*` names.
- `bun run check:arch:fixtures` tests the cruiser rules against the deliberately broken trees in `tools/arch-fixtures/cases/`.

Several targets named in the docs (`dev`, `seed:demo`, `test:authz`, `test:e2e`, `check:openapi`…) do not exist yet. DOC-69 §5 lists each one with the task that creates it. `scripts/check.ts`, `scripts/setup.ts` and `scripts/run-if-defined.ts` report a missing target as skipped and name that task. To add a target, define it in the root `package.json` and leave those scripts alone; they pick it up without an edit (DR-233).

## Architecture

There are Bun workspaces `apps/*`, `modules/*` and `packages/*`, and the linker is hoisted so that Metro and Vite can see the workspace packages. There is no build step for libraries: each package's `exports` points straight at `src/*.ts` through the `bun` condition. DOC-12 (`docs/03-architecture/code-architecture.md`) describes the full design. Its main rules follow.

**Scopes and import rules.** dependency-cruiser enforces them (`.dependency-cruiser.*.cjs`):

- `@app/api` (`apps/api`) is the composition root: it holds the HTTP server and the worker role. It imports modules only through their exports map (`.`, `./contracts`, `./config`, `./manifest`, `./schema`, `./integrations/<consumer>`) and never imports a driver directly. Only `main.ts` and `app.ts` may import the container.
- `@app/cms-web` (Vite, React 19, TanStack Router, Tailwind 4), `@app/resident-app` and `@app/staff-app` (Expo Router, NativeWind on Tailwind 3) are the clients. They import `@app/api` **only as `import type { App }`** for the Eden treaty client, and never import server code (`modules/*` or the server-side `@core/*`).
- `@mod/<name>` (`modules/`: `audit` and `building` so far) is a business module that owns one PostgreSQL schema. Modules talk to each other **only through `./contracts`**. Inside a module the layers are `domain` → `application` → `infrastructure`/`presentation`:
  - `domain` is pure. It imports only `@core/kernel` and `@rms/shared-types`; no `new Date()` and no I/O. Time comes from the `Clock` port and ids from `IdGenerator`.
  - `application` holds the use cases and ports. It must not touch Elysia, Drizzle or `process.env`.
  - `presentation` holds Elysia routes. A route handler is about three lines and receives use cases, never repositories.
  - The layout to follow is the module template in DOC-12 §4 and its rules in §4.5 (DR-254): `application/use-cases/<verb>-<noun>.ts` for commands only, with one class and one `execute`; reads are methods of a few query services in `queries/<name>-queries.ts` (no `get-`/`list-`/`view-` use case files); one handler per file in `handlers/`; `queries/<name>-api-impl.ts` for the contract; repository interfaces and aggregates in `domain/`, `<name>.module.ts` apart from `install.ts`. No `*Service` class. `bun run check:layout` enforces it.
- `@core/*` (`packages/core-*`) is infrastructure vendored from an upstream reference repository (`packages/CORE_VERSION`). It is this project's code now: fix bugs here, in a normal PR. Any change that is not a rename gets a line under `local-changes` in `CORE_VERSION`. A package may import only the other packages listed for it in the `ALLOWED` map of `.dependency-cruiser.packages.cjs`.
- `@rms/*` holds project packages shared with the clients. `@rms/shared-types` is a leaf with no dependencies (ids, statuses, error codes, `Money`, time helpers). The other packages are `@rms/i18n-catalog` and `@rms/design-tokens`. `client-core`, `mobile-core`, `ui-native` and `pdf-assets` are planned and not created yet.

**Backend rules that reviewers enforce** (DOC-12 §14 and master plan §7.2):

- Every business query carries a `BuildingScope`, taken from the token, membership or event and never from the request body.
- A state change that two actors can race is a single conditional `UPDATE … WHERE <expected state> RETURNING`; zero rows becomes a typed 409. Every new conditional update gets a barrier race test, and every money or notification mutation gets a run-twice idempotency test.
- The change, its outbox events and its audit row commit in one transaction, with no network call inside it; side effects go through the outbox (`@core/messaging`).
- Use `Money` for amounts, and `LocalDate` with the building's "today" for days.
- Behavior is selected by `APP_ENV`, never `NODE_ENV`.
- Migrations (drizzle-kit, one folder per module) are never edited after merge, and they stay backward compatible for one release.

**Design tokens.** Colors come only from `@rms/design-tokens`. A Biome GritQL plugin (`tools/biome/no-color-literal.grit`) rejects color literals everywhere except inside that package. The files in `packages/design-tokens/generated/` are generated and committed, and a test fails when they are stale.

**Dependencies.** Versions are exact (no `^`). `bunfig.toml` sets `minimumReleaseAge` to 7 days. A new dependency or version must be the latest stable, checked on the web, and recorded in DOC-11. dependency-cruiser runs from `tools/depcruise`, which has its own lockfile because it needs TypeScript 6; the product uses TypeScript 7.

## Workflow and CI

- `dev` is the trunk. Use short branches and rebase (fast-forward-style) merges, never squash, done with `bun run pr:merge <n>`. This script stands in for branch protection: it refuses to merge unless the required check `gate` is green on the PR's head and the branch is up to date.
- Commit subjects and PR titles must match `<type>(<scope>)?!?: <summary ≤100 chars>`, and `bun run check:commits` validates them. The scope is a module name or one of `api`, `web`, `resident-app`, `staff-app`, `core`, `db`, `runtime`, `shared`, `ops`, `docs`, `deps` (the list is in `scripts/check-commits.ts`).
- CI (`.github/workflows/ci.yml`) runs these jobs: `verify` (`bun run check`, `check:commits`), `unit`, `integration` (Postgres service, provisioned by `db:provision-ci`), `security` (Trivy, Semgrep with `.semgrep/rules.yml`, Gitleaks), `build` (the `docker/Dockerfile.api` image, Trivy, a boot smoke test on `/api/v1/health/live`), and `e2e-web`. `gate` aggregates all of them except `e2e-web`.
- The PR template's checklist expects docs to change in the same PR as the behavior. A new config key goes in DOC-41, a metric in DOC-40, an error code in DOC-42 with its copy in DOC-68, and a test prefix in DOC-88. A decision that changes an Approved document needs a DR.
