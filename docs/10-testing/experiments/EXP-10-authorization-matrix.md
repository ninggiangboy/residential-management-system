# EXP-10: Every route refuses every actor it should refuse, and serves every actor it should serve

> Status: **Draft** · Updated: 2026-10-21 (DR-226: 74 routes in the first version, 169 in the final; earlier: P0-32; DR-173 decided; first version for P1-15, final in P6-08) · DOC-99 / EXP-10
> Depends on: [common protocol](README.md) (DOC-89, not written yet), original SDD §19.5, §20.2, [DR](../../00-decision-register.md) (DR-39, 77, 78, 99, 132, 147, 151, DR-226), [DOC-39](../../06-design/security.md) §4, §9, §13, §16, [DOC-26](../../06-design/identity-and-sessions.md) §4.5, [DOC-27](../../06-design/residency-and-memberships.md) §3.2, [DOC-50](../../07-api/api-guidelines.md) §2, §7, [DOC-51](../../07-api/api-endpoints.md) §2, [DOC-88](../test-strategy.md) §13
> Main readers: P1-15 (first version), P6-08 (final); the evaluation of NFR-08

The authorization matrix itself (the input, the sixteen actors, `expected()`, the run and the pass criterion) is designed in DOC-39 §4 (DR-151) and is **not repeated here**. This document adds what an experiment needs: the variables, the baseline that proves the generator can fail, the exact step-up and charge-void cases, what the first version covers, the formulas, the criteria and the result tables. It proves gates, not content (§10).

**Until DOC-89 exists.** The common protocol is DOC-89 (P2). For this run DR-78 and §6 of this document hold it, with one **deviation** (DR-173, decided by the Owner 2026-10-20): the results of record come from the CI job `integration`, not from the staging host, because the run is correctness-only and needs `CREATE DATABASE` rights that no application role has.

## 1. Hypothesis

| ID | Statement | Source | Measured by |
| --- | --- | --- | --- |
| H1 | Across every mounted route × the 16 actors × `own` and `foreign` scope, **0 responses are a 2xx or 3xx where `expected()` says refuse** | NFR-08 | C1 |
| H2 | **0 responses are a refusal (401, 403, 404) where `expected()` says `ALLOW`**: no route refuses its own audience | DR-151 | C2 |
| H3 | 0 responses are 5xx, and no list response holds an id of the other scope | DR-151 | C3, C4 |
| H4 | Every mounted route declares its audience; the catalog and the mounted routes are the same set | original SDD §19.5, DR-99 | C5 |
| H5 | **Step-up:** every sensitive endpoint (E-40, E-42, E-50) called without a valid password and code, or with a proof that was used, expired, bound to another action or belongs to another Admin, causes **0 successful changes** | FR-50, DR-39, DR-132 | C8 |
| H6 | **Charge void (final):** no role, in no charge state other than `open` without a live allocation, voids a charge; a Technician, a Guard and a resident never do | FR-49, DR-19, DR-20 | C9 |
| H7 | The generator **can fail**: each of 11 deliberately broken guards is caught with the expected reason, 0 survive | DOC-39 §4 | C7 |
| H8 | The matrix is deterministic: five runs on the same commit give the same cells and results | DR-78 | C10 |
| H9 | A resident never sees an internal ticket note or a `before` photo (the part of original SDD §20.2 that is content, not a gate) | NFR-08, DOC-39 §4.8 | C11 (SC-12) |

## 2. Variables

| Kind | Variable | Values |
| --- | --- | --- |
| Independent | Route | every route of the mounted `App` (the catalog of DOC-51 §2: 74 under `/api/v1` in the first version, 169 in the final) |
| Independent | Actor | the 16 of DOC-39 §4.2 |
| Independent | Scope | `own`, `foreign` (DOC-39 §4.3) |
| Independent | Step-up proof state | the 9 states of §7.1 |
| Independent | Charge state and role | §7.2 |
| Independent | Mutant | the 11 broken guards of §3 |
| Dependent | Counts of unexpected 2xx and 3xx, unexpected refusals, 5xx, leaks, routes without metadata, missing fixtures; mutants detected; step-up and charge-void cases passed | §6 |
| Controlled | The sample building and its `sample` template database (DOC-88 §7.1), the `fake` and `console` drivers, headers a real client sends (`X-App-Id`, `X-App-Version` at the minimum, `Idempotency-Key`, `X-Unit-Id`, `If-Match`), a fixed `FakeClock` | |

