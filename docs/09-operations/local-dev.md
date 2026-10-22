# Local development

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-22 (DR-246: the Git hooks in §4; P1-19: the CI targets of §5, DR-240; P1-09: `uv` for DS-05, `tokens:build`, `check:i18n`, `dev:web`, `build`; DR-237; P1-03: the local infrastructure exists and the dry run is recorded in §14; DR-231, DR-233; earlier: DR-227: the dry run is the acceptance of P1-03; P0-31) · DOC-69
> Depends on: original SDD §4.3, §23, [DR](../00-decision-register.md) (DR-01, 04, 26, 36, 37, 60, 65, 68, 69, 77, 82, 94, 95, DR-157, DR-227), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §4.2, [DOC-11](../03-architecture/tech-stack-and-versions.md) §1, §6.4, §10, [DOC-12](../03-architecture/code-architecture.md) §2.1, [DOC-19](../05-data/db-roles-and-grants.md) §3, [DOC-26](../06-design/identity-and-sessions.md) §5.5, [DOC-36](../06-design/building-configuration-and-demo.md) §9, [DOC-41](../06-design/configuration-reference.md) §3, §6, §16
> Main readers: P1-01, P1-03, P1-04, P1-09, P1-12, P1-17; every developer on a new machine; [DOC-71](ci-cd.md) (the same commands run in CI)

This document takes a developer from an empty machine to the whole stack running: tools, the `bun run` targets, ports, the demo accounts and the fixed OTP, how to reset, and the problems a Bun + Expo workspace is known to cause. It does not hold the deployed environments (DOC-70), the pipeline (DOC-71), the Expo build profiles (DOC-73), the meaning of a configuration key (DOC-41) or the test method (DOC-88).

**State of this document.** The scripts below are written task by task: P1-01 (tooling), P1-03 (local infrastructure, done 2026-10-21), P1-04 (API), P1-06 (database). What exists today is the first four steps of `bun run setup`, `infra:*`, `keys:generate` (the infrastructure keys) and `check:tools`; everything marked P1-04 or later has not been written, and its command states the output **that task must produce**. The dry run of DR-227 (the acceptance of P1-03) is recorded in §14: it covers steps 1 to 4 of §4, because steps 5 and 6 do not exist yet.

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| Machine requirements | §2 |
| Tool setup (`.tool-versions`) | §3 |
| First run, step by step | §4 |
| `bun run` targets | §5 |
| What `infra:up` starts | §6 |
| Port table | §7 |
| Environment files and secrets | §8 |
| Demo accounts, fixed OTP, the simulators | §9 |
| Mobile development | §10 |
| Reset | §11 |
| Common problems (Bun, Expo, Docker) | §12 |
| Checks of this document | §13 |

## 2. Machine requirements

| Item | Requirement | Why |
| --- | --- | --- |
| Operating system | macOS 14 or later, or Linux (Ubuntu 24.04 or 26.04). Windows through WSL 2 with the repository **inside** the Linux file system | The tools and the scripts are POSIX shell. iOS builds need macOS |
| CPU and memory | 4 cores, 16 GB (8 GB works without a mobile emulator) | PostgreSQL, the object store, Mailpit, the API, Vite and Metro run together |
| Disk | 15 GB free | Docker images (about 1 GB), `node_modules` of three apps, Expo caches |
| Docker | Docker Engine 29.9 or Docker Desktop (DOC-11 §1); Compose v2 or later. `docker compose version` must work and the engine must be running. Engine 29.8.2 with Compose 5.5.0 on OrbStack passed P1-03 | `infra:up` runs PostgreSQL 18.6, the object store and Mailpit as containers |
| Git | 2.40 or later | Conventional Commits are checked by a hook (DR-08, DR-246; §4) |
| Network | Internet on the first run (images, packages) | Offline runs work after that |
| Mobile (optional) | iOS: Xcode 27 on macOS (Expo SDK 58 is built for the iOS 27 SDK, DOC-11 §6.1). Android: Android Studio with one emulator, or a physical device. **No local toolchain at all** is needed if the development build is made in the cloud (`eas build --profile development`, §10) | Expo Go is not used (DOC-11 §13) |
| Accounts | None for the web and the API. An Expo account for cloud builds only | |

PostgreSQL, Node and Bun are **not** installed from the operating system: the first two are a container and a pinned tool (§3).

## 3. Tool setup

`.tool-versions` at the repository root pins the tools (DR-01, DR-95). It is read by `asdf` and by `mise`; install one of them and run the install command in the repository root.

```
bun 1.4.3
nodejs 24.22.0
k6 2.3.0
gitleaks 8.30.1
```

