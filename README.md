# Residential Management System

A system for a property management company to run one apartment building in Vietnam. It covers units and residents, notices, support tickets, vehicles, resident QR codes, a document library, and fee batches with debt tracking and online payment by VietQR. The requirement above all others is that fee money is correct: no charge is ever settled twice, and no payment that reaches the bank goes unseen.

It has four clients of one API:

| App | Who uses it | Stack |
| --- | --- | --- |
| `apps/api` | Everyone, through the clients below; also the worker role | Bun, Elysia, Drizzle, PostgreSQL 18 |
| `apps/cms-web` | Admin and Manager (the building management board) | Vite, React 19, TanStack Router, Tailwind 4 |
| `apps/staff-app` | Manager, technicians and guards | Expo Router, NativeWind |
| `apps/resident-app` | Owners, family members, tenants and helpers | Expo Router, NativeWind |

## Status

The project is written docs-first. Phase 0 (Specification) is done; the work is now in **Phase 1, Foundation**, and the code is mostly scaffolding: tooling, CI, the vendored core packages, local infrastructure, design tokens, the i18n catalog and shared types. The business modules (`modules/`) are not written yet. Progress is tracked task by task (`P1-xx`) in the [master plan](docs/00-master-plan.md) §5.

## Documentation

- [`residential-management-sdd.md`](residential-management-sdd.md): the original system design (SDD).
- [`docs/00-master-plan.md`](docs/00-master-plan.md): every document, phase and task with its acceptance criteria.
- [`docs/00-decision-register.md`](docs/00-decision-register.md): the decisions (`DR-xx`).
- [`docs/README.md`](docs/README.md): the index of documents (`DOC-xx`) with their status.

Good places to start: [code architecture](docs/03-architecture/code-architecture.md) (DOC-12), [local development](docs/09-operations/local-dev.md) (DOC-69), [CI/CD](docs/09-operations/ci-cd.md) (DOC-71) and [tech stack and versions](docs/03-architecture/tech-stack-and-versions.md) (DOC-11).

## Getting started

Requirements (DOC-69 §2): macOS 14+ or Linux (Windows through WSL 2), Docker with Compose v2, Git 2.40+, and `asdf` or `mise` for the tools pinned in `.tool-versions` (Bun 1.4.3, Node 24.22.0).

```sh
mise install               # or: asdf plugin add bun && asdf plugin add nodejs && asdf install
bun run setup              # checks tools, installs packages, writes .env.local, starts the infrastructure
bun run dev:web            # web CMS on http://localhost:5173
```

`bun run setup` is idempotent; it reports the steps that later tasks add (migrations, seed) as skipped. Local infrastructure:

| Port | Service |
| --- | --- |
| 5432 | PostgreSQL 18.6 |
| 9000, 9001 | SeaweedFS: S3 API, file browser |
| 1025, 8025 | Mailpit: SMTP, web UI |

`bun run infra:down` stops it and keeps the data; `bun run infra:reset` **deletes** the local database and object store.

## Common commands

Run every command from the repository root.

```sh
bun run check              # every verify check: lint, typecheck, check:arch, knip, jscpd, i18n, …
bun run lint               # Biome; `bun run format` applies the fixes
bun run typecheck          # tsc in every workspace
bun run check:arch         # dependency-cruiser import rules
bun run test               # unit tests of every workspace (no database)
bun test <file> -t '<pattern>'   # one file or one test
```

The full list of targets, including those that later tasks will add, is in DOC-69 §5.

## Repository layout

```text
apps/       api (composition root), cms-web, resident-app, staff-app
modules/    business modules (@mod/*), one PostgreSQL schema each — not written yet
packages/   @core/* (vendored infrastructure) and @rms/* (shared-types, i18n-catalog, design-tokens)
docs/       the project documents
docker/     local compose stack and the API image
ops/        database provisioning
scripts/    setup, checks and CI helpers
tools/      Biome plugins, dependency-cruiser, architecture fixtures
```

Import boundaries between these scopes are enforced by dependency-cruiser; DOC-12 explains them.

## Contributing

- `dev` is the trunk. Work on short branches and squash-merge with `bun run pr:merge <n>`, which requires the `gate` check to be green.
- Commit subjects and PR titles follow `<type>(<scope>)?!?: <summary>`; `bun run check:commits` validates them.
- Change the docs in the same PR as the behavior, and cite the document or decision behind new code (`DOC-12 §6.2`, `DR-233`, `P1-04`).
- Dependency versions are exact and must be the latest stable release, recorded in DOC-11.
- Text that residents and staff see goes through the `vi`/`en` catalog in `packages/i18n-catalog`; colors come only from `@rms/design-tokens`.

See [`CLAUDE.md`](CLAUDE.md) for a denser summary of the rules reviewers enforce.
