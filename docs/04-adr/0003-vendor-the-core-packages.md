# ADR-0003: Copy the reference's infrastructure packages into the repository as `core-*` and sync them by hand

- Status: Accepted
- Date: 2026-10-19 · Applied: 2026-10-21 (P1-02) · Related: DR-02, DR-98, DR-04, DR-82, DOC-12 §13, DOC-11, ADR-0002, ADR-0004

## Context

The original SDD (§4, §23) says the repository uses `packages/kit-*` "from the reference kit". The reference packages are private workspace packages that are published to no registry, so `bun add @kit/messaging` cannot work. The SDD list is also incomplete: `kit-messaging` depends on `kit-context` and `kit-telemetry`, and on `kit-privacy-participant`, which this project skips (DR-03). Something has to decide how the code reaches this repository, how it is named and who owns it afterwards.

## Options considered

1. **Copy (vendor) the needed packages into this repository.** Pros: clones and CI work with no external access; the code is ours to fix; the closure is explicit. Cons: no automatic upstream updates.
2. **Link `../elysia-architecture` as a workspace outside the repository.** Pros: always current. Cons: breaks every fresh clone and CI run; couples builds to a sibling directory.
3. **Publish the reference packages to a private registry.** Pros: normal dependency management. Cons: a registry, tokens and a release process for a side project.

## Decision

Option **1** is chosen (Owner, 2026-10-19).

- Copy by dependency closure of the reference's messaging package: messaging, http, auth, db, runtime, storage, mail, i18n, testing, config, core, context, telemetry and the web-core package (SSE client and `authFetch`), plus the shared-types conventions. Not copied: the reference UI package and the privacy participant (DR-03).
- **Rename**: every reference `kit-x` becomes `core-x` with no exceptions; directory `packages/core-<name>`, scope `@core/*`. The mapping table lives in DOC-12 §13.1; upstream names appear only there and in the notes of `packages/CORE_VERSION`.
- `packages/CORE_VERSION` records the upstream commit SHA of the last sync, the packages `omitted`, and the `local-changes` list.
- The privacy-participant protocol is not vendored; the edit (in `core-runtime`, see Consequences) is listed in `local-changes` and re-applied at every sync (DR-98).
- Later upstream changes are merged **by hand** in a PR titled `chore(core): sync <sha>`, never automatically.
- Tool versions inside the copied packages are bumped to the DR-82 pins when they are vendored (P1-02).

## Consequences

**Positive**
- A clone builds with no access to the reference repository.
- A bug in a core package is fixed in the place where it is found.
- The scope `@core/*` is a clear boundary for the dependency rules (ADR-0004).

**Negative**
- The packages are now this project's code: upstream fixes arrive only when someone merges them.
- Every sync must re-apply the local changes, starting with DR-98; a missed one breaks the build or reintroduces a skipped dependency.
- Behaviors assumed from the copy were unverified until P1-02. Checked on 2026-10-21: `UnitOfWork.run` joined an open transaction in the reference; a nested transaction was **not** a savepoint (the reference `Database` had no `transaction` method) and there was no `autonomous`, so both are local changes (`Database.transaction`, `Database.autonomous`) with tests against PostgreSQL.
- DR-98 assumed that `kit-messaging` depended on the privacy participant. It does not: `kit-runtime` does, through `AppModule.privacy`. The edit is in `core-runtime`.

**Follow-up work**
- P1-02 (done 2026-10-21): the dependency closure was computed (14 packages), copied, renamed, `packages/CORE_VERSION` written, the two assumed behaviors checked, the gaps recorded as local changes. 132 unit tests of the copies pass in this repository with the dependencies at the DOC-11 versions.
- DOC-12 §13 keeps the sync rule and the mapping up to date.
