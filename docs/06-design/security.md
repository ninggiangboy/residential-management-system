# Security

> Status: **Draft** · Updated: 2026-10-20 (DR-159, DR-160 decided: §5.4; skeleton, P0-30; DR-151, DR-152, DR-153) · DOC-39
> Depends on: original SDD §7, §19.1, §19.4, §19.5, [DR](../00-decision-register.md) (DR-07, 12, 32, 33, 37, 38, 39, 48, 58, 61, 64, 65, 83, 113, 147, 151, 152, 153), [ADR-0010](../04-adr/0010-two-account-kinds-membership-scoped-authorization.md), [ADR-0011](../04-adr/0011-tokens-refresh-families-and-cookies.md), [ADR-0022](../04-adr/0022-personal-data-protection.md), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §7, [DOC-12](../03-architecture/code-architecture.md) §5.3, §11, [DOC-26](identity-and-sessions.md), [DOC-27](residency-and-memberships.md) §3, [DOC-35](audit-privacy-and-terms.md), [DOC-37](files-and-uploads.md), [DOC-41](configuration-reference.md), [DOC-50](../07-api/api-guidelines.md) §2, §7, §13, [DOC-51](../07-api/api-endpoints.md) §2, §12
> Main readers: P1-04, P1-10, P1-14, P1-15 (route metadata and the matrix), P1-16 (the web CMS headers), P1-20 (Caddy), P3-03, P5-09, P6-08 (the review), DOC-70, DOC-71, DOC-99 (EXP-10), DOC-98 (EXP-09)

This document is the security view of a system whose parts are specified elsewhere: who may call what (the endpoint × actor matrix and how it is generated), the headers and the client-IP rule, the rate limits in one table, the secrets, the webhook and step-up rules seen as defenses, a lightweight threat model per trust boundary, and what the pipeline scans. It does not specify sign-in and sessions (DOC-26), the household policy table (DOC-27 §3), the audit writer (DOC-35), the upload flow (DOC-37), the gateway adapter (DOC-24) or the infrastructure install (DOC-70).

**State of this skeleton (P1, final in P6).** The matrix input format (§4.1 to §4.6), the headers (§5), the limits table (§6), the secret inventory (§7), the webhook and step-up rules (§8, §9), the STRIDE rows for the five named flows (§11) and the scanning rules (§12) are final in form. The STRIDE rows for the other boundaries, the review checklist (§13) and the results columns are filled in P5-09 and P6-08.

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| The rules that hold everywhere | §2 |
| Authentication parameters seen from security | §3 |
| The endpoint × actor matrix: input, actors, expected outcome, output | §4 |
| TLS, headers, CSP, CORS, cookies, the client IP | §5 |
| Rate limits | §6 |
| Secrets | §7 |
| Webhook (defense side) | §8 |
| Step-up (defense side) | §9 |
| Personal data | §10 |
| Threat model | §11 |
| CI scanning | §12 |
| Review checklist for P6-08 | §13 |
| Tests (`SC-`) | §16 |

## 2. Rules that hold everywhere

| # | Rule | Source | Checked by |
| --- | --- | --- | --- |
| 1 | **Deny by default.** Every route declares its audience as metadata; a route without it does not build and there is no default-allow route | original SDD §19.5, DOC-12 §5.3 | AG-01, SC-01 |
| 2 | **Two kinds of token, never interchangeable.** A resident token never passes a staff guard and the reverse, whatever the role | FR-16.4, ADR-0010 | SC-09, RM-03 |
| 3 | **A token holds no permission on a unit.** The membership is read on every resident request, so a lock takes effect on the next request | FR-16.3, DOC-27 §3.1 | RM-01, RM-04 |
| 4 | **404 outside the caller's scope, never 403.** An id of another unit or building is not told apart from an id that does not exist | DOC-42 §2, DOC-50 §2 | SC-06 |
| 5 | **The building scope is in the type.** A repository method needs a `BuildingScope`; the lint rejects a business query without a `building_id` predicate | DR-12, original SDD §19.4 | `check:scope`, P1-01 |
| 6 | **No credential gets a validation answer.** A request without a valid credential is 401 before its body is looked at | DOC-50 §7 | AG-04 |
| 7 | **Ids are UUIDv7**, never sequential, never guessable from a count | original SDD §19.5, DOC-14 | DOC-14 tests |
| 8 | **A secret is a file**, never in the image, the repository, a CI log, `/metrics` or a log line | DR-65 | SC-20…22 |
| 9 | **The gateway is trusted for nothing but its signature.** The HMAC is the only gate of the webhook; an IP is never a gate | DR-32 | SC-24…26 |
| 10 | **A sensitive staff action needs a proof beyond the session.** Password plus an emailed code, single use | FR-50, DR-39 | AU-44, SC-08 |
| 11 | **Personal data is read by few and logged.** CCCD and date of birth to Manager and Admin, each view and export written to the audit log; masked for Guards | NFR-14, DR-48, DR-57 | AD-20…24 |
| 12 | **The audit row is in the mutation's transaction**; the application role cannot update or delete it | FR-37, DR-57 | AD-01, AD-17 |

## 3. Authentication, in numbers

The behavior is DOC-26. This table gathers the parameters a reviewer asks about, with the key that sets each.