## 3. Baseline

The baseline of this experiment is not a slower algorithm but a **broken router**: the same generator run against applications with one guard deliberately defective. A matrix that stays green on these would also stay green on a real defect. Each mutant is built by the test composition root replacing one entry of `host.guards` (the injection seam of DR-99) or one repository, in `apps/api/test/authz/mutations.authz.test.ts`; its title starts `EXP-10 M<n>`. These are not test IDs of a registered prefix (DOC-88 §15).

| Mutant | Defect | The run must fail with | Names |
| --- | --- | --- | --- |
| M1 | One route's `audience` metadata removed | `route_without_audience`, **before any request is sent** | the route |
| M2 | The guard of an admin-only route widened to `staff('admin','manager','guard')`, the declared metadata unchanged | `unexpected_2xx` | endpoint, `staff.manager` and `staff.guard`, status |
| M3 | An admin route answers 403 to an Admin | `unexpected_refusal` | endpoint, `staff.admin` |
| M4 | A repository loads an object by id without the unit or building predicate | `unexpected_2xx` in `foreign` scope (expected 404) | endpoint, actor |
| M5 | A list route drops its scope filter | `leak` | endpoint, the foreign id found |
| M6 | A handler throws for the Technician actor | `server_error` (5xx) | endpoint, `staff.technician` |
| M7 | `verifyStepUp` returns without checking the proof | `unexpected_2xx` for the cases of §7.1 that must fail | endpoint, state |
| M8 | The production capability table lets `tenant_nopay` do `pay` while the hand-typed copy does not | `unexpected_2xx` for `res.tenant_nopay` | endpoint |
| M9 | The staff guard accepts a resident token (the token-kind check removed) | `unexpected_2xx` for every `res.*` on a staff route | endpoint |
| M10 | A disabled staff member's token is accepted (the status check removed) | `unexpected_2xx` for `staff.disabled` (expected 401) | endpoint |
| M11 | A `locked` membership is treated as `active` | `unexpected_2xx` for `res.locked` (expected 403 `membership_inactive`) | endpoint |

M12, added when the webhook exists (P3-03): E-117 verifies no signature; expected `unexpected_2xx` for every actor (expected 401 `invalid_signature`).

A mutant run uses the five routes of DOC-39 §4.7 as its subset (E-03, E-13, E-27, E-40, E-41, plus the route a mutant touches), so the 11 mutant runs take about one minute in total. A surviving mutant fails the experiment (C7).

## 4. Environment

| Item | Value |
| --- | --- |
| Where | The CI job `integration` (the `postgres:18.6` service container, DOC-71) and a developer machine with `bun run infra:up`. **Not** the staging host (DR-173) |
| In process | The generator calls `app.handle(new Request(...))` on the mounted `App`; no listener, no network (DOC-39 §4.5) |
| Database | A clone of the `sample` template per route batch (DOC-88 §6), connected as `rms_app` |
| Software | Commit and `bun --version` in every result file; Bun 1.4.3, PostgreSQL 18.6 |
| Machine | Recorded in the result: the runner image and size for CI, the CPU and memory for a laptop. No criterion depends on speed |
| Drivers | `SMS_DRIVER=console`, `MAIL_DRIVER=console`, the `fake` payment driver; the codes of the step-up cases are read from the in-memory mailer, decrypted with the test key ring |

## 5. Steps

```bash
bun run infra:up
bun run test:authz                         # the full run: generator, step-up pass, charge-void pass (final), mutants
bun run test:authz -- --routes E-27,E-40   # a subset by endpoint id
bun run test:authz -- --mutations          # the mutants only
bun run exp:10                             # five runs of the full matrix; writes the five result files and the summary
```

Order of one run (a refusal never changes data, so refusals go first, DOC-39 §4.5):