| Tool | Version (DOC-11) | Used for | Required |
| --- | --- | --- | --- |
| Bun | 1.4.3 | Runtime, package manager, `bun test` | Yes |
| Node.js | 24.22.0 (tooling only) | Expo CLI, EAS, Metro (DOC-11 §1). Node 26 is considered at the first refresh after 2026-10-28 | Yes, for the mobile apps |
| k6 | 2.3.0 | EXP-07 (DOC-88) | Only to run the load test |
| gitleaks | 8.30.1 | The pre-push secret scan (the same as CI, DOC-71 §5) | Recommended |
| `eas-cli` | 25.2.0 | Cloud builds (DOC-73) | Only for builds; run as `bunx eas-cli@25.2.0` |
| `uv` | any current release ([astral.sh/uv](https://docs.astral.sh/uv/)) | Runs fontTools for the font check DS-05 (`uv run --with fonttools==4.67.0 --with brotli==1.2.0`, DR-237); nothing is installed in the repository | Recommended; without it `bun run test` skips DS-05 locally. Required in CI |
| Maestro CLI | 2.11.0 | Mobile flows (DOC-88) | Only to run them |

```bash
# with mise
mise install
# with asdf
asdf plugin add bun && asdf plugin add nodejs && asdf install
# check
bun --version      # 1.4.3
node --version     # v24.22.0
docker compose version
```

Expected: the three versions above. `bun run check:tools` (`scripts/check-tools.ts`, written in P1-03) is step 1 of `setup` and applies these rules:

| Tool | Rule | Message |
| --- | --- | --- |
| Bun | Exactly the version of `.tool-versions` | `tool_version_mismatch: bun 1.5.0, expected 1.4.3` and exit 1 |
| Node.js | Any release Expo SDK 58 accepts: 24.3 or later on the 24 line, or an even line from 26 (DOC-11 §1). A different release from the pin only warns | `warn: node 26.10.0, .tool-versions pins 24.22.0 (accepted by Expo SDK 58)`; a release Expo rejects stops with `tool_version_mismatch` |
| Docker | Compose v2 or later and a running engine | `tool_missing: docker compose …` or `docker_not_running: start Docker, then run again` |

The CI job reads the same file (DOC-71 §3).

**Expo tooling runs on Node, not on Bun.** Use `bunx expo …` and never `bunx --bun expo …`: Metro and the Expo CLI are tested on Node (DOC-11 §6.1) and the `--bun` flag makes Bun run them itself.

## 4. First run

```bash
git clone git@github.com:<org>/residential-management-system.git
cd residential-management-system
bun run setup
bun run dev
```

`bun run setup` (`scripts/setup.ts`) is one command that runs, in order, and stops at the first failure. A step whose target does not exist yet is reported as skipped, so the file needs no edit when P1-06 and P1-12 land:

| Step | What | Expected output (the line P1-03 prints) |
| --- | --- | --- |
| 1 | `scripts/check-tools.ts`: Bun, Node, Docker, Compose versions against `.tool-versions` and §2 | `tools ok` |
| 2 | `bun install --frozen-lockfile` | `bun install` summary; `bun.lock` unchanged (`git status` is clean) |
| 3 | `bun run keys:generate`: creates `.env.local` (§8) when it does not exist | `created .env.local (21 keys)` (P1-04 adds the application keys, so the count grows); on a second run `kept .env.local` and no change |
| 4 | `bun run infra:up` (§6) | A table of three services, each `healthy`, and `infra up in <n> s`; 3 minutes or less |
| 5 | `bun run db:migrate`: the migrations of every module in catalog order, then the grants step (DOC-19 §3.1, steps 2 to 4) | `migrated 14 schemas`, `grants applied`. Until P1-06: `skipped: \`bun run db:migrate\` does not exist before P1-06` |
| 6 | `bun run seed:demo` (§9) | `demo seeded: 240 units, 8 residents, 4 staff`. Until P1-12: `skipped: …` as in step 5 |

**Git hooks (DR-246).** Step 2 also installs the hooks: `bun install` runs the root `prepare` script, `husky`, which points `core.hooksPath` at `.husky/_`. Each hook is a fast subset of CI, which stays the gate:

| Hook | Runs | Fails when |
| --- | --- | --- |
| `pre-commit` | `biome check --staged` (the staged files only; it never rewrites them, `bun run format` does) | A format or lint error in a staged file |
| `commit-msg` | `bun scripts/check-commits.ts --message-file <file>` (merge commits are skipped) | The subject does not match DOC-71 §11.2 |
| `pre-push` | `bun scripts/pre-push.ts`: Gitleaks with `.gitleaks.toml` over the pushed commits that no remote branch has | Gitleaks finds a secret. Without the `gitleaks` binary (§3) it prints `pre-push: gitleaks not found, secret scan skipped` and lets the push through |

`--no-verify` skips a hook; CI runs the same checks on the pull request.

`bun run dev` starts one process, `APP_ROLES=api,worker` (DOC-07 §4.2), and the Vite dev server of the web CMS; both reload on a file change.

Check that the stack is up:

```bash
curl -s localhost:3000/api/v1/health/ready      # {"status":"ok"}
curl -s localhost:3001/health/ready             # the ops port: names every dependency
curl -s localhost:3001/metrics | head -3        # Prometheus text format
open http://localhost:5173                      # the web CMS (xdg-open on Linux)
open http://localhost:8025                      # Mailpit
```

Sign in to the web CMS as `admin@demo.rms.invalid` with `demo-password-1` (§9). If the page loads and the sign-in succeeds the whole chain works: web → API → PostgreSQL.

## 5. The `bun run` targets

Every target is a script of the root `package.json` that calls the workspace scripts. The names are fixed here so that DOC-71 and the other documents can cite them. A target marked *later* is created by the task in the last column; until then it does not exist.

| Target | What it does | Task |
| --- | --- | --- |
| `check:tools` | Step 1 of `setup`: the installed tools against `.tool-versions` (§3) | P1-03 |
| `setup` | §4 steps 1 to 6 | P1-03 |
| `keys:generate` | Writes `.env.local` and the throw-away database passwords for `local` (§8). Idempotent: it never changes a value that exists and appends a key that is missing. `--out <dir>` writes the files form (`*_FILE`) used on the staging host (DOC-70 §9) | P1-03 (ports, passwords, URLs, S3 keys), P1-04 (the application keys and `--out`) |
| `infra:up` | `scripts/infra.ts up`: `docker compose -f docker/compose.local.yml --env-file .env.local up -d --wait --wait-timeout 180`, then the table of §6. Exit 2 and `.env.local not found: run bun run keys:generate` without the file | P1-03 |
| `infra:down` | `scripts/infra.ts down`: the same with `down` (data volumes kept) | P1-03 |
| `infra:reset` | `scripts/infra.ts reset`: `down -v` then `up`: **deletes the local database and the object store** (§11) | P1-03 |
| `dev` | `api,worker` in one process on `PORT` and `OPS_PORT`, plus Vite on 5173 | P1-04 |
| `dev:api` | The API and worker only (no web) | P1-04 |
| `dev:web` | Vite only | P1-09 (done) |
| `dev:resident`, `dev:staff` | `expo start --dev-client` for the resident app on Metro port 8081 and the staff app on 8082 (§10) | P1-17 |
| `db:generate` | drizzle-kit generates the next migration of a module (`--filter @mod/<name>`) from its `schema.ts` (DOC-14 §14) | P1-06 |
| `db:migrate` | Applies the pending migrations of every module in catalog order on one connection with `prepare: false`, then the grants step; as `rms_migrator` (DOC-19 §3.1) | P1-06 |
| `seed:demo` | Runs `resetDemo` then `seedDemo` of every module for the demo building (DOC-36 §10.2). Safe to run again | P1-12 |
| `db:reset` | `DROP DATABASE`, then provision, migrate and seed: the quick reset (§11) | P1-06 |
| `payos:sim` | Signs and POSTs a gateway webhook to the local API (§9.3) | P3-03 |
| `lint`, `typecheck`, `check:arch`, `check:scope`, `check:i18n` | Biome (with the color-literal plugin, DR-237); TypeScript; the three dependency-cruiser configs plus knip and jscpd; the building-scope lint; catalog parity and content tests (`bun test packages/i18n-catalog`, DOC-68 §9; run by `verify` too) (DOC-71 §4.1, stage `verify`) | P1-01, P1-12, P1-09 (`check:i18n`) |
| `tokens:build` | Writes `packages/design-tokens/generated/` from `tokens.json` (DOC-54 §2.1); `--check` only reports. A test fails when the committed files differ | P1-09 |
| `check` | Every check of the `verify` stage in one go (`lint`, `typecheck`, `check:arch`, `check:arch:fixtures`, `quality:unused`, `quality:dup`, `check:scope`, `check:i18n`, `check:authz-metadata`, `check:dependabot`, `check:test-ids`); it runs all of them, prints a table and reports a target that does not exist yet as skipped with its task (DR-240). It replaces P1-01's `verify` script | P1-19 |
| `test` | Unit tests of every workspace (`bun test`, no database); `bun run test:unit` does not exist | P1-01 |
| `test:coverage` | The same tests with lcov per workspace and the table of DOC-88 §10 (warnings only, DR-77) | P1-19 |
| `test:integration` | Integration tests against the local PostgreSQL; each file clones the template database (DOC-88 §6) | P1-04 |
| `test:race` | The race harness (`apps/api/test/race`) | P2-03 |
| `test:authz` | The authorization matrix generator and run (EXP-10, DOC-39 §4) | P1-15 |
| `test:e2e` | Playwright flows of the web CMS against `dev` | P1-16 (the first flows; P1-09 has no screen to drive) |
| `test:grants` | The permission tests of DOC-19 §9 against a fresh cluster (`packages/testing/grants.test.ts`) | P1-06 |
| `test:mobile` | Maestro flows against a development build on a simulator (on demand, DOC-88 §11) | P1-17 |
| `test:load` | k6 profile named by `--profile`, against the host named by `TEST_BASE_URL` (EXP-07; staging only, DOC-88 §11) | P6-01 |
| `test:db-clean` | Drops the leftover test databases `rms_test_*` and stale sample templates (DOC-88 §6) | P1-04 |
| `check:test-ids` | Compares the IDs of every "Required tests" table with the test titles; **warns, never fails** (DOC-88 §5, DR-169) | P1-19 |
| `check:commits` | Validates the pull-request title and the commit messages against the pattern of DOC-71 §11.2 | P1-19 |
| `pr:merge <n>` | Squash-merges pull request `<n>` into `dev` only when `gate` is green on its head and the branch is up to date (DOC-71 §11.1, DR-241); needs `gh` signed in | P1-19 |
| `check:authz-metadata` | Fails when a route has no audience metadata (AG-01, SC-01) | P1-15 |
| `db:provision-ci` | Runs `0001-provision.sql` as `postgres` with the generated passwords: the CI twin of the `initdb.d` script of §6 (DOC-71 §4.2) | P1-19 |
| `exp:<nn>` | One experiment run, for example `exp:09` (DOC-98) | per experiment |
| `build` | `apps/cms-web` production bundle and the type check of the apps | P1-09 (done) |
| `docker:build` | Builds the `rms-api` image locally as `rms-api:local` (DOC-71 §6) | P1-19 |
| `check:bundle` | Builds the web CMS with a Vite manifest and checks the gzip budgets of DOC-53 §8 (DR-179) | P1-19 |
| `dependabot:sync`, `check:dependabot` | Writes `.github/dependabot.yml` from the Expo SDK's bundled modules; the check fails when the file is stale (DOC-71 §11.5) | P1-19 |
| `check:openapi` | Fails on a breaking OpenAPI change against the base of the pull request without `/api/v2` (DR-144, AG-26) | P1-04 |

The reference repository's `kit:add`, `kit:remove`, `gen:module` and `check:add-matrix` targets are **not** carried over unless a task adds them (DR-02); `gen:module` may be added by P1-02 if a module template script is wanted.

A target that needs the stack and cannot find it says so and exits with code 2: `PostgreSQL not reachable on localhost:5432: run bun run infra:up`.

## 6. What `infra:up` starts

`docker/compose.local.yml` (P1-03) defines three services and one one-shot job, under the Compose project name `rms`. The versions are DOC-11 §1; every image tag is exact (DR-95). All ports are published on `127.0.0.1` only: the local credentials are throw-away, and the Mailpit and the object store console have none (DR-233).

| Service | Image | Host port | Volume | Healthcheck |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:18.6` | 5432 | `rms-pg` (mounted at `/var/lib/postgresql`, the layout of the 18 image) | `pg_isready -h 127.0.0.1 -U postgres -d rms`. TCP on purpose: during the first start the image runs the provisioning script on a temporary server that listens on the socket only, so the check cannot pass before the roles exist |
| `objectstore` | `chrislusf/seaweedfs:4.48` (DR-231), `weed server -s3` with a filer. It serves presigned `PUT`, `HEAD` and `DELETE` and bucket CORS (DOC-11 §1) | 9000 (S3), 9001 (the filer's file browser, where the objects of a bucket can be looked at) | `rms-s3` | `GET /healthz` on the S3 port |
| `objectstore-init` | `amazon/aws-cli:2.38.3` (one-shot; SeaweedFS has no CLI that sets CORS) | none | none | Exits 0 after it has created the bucket `rms-local-files` and its CORS rule (`PUT`, `GET` and `HEAD` from `http://localhost:5173`); Compose reports it `Healthy` once it exited 0 |
| `mailpit` | `axllent/mailpit:v1.31.6` | 1025 (SMTP), 8025 (web) | none | `/mailpit readyz` |

**Database provisioning.** The `postgres` container runs `docker/postgres/init/10-provision.sh` on its first start (an `initdb.d` script). It reads `RMS_MIGRATOR_PASSWORD`, `RMS_APP_PASSWORD`, `RMS_READONLY_PASSWORD` from the container environment (set by Compose from `.env.local`) and calls `psql -f /provision/0001-provision.sql`, which is `ops/postgres/0001-provision.sql` of the repository (the text of DOC-19 §3, the same file as production), with the four roles and the database `rms` (extensions `pg_trgm`, `unaccent`, `citext` come with the bootstrap step of `db:migrate`). The superuser `postgres` has its own generated password, `RMS_POSTGRES_PASSWORD`; a connection from the host is always password-checked (checked in P1-03: a wrong password for `rms_app` and for `postgres` is refused). The local roles are the same as production, so a permission error shows up on the laptop (DR-67). The role `rms_backup` is created and unused. The script runs once: `infra:down` keeps the data and does not run it again, `infra:reset` does.

**Compose variables** (read only by `compose.local.yml`; the application never reads them): `RMS_PG_PORT` (5432), `RMS_S3_PORT` (9000), `RMS_S3_CONSOLE_PORT` (9001), `RMS_MAIL_PORT` (1025), `RMS_MAIL_UI_PORT` (8025), and the passwords `RMS_POSTGRES_PASSWORD`, `RMS_MIGRATOR_PASSWORD`, `RMS_APP_PASSWORD`, `RMS_READONLY_PASSWORD`. Set a port in `.env.local` when it is taken (§12); `DATABASE_URL` and the other URLs written by `keys:generate` refer to `${RMS_PG_PORT}` and `${RMS_S3_PORT}` with a dotenv reference (Bun and Compose both expand it), so they follow. A port can also be chosen the first time: `RMS_PG_PORT=5433 bun run setup`.

**Local object store settings** (DOC-41 §10): `S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_ENDPOINT` the same, `S3_BUCKET=rms-local-files`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`, with `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` generated by `keys:generate` and given to the store at start (as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of the container). Because the store listens on `127.0.0.1`, a physical phone cannot upload to it directly; bind the port to the LAN address in `compose.local.yml` (and set `S3_PUBLIC_ENDPOINT` to it) when the camera or photo upload is tried on a device (P1-17).

`infra:up` ends when all three long-running services are `healthy` (`--wait`) and prints:

```
postgres      healthy   localhost:5432
objectstore   healthy   localhost:9000  (console 9001)
mailpit       healthy   localhost:1025  (web 8025)
```

The acceptance is: from a fresh clone with the images not yet pulled, `bun run setup` reaches step 5 in 3 minutes or less (P1-03).

## 7. Port table

Ports are fixed so that documents, screenshots and the `CORS_ORIGINS` default agree. Container ports of the deployed stack (3000, 3001 and so on) are the same numbers on purpose (DOC-07 §3).

| Port | What | Process | Configured by |
| --- | --- | --- | --- |
| 3000 | The API (`/api/v1/*`, SSE, webhook) | `bun run dev` | `PORT` |
| 3001 | Ops port: `/health/live`, `/health/ready`, `/metrics`. Bound to localhost in `local` | `bun run dev` | `OPS_PORT` |
| 5173 | Web CMS (Vite) | `bun run dev` | Vite; the `CORS_ORIGINS` default is `http://localhost:5173` |
| 8081 | Metro of the resident app | `bun run dev:resident` | `--port` |
| 8082 | Metro of the staff app | `bun run dev:staff` | `--port` |
| 5432 | PostgreSQL 18.6 | `infra:up` | `RMS_PG_PORT` |
| 9000, 9001 | Object store: S3 API, file browser | `infra:up` | `RMS_S3_PORT`, `RMS_S3_CONSOLE_PORT` |
| 1025, 8025 | Mailpit: SMTP, web UI | `infra:up` | `RMS_MAIL_PORT`, `RMS_MAIL_UI_PORT` |

## 8. Environment files and secrets

| File | Holds | In Git |
| --- | --- | --- |
| `.env.example` | Every key of DOC-41 §4 to §13 with its default and no secret value. **Generated** from the configuration schema (CF-17); never edited by hand | Yes |
| `.env.local` | `APP_ENV=local`, the database URLs, the key rings, the S3 credentials, the compose passwords. Made by `keys:generate`; may be edited to override a default | **No** (`.gitignore`; gitleaks would catch it) |
| `apps/cms-web/.env.local` | `VITE_API_BASE_URL`, `VITE_APP_ENV`: only when the API is not on `localhost:3000` | No |
| `apps/resident-app/.env.local`, `apps/staff-app/.env.local` | `API_BASE_URL`, `APP_ENV` (§10) | No |

Rules:

- **`APP_ENV`, never `NODE_ENV`** decides behavior (DR-156). Expo sets `NODE_ENV` from the command (`NODE_ENV=test npx expo start` loads `.env.development`, DOC-11 §6.4), so an `.env` file must not depend on it.
- In `local` and `test` a secret may be a plain value (DOC-41 §2 rule 4). `keys:generate` writes plain values to `.env.local`. The same command with `--out` writes the `_FILE` form for a host.
- What `keys:generate` creates for `local` (CF-16). **Since P1-03:** `APP_ENV`, the five ports, `RMS_POSTGRES_PASSWORD` and the three role passwords, `DATABASE_URL` (`rms_app`), `MIGRATION_DATABASE_URL` (`rms_migrator`), `READONLY_DATABASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `DEMO_STAFF_PASSWORD` (set to `demo-password-1`, DOC-36 §9.1): 21 keys. **P1-04 adds:** `JWT_KEYS` (one ES256 key, `k1`), `QR_KEYS` (`v1`), `OTP_HMAC_KEY`, `SETTINGS_ENCRYPTION_KEYS` (`k1`), `PII_ENCRYPTION_KEYS` (`k1`). Passwords are 48 hexadecimal characters, so they need no escaping in a URL. Losing `.env.local` loses the local PII key: the local data is then unreadable and `infra:reset` is the way out. That is acceptable for `local` only.
- The drivers in `local` are `SMS_DRIVER=console` and `MAIL_DRIVER=console` (DOC-41 §16): a code or a link is printed in the API log, one line each (§9.4). To see rendered mail in Mailpit set `MAIL_DRIVER=smtp`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `MAIL_FROM=dev@rms.invalid` in `.env.local`.
- `OPENAPI_ENABLED` is `true`: the Scalar page is at `http://localhost:3000/api/v1/docs`.

## 9. Demo accounts, fixed OTP, simulators

### 9.1 The data

`bun run seed:demo` fills the **demo building** `DEMO-A` (DOC-36 §9.1): 240 units `A-0101…A-1516`, a published batch with 120 paid charges, 6 tickets, 3 notices, 5 vehicles, a small library, and the accounts below. The seed is versioned (`DEMO_SEED_VERSION`) and uses fixed ids, so a link in a note keeps working after a reset.

| Role | Sign in | Credential |
| --- | --- | --- |
| Admin | `admin@demo.rms.invalid` | `demo-password-1` |
| Manager | `manager@demo.rms.invalid` | `demo-password-1` |
| Technician | `technician@demo.rms.invalid` | `demo-password-1` |
| Guard | `guard@demo.rms.invalid` | `demo-password-1` |

| Resident | Phone | Memberships |
| --- | --- | --- |
| Demo Owner | `+12025550101` | owner of `A-1508` |
| Demo Family | `+12025550102` | family member of `A-1508`, can pay |
| Demo Tenant | `+12025550103` | tenant of `A-1508`, can pay |
| Demo Helper | `+12025550104` | helper of `A-1508` |
| Demo Owner 2 | `+12025550105` | owner of `A-0302` |
| Demo Tenant 2 | `+12025550106` | tenant of `A-0302`, cannot pay |
| Demo Owner 3 | `+12025550107` | owner of `A-0505` and `A-0506` (shows `Unit-Pick`) |
| Store review | `+12025550108` | owner of `A-0101` |

The phones are fictional numbers (`555-0100` to `555-0199`) that can never reach a person; the phone field of the apps accepts any international number (DR-36). `.invalid` is reserved (RFC 2606): no mail can be delivered to it.

### 9.2 The fixed OTP

A resident signs in with the phone and the code **`123456`**. The code is accepted only for an account with `is_demo = true`, and such an account triggers no SMS (DR-37, DOC-36 §9.2). In `local` there is no other way to sign in as a resident: no real number receives a message. An account created by hand in the CMS (not `is_demo`) gets a real challenge; with `SMS_DRIVER=console` the code is printed in the log (§9.4).

### 9.3 The payment simulator

`bun run payos:sim` (from P3-03) signs a payload with the checksum key of a gateway configuration and POSTs it to the real webhook route, so the whole path (HMAC, `gateway_event`, `settle`) runs without a bank. The demo building has a `fake`-driver configuration (DR-26, DR-60).

```bash
bun run payos:sim -- --config <gatewayConfigId> --order-code 1760000000123 --amount 2838000 --repeat 5 --shuffle --delay 200
bun run payos:sim -- --config <gatewayConfigId> --order-code 1760000000123 --amount 2838000 --wrong-signature
```

| Flag | Meaning |
| --- | --- |
| `--config <id>` | `gatewayConfigId` in the webhook path |
| `--order-code <n>`, `--amount <vnd>` | The confirmation to send |
| `--repeat <n>`, `--shuffle`, `--delay <ms>` | Send it `n` times, in random order, with a delay between sends (the duplicate and late cases of EXP-01) |
| `--wrong-signature` | Sign with a wrong key: expect 401 and one `webhook_rejection` row |
| `--url <url>` | Target; default `http://localhost:3000/api/v1/payments/webhooks/payos/<id>` |

The expected output is one line per send with the status and the body (`200 {"ok":true}`); the full flags are DOC-24's. The command does not exist before P3-03.

### 9.4 Reading a code or a link in the log

With the `console` drivers the sender handler prints one line for each message (DOC-26 §5.5); the code is **never** logged by any other driver (SC-23).

```
{"level":"info","msg":"sms.console","to":"+84901234567","text":"123456 la ma xac thuc ..."}
{"level":"info","msg":"mail.console","to":"new.staff@example.vn","subject":"Invitation","link":"http://localhost:5173/set-password?token=…"}
```

Filter with `bun run dev 2>&1 | grep -E 'sms.console|mail.console'`.

## 10. Mobile development

Both apps are Expo SDK 58 on the New Architecture, as **development builds** (DR-82 rule 5; Expo Go is not used).

1. Make a development build once (a rebuild is needed only when a native module changes):

   ```bash
   cd apps/resident-app
   bunx eas-cli@25.2.0 build --profile development --platform ios        # or android; add --local to use your own toolchain
   ```

   Install the result on a simulator or device. The profile, bundle ids and credentials are DOC-73.
2. Point the app at the API in `apps/resident-app/.env.local`:

   | Where the app runs | `API_BASE_URL` |
   | --- | --- |
   | iOS simulator | `http://localhost:3000/api/v1` |
   | Android emulator | `http://10.0.2.2:3000/api/v1` |
   | A physical device on the same Wi-Fi | `http://<LAN-IP of the laptop>:3000/api/v1` |

   A physical device cannot reach `localhost`. `bun run dev` listens on all interfaces in `local`; allow the port in the laptop firewall.
3. Start Metro: `bun run dev:resident` (port 8081) or `bun run dev:staff` (port 8082), open the development build, and it connects by the QR code or the URL printed in the terminal.
4. Sign in as a demo resident (§9) or, in the staff app, as a demo staff member.

The camera QR scan and the push token need a **physical device** (`expo-device`, DOC-11 §6.2); a simulator shows the screens without them. Push to a development build needs the EAS push credentials of the development project (DOC-73 §6).

`APP_ENV` and `API_BASE_URL` are read in `app.config.ts` and exposed through `extra` (DR-69); a change needs a Metro restart with `--clear`.

## 11. Reset

| Goal | Command | What is lost |
| --- | --- | --- |
| Re-run the demo seed only | `bun run seed:demo` | The demo building's data back to the seed; sessions of demo users |
| Empty the application database, keep the containers | `bun run db:reset` | Everything in database `rms`: migrate and seed again |
| Start from nothing | `bun run infra:reset && bun run setup` | The database, the local files and Mailpit's messages. `.env.local` stays |
| Forget the secrets too | delete `.env.local`, then the line above | Also the local keys: a new `.env.local` is made, and an old database cannot be read |

`seed:demo` calls `resetDemo(buildingId)` of each module, which refuses a building that is not a demo building (DR-60, BD-37); on `local` the only building is the demo, so it always works.

## 12. Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `tool_version_mismatch` at `setup` | The installed Bun or Node differs from `.tool-versions` | `mise install` or `asdf install`; open a new shell |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` on `infra:up` (exit 1) | Another PostgreSQL, store or mail tool on 5432, 9000 or 1025 (happened in P1-03: another project's PostgreSQL container) | Set `RMS_PG_PORT` (or the other variable of §6) in `.env.local`, or use `RMS_PG_PORT=5433 bun run setup` the first time; `keys:generate` is not needed again; run `infra:up` |
| `.env.local not found: run bun run keys:generate` (exit 2) | `infra:up` before `setup`, or the file was deleted | `bun run keys:generate` |
| `PostgreSQL not reachable on localhost:5432` | The container is down or its port moved | `docker compose -f docker/compose.local.yml ps`; `bun run infra:up` |
| `config_invalid` and exit 78 at `dev` | A key is missing or malformed (DOC-41 §17) | Read the line: it names every failing key. `bun run keys:generate` fills the missing secrets |
| `permission denied for table …` | The grants step did not run after a migration | `bun run db:migrate` runs it last (DOC-19 §3.1); never grant by hand |
| `password authentication failed for user "rms_app"` after editing `.env.local` | The role password in the volume differs from the file | `bun run infra:reset` (local data only) |
| Metro: `Unable to resolve module @rms/…` or `@core/…` | Bun hoisted or linked workspace packages in a way Metro does not follow | In `apps/*-app` run `bunx expo start --clear`; if it persists, use the fallback of DR-01: `bun install --linker hoisted` for the mobile workspace root (DOC-11 §10 row 1) and record it there |
| `expo install --check` lists a mismatch | A dependency was bumped by hand; the Expo-managed modules follow the SDK (DR-94) | `bunx expo install --fix` in the app; never set an Expo-managed module to npm `latest` |
| The app loads `.env.development` or the wrong API | `NODE_ENV` is set in the shell | `unset NODE_ENV`; the apps read `APP_ENV` (DOC-11 §6.4) |
| Device cannot reach the API | The app points at `localhost` | Use the LAN address (§10); check the firewall for 3000 |
| Simulator shows no push token | A simulator has none | Use a physical device (DOC-73 §6) |
| `bun test` is slow or hangs on integration | Template database missing | `bun run db:migrate` once; the first integration run builds `rms_template` (DOC-88 §6) |
| `docker compose` cannot pull the images | Docker Desktop not running, or no network | Start Docker; retry |
| An import fails with `exceljs` date serials | The streaming reader returns dates as serial numbers unless opened with `styles: 'cache'` | Use the import module's reader, not `exceljs` directly (DOC-18 §1.1) |
| TypeScript: `Cannot find module '@app/api'` in a client | A value import of `@app/api` is forbidden; only `import type { App }` (DR-04) | Change the import to `import type`; `check:arch` also flags it |

## 13. Checks of this document

These are the checks a reviewer runs after P1-03. Checks 1 and 2 were run on 2026-10-21 for steps 1 to 4 (§14); checks 3 to 5 need P1-04, P1-06 and P1-12; checks 6 and 7 are open until the later targets exist. Check 1 is the dry run of DR-227: it is the acceptance of P1-03, not of the M0 review. They are not test cases and take no test ID.

| # | Check | Expected |
| --- | --- | --- |
| 1 | On a clean user account (no Bun, no Node, Docker only): install the tools of §3, clone, run `bun run setup` | Steps 1 to 6 pass; `infra:up` healthy in 3 minutes or less (P1-03) |
| 2 | `bun run setup` a second time | No file changes (`git status` clean); `.env.local` kept; the seed does not duplicate |
| 3 | The curl commands of §4 | `ready` on both ports; `/metrics` text |
| 4 | Sign in as `admin@demo.rms.invalid`, then as `+12025550101` with `123456` in the resident app | Both succeed; the resident sees unit `A-1508` |
| 5 | `bun run db:reset` | The seed is back; the sessions of check 4 no longer work |
| 6 | Every command in §5 marked P1-xx exists once that task is done | `bun run <target>` exits 0 or prints its usage |
| 7 | Every port of §7 | Is the one in use; no other port appears in the repository's documents (`grep`) |

## 14. Decisions made while writing

Every new decision in this document is recorded as a DR (decided, Claude delegated by the Owner) and summarized here.

| ID | Title | State | Where used |
| --- | --- | --- | --- |
| DR-227 | The dry run of this document is the acceptance of P1-03, not a condition of the M0 approval (Owner, 2026-10-21) | Decided | State of this document, §13 check 1 |
| DR-231 | The local object store is SeaweedFS 4.48; the bucket and CORS are created by an `amazon/aws-cli` one-shot (P1-03) | Decided | §6, §7 |
| DR-233 | Local infrastructure rules found by the P1-03 dry run: ports on `127.0.0.1`, a TCP healthcheck for PostgreSQL, a superuser password of its own, URLs that follow the ports by dotenv reference, `setup` skips the steps whose target does not exist yet, Node only warns when it differs from the pin | Decided | §3, §4, §6, §8 |
| DR-157 | Local development: the names of the root `bun run` targets, the port table and the compose variables of `compose.local.yml`; Expo tooling runs on Node (`bunx expo`, never `--bun`) with the `--linker hoisted` fallback of DR-01; local roles are provisioned by `0001-provision.sql` in the `initdb.d` script of the `postgres` container | Decided | §3, §5, §6, §7, §12 |

### 14.1 The dry run of P1-03 (DR-227)

Run on 2026-10-21 by Claude Code for the Owner, on macOS with OrbStack (Docker Engine 29.8.2, Compose 5.5.0), Bun 1.4.3, Node 24.21.0 inside the clone (26.10.0 in the working copy). **It was not a clean user account**: Bun, Node and Docker were already installed, other projects' containers were running, and the images were partly cached. What it did cover is the repository side of check 1: a fresh `git clone` into an empty directory (plus the uncommitted P1-03 files), then the commands below.

| Step | Command | Result |
| --- | --- | --- |
| Clone | `git clone` into a temporary directory, no `.env.local`, no `node_modules` | Clean tree |
| Prepare the machine | Removed the local tags of `chrislusf/seaweedfs:4.48`, `axllent/mailpit:v1.31.6`, `amazon/aws-cli:2.38.3`; `postgres:18.6` stayed | Images pulled by `up` |
| First run | `RMS_PG_PORT=5433 bun run setup` (port 5432 was taken by another project's container, so this also ran the §12 row) | Steps 1 to 4 pass; the three services `healthy` in 24 s, the whole command 26 s (limit 180 s); steps 5 and 6 `skipped` |
| Second run | `bun run setup` | `kept .env.local`, `bun install` reports no changes, `bun.lock` unchanged, the services stay up (1 s) |
| Persistence | `infra:down`, `infra:up`, read a row created before | The row is there; the provisioning script did not run again |
| Reset | `infra:reset` | The table is gone and the three services are healthy again (6 s) |
| Roles | Connect from the host (Bun, `postgres` 3.4.9) as `rms_app` and `rms_migrator` with the right password, and as `rms_app` and `postgres` with a wrong one | The right passwords are accepted, the wrong ones refused; the four roles have the connection limits of DOC-19 §3 |
| Object store | Presigned `PUT`, `HEAD`, presigned `GET`, `DELETE` and the CORS preflight with the generated credentials (run on the same compose file just before the clone) | All as in DOC-11 §1 |
| No `.env.local` | `bun run infra:up` | `.env.local not found: run bun run keys:generate`, exit 2 |
| Port taken | `RMS_PG_PORT=5432` | `port is already allocated`, exit 1 |

Differences between the first draft of this document and what the dry run showed, all corrected above in the same change:

1. The object store is SeaweedFS (not "SeaweedFS or RustFS"); its ports are the S3 port 9000 and the **filer** on 9001, since SeaweedFS has no S3 console; the init job uses the `aws-cli` image, because the store has no CLI that sets CORS (§6).
2. The PostgreSQL healthcheck must use TCP: with the socket the check passed while the provisioning script was still running (§6).
3. The Mailpit healthcheck is the binary's own `readyz`, not an HTTP probe (the image has no shell tools) (§6).
4. `infra:up` is a script (`scripts/infra.ts`) that wraps Compose, prints the table and the elapsed time and fails early without `.env.local` (§5).
5. `keys:generate` also writes `RMS_POSTGRES_PASSWORD` (the superuser needs a password; there is no trust login from the host) and the ports; its URLs use dotenv references so a changed port needs no second run (§6, §8).
6. `setup` cannot run steps 5 and 6 before P1-06 and P1-12; it reports them as skipped (§4).
7. The machine's Node (24.21.0 in the clone, 26.10.0 in the working copy) differs from the pin 24.22.0 in `.tool-versions`: Node only warns when Expo SDK 58 accepts it (§3).
8. Docker 29.8.2 and Compose 5.5.0 are older than the pins and work (§2).
9. Ports are bound to `127.0.0.1` (§6).

**Not covered, so check 1 is open in its strict form:** installing the tools from §3 on a machine that has none (`mise install` or `asdf install`), a Linux or WSL host, and a cold download of the PostgreSQL image. The Owner can close it by running §4 on a new user account and adding a line here.

## 15. Not in this document

| Topic | Lives in |
| --- | --- |
| The staging and production hosts, Cloudflare, secrets as files | DOC-70 |
| CI stages, caches, the commands of `verify` | DOC-71 |
| EAS profiles, channels, credentials, store submission | DOC-73 |
| What each configuration key does | DOC-41 |
| Test method, fixtures, the template database | DOC-88 |
| Demo seed content and the reset mechanics | DOC-36 §9, §10 |
| The compatibility results of the toolchain | DOC-11 §10 |

## 16. Traceability

| Section | Decisions | Tasks and checks |
| --- | --- | --- |
| §2, §3 tools | DR-01, DR-82, DR-95 | P1-01 |
| §4, §6 first run, infrastructure | DR-67, DR-77 | P1-03; checks 1, 2 |
| §5 targets | DR-04, DR-08, DR-77 | P1-01, P1-04, P1-06 |
| §8 environment | DR-65, DR-156 | P1-04; CF-16, CF-17 |
| §9 demo and OTP | DR-26, DR-37, DR-60 | P1-12, P3-03; BD-37 |
| §10 mobile | DR-69, DR-82, DR-94 | P1-17 |

## Open questions

- **The dry run on a clean user account** is done for the repository side only (§14.1); the part that needs a machine with no tools is open (see the end of §14.1). Decided by the Owner on 2026-10-21 (DR-227): it is check 1 of §13 and the acceptance of P1-03.
- Steps 5 and 6 of §4, the targets marked P1-04 and later, and checks 3 to 7 of §13 wait for their tasks.
- Decisions made while writing: DR-157, DR-231, DR-233. Decided by the Owner: DR-227.