| Item | Value | Key or source |
| --- | --- | --- |
| Staff password hash | Argon2id, 19,456 KiB, time cost 2, NFC-normalized, ≥ 8 characters with a letter and a digit, ≤ 128 | `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`; DR-39, DR-128 |
| Staff lockout | 5 failures lock 15 minutes; 30 attempts per 15 minutes per IP | building settings `lockout.*`; `STAFF_LOGIN_PER_IP` |
| Reset and invite links | 256-bit random, stored as SHA-256, single use, 30 minutes and 24 hours | `RESET_TTL_MINUTES`, `INVITE_TTL_HOURS` |
| Resident OTP | 6 digits, HMAC-hashed, 300 s, 5 attempts, resend after 45 s | `OTP_*`; DR-37 |
| Access token | ES256 JWT, 15 minutes, no unit claim and no building claim for a resident | `ACCESS_TOKEN_TTL_SECONDS`; DR-38 |
| Refresh token | Opaque, rotated on use, a reused token revokes the family; 30 and 180 days sliding, 90 and 365 absolute | `REFRESH_*`, `FAMILY_MAX_DAYS_*`; DOC-26 §3.5 |
| Web CMS cookie | `__Secure-rms_refresh`, host-only on `api.<domain>`, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`; refresh and logout need `X-Requested-With: rms` | DR-38, DOC-26 §3.3 |
| QR token | HMAC-signed, 15 minutes, nonce and credential version checked on every scan | `QR_TTL_SECONDS`; DR-48 |
| Step-up | Password and a 6-digit code mailed to the Admin, 10 minutes, single use, 5 attempts | `STEPUP_*`; §9 |

## 4. The authorization matrix

EXP-10 (DOC-99) calls every endpoint as every actor on every scope and counts the unexpected successes; the pass criterion is 0 (NFR-08). This section fixes **what the generator reads, who the actors are, what it expects and what it writes**, so that P1-15 builds it without asking. DOC-99 holds the experiment protocol and the results.

### 4.1 The input: route metadata

The generator reads the routes of the mounted `App` **in process** (`app.routes` joined with the metadata map the route plugin keeps), not the HTTP OpenAPI document. The same record is published on each operation of the OpenAPI document as vendor extensions (`x-endpoint-id`, `x-audience`, `x-step-up`, `x-idempotent`) for the clients and for test AG-02 (DR-151).

Each route declares (DOC-50 §2; the notation of DOC-51 §1.2):

```ts
type Audience =
  | { kind: 'public' }
  | { kind: 'resident'; capability?: Capability }       // capability set => unit(capability) guard
  | { kind: 'staff'; roles: Role[] }                    // 'any' is written as all four roles
  | { kind: 'webhook'; provider: string }