1. Build the `App` with the test composition root; read `app.routes` joined with the metadata map; write `authz-routes.json`. Fail before any request on a route without `audience`, a missing or duplicated `endpointId`, a path parameter without a fixture, or a `/staff/*` route without roles (DOC-39 §4.1).
2. Assert that every fixture id exists in the database (§10, threat "404 for the wrong reason").
3. Issue the 16 tokens through the real sign-in use cases.
4. For each route in order of `endpointId`: send the refusal cells, then the `ALLOW` cells; restore the fixtures from the template before the next route. Write `authz-matrix.json` and `authz-matrix.md`.
5. **Step-up pass** (§7.1): for E-40, E-42 and E-50, request a code through E-38, read it from the mailer, and run the nine proof states.
6. **Charge-void pass** (§7.2, final only; skipped with a notice before E-100 exists).
7. **Mutants** (§3).
8. `bun run exp:10` repeats steps 1 to 7 five times, compares the five `authz-matrix.json` files after removing timestamps and ids (C10) and writes `results/EXP-10-<utc>-run<k>.json` and `-summary.json` (DOC-88 §12).

The artifacts of a CI run (`authz-routes.json`, `authz-matrix.json`, `authz-matrix.md`) are uploaded by the job and not committed; the result files are.

## 6. Metrics and formulas

| Name | Definition |
| --- | --- |
| `routes` | routes in the mounted `App` under `/api/v1` (the ops-port routes `/health/*` and `/metrics` are another app) |
| `routesWithMetadata` | routes with an `audience` and an `endpointId`; **coverage = `routesWithMetadata / routes`** |
| `catalogParity` | `routes` equals the set of `E-xx` of DOC-51 §2 that are implemented at the commit; a route not in the catalog, or an implemented catalog entry not mounted, is a difference (test AG-02 reports it, this run counts it) |
| `cellsOwn` | `routes × 16` |
| `cellsForeign` | the sum, over routes whose `scopeOfObject` is `unit` or `building`, of the actors that pass the gate (DOC-39 §4.3) |
| `cells` | `cellsOwn + cellsForeign` |
| `unexpected2xx` | cells whose status is 2xx or 3xx and whose `expected` is not `ALLOW` |
| `unexpectedRefusals` | cells whose `expected` is `ALLOW` and whose status is 401, 403 or 404 |
| `serverErrors` | cells with a 5xx |
| `leaks` | list-route cells whose body holds an id of the other scope's fixtures |
| `missingFixtures` | path parameters without a fixture (the run stops before sending) |
| `mutantsCaught` | mutants whose run failed with the reason of §3, out of 11 |
| `stepUpCases`, `stepUpFailures` | cases of §7.1 and the ones whose result differs from the table |
| `chargeVoidCases`, `chargeVoidFailures` | cases of §7.2 and the ones that differ |
| `deterministic` | the five `authz-matrix.json` files, stripped of timestamps and ids, have the same SHA-256 |

**Sizes.** First version: 74 routes (the 75 of E-01…E-74 and E-169 minus E-01, which is on the ops port) × 16 = **1,184** own-scope cells, plus the foreign cells (a few hundred). Final: 169 × 16 = **2,704** own-scope cells (DOC-39 §4.6) plus the foreign cells.

## 7. Pass criteria and the exact cases

| ID | Criterion | Expected | Version |
| --- | --- | --- | --- |
| C1 | `unexpected2xx` | 0 | first and final |
| C2 | `unexpectedRefusals` | 0 | first and final |
| C3 | `serverErrors` | 0 | first and final |
| C4 | `leaks` | 0 | first and final |
| C5 | `routesWithMetadata = routes` (coverage 100%), `catalogParity` differences, `missingFixtures` | 100%, 0, 0 | first and final |
| C6 | Every `unexpected` cell names the endpoint, the actor, the scope, the expected and the actual status in `authz-matrix.md` (in bold) | true | first and final |
| C7 | `mutantsCaught` | 11 of 11 (12 of 12 from P3-03) | first and final |
| C8 | `stepUpFailures` | 0 | first (E-38, E-40, E-42, E-50), final |
| C9 | `chargeVoidFailures` | 0 | final (needs E-100) |
| C10 | `deterministic` | true over 5 runs | first and final |
| C11 | SC-12 passes: resident ticket responses hold no internal note and no `before` photo | pass | P4, final |

Correctness criteria hold in **every** run of the five (DR-78). The experiment **passes** when C1 to C8 and C10 hold in the first version, and all eleven in the final one. One unexpected 2xx is a failure of NFR-08, not a flake.

### 7.1 Step-up cases (C8)

Sensitive endpoints (DOC-39 §9, DOC-51 §2): E-40 `POST /staff/accounts` when `role` is `admin` (action `admin_change`), E-42 `PATCH /staff/accounts/{id}` when the new role is `admin` (`admin_change`) or an `email` is present (`staff_email`), E-50 `PUT /staff/gateway` (`gateway_config`). E-38 `POST /staff/step-up` is the code request; its cases are the last rows. Rules of the answers: DOC-26 §4.5 and DR-147 (a non-Admin gets 403 `forbidden` first; only an Admin without a proof gets `step_up_required`; every failed proof is 403 `step_up_failed` with `attemptsLeft`).

Each row runs against **each** of the four endpoint variants (E-40 admin, E-42 promote, E-42 email, E-50) as `staff.admin` unless the first column says another actor. "Unchanged" means the rows the action would write are byte-equal before and after (account list, `gateway_config` row and `version`, no new `password_token` of kind `invite`, no audit row of the action).

| State | The request | Expected status and code | State after |
| --- | --- | --- | --- |
| S0 | no `stepUp` object | 403 `step_up_required` (`details.action`), decided before any database work | unchanged; no code consumed |
| S1 | `stepUp { password: wrong, code: right }` | 403 `step_up_failed` | unchanged; the Admin's `failed_attempts` + 1; the code's `attempts` unchanged (AU-47) |
| S2 | `stepUp { password: right, code: wrong }` | 403 `step_up_failed`, `attemptsLeft` 4 | unchanged; the code's `attempts` is 1 and **stays 1 after the rollback** (DR-132, AU-46) |
| S3 | the right code at 10 min 1 s (`FakeClock`) | 403 `step_up_failed` | unchanged |
| S4 | the right code a second time after a success | 403 `step_up_failed` | unchanged; the first change stands |
| S5 | a code requested for another action (`staff_email` code on `gateway_config`) | 403 `step_up_failed` (AU-45) | unchanged |
| S6 | another Admin's code, right password | 403 `step_up_failed` | unchanged |
| S7 | the right code after five wrong ones | 403 `step_up_failed`, `attemptsLeft` 0 (AU-46) | unchanged |
| S8 | the right password and a fresh code, then one business failure (the gateway in use, a duplicate email) | the business error (409), and the code is still live (AU-49) | unchanged; no notice written |
| S9 | the right password and a fresh code | ALLOW (2xx), once | changed; one `step_up_notice` per active Admin (AU-48); the code is spent |

| Other actor, any variant | Expected |
| --- | --- |
| `staff.manager`, no proof | 403 `forbidden` (not `step_up_required`, DR-147); E-40 with `role: technician` is ALLOW without a proof |
| `staff.technician`, `staff.guard`, any `res.*`, `staff.disabled`, `anon` | 403 `forbidden` / 401, as the matrix says |
| `staff.admin`, E-40 with `role: technician` | ALLOW without a proof (no step-up for a non-Admin role) |
| `staff.admin`, E-42 changing only `fullName`, `language` or a non-admin `role` | ALLOW without a proof |
| `staff.admin`, E-38 with `action` unknown | 400 `validation_failed` |
| `staff.manager` on E-38 | 403 `forbidden` |
| `staff.admin`, E-38 six times in an hour | the sixth is 429 `rate_limited` (AU-50) |

Counts: 4 variants × 10 states = 40 cases, plus 7 rows of other actors on each of the 3 sensitive endpoints, plus the E-38 rows: about 70 cases. Pass: every case equals its row, and **the number of 2xx among S0 to S8 is 0**.

### 7.2 Charge void, role × charge state (C9, final)

Endpoint: E-100 `POST /staff/charges/{id}/void` (audience `staff: admin, manager`, DR-19, DR-20; its section is written in P2, DOC-51). Charge states are the four values of `charge.status`, `draft`, `open`, `paid`, `void` (DR-13, DR-84; the DDL is DOC-15, not written yet; the shape is in the example of [DOC-14](../../05-data/data-conventions.md) §15), plus the intent states that matter for the cascade. Expected outcomes follow DR-20: only an `open` charge with no live allocation is voided; a reason of at least 5 characters is required; the action is audited and `version` guarded. The error codes are written when DOC-51 specifies E-100; the matrix asserts the **class** (2xx or 409 or 422) until then.