interface RouteSecurity {
  audience: Audience
  idempotent?: true                                     // Idempotency-Key required
  stepUp?: StepUpAction                                 // 'gateway_config' | 'admin_change' | 'staff_email'
}
```

The generator turns a route into this record (one JSON object per route; the file is `authz-routes.json`, an artifact of the run):

```json
{
  "endpointId": "E-27",
  "method": "POST",
  "path": "/me/members",
  "operationId": "addMember",
  "audience": { "kind": "resident", "capability": "manage_members" },
  "idempotent": true,
  "stepUp": null,
  "pathParams": [],
  "scopeOfObject": "unit"
}
```

`scopeOfObject` is `unit` (the object belongs to the unit named by `X-Unit-Id`), `building` (staff routes) or `none` (no object: a list of the caller's own data, a public route). It is **derived** from the audience and the path, not declared, except that a route may override it with `objectScope` when the derivation is wrong (a review finds the case). `endpointId` comes from `x-endpoint-id`; a route whose id is not in DOC-51 §2 fails AG-02 before the matrix starts.

The generator **fails before sending a request** when: a route has no `audience`; an `endpointId` is missing or duplicated; a path parameter has no fixture (§4.5); a route in `/staff/*` lists no roles; a route that DOC-51 §2 marks with a *Step-up* lacks `stepUp`.

### 4.2 The actors

Sixteen actors. A *token* actor holds a real token issued by the sign-in use case, not a forged one. The fixtures are the sample building (DOC-01): building B1 with unit U1 `A-1508` (owner Nguyễn Văn An, tenant Trần Thị Bình), a second unit U2 `A-1509` in B1, and a second building B2 with unit U3.

| Actor | What it is |
| --- | --- |
| `anon` | No `Authorization` header |
| `tok.expired` | A resident access token past `exp` |
| `res.owner` | Resident, active **owner** of U1 (`X-Unit-Id` = U1) |
| `res.family` | Active family member of U1 |
| `res.tenant_pay` | Active tenant of U1, `can_pay` on |
| `res.tenant_nopay` | Active tenant of U1, `can_pay` off |
| `res.helper` | Active helper of U1 |
| `res.locked` | A member of U1 whose membership is `locked` |
| `res.terms_pending` | Owner of U1 who has not accepted the latest terms |
| `res.stranger` | A resident with a membership of U2 only; sends `X-Unit-Id` = U1 |
| `staff.admin` | Admin of B1 |
| `staff.manager` | Manager of B1 |
| `staff.technician` | Technician of B1 |
| `staff.guard` | Guard of B1 |
| `staff.disabled` | A staff member of B1 disabled after a valid access token was issued |
| `staff.admin_b2` | Admin of B2 (the cross-building actor) |

### 4.3 The targets

A cell is (route, actor, scope). The scope names which fixture objects the path parameters and the body refer to:

| Scope | Meaning | Applies to |
| --- | --- | --- |
| `own` | The objects of U1 (resident routes) or of B1 (staff routes) | every route with a path parameter, and every route without |
| `foreign` | The objects of U2 in B1 for a resident route (the actor is not a member of U2); the objects of B2 for a staff route | routes whose `scopeOfObject` is `unit` or `building`, and only for actors that pass the gate |

### 4.4 The expected outcome

`expected(route, actor, scope)` is a pure function of the metadata. It returns one of: `ALLOW`, `401 unauthenticated`, `403 forbidden`, `403 membership_inactive`, `403 terms_required`, `403 step_up_required`, `401 invalid_signature`, `404 not_found`. `ALLOW` means *the gate passes*: the status is a 2xx, or a business answer in {400, 409, 412, 422, 428} produced by the use case on a minimal valid request. A 401, 403 or 404 on an `ALLOW` cell is an **unexpected refusal** and fails the run as surely as an unexpected 2xx (a route that refuses its own audience is a defect).

| Audience | `anon`, `tok.expired` | `res.*` | `staff.*` of listed roles | other staff roles | `staff.disabled` | `staff.admin_b2` |
| --- | --- | --- | --- | --- | --- | --- |
| `public` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| `resident` (no capability) | `401 unauthenticated` | ALLOW (a locked or stranger membership does not matter: no unit guard) | — | `403 forbidden` for every staff actor | `403 forbidden` | `403 forbidden` |
| `resident` with capability | `401 unauthenticated` | by the rows below | — | `403 forbidden` for every staff actor | `403 forbidden` | `403 forbidden` |
| `staff` | `401 unauthenticated` | `403 forbidden` for every `res.*` | ALLOW | `403 forbidden` | `401 unauthenticated` | ALLOW at the gate; scope rules of §4.3 |
| `webhook` | `401 invalid_signature` | `401 invalid_signature` | `401 invalid_signature` | — | — | — |

For `resident` with a capability, in the order of the gates of DOC-50 §7 (membership, then terms, then policy):

| Actor | Result |
| --- | --- |
| `res.stranger`, `res.locked` | `403 membership_inactive` |
| `res.terms_pending` | `403 terms_required` (a route exempt from the terms gate: ALLOW) |
| `res.owner`, `res.family`, `res.tenant_pay`, `res.tenant_nopay`, `res.helper` | ALLOW when `can(ctx, capability)` of the policy table (DOC-27 §3.2) is true, otherwise `403 forbidden`. The generator takes the truth value from the **independent copy** of the table in `authz.fixtures.ts` (a hand-typed copy), not from the production function, so that a wrong production table is a failure |

Two more rules:

- **`scope = foreign` and the actor passes the gate** → `404 not_found`. Never 200, never 403 (rule 4 of §2). For a list route (no path parameter) the cell is ALLOW and the **leak scan** applies: the response body must contain none of the ids of the other scope's fixtures.
- **A route with `stepUp`**: an actor that passes the gate and sends the step-up body without `stepUp` gets `403 step_up_required` if it is `staff.admin`, and `403 forbidden` if it is another listed role (DR-147). The `ALLOW` cell for such a route is the one **with a valid proof**, run once (§4.5).

### 4.5 The run

1. Seed the fixtures into a test database cloned from a migrated template (`createdb -T`), about 100 ms.
2. Issue the tokens of §4.2 once, through the real sign-in use cases.
3. For each route, in order of `endpointId`: send the **refusal cells first**, then the `ALLOW` cells. A refusal cell cannot change data. An `ALLOW` cell of a mutating route may, so the fixtures are restored from the template before the next route.
4. Path parameters are filled from `authz.fixtures.ts`, a map `parameter name → fixture id per scope` (`unitId`, `membershipId`, `accountId`, `sessionId`, `fileId`, …). A body is the minimal valid example of the OpenAPI schema (the examples of DOC-51); a route whose example is not valid fails the run.
5. A request carries the headers a real client sends: `X-App-Id`, `X-App-Version` (the minimum), `Idempotency-Key` where `idempotent` is set, `X-Unit-Id` for the resident actors, `If-Match` read from a preceding `GET` where the route needs one.

The run needs no network: the gateway, SMS and mail drivers are the fake and console drivers.

### 4.6 The output and the pass criterion

Two files, artifacts of the CI job (not committed): `authz-matrix.json` (one object per cell: `endpointId`, `actor`, `scope`, `expected`, `status`, `code`, `ok`) and `authz-matrix.md` (a table per audience class: routes as rows, actors as columns, the actual status in each cell, a mismatch in bold). The size is the number of cells: for the 168 routes of DOC-51 and 16 actors, 2,688 cells for `own` plus one `foreign` cell for each passing actor of each object route.

The run **fails** on any of: an unexpected 2xx or 3xx; an unexpected refusal; any 5xx; a leak found by the scan; a route without metadata; a missing fixture. A passing run writes its counts (routes, cells, unexpected = 0) into the results of EXP-10 (DOC-99).

### 4.7 Worked cells

Five routes of the catalog, as the generator expects them (own scope; `foreign` in the last row of each):

| Route | `anon` | `res.owner` | `res.helper` | `res.locked` | `res.terms_pending` | `staff.admin` | `staff.manager` | `staff.guard` | `staff.admin_b2` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-03 `GET /public/config` (public) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| E-13 `GET /me` (resident) | 401 | ALLOW | ALLOW | ALLOW | ALLOW | 403 forbidden | 403 forbidden | 403 forbidden | 403 forbidden |
| E-27 `POST /me/members` (unit: manage_members) | 401 | ALLOW | 403 forbidden | 403 membership_inactive | 403 terms_required | 403 forbidden | 403 forbidden | 403 forbidden | 403 forbidden |
| E-40 `POST /staff/accounts` (staff: admin, manager; step-up when the role is `admin`) | 401 | 403 forbidden | 403 forbidden | 403 forbidden | 403 forbidden | ALLOW for `role: technician`; `403 step_up_required` for `role: admin` | ALLOW for `role: technician`; `403 forbidden` for `role: admin` (DR-147) | 403 forbidden | ALLOW at the gate; **foreign** scope not applicable (no path object) |
| E-117 `POST /payments/webhooks/{provider}/{gatewayConfigId}` (webhook) | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature | 401 invalid_signature |
| E-41 `GET /staff/accounts/{id}`, **foreign** scope (an account of B2) | 401 | 403 | 403 | 403 | 403 | 404 not_found | 404 not_found | 403 | the account is its own: ALLOW (own scope of B2) |

The last row is the isolation proof (NFR-08): the Admin of B1 asking for a staff account of B2 is told it does not exist.

### 4.8 What the matrix does not prove

It proves the gates, not the content. Content checks live beside their features and are listed in the checklist of §13: a resident endpoint never returns an internal ticket note or a `before` photo (DOC-28, P4), a Guard never sees a full phone (DR-48, AD-24), a Manager's audit list omits `pii.read` rows (AD-25).

## 5. Transport, headers, CORS, cookies, client IP

### 5.1 TLS and where headers come from

TLS ends at the Cloudflare edge; the VPS has no inbound port and Caddy speaks plain HTTP (`auto_https off`). The web CMS headers come from the Pages `_headers` file; the API headers from Caddy; the app sets `Cache-Control` and `ETag` itself (DOC-50 §12), which Caddy must not override. `<files-host>` is the host of `S3_PUBLIC_ENDPOINT`; `<domain>` the company domain (Owner input, P0-03).

**Web CMS `_headers`** (DR-64 revised by DR-152: the CSP of DR-64 had `connect-src 'self'`, which would block the calls to `api.<domain>` because the web CMS and the API are different origins):

```
/*
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<files-host>; media-src 'self' https://<files-host>; font-src 'self'; frame-src https://www.youtube-nocookie.com; connect-src 'self' https://api.<domain> https://<files-host>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Staging replaces `api.<domain>` with `api-staging.<domain>`; local development has no CSP header (Vite). `style-src 'unsafe-inline'` is kept for the TipTap editor and the component library; the scripts are never inline (Vite emits none). The `Strict-Transport-Security` has no `includeSubDomains` and no `preload`: both are hard to undo (DR-152).

**API response headers in the Caddyfile** (DOC-70 holds the whole file):

```
header {
  Strict-Transport-Security "max-age=31536000"
  X-Content-Type-Options "nosniff"
  Referrer-Policy "no-referrer"
  Permissions-Policy "camera=(), microphone=(), geolocation=()"
  -Server
}
@notdocs not path /api/v1/docs*
header @notdocs Content-Security-Policy "default-src 'none'; frame-ancestors 'none'"
```

An API answer is JSON, a file redirect or an SSE stream, never a page, so the CSP forbids everything; the Scalar page of staging is the one exception.

### 5.2 CORS and cookies

CORS is DOC-50 §5.3 (one origin per environment, credentials on, a fixed header list, `CORS_ORIGINS`). A request from another origin gets no CORS headers; the apps send no `Origin`. The web CMS holds the access token in memory and the refresh token in the `HttpOnly` cookie of §3; the defense against a cross-site request is `SameSite=Strict` and the preflight forced by `X-Requested-With`. The bucket has its own CORS rule: `PUT` and `GET` from `https://admin.<domain>` only (DR-64, DOC-37 U11).

### 5.3 The client IP

Every IP bucket, the audit row and the log use one function, `clientIp(request)`, in `@core/http` (DR-152):

1. Let `peer` be the address of the TCP connection. If `peer` is not inside `TRUSTED_PROXY_CIDRS` (empty in `local` and `test`), the answer is `peer` and no header is read.
2. Otherwise, if `CF-Connecting-IP` is present and is a valid IP literal, the answer is its value. Cloudflare sets it at the edge and overwrites a value sent by the client.
3. Otherwise take `X-Forwarded-For` and the entry `TRUSTED_PROXY_HOPS` places from the right (1 = the right-most). If it is a valid IP, that is the answer.
4. Otherwise `peer`.
5. An IPv6 address is reduced to its `/64` prefix for every **bucket key** (not for the audit row or the log, which keep the full address). One person can use millions of addresses of a `/64`.

The VPS has no inbound port, so the only peers in the trusted range are the containers of the Docker network (Caddy). Examples (`TRUSTED_PROXY_HOPS=1`, trusted range `172.18.0.0/16`):

| `peer` | `CF-Connecting-IP` | `X-Forwarded-For` | Result |
| --- | --- | --- | --- |
| `172.18.0.5` | `203.0.113.7` | `198.51.100.9` | `203.0.113.7` |
| `172.18.0.5` | missing | `198.51.100.9, 172.18.0.2` | `172.18.0.2` is the right-most; it is a proxy address, so a deployment that reaches this branch is misconfigured: log `warn` `client_ip_fallback` (the answer is still `172.18.0.2`) |
| `198.51.100.50` (direct) | `203.0.113.7` | any | `198.51.100.50` (not trusted, headers ignored) |
| `172.18.0.5` | `2001:db8:1:2:aaaa:bbbb:cccc:dddd` | | the bucket key is `2001:db8:1:2::/64`; the audit row keeps the full address |
| `172.18.0.5` | `not-an-ip` | `198.51.100.9` | `198.51.100.9` |

### 5.4 Other exposure

- `/health/*` and `/metrics` are on the ops port, bound to the Docker network, not routed (DR-07). Only `GET /api/v1/health/ready` is public and names no dependency (DR-145).
- OpenAPI and Scalar exist only in `local` and `staging`; `production` answers 404 and refuses to boot with the flag on (AG-03).
- A call to the webhook route from an address outside `WEBHOOK_KNOWN_IPS` is logged `webhook.unknown_ip` (`warn`, with the address and the configuration id) and counted in `webhook_unknown_ip_total`; it is **never blocked** (DR-32). The list is empty until the gateway documentation or sandbox gives the ranges (DR-25).
- Cloudflare: one rate rule on `/api/v1/auth/*` (the free plan allows one) as the outer net; WAF challenges and Bot Fight Mode are skipped for the API host and the webhook path because the apps cannot answer a challenge (TB1). *Revised (DR-159, DR-160):* Bot Fight Mode cannot be skipped on the free plan, so it is **off** for the zone; the webhook path skips the managed and rate rules, and the rate rule is 100 requests per 10 s per IP (DOC-70 §5.3). The rule's numbers are set in DOC-70 within the limits of the free plan, checked on the web in P1-20.

## 6. Rate limits

One table for all buckets. A bucket is a token bucket in PostgreSQL, one atomic statement (DOC-16 §4.6, DOC-17 §3.4); "N per period" is capacity N and refill N/period. The keys are in DOC-41. A refusal is 429 `rate_limited` with `Retry-After` and `details {scope}`; the metric is `rate_limited_total{scope}` (DOC-40).

| Scope | Bucket key | Capacity and refill | Table | Config key | Defined in |
| --- | --- | --- | --- | --- | --- |
| `otp_ip` | `otp:ip:<ip>` | 20 per hour | `identity.rate_bucket` | `OTP_PER_IP_PER_HOUR` | DOC-26 §6 |
| `otp_phone` | `otp:phone:<e164>` | 5 per hour (also spent by a member invitation) | `identity.rate_bucket` | `OTP_PER_PHONE_PER_HOUR` | DOC-26 §6 |
| (daily cap) | counted on `otp_challenge` over 24 h | 3,000 challenges | `identity.otp_challenge` | `OTP_DAILY_CAP` | DOC-26 §5.1 |
| `staff_login_ip` | `staff-login:ip:<ip>` | 30 per 15 minutes | `identity.rate_bucket` | `STAFF_LOGIN_PER_IP` | DOC-26 §6 |
| `reset_email` | `reset:email:<email>` | 3 per hour | `identity.rate_bucket` | `RESET_PER_EMAIL_PER_HOUR` | DOC-26 §6 |
| `reset_ip` | `reset:ip:<ip>` | 10 per hour | `identity.rate_bucket` | `RESET_PER_IP_PER_HOUR` | DOC-26 §6 |
| `stepup` | `stepup:staff:<id>` | 5 per hour | `platform.rate_bucket` | `STEPUP_REQUESTS_PER_HOUR` | DOC-26 §6 |
| `webhook` | `webhook:ip:<ip>` | 60 per minute (inserts into `webhook_rejection`) | `platform.rate_bucket` | `WEBHOOK_PER_MINUTE_PER_IP` | DR-32 |
| `qr` | `qr:account:<id>` | 30 per minute | `platform.rate_bucket` | `QR_ISSUE_PER_MINUTE` | DR-64 |
| `intent` | `intent:account:<id>` | 10 per minute | `platform.rate_bucket` | `INTENT_CREATE_PER_MINUTE` | DR-64 |
| `reminder` | `reminder:account:<id>` | 10 per hour | `platform.rate_bucket` | `DEBT_REMINDER_PER_HOUR` | DR-64 |
| `upload` | `upload:account:<id>` | 60 per hour | `platform.rate_bucket` | `UPLOAD_RATE_PER_HOUR` | DOC-37 §6.1 |
| `client_errors` | `client-error:ip:<ip>`, `client-error:account:<id>` | 10 per minute; 30 per hour | `platform.rate_bucket` | `CLIENT_ERRORS_PER_MINUTE_PER_IP`, `CLIENT_ERRORS_PER_HOUR_PER_ACCOUNT` | DOC-42 §10 |
| (invitations) | counted under an advisory lock | 10 per owner per building day | `residency.membership` | `MEMBER_INVITES_PER_DAY` | DOC-27 §14 |
| (streams) | counted in memory per account | 3 concurrent `GET /staff/events` | none | `SSE_MAX_STREAMS_PER_ACCOUNT` | DR-75 |
| (exports) | worker concurrency | 2 at once | none | `EXPORT_CONCURRENCY` | DR-64 |

The IP in a bucket key is the result of §5.3 (an IPv6 address as its `/64`). Idle buckets are deleted by `token_purge` (DOC-20).

## 7. Secrets

Format and reader are DOC-41 §6; this table adds where each lives, how it changes and what its loss or leak does. Rotation steps are RB-12. All secrets are files under `/etc/rms/secrets` (root, mode 0400) read through `*_FILE`; `bun run keys:generate` makes local and staging keys; production keys are generated on the host and a sealed copy of the PII key and of the pgBackRest passphrase is kept offline by the Owner (DR-65). Gitleaks runs in CI (§12).

| Secret | Rotation | If lost | If leaked |
| --- | --- | --- | --- |
| `DATABASE_URL` (`rms_app`), `READONLY_DATABASE_URL`, `MIGRATION_DATABASE_URL` | On staff change | Reset the role password; restart | Data access as that role: `rms_app` is DML only and cannot touch the audit table's rows (GRT); change the password at once |
| `JWT_KEYS` | Yearly, overlap ≥ 30 min | No token can be issued; add a new key, restart; all access tokens fail once and clients refresh | An attacker can mint tokens: remove the kid, add a new one; every access token fails once (refresh tokens are rows and survive) |
| `QR_KEYS` | Yearly, overlap ≥ 15 min | QR codes fail until a key is added | Forging a QR still needs the stored nonce, so the risk is low; rotate |
| `OTP_HMAC_KEY` | On suspicion | Live challenges (≤ 5 minutes) fail; residents ask again | With a database read an attacker could test the 10⁶ codes offline during the 5 minutes; rotate |
| `SETTINGS_ENCRYPTION_KEYS` | Re-encrypt job (RB-12) | The gateway credentials are entered again; no data lost | With a database read the payOS credentials are exposed: rotate the key **and** the payOS credentials |
| `PII_ENCRYPTION_KEYS` | Re-encrypt job (RB-12) | **CCCD numbers unrecoverable**; the offline copy is mandatory | With a database read the CCCD numbers are exposed: a personal-data incident (Decree 13) |
| `S3_*` | Per provider | Uploads and PDFs fail; the outbox retries | Read and write of the files bucket: rotate; check the object log |
| `SMS_*`, `SMTP_PASSWORD`, `EXPO_ACCESS_TOKEN` | Per provider | OTP, mail or push stops; alerts `ProviderAuthFailed` | Abuse of the account (cost, spam): rotate at the provider |
| payOS credentials | Admin edits with step-up (DR-33) | Enter again | Fake payment links under our name; and with the checksum key, forged webhooks: change them at payOS (RB-13) |
| `DEMO_STAFF_PASSWORD` | On staff change | Reseed | Access to the demo only (the demo is isolated, DR-60) |
| Tunnel token, GHCR read token, pgBackRest passphrase and R2 backup token, CI secrets, Telegram token, Alertmanager SMTP, Grafana admin password | Operator | Per DOC-70 | Per DOC-70; a leaked Tunnel token exposes the API under our hostname |

A boot error names a key and a rule, never a value (DOC-41 §17). The `/metrics` page, the logs and the audit rows never hold a secret (DOC-42 §8.4, BD-19).

## 8. The webhook, seen as a defense

The sequence and the adapter are DOC-24 and DOC-52. The security properties that must hold (DR-32, ADR-0008):

1. **The HMAC-SHA256 over the body with the stored checksum key is the only gate**, compared in constant time. A bearer token, a cookie or an IP never substitutes for it (E-117 in the matrix answers 401 to every actor).
2. The order of checks is cheap-first: size ≤ 16 KB (`WEBHOOK_MAX_BODY_BYTES`) → the configuration exists and is `active` (else 404, no row) → HMAC → `data.accountNumber` equals the configured account → the call says a transfer was paid → `settle`.
3. **`gateway_event` holds only authenticated confirmations.** A failure writes one `webhook_rejection` row (reason one of `bad_signature`, `bad_account`, `malformed`, `unknown_config`, `foreign_building`), so a forged call with a real-looking `reference` cannot occupy the arbiter's unique key and make the genuine call a duplicate (EXP-01, forged-first).
4. Inserts into `webhook_rejection` are limited to 60 per minute per IP; rows are purged after 30 days; the excerpt is cut at 2 KB (`WEBHOOK_REJECTION_EXCERPT_BYTES`).
5. A call from an address outside `WEBHOOK_KNOWN_IPS` is logged and counted, never refused (§5.4).
6. The answers carry no detail: 200 (processed or duplicate), 400, 401 `invalid_signature`, 5xx transient so that the gateway retries.
7. The alert `WebhookSignatures` counts `webhook_rejection` rows (more than 3 in 10 minutes, DOC-40).

## 9. Step-up, seen as a defense

The flow is DOC-26 §4.5. The properties:

1. Three actions need it: `gateway_config` (E-50), `admin_change` (E-40, E-42 when the role is or becomes `admin`) and `staff_email` (E-42 when an email changes). The route declares `stepUp`; the matrix checks it (§4.4).
2. The proof is the Admin's password and a 6-digit code from a CSPRNG mailed to the Admin's own address, valid 10 minutes, **single use**, bound to the action (a code requested for `staff_email` fails for `gateway_config`, AU-45), at most 5 wrong attempts, one live code per staff and action.
3. A wrong password counts toward the account lockout. A code request is limited to 5 per hour per staff member.
4. Each success notifies **every Admin** of the building by email and by inbox entry and is recorded in the audit row (`details.stepUp = true`).
5. A Manager who asks for a step-up action gets 403 `forbidden`, and only an Admin without a proof gets `step_up_required` (DR-147).
6. TOTP is not built in phase 1.

## 10. Personal data

ADR-0022 and DOC-35 hold the inventory, the masking and the retention. The security tests in this document add: the log scrape (SC-23, with AD-29 and ER-30), the field-level reads (AD-20…24), and the demo exclusion of the business gauges (BD-36, OB-09). Cross-border processors are Cloudflare, Expo, FCM and APNs only; push carries no personal text (DR-52).

## 11. Threat model (lightweight STRIDE)

Per boundary of DOC-07 §7.1. Each row is a threat, the defense that exists and the test that proves it. `—` means no threat of that class matters at that boundary. The five flows named by the plan come first; the others are summarized in §11.6 and completed in P5-09.

### 11.1 Webhook (TB7, E-117)

| Class | Threat | Defense | Test |
| --- | --- | --- | --- |
| Spoofing | A forged confirmation, or a forged call that arrives first with a real `reference` | HMAC with the checksum key; the account number check; rejections go to `webhook_rejection`, not to the arbiter row | SC-24, EXP-01 |
| Tampering | The amount or the reference changed on the way | HMAC covers the body; only an exact amount is posted, otherwise the money log (DR-84) | IN-, EXP-01 |
| Repudiation | The gateway denies sending a call, or we deny processing it | Authenticated confirmations stored in `gateway_event` with the body hash; rejections logged with `body_sha256`; the settlement is audited with `actor_kind = 'system'` | AD-14 |
| Information disclosure | An error body reveals which configuration exists or why a check failed | Fixed answers; an unknown configuration is 404 with no row | SC-11, ER-25 |
| Denial of service | A flood of invalid calls fills the table or the worker | Body ≤ 16 KB; 60 inserts per minute per IP; the Cloudflare edge; rows purged at 30 days; the check order is cheap-first | SC-26 |
| Elevation | The route as a token-less path to the ledger | It can only call `settle`; its audience is `webhook`; a bearer token is ignored | SC-11 |

### 11.2 Upload (TB6, E-24, E-25, E-36, E-37)

| Class | Threat | Defense | Test |
| --- | --- | --- | --- |
| Spoofing | Uploading under another account or into another building | Registration needs a token; the server chooses the key; the presigned `PUT` is bound to the key and the signed `Content-Type` | FS-, SC-29 |
| Tampering | The bytes are replaced after verification inside the URL's lifetime | Residual risk accepted for phase 1 and reduced to zero if U6 (`If-None-Match: *`) passes (DOC-37 §12) | FS- U6 |
| Repudiation | Who uploaded what | `file_object` holds the account; attach and remove are audited | AD- |
| Information disclosure | A guessable or public object | Private bucket; random keys; signed `GET` for 15 minutes (5 for papers); no public listing | FS- |
| Denial of service | Large files, quota exhaustion, a stuck upload | Per-purpose size caps; the building quota answers 413; 60 uploads per hour per account; orphans removed after 24 h | FS-, BD-12 |
| Elevation | An HTML or script file served from our origin | Type allow-list; magic bytes checked after the upload; served from the bucket host with the registered `Content-Type`; the CSP has no `script-src` for it | SC-28 |

### 11.3 QR scan (TB1, E-142 `POST /staff/access/scans`)

| Class | Threat | Defense | Test |
| --- | --- | --- | --- |
| Spoofing | A forged token; a screenshot used after the owner locked the member | HMAC signature (`QR_KEYS`); the nonce in `qr_credential`; `exp` 15 minutes; the credential version must equal the live membership's | EXP-05 |
| Tampering | A token with another membership id | The signature covers the payload | QC- |
| Repudiation | A Guard denies a scan | `qr_scan` and `lookup_log` rows with the guard id; purged after 90 days | QC-, AD-24 |
| Information disclosure | A Guard learns a phone number | Masked with a Call button, every view logged (DR-48); an `invalid` scan stores no membership id | AD-24 |
| Denial of service | Scan or issue floods | Scans need a staff token; issue is `qr` 30 per minute; a scan bucket is not defined in phase 1 | open question |
| Elevation | A revoked or locked member still enters | The membership is read on every scan; lock, removal, type change and transfer bump the credential version | RM-01, EXP-05 |

### 11.4 OTP (TB1, E-09, E-10)

| Class | Threat | Defense | Test |
| --- | --- | --- | --- |
| Spoofing | Guessing a 6-digit code | HMAC-hashed code, 5 attempts, 300 s, one live challenge per phone | AU-, EXP-09 |
| Tampering | Replaying an old code or editing a challenge | Single use by an atomic statement; the table is writable by `rms_app` only through the use case | AU- |
| Repudiation | A resident says they did not sign in | Sign-in lines and the session row (`auth.otp_verified`), no code in the log | AU- |
| Information disclosure | The code is stored or logged; a phone number is probed for registration | The code leaves the outbox payload encrypted (DR-117) and is never logged except by the `console` driver; the 404 `phone_not_registered` tells that a phone is not registered, which is accepted (accounts are created by the Manager) and bounded by the per-phone and per-IP buckets | SC-23, AU- |
| Denial of service | SMS pumping and cost; locking a victim out | 5 per hour per phone, 20 per hour per IP, a daily cap of 3,000, a Cloudflare rule; the alert `OtpDailyCapReached` | EXP-09 |
| Elevation | The demo's fixed code `123456` on a real account | Valid only for a flagged account; the production boot guard refuses a flagged account with a membership in a real building | BD-30 |

### 11.5 Step-up (TB1, E-38, E-50, E-40, E-42)

| Class | Threat | Defense | Test |
| --- | --- | --- | --- |
| Spoofing | A stolen Admin session used to change the gateway account | The proof needs the password and a code sent to the Admin's own email | AU-44 |
| Tampering | A code for one action used for another; a code reused | Bound to the action; single use; the consuming statement is atomic | AU-44, AU-45 |
| Repudiation | An Admin denies the change | Audit row with `details.stepUp = true` and the fields changed (not values); every Admin notified | BD-22 |
| Information disclosure | The code in a log or a mail preview | Never logged; the mail command carries it encrypted (DR-117) | SC-23 |
| Denial of service | Flooding code mails | 5 requests per hour per staff member | AU-50 |
| Elevation | A Manager reaching an Admin-only action | The route refuses a non-Admin with `forbidden` before it asks for a proof | SC-08 |

### 11.6 The other boundaries

Completed in P5-09 (`—` = nothing to add yet).

| Boundary | Main threat | Defense that exists |
| --- | --- | --- |
| TB1 Internet → Cloudflare | Credential stuffing; flooding; the API reached without Cloudflare | WAF and one rate rule; the VPS has no inbound port, so Cloudflare cannot be bypassed from outside |
| TB2 Cloudflare → VPS | A stolen Tunnel token | The token is a secret of §7; Access service tokens for CI; SSH only through the Tunnel |
| TB3 Caddy → `api` | A spoofed `CF-Connecting-IP` | §5.3: believed only from a trusted peer |
| TB4 `api`, `worker` → PostgreSQL | SQL injection; a leaked URL | Parameterized queries (Drizzle); role `rms_app` is DML only; `scram-sha-256` from the Docker subnet |
| TB5 `api`, `worker` → R2 | A leaked bucket key | Private bucket; separate token for the backup bucket |
| TB8 `api`, `worker` → providers | Personal data to a third party | Push payloads without personal text; SMS carries a code only |
| TB9 CI → registry and VPS | A poisoned image or action | Pinned action versions; Trivy; a read-only registry token on the VPS |
| TB10 Monitoring | Metrics or logs exposed | Ops port not routed; only Grafana has a public host, `monitor.<domain>`, behind Cloudflare Access plus its own sign-in; Prometheus, Loki and Alertmanager have none (DR-88) |

## 12. CI scanning

The pipeline is DOC-71; this section sets what each scanner must catch and what fails the build (DR-153). Versions are DOC-11 §9.

| Scanner | Scope | Fails the build on |
| --- | --- | --- |
| Gitleaks | The pull request's commits; the full history once a week on `main` | Any finding. An allow-listed fixture needs a comment saying why |
| Trivy, filesystem | The repository's lockfile on every pull request | A vulnerability of severity HIGH or CRITICAL that has a fixed version (`--ignore-unfixed`) |
| Trivy, image | The `rms-api` image on every build of `main`, and weekly on the image that runs | The same, plus any secret found in a layer |
| CodeQL | JavaScript and TypeScript, query suite `security-extended`, on pull requests | Any alert of severity error |
| Dependabot | Weekly version updates; security updates at once (DR-01) | Opens pull requests; does not fail the build |

A weekly failure of the scheduled image scan is an email from GitHub Actions to the Owner; it is the only scanner that can find a new vulnerability in a build nobody touched.

## 13. Review checklist for P6-08

Filled and signed in P6-08 (task acceptance: checklist for webhook, upload, QR and OTP). Every row is **Not run**.

| # | Check | Where proven |
| --- | --- | --- |
| 1 | The matrix of §4 on the full catalog: 0 unexpected 2xx, 0 5xx, 0 leaks | EXP-10 |
| 2 | A forged webhook with a real reference first, the genuine second: the genuine settles | EXP-01, SC-24 |
| 3 | A webhook from an unlisted IP with a valid signature: settled and logged | SC-25 |
| 4 | An HTML file uploaded as an image is refused; a file of another building cannot be fetched | SC-28, SC-29 |
| 5 | A locked member's old QR fails; a screenshot after rotation fails | EXP-05 |
| 6 | OTP abuse: 2,500 requests from one `/64` and 6 phones; the caps and the alert behave | EXP-09, SC-18 |
| 7 | A step-up proof replayed, reused across actions, and after 10 minutes | AU-44…47 |
| 8 | The demo gauges and the demo OTP cannot touch a real building | BD-30, BD-36, OB-09 |
| 9 | No secret in any image layer, log line, `/metrics` page or `docker inspect` | SC-21…23 |
| 10 | RB-12: rotate the JWT and QR keys without logging anyone out unexpectedly | RB-12 drill |
| 11 | Trivy and CodeQL clean on `main` | §12 |
| 12 | The headers of §5.1 on a production response, and no CSP violation in the web CMS console on a full walkthrough | SC-14…16 |

## 14. Configuration

The keys this document relies on are in DOC-41: `CORS_ORIGINS`, `TRUSTED_PROXY_HOPS`, `TRUSTED_PROXY_CIDRS`, `OPENAPI_ENABLED`, the bucket keys of §6, `WEBHOOK_KNOWN_IPS`, `WEBHOOK_PER_MINUTE_PER_IP`, `WEBHOOK_MAX_BODY_BYTES`, `WEBHOOK_REJECTION_EXCERPT_BYTES`, `ARGON2_*`, `STEPUP_*`, and the key rings of §7. This document adds none.

## 15. Metrics and logs

Metrics (DOC-40): `rate_limited_total{scope}`, `webhook_rejections_total{reason}`, `webhook_unknown_ip_total`, `auth_*` (DOC-26 §10), `provider_auth_failed_total{provider}`. Log lines: `webhook.unknown_ip` (`warn`, address and configuration id), `client_ip_fallback` (`warn`, once per minute), `auth.*` (DOC-26 §10), `boot_guard_failed`, `config_invalid`. No log line holds a secret, a code, a token, a full phone or a CCCD (DOC-42 §8.4).

## 16. Required tests

Prefix `SC-` (security; unused before this document; master plan §0.2, DR-156; DOC-88 indexes it). A test written in an earlier document is referenced, not repeated. All are **not run** yet.

| ID | Scenario | Expected | Written in |
| --- | --- | --- | --- |
| SC-01 | The generator run on an app with one route lacking `audience` | Exit 1 before any request; the route is named | P1-15 |
| SC-02 | `expected()` on 40 pinned rows (the five routes of §4.7 × the sixteen actors, plus step-up and foreign rows) | Every row equals the table of §4.4 | P1-15 |
| SC-03 | The matrix on the implemented endpoints | 0 unexpected 2xx, 0 unexpected refusals, 0 5xx, 0 leaks | P1-15, P6-08 |
| SC-04 | A deliberately broken route (a staff route with `roles: ['admin']` answering a Manager 200) | The run fails and names `endpointId`, actor and status | P1-15 |
| SC-05 | A route that refuses its own audience (an Admin route answering an Admin 403) | The run fails as an unexpected refusal | P1-15 |
| SC-06 | A permitted actor on `foreign` objects of every object route | 404 `not_found` each; never 200 or 403 | P1-15 |
| SC-07 | The list routes as `staff.admin_b2` | 200; the body holds none of the ids of B1 | P1-15 |
| SC-08 | A step-up route, as `staff.admin` without `stepUp`, as `staff.manager` | `step_up_required`; `forbidden` | P1-15 |
| SC-09 | Every `/staff/*` route with each `res.*` token; every `/me/*` route with each `staff.*` token | 403 `forbidden` for all | P1-15 |
| SC-10 | Every `/me/*` and `/staff/*` route with no token and an invalid body | 401, never 400 (AG-04) | P1-04 |
| SC-11 | E-117 with an Admin bearer token and no signature | 401 `invalid_signature`; no `gateway_event` row; one `webhook_rejection` row | P3-03 |
| SC-12 | A resident endpoint list over tickets with internal notes | No internal note and no `before` photo in any resident response | P4 |
| SC-13 | A route with a path parameter that has no fixture | The generator fails naming the parameter | P1-15 |
| SC-14 | Parse the `_headers` file of the build | Every header of §5.1 present with its value; `connect-src` holds the API origin and `<files-host>` | P1-16 |
| SC-15 | The web CMS walkthrough in Playwright (sign in, units, upload a logo, SSE open) | No CSP violation in the console | P1-16 |
| SC-16 | A JSON route and `/api/v1/docs` through Caddy in staging | The four headers and the CSP on the JSON route; no CSP on the docs page | P1-20 |
| SC-17 | `clientIp` on the five rows of §5.3 | The results of the table; `client_ip_fallback` logged for row 2 | P1-04 |
| SC-18 | 21 OTP requests from 21 addresses of one IPv6 `/64` | The 21st is 429 (the bucket key is the `/64`) | P1-11 |
| SC-19 | One test per scope of §6: capacity + 1 requests | The last is 429 with `Retry-After` and `details.scope`; `rate_limited_total{scope}` rises | P1-10, P1-11, later phases |
| SC-20 | Gitleaks on the repository; then on a branch with a fake key added | Clean; the branch is caught | P1-01 |
| SC-21 | Trivy secret scan on the built image | No finding | P1-20 |
| SC-22 | On staging: `docker inspect` of `api` and `worker`, and `GET /metrics` | The environment holds `*_FILE` paths and no secret value; `/metrics` holds none | P1-20 |
| SC-23 | Log scrape of a suite run with an OTP, a reset, a step-up, a gateway edit and a webhook | No code, token, password, secret, full phone or CCCD in any line (AD-29, ER-30) | P1-10 |
| SC-24 | A forged call with a real `reference` first, then the genuine call | The genuine one settles; the forged one is a `webhook_rejection` | P3-03 |
| SC-25 | `WEBHOOK_KNOWN_IPS` set; a genuine call from outside the list | 200, settled, `webhook.unknown_ip` logged, `webhook_unknown_ip_total` +1 | P3-03 |
| SC-26 | 61 rejected calls from one IP in a minute | The 61st is 429 and writes no row | P3-03 |
| SC-27 | A refresh by cookie without `X-Requested-With`; the same from another origin | 403 `forbidden`; no CORS headers | P1-10 |
| SC-28 | An HTML file registered as `image/png` | `verify` fails (`file_not_verified`) | P1-07 |
| SC-29 | The signed URL of a file of another building asked for through the API | 404 | P1-07 |
| SC-30 | Boot guard check 1 with a flagged account in a real building | Exit 78 (BD-30) | P1-12 |
| SC-31 | A pull request adding a Trivy-HIGH dependency with a fix | The build fails (§12) | P1-01 |

## 17. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-151 | The authorization matrix: input record, sixteen actors, the expected-outcome function, the run order and the failure conditions | §4 |
| DR-152 | The header values of the API and the web CMS, the corrected `connect-src`, the client-IP rule with the `/64` bucket key | §5 |
| DR-153 | Scanner thresholds; `WEBHOOK_KNOWN_IPS` | §5.4, §12 |

## 18. Not in this document

| Topic | Lives in |
| --- | --- |
| Sign-in, sessions, key rotation of tokens, the OTP flow | DOC-26 |
| The policy table and the household rules | DOC-27 §3 |
| The audit writer, the inventory of personal data, retention | DOC-35, DOC-20 |
| The upload flow and its checks | DOC-37 |
| The gateway adapter, signature test vectors | DOC-24 |
| The SSE stream and the webhook contract | DOC-52 |
| Caddyfile, compose, Tunnel and firewall installation | DOC-70 |
| The experiment protocol and results of EXP-09 and EXP-10 | DOC-98, DOC-99 |
| Rotation steps | RB-12 |

## 19. Traceability

| Section | Decisions | Requirements and checks |
| --- | --- | --- |
| §2 | DR-12, DR-32, DR-39, DR-57, DR-65 | NFR-06…08, NFR-14, FR-16, FR-37, FR-50 |
| §4 | DR-151, DR-147, DR-142 | NFR-08; SC-01…13, AG-01, AG-02, EXP-10 |
| §5 | DR-07, DR-64, DR-152 | SC-14…18 |
| §6 | DR-37, DR-39, DR-64, DR-85 | NFR-07; SC-19, AU-, EXP-09 |
| §7 | DR-65, DR-113 | SC-20…22 |
| §8 | DR-32, DR-153 | NFR-01; SC-24…26, EXP-01 |
| §9 | DR-39, DR-132, DR-147 | FR-50; AU-44…48, SC-08 |
| §11 | DR-32, DR-37, DR-48, DR-61 | the tests named in each row |
| §12 | DR-01, DR-08, DR-153 | SC-31 |

## Open questions

- **A rate limit on QR scans** (§11.3): phase 1 has none because scans need a staff token. DOC-29 decides whether a Guard's scan rate needs a bucket (P4).
- **The Cloudflare rule's numbers** are set in DOC-70 within the free plan's limits, verified on the web in P1-20.
- **The gateway's source ranges** (`WEBHOOK_KNOWN_IPS`) wait for the gateway documentation or sandbox (DR-25).
- **The `U6` upload hardening** (`If-None-Match: *` on the presigned `PUT`) is decided by the check in P1-07 (DOC-37 §12).