| Charge state | `staff.admin` | `staff.manager` | `staff.technician` | `staff.guard` | `res.owner` | `anon` | `staff.admin_b2` (a charge of B1) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `draft` | 409 | 409 | 403 | 403 | 403 | 401 | 404 |
| `open`, no intent | **2xx**, charge `void` | **2xx** | 403 | 403 | 403 | 401 | 404 |
| `open`, one `pending` intent holding it | **2xx**; the intent is cancelled as a whole (`finance.intent_cancel_requested.v1`) | **2xx** | 403 | 403 | 403 | 401 | 404 |
| `open`, one `expired` intent | **2xx** | **2xx** | 403 | 403 | 403 | 401 | 404 |
| `paid` | 409 | 409 | 403 | 403 | 403 | 401 | 404 |
| `void` | 409 | 409 | 403 | 403 | 403 | 401 | 404 |

Reason cases, as `staff.admin` on an `open` charge: absent → 422; 4 characters → 422 (rule `reason_too_short`, as E-42); 5 characters → 2xx; 500 → 2xx; 501 → 422. A request without `If-Match` or with a stale one → 428 / 409 (DOC-50 §9).

After each cell: a `paid` charge keeps its live allocation and `status = 'paid'`; a refused call writes no audit row; an accepted one writes `fee.charge_voided` and one `finance.charge_voided.v1`. Counts: 6 states × 7 actors = 42, plus 5 reason cases and 2 version cases = 49. **The number of 2xx on `draft`, `paid` or `void`, and for any actor other than `staff.admin` and `staff.manager`, is 0.**

The race of a void against a settlement (exactly one wins) is `LG-` (P2-07), not a gate test.

## 8. Analysis

- `authz-matrix.md`: one table per audience class (public, resident, resident with capability, staff, webhook), routes as rows, actors as columns, the actual status in each cell, a mismatch in **bold**. The reviewer reads the bold cells first (DOC-39 §4.6).
- `bun run exp:10` writes the summary: per criterion the value of each run and `pass` when all five agree and pass; `deterministic` from the SHA-256 of the stripped matrices.
- A **diff between versions**: the summary lists routes added and removed since the previous result file, so a route that appeared without a fixture or a row shows up in review.
- Scripts: `apps/api/test/authz/` (the generator, DOC-88 §13), `apps/api/test/exp/exp10-authz-matrix.ts` (the five runs and the summary).

## 9. Result table template

Filled by the summary; empty until the run. First version (P1-15):

| Run | Commit | Routes | With metadata | Cells own | Cells foreign | Unexpected 2xx | Unexpected refusals | 5xx | Leaks | Mutants caught | Step-up failures | Deterministic |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | | | /11 | | |
| 2 | | | | | | | | | | /11 | | |
| 3 | | | | | | | | | | /11 | | |
| 4 | | | | | | | | | | /11 | | |
| 5 | | | | | | | | | | /11 | | |

Final (P6-08) adds the columns `Charge-void failures` and `SC-12`, and the row `Routes` shows 169.

Result file (envelope of DOC-88 §12, `metrics` of this document):

```json
{
  "experiment": "EXP-10", "run": 1, "of": 5, "commit": null,
  "startedAt": null, "finishedAt": null,
  "machine": { "host": "ci", "cpu": null, "ramGb": null, "os": null },
  "runtime": { "bun": "1.4.3", "postgres": "18.6", "api": null },
  "metrics": {
    "routes": null, "routesWithMetadata": null, "catalogParity": { "missing": [], "extra": [] },
    "cellsOwn": null, "cellsForeign": null,
    "unexpected2xx": null, "unexpectedRefusals": null, "serverErrors": null, "leaks": null, "missingFixtures": null,
    "mutants": { "run": 11, "caught": null, "survivors": [] },
    "stepUp": { "cases": null, "failures": null },
    "chargeVoid": { "cases": null, "failures": null },
    "matrixSha256": null
  },
  "criteria": [ { "id": "C1", "expected": "0", "observed": null, "pass": null } ],
  "pass": null
}
```

## 10. Threats to validity

| Threat | Effect | Handling |
| --- | --- | --- |
| **The matrix proves gates, not content** | A route can answer an allowed actor with fields it should not show | Content checks live beside their features: SC-12 (internal notes, `before` photos), AD-24 and DR-48 (Guards see a masked phone), AD-25 (the Manager's audit list); C11 ties SC-12 to this experiment (DOC-39 §4.8) |
| **The fixtures copy the bug** | `expected()` and the production guard share an author; a wrong rule written twice passes | The capability truth values come from a hand-typed copy of DOC-27 §3.2, not from the production function; M8 proves the copy catches a change; a reviewer compares the copy with the document at each change of the table |
| **404 versus 403** | A 404 can come from a missing path, a missing object or a refusal by design; a `foreign` 404 would pass for the wrong reason | Step 2 asserts every fixture exists; the `own` cell of the same route must be `ALLOW`; the 404 body must hold `error.code = "not_found"` with an `X-Request-Id`, which an unknown path (no route) does not produce |
| **The ALLOW cell hides a defect after validation** | A 400 on a minimal body is "ALLOW" | The gate order (DOC-50 §7) puts authorization before validation, so a refused actor gets 401 or 403 even with an invalid body (SC-10); an actor that should be refused and gets 400 is a mismatch |
| **State-dependent routes** | A route that needs a state (a published batch, an open intent) is only gate-tested on the minimal state | The fixtures of such routes are built by the module builders (DOC-88 §7.2); a route whose minimal request cannot reach the gate is a missing fixture, not a pass |
| **In-process is not the edge** | Caddy, Cloudflare, CORS and headers are not exercised | SC-14 to SC-16 and the deploy smoke test cover them; this experiment covers the application |
| **A fixed list of 16 actors** | A new role or member type is not tested until an actor is added | Adding a role to `@rms/shared-types` fails the `actors.ts` completeness check; the list is part of DOC-39 §4.2 |
| **Mutants prove detection only for the mutants listed** | A defect of another kind could survive | The list grows with every defect found in review; each escaped defect adds a mutant |
| **Not run on the staging host** | DR-78 says every experiment runs there | DR-173: the run is correctness-only and deterministic, so the machine does not matter; the deploy smoke test and SC-16 touch staging |
| **A single database cluster** | Behavior of grants on the staging cluster is not exercised | `GRT-` and the `db-grants` job cover the roles; the matrix connects as `rms_app` like the application |

## 11. Results

Not run. The first version runs in P1-15 (after P1-14); the final run is P6-08. The results of record are the files under `docs/10-testing/experiments/results/` and the tables of §9.

## 12. Open questions

- **DR-173 (decided, Owner, 2026-10-20; deviates from DR-78): EXP-10 does not run on the staging host.** *Problem:* DR-78 says all experiments run on the staging host, except EXP-03 and EXP-04. The matrix needs a fresh database per route batch (`CREATE DATABASE … TEMPLATE`), which needs a role with `CREATEDB` that the application roles do not have (DR-113) and that the staging cluster should not give; it has no timing criterion. *Decision:* the results of record come from the CI job `integration` at the commit under test (five repetitions by `bun run exp:10`), with the machine recorded; the staging deployment is checked by the smoke test and SC-16. *Consequences:* DOC-89 lists EXP-10 beside EXP-03 and EXP-04 as an experiment that does not need the staging host; DOC-71 keeps `test:authz` in `integration`. *Write to:* DOC-89, DOC-99, DOC-71.
- **DR-172 (decided, Claude delegated): the generator's own checks are mutants injected through `host.guards`.** *Problem:* a matrix that cannot fail proves nothing, and DOC-39 §16 has only two negative tests (SC-04, SC-05). *Decision:* §3: eleven defective guards or repositories, built by the test composition root through the guard seam of DR-99, run in the same job; a surviving mutant fails the experiment. *Consequences:* the test composition root accepts guard overrides (test code only); about one more minute in `integration`. *Write to:* DOC-99, DOC-39 §16 (SC-04 and SC-05 are the first two of them), DOC-88 §13.
- **E-100 error codes.** The cases of §7.2 assert the class of the answer until DOC-51 specifies E-100 (P2). The `charge.status` values come from DR-13 and DR-84; DOC-15 holds the DDL when it is written.
- **The route count of the first version.** 74 is E-02…E-74 and E-169 as numbered today (E-169, `GET /staff/imports`, joined with DR-226 on 2026-10-21); P1-15 records the real count at its commit, and `catalogParity` reports a route that is mounted early or late (E-75…E-77, the SSE and inbox groups of P1-26).
