# Identity and sessions

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-28 (P1-26: `liveSessionIds` in §3.7, DR-300) · 2026-10-23 (P1-14: the staff accounts and the calls for `residency` as built, §4.4, §12, DR-261; P1-11: the resident OTP as built, §5.6, §12, DR-256; earlier 2026-10-21: DR-68: providers picked at P1-22, fake drivers before; DR-225: `client` in the session lists; DR-189: client handling note in §3.3; earlier DR-147, DR-150: staff account states, step-up order, reset response floor) · DOC-26
> Depends on: original SDD §7, §17.1, §19.3, [DR](../00-decision-register.md) (DR-36…39, 59, 60, 64, 65, 68, 73, 74, 83, 85, 87, 99, 107, 108, 125, 127), [ADR-0010](../04-adr/0010-two-account-kinds-membership-scoped-authorization.md), [ADR-0011](../04-adr/0011-tokens-refresh-families-and-cookies.md), [DOC-03](../01-product/requirements.md) (FR-13…15, 45, 50), [DOC-04](../01-product/use-cases.md) (UC-14, UC-17, UC-26), [DOC-09](../03-architecture/messaging-contracts.md) §6.3, §7.3, [DOC-12](../03-architecture/code-architecture.md) §5.3, §8, §12, [DOC-16](../05-data/identity-and-residency-model.md) §4, [DOC-17](../05-data/operations-model.md) §3, [DOC-35](audit-privacy-and-terms.md) §10, [DOC-36](building-configuration-and-demo.md) §3, §7, §9, §10, [DOC-42](error-handling.md) §5.3, [DOC-06](../02-glossary.md)
> Main readers: P1-10 (identity: staff), P1-11 (identity: resident OTP), P1-14 (staff API), P1-22 (SMS and mail adapters), DOC-27, DOC-39, DOC-41, DOC-51, EXP-09, EXP-10, RB-12

This document says how people prove who they are and how a session lives: the staff password flow (sign-in, lockout, invite, reset, administration of staff accounts), the step-up for sensitive staff actions, the resident OTP, the access and refresh tokens, the cookie of the web CMS, key rotation, the session endpoints, the rate buckets, and the revocation matrix. The tables are DOC-16 §4. What a resident may do once signed in (membership, policy table) is DOC-27. The terms gate and account deletion are DOC-35; the boot guard is DOC-36 §10.1; CORS, headers and the trusted-proxy rule are DOC-39. Endpoints are named by method and path; the numbered catalog (`E-xx`) is DOC-51.

Every new decision in this document is recorded as DR-128…DR-135 and summarized in §14.

## 1. Purpose and scope

### 1.1 Components

"Runs in" is the process role (DOC-07 §5): `api` serves requests, `worker` sends SMS and mail and runs the purge jobs. Every class lives in `modules/identity` (a fork of the reference `identity`, DR-03) unless the column says otherwise.

| Component | Runs in | Trigger | Reads | Writes | Task |
| --- | --- | --- | --- | --- | --- |
| `StaffSignIn` (use case) | api | `POST /auth/staff/login` | `staff_account`, `identity.rate_bucket`, `BuildingApi.getSettings` | `staff_account` counters, `refresh_family`, `refresh_token` | P1-10 |
| `StaffPasswordFlows` (reset request, set password from a link, invite resend) | api | `POST /auth/staff/password-reset`, `POST /auth/staff/password`, `POST /auth/staff/invite/resend` | `staff_account`, `password_token` | `password_token`, `staff_account`, outbox `identity.mail_requested.v1` | P1-10 |
| `StaffAccounts` (create, edit, lock, unlock, disable, enable) | api | `/staff/accounts*` | `staff_account`, the open-tickets port (§4.4) | `staff_account`, `refresh_family`, audit | P1-14 |
| `StepUp` (`POST /staff/step-up`, `IdentityApi.verifyStepUp`) | api | the sensitive request | `password_token`, `staff_account` | `password_token`, outbox `identity.mail_requested.v1` | P1-10 |
| `ResidentOtp` (request, verify) | api | `POST /auth/otp`, `POST /auth/otp/verify` | `resident_account`, `otp_challenge`, `identity.rate_bucket`, `outbox_messages` | `otp_challenge`, `refresh_family`, `refresh_token`, outbox `identity.sms_requested.v1` | P1-11 |
| `SessionService` (refresh, logout, list, revoke) | api | `POST /auth/refresh`, `POST /auth/logout`, `/me/sessions*`, `/staff/sessions*` | `refresh_family`, `refresh_token`, account tables | the same, outbox `identity.session_revoked.v1` | P1-10 |
| `TokenSigner` | api | every sign-in and refresh | `JWT_KEYS` | none | P1-10 |
| `identity.send_sms`, `identity.send_mail` (handlers) | worker | `identity.sms_requested.v1`, `identity.mail_requested.v1` | `resident_account`, `staff_account`, the command | none (provider calls) | P1-22 |
| `otp_purge`, `token_purge`, `account_deletion` (jobs) | worker | timers of DOC-38 §4 | DOC-20 §5 | DOC-20 §5 | P1-08 |
| Token verification and the `staff` and `resident` guards | api | every request | `JWT_KEYS`, `IdentityApi.getStaff` | none | P1-10 (guards are built in `apps/api`, DOC-12 §5.3) |

### 1.2 What the two kinds of account are

| | Staff | Resident |
| --- | --- | --- |
| Table | `identity.staff_account` | `identity.resident_account` |
| Identifier | work email (`citext`, unique across buildings) | phone, E.164 (unique) |
| Proves identity with | email and password (Argon2id) | an SMS code (OTP) |
| Rights come from | one fixed role in one building | the active membership of the selected unit (DOC-27) |
| Token claims | `sub`, `kind: "staff"`, `role`, `bid`, `sid` | `sub`, `kind: "resident"`, `sid` (no building, no unit) |
| Apps | web CMS (Admin, Manager), staff app (Manager, Technician, Guard) | resident app |
| Refresh token lives | 30 days sliding, 90 days absolute | 180 days sliding, 365 days absolute |

A staff member who is also a resident has two accounts, one per app (DR-36). A resident token never passes a staff guard and the reverse, whatever the role (FR-16.4).

## 2. Components and interfaces

### 2.1 Ports

The module depends on these ports; adapters are bound in the composition root (DOC-12 §5.1). `Clock`, `IdGenerator` and `UnitOfWork` are `@core/kernel`'s.

```ts
// modules/identity/src/application/ports.ts
export interface SmsSender {                       // drivers: console | allowlist | provider (§5.5, DR-68)
  send(msg: { to: string; text: string; requestId: string }): Promise<void>   // throws on a provider failure
}
export interface Mailer {                          // @core/mail: console | allowlist | smtp
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<void>
}
export interface PasswordHasher {                  // Bun.password, Argon2id (§4.2)
  hash(plain: string): Promise<string>
  verify(plain: string, hash: string): Promise<boolean>
  needsRehash(hash: string): boolean               // compares m and t of the stored string with the configuration
  dummyVerify(plain: string): Promise<void>       // one verify against a fixed hash with the same parameters (§4.1)
}
export interface TokenSigner {                     // jose, ES256, key ring JWT_KEYS (§3.2)
  signAccess(claims: AccessClaims): Promise<string>
}
export interface OpenTicketsProbe {                // declared here, implemented by tickets in integrations/identity (DOC-12 §4.4)
  openTicketsOf(staffId: Uuid): Promise<Array<{ ticketId: Uuid; code: string; status: string }>>   // assigned, accepted, in_progress, on_hold
  reassignAll(fromStaffId: Uuid, toStaffId: Uuid): Promise<number>            // runs in the caller's transaction
}
```

`OpenTicketsProbe` follows the pattern DOC-12 §4.4 gives for `ActiveIntentProbe`: `identity` declares the port in its contracts and `tickets` ships the implementation in `integrations/identity`, so the module graph stays acyclic (`tickets` already calls `IdentityApi.getStaff`). The production start refuses to boot without the binding, like check 5 of DOC-36 §10.1 (DOC-36 owns the list; this probe is added to it with DOC-28).

### 2.2 `IdentityApi` (the contract, DOC-09 §7.3, with the additions of this document)

DOC-09 §7.3 holds `getStaff`, `listActiveStaff`, `getResidentAccounts`, `findResidentAccountsByPhoneFragment`, `findResidentAccountsByPhones`, `listDeletionRequests` and `verifyStepUp`. The units import, the household and the phone change need three more (DR-135). Like every contract they join the caller's transaction (DOC-09 §7.1).

```ts
interface IdentityApi {
  // …the seven calls of DOC-09 §7.3…
  findOrCreateResidentAccount(phone: string, displayName: string): Promise<{ accountId: Uuid; created: boolean }>
  changeResidentPhone(accountId: Uuid, newPhone: string): Promise<void>
  queueMemberInvitation(accountId: Uuid, params: { unitCode: string }): Promise<void>
}
```

| Call | Behavior |
| --- | --- |
| `findOrCreateResidentAccount` | Parses `phone` with `libphonenumber-js/max`, region `VN`, `isValid()` (DR-36, DR-114); an invalid number throws `ValidationError` with rule `phone_invalid`. Inserts with `ON CONFLICT (phone) DO NOTHING`; a conflict returns the existing account **unchanged** (its name is never overwritten, FR-18.1) and `created: false`. A `deleted:<id>` phone never matches. |
| `changeResidentPhone` | One `UPDATE … SET phone = :new WHERE id = :id AND status IN ('active', 'deletion_requested')`: 0 rows is `NotFoundError`; SQLSTATE `23505` on `resident_account_phone_key` is 409 `phone_in_use` (FR-18.4). It then revokes every refresh family of the account with reason `phone_changed` and writes one `identity.session_revoked.v1` per family (§3.8). The caller (`residency`) writes the audit row `residency.login_phone.change`. |
| `queueMemberInvitation` | Writes `identity.sms_requested.v1` with kind `member_invitation`, `expiresAt = now + 5 minutes`, after drawing one token from the phone's bucket `otp:phone:<e164>` (original SDD §7.7: the invitation is "counted in the phone's bucket"). An empty bucket throws `RateLimitedError` (429), so the caller's membership insert rolls back and the owner tries again later. The owner's cap of 10 invitations a day is `residency`'s (DOC-27). |

### 2.3 Use case signatures

```ts
// every command runs in one uow.run: reads that matter, writes, outbox events, audit (DOC-12 §8.3)
interface StaffSignIn {
  execute(i: { email: string; password: string; client: 'web' | 'app'; ip: string; userAgent: string }): Promise<SignInResult>
}
interface ResidentOtp {
  request(i: { phone: string; ip: string }): Promise<{ challengeId: Uuid; resendAfter: number; expiresIn: number }>
  verify(i: { challengeId: Uuid; code: string; ip: string; userAgent: string }): Promise<ResidentSignInResult>
}
interface SessionService {
  refresh(i: { refreshToken: string; userAgent: string }): Promise<RefreshResult>
  logout(i: { refreshToken: string }): Promise<void>
  list(actor: { kind: 'staff' | 'resident'; accountId: Uuid; sid: Uuid }): Promise<SessionDto[]>
  revoke(actor: { kind: 'staff' | 'resident'; accountId: Uuid; sid: Uuid }, sessionId: Uuid): Promise<void>
}
type AccessClaims =
  | { sub: Uuid; kind: 'staff'; role: StaffRole; bid: Uuid; sid: Uuid }
  | { sub: Uuid; kind: 'resident'; sid: Uuid }
```

## 3. Tokens and sessions

### 3.1 The access token

An ES256 JWT, valid 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`, FR-45.4). Header and claims (DR-38, ADR-0011):

```json
{ "alg": "ES256", "typ": "at+jwt", "kid": "k2" }
{ "iss": "rms", "sub": "0192f3c4-5a1e-7000-8000-000000000051", "kind": "staff", "role": "manager",
  "bid": "0192f3c4-5a1e-7000-8000-000000000001", "sid": "0192f3c4-5a1e-7000-8000-000000000062",
  "iat": 1792400000, "exp": 1792400900 }
```

A resident token is `{ "iss": "rms", "sub", "kind": "resident", "sid", "iat", "exp" }`: no building and no unit permission (a resident account can span buildings; the building comes from the selected membership, ADR-0010).

Verification (`@core/auth`, the vendored `jose` 6.2.13, DOC-11 §3) accepts only `alg = ES256`, reads `kid`, verifies with the key of that id, checks `iss = "rms"` and `exp` with a tolerance of 5 seconds, and refuses `alg: none`, an unknown `kid` and a missing `kind`. Every failure is 401 `unauthenticated`. The `role` claim is **informational**: the staff guard reads role and status from the database on every request (DOC-12 §5.3), so a changed role or a lock applies at once (FR-14.4). The `sid` ties the token to its refresh family; no request checks the family, so a revoked session's access token lives until it expires (at most 15 minutes, ADR-0011 negative consequence).

### 3.2 Signing keys and rotation

`JWT_KEYS` is a map `kid → PEM` (DR-65). Sign with the newest `kid` (the highest `k<n>`), verify with every `kid` in the map. Rotation is RB-12:

1. Add `k<n+1>` to `JWT_KEYS` and deploy: new tokens are signed with it; old tokens still verify.
2. Wait at least 30 minutes (the access lifetime of 15 minutes plus a margin; DR-65 gives "overlap ≥ 30 min").
3. Remove the old key and deploy. Tokens signed with it fail with 401 and the apps refresh once, which signs a new one.

Refresh tokens are random, not signed, so a rotation never invalidates a session. `bun run keys:generate` makes a key for `local` and `staging` (DR-65). A key is generated with `ES256` (P-256).

### 3.3 Delivery to the web CMS and to the apps

The staff app and the resident app keep the refresh token in `expo-secure-store` and send it in the request body. The web CMS (`admin.<domain>`) never sees it: the API puts it in a cookie (DR-130, ADR-0011).

| | Web CMS | Apps |
| --- | --- | --- |
| Who | staff, `client: "web"` | staff and residents, `client: "app"` (residents always) |
| Refresh token reaches the client in | `Set-Cookie` only | the JSON body only |
| Refresh token is sent back in | the cookie; the request must carry `X-Requested-With: rms` | the body `{ "refreshToken": "…" }` |
| Access token | the JSON body, kept in memory by the SPA | the JSON body |

The cookie:

```
Set-Cookie: __Secure-rms_refresh=<256-bit token, base64url>; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000
```

- No `Domain` attribute: the cookie is host-only on `api.<domain>`.
- `Max-Age` is the seconds until the token's own `expires_at` (30 days at sign-in, less near the 90-day cap), so the browser drops the cookie when the family can no longer refresh. Every refresh sets a new cookie.
- `__Secure-` is used instead of `__Host-` because `__Host-` forces `Path=/`, and the cookie must stay on `/api/v1/auth`.
- Logout answers `Set-Cookie: __Secure-rms_refresh=; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=0`.
- The SPA sends `credentials: 'include'`; CORS allows only `https://admin.<domain>` with credentials; `X-Requested-With: rms` on `/auth/refresh` and `/auth/logout` forces a preflight, which with `SameSite=Strict` is the CSRF defense (DR-38, DOC-39 owns the CORS rules).

*Client handling (DR-189, DOC-55 §5).* Every client keeps the access token in memory only. An app stores the refresh token in `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and writes the new one **before** it replays any waiting call. A refresh that gets no answer (network failure, timeout, 502/503/429) is not a sign-out: the client retries the same token after 1 s and 3 s, inside the grace window of §3.5, then reports the state `unknown`; only a 401 or 403 from the refresh ends the session. Web tabs share one refresh through the Web Locks API and a `BroadcastChannel`, so two tabs never present the same cookie twice.

**Which credential a refresh uses.** If the JSON body has `refreshToken`, it is used. Otherwise the cookie is used, and the request must carry `X-Requested-With: rms`, else 403 `forbidden` (a cross-site form post has the cookie but cannot set the header). With neither, 401 `unauthenticated`. A request that sends both uses the body and ignores the cookie.

### 3.4 Sign-in answers

Staff, web (`client: "web"`):

```http
POST /api/v1/auth/staff/login
Content-Type: application/json

{ "email": "minh.le@sunrise.example", "password": "Sunrise2026!", "client": "web" }
```
```http
HTTP/1.1 200 OK
Set-Cookie: __Secure-rms_refresh=…; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000

{ "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900,
  "staff": { "id": "0192f3c4-5a1e-7000-8000-000000000051", "fullName": "Lê Minh", "role": "manager",
             "buildingId": "0192f3c4-5a1e-7000-8000-000000000001", "language": "vi" } }
```

With `client: "app"` the body also carries `"refreshToken": "…"` and no cookie is set. A resident's `POST /auth/otp/verify` answer (§5.2):

```json
{ "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900, "refreshToken": "Zm9vYmFy…",
  "account": { "id": "0192f3c4-5a1e-7000-8000-000000000041", "phone": "+84901234567", "displayName": "Trần Thị Hoa",
               "language": "vi", "pushEnabled": true },
  "memberships": [ { "membershipId": "0192f3c4-5a1e-7000-8000-000000000061", "unitId": "0192f3c4-5a1e-7000-8000-000000000021",
                     "unitCode": "A-1508", "memberType": "owner", "canPay": true },
                   { "membershipId": "0192f3c4-5a1e-7000-8000-000000000062", "unitId": "0192f3c4-5a1e-7000-8000-000000000022",
                     "unitCode": "A-0703", "memberType": "tenant", "canPay": false } ] }
```

`memberships` are the **active** ones, from `ResidencyApi.listActiveMemberships(accountId)` (DOC-27 §2). An empty list is the "no unit is linked" case of UC-14 E7; the sign-in still succeeds.

### 3.5 Refresh: rotation, grace window, reuse

`POST /auth/refresh` runs the statements of DOC-16 §4.5 in one transaction. The raw token is never stored (only SHA-256), so the numbered steps are:

1. Take the credential (§3.3) and compute `token_hash = SHA-256(token)`.
2. **Consume**: the rotation `UPDATE` of DOC-16 §4.5 (`revoked_at IS NULL`, token not expired, family not revoked, family inside its absolute limit). One row means this request is the first user of the token: continue at step 5.
3. **No row: classify** with one `SELECT` of the token joined to its family (`revoked_at` of both, `in_grace = revoked_at > now() - 10 s`):
   - no token with that hash: 401 `unauthenticated`;
   - the family is revoked, or the token is expired, or the family passed its absolute limit: 401 (nothing else to do; the family is already dead or will be purged);
   - the token was rotated **within the last 10 seconds** (`in_grace`): continue at step 4;
   - the token was rotated **more than 10 seconds ago**: this is reuse. Revoke the family with reason `token_reuse`, revoke its tokens, write `identity.session_revoked.v1`, **commit**, then answer 401 (the statements of DOC-16 §4.5; the answer is thrown after the commit so the revocation is not rolled back, DOC-12 §8.1).
4. **Grace: mint a sibling.** The first response of the same call may have been lost on the network, and its raw token cannot be returned again, so a new token is inserted into the same family (no `replaced_by_id`, expiry as in step 5). The earlier successor stays valid until it is used or expires; if the client uses it after the sibling has been rotated more than 10 seconds ago, that is reuse and the family is revoked (DR-131). A stolen token used inside the 10-second window passes; ADR-0011 accepts it.
5. **Check the account** (DR-130): a staff family needs `staff_account.status = 'active'` (a temporary lockout, `locked_until`, does not stop a refresh); a resident family needs `status IN ('active', 'deletion_requested')`. Otherwise revoke the family with reason `account_locked`, `account_disabled` or `deleted` and answer 401. Read the `role` fresh for the new claims.
6. **Issue**: insert the successor with `expires_at = least(now() + sliding, family.absolute_expires_at)` (sliding is 30 or 180 days), set `last_used_at`, sign the access token.
7. For a resident, set `last_app_open_at` at most once an hour (§5.2).

```json
{ "accessToken": "eyJhbGciOiJFUzI1NiIs…", "expiresIn": 900, "refreshToken": "bmV4dC10b2tlbg" }
```

The web answer has no `refreshToken` and carries the new cookie. The grace statements were run on PostgreSQL 18.6 (AU-S03).

### 3.6 Lifetimes and the cap

| | Staff | Resident |
| --- | --- | --- |
| Access token | 15 min | 15 min |
| Refresh token (sliding, from the last use) | 30 days (`REFRESH_TTL_DAYS_STAFF`) | 180 days (`REFRESH_TTL_DAYS_RESIDENT`) |
| Family (absolute, from sign-in) | 90 days (`FAMILY_MAX_DAYS_STAFF`) | 365 days (`FAMILY_MAX_DAYS_RESIDENT`) |
| Live families per account | 10 (`MAX_FAMILIES_PER_ACCOUNT`) | 10 |

At sign-in, before the new family is inserted, the cap statement of DOC-16 §4.5 revokes the oldest families so that nine stay (reason `cap_exceeded`). It runs with `RETURNING id`, and one `identity.session_revoked.v1` is written per evicted family, so its device token is dropped and its stream closes (FR-45.3).

### 3.7 Sessions

A session is a refresh family (`sid`). The lists show only live families (`revoked_at IS NULL AND absolute_expires_at > now()`):

```sql
SELECT id, client, user_agent, created_at, last_used_at, id = :sid AS current
  FROM identity.refresh_family
 WHERE kind = :kind AND account_id = :account_id AND revoked_at IS NULL AND absolute_expires_at > now()
 ORDER BY last_used_at DESC;
```

`GET /me/sessions` and `GET /staff/sessions` answer:

```json
{ "items": [
  { "id": "0192f3c4-5a1e-7000-8000-000000000062", "client": "app", "device": "iPhone17,1, iOS 19.1", "createdAt": "2026-10-14T03:12:08.000Z",
    "lastUsedAt": "2026-10-20T01:02:11.000Z", "current": true },
  { "id": "0192f3c4-5a1e-7000-8000-000000000063", "client": "app", "device": "Pixel 9, Android 16", "createdAt": "2026-09-02T10:20:44.000Z",
    "lastUsedAt": "2026-10-18T16:59:08.000Z", "current": false } ] }
```

*Added 2026-10-28 (DR-300):* `IdentityApi.liveSessionIds(sessionIds)` applies the same predicate to a list of at most 500 session ids (any kind, any account) and returns the live ones; the push sender uses it to skip and delete the device tokens of sessions that ended by expiry, which writes no event (DOC-31 §6.2, DOC-09 §7.3):

```sql
SELECT id FROM identity.refresh_family
 WHERE id = ANY(:session_ids) AND revoked_at IS NULL AND absolute_expires_at > now();
```

`client` (`web` | `app`) is the column of the family, written at sign-in from the request's `client` (DR-130; a resident is always `app`, DR-225); a client picks the icon from it. `device` is computed on read from `user_agent` (it is stored raw, at most 300 characters). The apps send `User-Agent: rms-resident/1.0.0 (iOS 19.1; iPhone17,1)` (the staff app `rms-staff/…`); the label is `"<model>, <os>"`. A browser agent becomes `"<browser> on <os>"` by five patterns (Chrome, Edge, Firefox, Safari; macOS, Windows, Linux, Android, iOS); anything else is `"Unknown device"`. No library is used.

`DELETE /me/sessions/{id}` and `DELETE /staff/sessions/{id}` revoke one session with the conditional statement below and answer 204. Zero rows is 404 `not_found`: a session of another account looks like a missing one (UC-26 E3). Revoking the current session is allowed and equals a logout.

```sql
UPDATE identity.refresh_family SET revoked_at = now(), revoked_reason = 'user_revoked'
 WHERE id = :id AND kind = :kind AND account_id = :account_id AND revoked_at IS NULL
RETURNING id;
-- then: UPDATE identity.refresh_token SET revoked_at = now() WHERE family_id = :id AND revoked_at IS NULL;
-- and one identity.session_revoked.v1 (reason 'user_revoked')
```

`POST /auth/logout` takes the refresh token as its credential (body or cookie, §3.3), revokes its family with reason `sign_out` and answers 204 **whether or not the token is known** (a repeated logout is not an error). Its event deletes the device token and closes the staff stream.

### 3.8 Revocation matrix

One vocabulary is used by the column `refresh_family.revoked_reason` and by the field `reason` of `identity.session_revoked.v1` (DR-129). Every revocation sets `revoked_at` on the family and on its live tokens in one transaction, and writes one event per family.

| Cause | Families revoked | Reason | By whom |
| --- | --- | --- | --- |
| Sign out | that family | `sign_out` | the user |
| User ends a session in the list | that family | `user_revoked` | the user |
| A rotated refresh token used again after the grace window | that family | `token_reuse` | automatic |
| The 11th sign-in | the oldest families, down to nine | `cap_exceeded` | automatic |
| Staff account locked (`status = 'locked'`) | all of the account | `account_locked` | Manager, Admin |
| Staff account disabled | all of the account | `account_disabled` | Admin |
| Staff role changed | all of the account | `role_changed` | Admin |
| Staff password set from a **reset** link | all of the account | `password_changed` | the staff member |
| Resident login phone changed | all of the account | `phone_changed` | Manager, Admin |
| Resident account deletion executed | all of the account | `deleted` | the job `account_deletion` |
| A refresh finds the account locked, disabled or deleted | that family | `account_locked`, `account_disabled`, `deleted` | automatic |
| Staff temporary lockout (`locked_until`) | **none**: only sign-in is refused | — | automatic |
| Staff invite accepted, staff email changed, Manager unlock | none | — | — |
| A resident membership locked or removed | none: the membership is read on every request (DOC-27) | — | — |
| A new terms version | none: the terms gate answers 403 (DOC-35 §9.2) | — | — |
| The demo reset | the families of the demo building's accounts are deleted with them, no event (DOC-36 §10.2) | — | the job `demo_reset` |

The consumers of the event are `realtime` (closes the SSE streams of that session; sends `session.revoked` to staff) and `notification` (deletes the `device_token` of the session), DOC-09 §5.2. The event carries `accountKind`, `accountId`, `sessionId` and `reason`.

## 4. Staff

### 4.1 Sign-in

`POST /auth/staff/login` `{ email, password, client }` (DR-128). The body must be valid (`email` a valid address, at most 254 characters; `password` at most 128 characters; a longer password is refused before any hashing, so a long body cannot be used to burn CPU). The steps:

1. **IP bucket.** Draw one token from `staff-login:ip:<ip>` (30 per 15 minutes, FR-13.2). Empty: 429 `rate_limited` with `Retry-After`. Every attempt counts, successful or not.
2. **Find the account**: `SELECT … FROM identity.staff_account WHERE email = :email` (`citext`, so case does not matter).
3. **No account, or the status is not `active`, or `password_hash` is null** (an unknown email, a person still `invited`, a manual `locked`, a `disabled` one): run `dummyVerify(password)` (one Argon2id verify against a fixed hash of the configured parameters, so the timing class is the same as a real check) and answer 401 `invalid_credentials`. The body is identical for every one of these and for a wrong password (ER-20).
4. **Temporary lock.** `locked_until > now()`: answer 423 `account_locked` with `details.retryAfter` (seconds) and a `Retry-After` header, **without checking the password** (the correct password is refused during the lock, FR-13.1).
5. **Verify** the password with Argon2id.
6. **Wrong password.** Run the lockout statement of DOC-16 §4.1 with `:max_attempts = lockout.maxAttempts` and `:lock_minutes = lockout.minutes` (building settings, default 5 and 15, read through `BuildingApi.getSettings`). If it returns a row whose `locked_until` is in the future, or returns no row (a parallel attempt locked the account first), answer 423 as in step 4; otherwise 401 `invalid_credentials`. The attempt that reaches the limit is the first to see 423.
7. **Right password.** `UPDATE … SET failed_attempts = 0, locked_until = NULL, last_login_at = now()`. If `needsRehash(password_hash)` (§4.2), hash again with the current parameters and store it in the same statement. Evict old families (§3.6), insert the family (with the request's `client`) and the first token, sign the access token (§3.1), answer as in §3.4.

The answer never says how many tries are left: that would tell a stranger which emails exist, because an unknown email has no counter. The login screen shows "The email or password is not correct." and, after the lock, "Too many attempts. Try again in {minutes} minutes." (DOC-42 §5.3). DOC-02 (journey step 1) and DOC-04 (UC-17 A) said the screen shows "2 tries left"; both are revised (DR-128). A sign-in writes no audit row (FR-37 covers mutations); it writes the log line `auth.staff_login` with `outcome`, `staffId` when known and the IP, never the email or the password.

A successful sign-in of a **Manager or Technician on the web CMS** is not special: any role may sign in to any client its role can use; which screens a role gets is DOC-39 and the screen documents.

### 4.2 Passwords

| Rule | Value |
| --- | --- |
| Length | 8 to 128 characters (counted after normalization), never trimmed |
| Content | at least one letter (`\p{L}`) and one digit (`\p{Nd}`) |
| Normalization | NFC before hashing, so the same password typed on two keyboards matches |
| Breach list | none in phase 1 (DR-39) |
| Refusal | 400 `validation_failed`, rule `password_weak` |
| Algorithm | Argon2id through `Bun.password`: `memoryCost` 19,456 KiB, `timeCost` 2, parallelism 1 |
| Rehash | on sign-in, when the `m` or `t` of the stored string differs from the configuration |

Examples (FR-13.5): `abc12345` is accepted; `abcdefgh` (no digit), `12345678` (no letter), a 129-character password and `abc1234` (7 characters) are refused.

**Cost, measured** on 2026-10-20 on a development machine (Apple M2, Bun 1.4.3), not on the staging host: one hash 28 ms, one verify 19 ms on average over 20 runs, 8 verifies in parallel 44 ms. The stored string is `$argon2id$v=19$m=19456,t=2,p=1$…`, from which `needsRehash` reads `m` and `t`. DR-39 asks to benchmark on the staging host in P1-10 and raise the parameters if the host allows; the keys `ARGON2_MEMORY_KIB` and `ARGON2_TIME_COST` exist for that, and a change takes effect at each person's next sign-in. *Measured again 2026-10-23 (P1-10) with `scripts/bench-argon2.ts` on a second development machine (Intel i7-4790, 8 threads, Linux, Bun 1.4.3): hash 41 ms, verify 43 ms, 8 verifies in parallel 101 ms at the default parameters: well under the 250 ms sign-in budget, so the defaults stay. The staging host does not exist yet; the same script is run there when it does and the result is added to DR-39.*

### 4.3 Invite and reset

Both use `identity.password_token` (DOC-16 §4.4): 256 random bits, stored as SHA-256, consumed by one atomic statement. A new token of the same kind first consumes the older one (the partial unique index decides a race, test IDM-21).

| | Invite | Reset |
| --- | --- | --- |
| Issued by | `POST /staff/accounts` (Admin; Manager for Technician and Guard); `POST /auth/staff/invite/resend` (the same roles) | `POST /auth/staff/password-reset` `{ email }` (public) |
| Valid | 24 hours (`INVITE_TTL_HOURS`) | 30 minutes (`RESET_TTL_MINUTES`) |
| Link | `https://admin.<domain>/invite?token=<raw>` | `https://admin.<domain>/reset?token=<raw>` |
| Sent by | `identity.mail_requested.v1` kind `staff_invite` | the same event, kind `password_reset` |
| Account status needed | `invited` | `active` |
| After use | `invited → active` | counters cleared, every family revoked (`password_changed`) |

The links open in a browser; the apps have no change-password screen (DR-39).

*Revised 2026-10-20 (DR-150):* a reset request answers no earlier than `RESET_MIN_RESPONSE_MS` (150 ms, default) after it began, so the active-account path (two more writes) and the unknown-email path have the same response time class (FI-16); the `UPDATE staff_account` of the set-password step carries `AND status = :expected` (`invited` for an invite, `active` for a reset), and zero rows rolls the transaction back, leaves the link unconsumed and answers 400 `token_invalid`. The raw token travels only in `secretEnc` of the command (DR-117) and in the link.

**Reset request.** `POST /auth/staff/password-reset { "email": "…" }` always answers `202 {}` and takes the same time class for every input.
1. Draw one token from `reset:email:<lower(email)>` (3 per hour) and one from `reset:ip:<ip>` (10 per hour). Either empty: 429. Both buckets are keyed by the input, not by whether the account exists, so the 429 reveals nothing (FR-13.4).
2. If an account exists with the status `active`, issue the token and write the mail command. For an unknown email, a `locked`, `disabled` or `invited` account, do nothing and still answer 202 (an invited person asks for a resend of the invite; a locked person is helped by a Manager).

**Set password.** `POST /auth/staff/password { "token": "…", "password": "…" }`:
1. Validate the password rule first, so a weak password does not burn the link (400 `validation_failed`, `password_weak`).
2. In one transaction consume the token with the statement below; 0 rows is 400 `token_invalid` (unknown, expired and used links answer the same).
3. Set `password_hash`, clear `failed_attempts` and `locked_until`, and for an invite set `status = 'active'`.
4. For a reset only, revoke every family of the account (`password_changed`, §3.8). The invite has none.
5. Answer 204; the person signs in on the next screen. A reset also clears a temporary lockout (FR-13.6) but never a manual lock (`status = 'locked'`: that is a Manager's decision, FR-14.3).

```sql
UPDATE identity.password_token SET consumed_at = now()
 WHERE token_hash = :hash AND kind IN ('reset', 'invite') AND consumed_at IS NULL AND expires_at > now()
RETURNING staff_id, kind;
```

Run on PostgreSQL 18.6 (AU-S05): an invite at 25 hours returned no row; a reset link returned its row once and no row the second time. A link of 23 hours works and one of 25 hours does not; the account stays `invited` until the Admin resends (FR-14.2).

### 4.4 Staff accounts

The use cases behind `/staff/accounts*` (FR-14, UC-17). The screens are `W-Staff` and `W-Staff-New`.

| Action | Endpoint | Who | Needs step-up | Notes |
| --- | --- | --- | --- | --- |
| Create | `POST /staff/accounts` `{ fullName, email, role, language? }` | Admin (any role); Manager (Technician, Guard) | `admin_change` when `role = admin` | Status `invited`; `email_in_use` (409) on a duplicate; the language defaults to the building's `defaultLanguage`; audit `identity.staff.create` |
| Edit name or language | `PATCH /staff/accounts/{id}` `If-Match` | Admin; Manager (Technician, Guard) | no | Audit `identity.staff.update` |
| Change role | `PATCH` with `role` | Admin | `admin_change` when the new role is `admin` | Revokes every family (`role_changed`); see the open-tickets rule |
| Change email | `PATCH` with `email` | Admin | `staff_email` | Sessions stay: it is the same person (DR-133); the invite or reset goes to the new address |
| Lock | `POST /staff/accounts/{id}/lock` `{ reassignTo? }` | Manager (Technician, Guard); Admin (all) | no | `status = 'locked'`; revokes every family (`account_locked`); audit `identity.staff.lock`, or `identity.staff.force_lock` with `reassignTo` (FR-14.3) |
| Unlock | `POST /staff/accounts/{id}/unlock` | the same | no | Clears `failed_attempts` and `locked_until`; `locked → active`. One endpoint for both locks (FR-13.6) |
| Disable, enable | `POST /staff/accounts/{id}/disable`, `…/enable` | Admin | no | `disabled` revokes every family (`account_disabled`); the email stays reserved (DOC-20 §2.1) |
| Resend invite | `POST /auth/staff/invite/resend` `{ staffId }` | Admin; Manager (Technician, Guard) | no | Only for `invited`; consumes the older token; audit `identity.staff.update` with `details.invite = "resent"` |

*Revised 2026-10-20 (DR-147):* a Manager lists and reads all four roles (`GET /staff/accounts`, `GET /staff/accounts/{id}`); only actions on an Admin or a Manager stay 403. Source states: lock from `active`; unlock from `locked` or while `locked_until > now()`; disable from `invited`, `active` or `locked`; enable from `disabled` only (it returns `invited` when no password was ever set); anything else is 409 `invalid_transition`. `reassignTo` on lock, disable and role change always needs a `reason` (5…500 characters).

Rules (DR-133):

1. **A Manager touches only Technician and Guard accounts.** An action on an Admin or a Manager account by a Manager is 403 `forbidden`. A Manager creating an Admin is 403 `forbidden` (FR-14.1) before any step-up is asked.
2. **Nobody locks, disables or changes the role of their own account**: 403 `forbidden`, `details.reason = "self"`. Changing one's own name or language is `PATCH /staff/me`.
3. **The last active Admin of the building is protected.** Locking, disabling or demoting an Admin when no other `active` Admin of the building would remain is 409 `last_admin`. The check must be serialized, or two Admins who lock each other at the same moment both succeed and the building has none: the transaction first locks the building's active Admin rows (`SELECT id … WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE`) and then runs the update with the count in its `WHERE` (statement tested with two sessions, AU-S08; without the row lock both locks succeeded).
4. **Open tickets block lock, disable and a role change.** `OpenTicketsProbe.openTicketsOf(staffId)` lists the person's tickets in `assigned`, `accepted`, `in_progress` or `on_hold`; a non-empty list is 409 `staff_has_open_tickets` with `details.tickets` (FR-14.3). The Admin may pass `reassignTo` (an active Technician or Guard): the use case calls `OpenTicketsProbe.reassignAll(from, to)` in the same transaction, then does the change. A Manager cannot force.
5. **Every mutation writes an audit row in its transaction** (DOC-35 §4.2) and, when the sessions are revoked, the events of §3.8.
6. **Eligibility to sign in** is `status = 'active'` (and `locked_until` not in the future): `invited`, `locked` and `disabled` accounts cannot sign in or reset a password.

### 4.4.1 As built (P1-14, 2026-10-23, DR-261)

The use cases are `CreateStaffAccount`, `UpdateStaffAccount`, `LockStaffAccount`, `UnlockStaffAccount`, `DisableStaffAccount` and `EnableStaffAccount`; the reads (E-39, E-41) are `StaffQueries.list` and `get`; the routes are in `presentation/staff-routes.ts`. `StaffAccount` decides who may do what (`assertManagedBy`, `assertNotSelf`, the source states) and returns the guarded change; `StaffSafeguards` holds the two rules that need other rows (the last active Admin, the open tickets); `StaffSessions` ends every session of the account with one event per family. What the build settled:

- **The order of refusals** is the one of DOC-51 §8 and security.md: role of the route (403), then what the actor may not do to this kind of account (403, a Manager creating an Admin before any proof is asked for), then the proof that is missing (`step_up_required`, decided from the body before any statement), then the rows (404, 409). A request for a role change or an email change by a Manager is 403 before a row is read.
- **One proof per request** (DR-261 (2)): a body that is both a promotion to Admin and an email change is 400 rule `one_step_up_action`. `admin_change` is asked whenever the body names `role: "admin"`.
- **Forced lock, disable and role change.** `reassignTo` is the Admin's (403 for a Manager); it needs a reason of 5…500 characters (422 `reason_too_short`) and an active Technician or Guard of the building (422 `assignee_locked`); the tickets move in the transaction of the change through `OpenTicketsProbe.reassignAll`. A lock with `reassignTo` is audited as `identity.staff.force_lock`, a disable or a role change with it as `.disable` or `.update` with `details.reassignedTo` and the reason. Until `tickets` exists (P3) the container binds a probe that finds no ticket, so nothing blocks a lock yet; the test harness supplies one that does.
- **Lost races.** Lock, unlock, disable and enable carry no version: the aggregate decides on the row it read, one statement guarded by `status` and `version` applies it, and a statement that found the row moved reads it again and decides again (DR-255), so the second of two locks is 409 `invalid_transition`. `PATCH` guards on the `If-Match` version: 428 without it, 409 `version_conflict` when it is stale or a second edit used the same one. A taken email is 409 `email_in_use` (`uq_staff_account_email`, any case).
- **Disabling an invite.** `invited → disabled` is allowed (DR-147), which the table's check refused; migration `0003` relaxes it (DR-261 (1)). `enable` of such an account returns `invited`.
- **Not built.** `PATCH /staff/me` (name and language of oneself, DR-147) comes with the CMS profile screen (P1-16). The idempotency second net `token_purge` (DOC-38 §4.2) has no job yet.

### 4.5 Step-up

Step-up protects three actions (FR-50, DR-39, glossary "sensitive staff action"): change the gateway configuration or the receiving account (`gateway_config`), create or promote an Admin (`admin_change`), change a staff email (`staff_email`). The proof is the Admin's password and a 6-digit code mailed to the Admin's own address.

```mermaid
sequenceDiagram
  autonumber
  participant W as Web CMS (Admin)
  participant API as API
  participant ID as identity
  participant DB as PostgreSQL
  participant MQ as Outbox and worker
  W->>API: POST /staff/step-up {action}
  API->>ID: StepUp.request
  ID->>DB: consume the live code of (staff, action); insert the new one; outbox step_up_code
  API-->>W: 204
  MQ-->>W: mail with the code (valid 10 minutes)
  W->>API: PUT /staff/gateway {…, stepUp {password, code}}
  API->>ID: IdentityApi.verifyStepUp (inside the action's transaction)
  alt password and code are right
    ID->>DB: consume the code; outbox step_up_notice for every active Admin
    API->>DB: the change, audit row, commit
    API-->>W: 200
  else any failure
    ID->>DB: count the failure in its own transaction
    API-->>W: 403 step_up_failed
  end
```

*Revised 2026-10-20 (DR-147):* for a step-up action the route first refuses a non-Admin with 403 `forbidden`, and only an Admin without `stepUp` gets 403 `step_up_required`.

**Request.** `POST /staff/step-up { "action": "gateway_config" }` (Admin only, 204). In one transaction: consume the live code of `(staff_id, 'step_up', action)`, insert the new row, write `identity.mail_requested.v1` kind `step_up_code` (`params {action}`, `secretEnc` the encrypted code, `expiresAt` +10 minutes). The code is 6 digits from the CSPRNG (uniform by rejection, as the OTP). The stored value is `HMAC-SHA256(OTP_HMAC_KEY, "stepup:" || staff_id || ":" || action || ":" || code)` in hex, so a code is bound to the person and the action: a code requested for `staff_email` does not open `gateway_config`, and another Admin's code is a different value (DR-132). The request draws one token from `stepup:staff:<id>` (5 per hour, `platform.rate_bucket`); empty is 429. The statements are DOC-16 §4.4 (AU-S01).

**Proof.** A sensitive request carries `"stepUp": { "password": "…", "code": "482913" }`. A request with no `stepUp` is 403 `step_up_required` (`details.action`), decided by the route before any database work (FR-50.2). `IdentityApi.verifyStepUp(staff, action, proof)` then runs inside the action's transaction:

1. Read the staff row. Verify the password with Argon2id. Wrong, or the account is in a temporary lock: record a failure (below), count it toward the sign-in lockout with the statement of §4.1 step 6, and throw `StepUpFailedError`.
2. Consume the code with the atomic statement of DOC-16 §4.4 (bound to `staff_id` and `action`). No row: record a failure and throw.
3. Success. Write one `identity.mail_requested.v1` kind `step_up_notice` for **every active Admin of the building**, the actor included (`params {action, actorName}`), in this transaction, so the notices exist only if the change commits (FR-50.4, DOC-36 §7.3). `notification.inbox_on_identity_mail_requested` turns each into the inbox entry `staff.step_up_done`.

Every failure is 403 `step_up_failed` with `details.attemptsLeft` (the attempts left of the live code, `5 − attempts`, or 0 when there is none). The answer is the same for a wrong password, a wrong code, an expired code, a used code and another Admin's code (FR-50.2).

**Counting a failure survives the rollback (DR-132).** The action's transaction is rolled back when `verifyStepUp` throws, which would also roll back the counter, and an attacker holding a stolen session could then try codes for ever. So the counting writes of a failure (`attempts + 1` on the live code, and the lockout counter) run in **their own short transaction on a second connection**, committed before the exception is thrown. This is the only place where identity opens a second transaction inside a request. `@core/db` gets one more behavior for it (DOC-12 §8.1, behavior 5): `database.autonomous(fn)` runs `fn` in a transaction on a separate pool connection, outside the ambient one. The autonomous statements touch `password_token` and `staff_account`, which the action's transaction has not yet written when a failure happens (the checks come first), so they cannot wait on it. The success path writes only in the ambient transaction.

The five wrong codes of FR-50.3 consume the live code; the next proof fails with `attemptsLeft: 0` until the Admin asks for a new code. A wrong password counts toward the lockout of §4.1 and not toward the code's attempts.

## 5. Resident OTP

### 5.1 Request

`POST /auth/otp { "phone": "+84901234567" }` (DR-37, DR-134). The phone is parsed with `libphonenumber-js/max` region VN; a number that is valid nowhere is 400 `validation_failed` with rule `phone_invalid`. The steps, in this order (the order matters: a refused request must spend as little as possible and must not reveal more than SDD §7.3 accepts):

1. **IP bucket.** One token from `otp:ip:<ip>` (20 per hour, `OTP_PER_IP_PER_HOUR`). Every request spends one, whatever its outcome, so enumerating phones is throttled too. Empty: 429.
2. **Find the account** by phone with `status IN ('active', 'deletion_requested')`. None: 404 `phone_not_registered`, no challenge, no SMS (FR-15.1). The enumeration trade-off is accepted (SDD §7.3, DR-37).
3. **Resend gate.** If a live challenge exists and its `resend_after > now()`: 429 `rate_limited` with `Retry-After` = the seconds left (FR-15.2). No token is spent.
4. **Phone bucket.** One token from `otp:phone:<e164>` (5 per hour). Empty: 429 with `Retry-After`.
5. **SMS provider check** (a real account only): the heuristic of §5.4; 503 `sms_unavailable` when it says down.
6. **Daily cap.** `SELECT count(*) FROM identity.otp_challenge WHERE created_at > now() - interval '24 hours'` ≥ `OTP_DAILY_CAP` (3,000): refuse with 503 `sms_unavailable`, raise the counter `otp_daily_cap_reached_total` and the alert (FR-15.5, DR-37). It is a rolling 24 hours, not a calendar day (an account has no building, so it has no building day; DR-134).
7. **Issue**, one transaction: consume the live challenge of the phone whose resend wait is over (`resend_after <= now`, DR-256), insert the new one (`expires_at = now() + 5 min`, `resend_after = now() + 45 s`), and unless the account is a demo account write `identity.sms_requested.v1` kind `otp` (`secretEnc` the encrypted code, `expiresAt` the challenge's expiry). The statements are DOC-16 §4.3.
8. Answer `202`:

```json
{ "challengeId": "0192f3c4-5a1e-7000-8000-000000000071", "resendAfter": 45, "expiresIn": 300 }
```

The code is 6 digits from `crypto.getRandomValues`, uniform by rejection (no modulo bias). `code_hmac = HMAC-SHA256(OTP_HMAC_KEY, "otp:" || challenge_id || ":" || code)` in hex: the challenge id binds the value, so the same code on another challenge has another hash. The message text and the sender are §5.4.

**Daily cap and launch day.** At go-live about 650 residents sign in within days (original SDD §7.3), mostly on mobile data, but some on the building's Wi-Fi behind one public IP. The ceiling of 20 challenges per IP per hour can refuse them. `OTP_PER_IP_PER_HOUR` is configuration for this reason: raise it for the first days (DOC-103 lists it) and put it back.

### 5.2 Verify

`POST /auth/otp/verify { "challengeId": "…", "code": "482913" }`. One transaction:

1. The consume statement of DOC-16 §4.3 (`code_hmac` equal, not consumed, not expired, `attempts < 5`) returns the phone. For a **demo account** the statement of §5.3 is used instead.
2. No row: the attempts statement of DOC-16 §4.3 (`attempts + 1`, consumed at the fifth) and **commit**, then answer 400 `otp_invalid` with `details.attemptsLeft = 5 − attempts` (4, 3, 2, 1, 0; FR-15.3). A challenge that is unknown, expired or already consumed answers 400 `otp_invalid` with `attemptsLeft: 0`. The failure counters are written before the exception, as in §3.5.
3. A row: load the account by phone (`active` or `deletion_requested`), evict families (§3.6), insert the family and the first token (`client = 'app'`, `user_agent`, 365-day absolute limit), set `last_app_open_at` with the throttled statement below, sign the access token, read the active memberships (`ResidencyApi.listActiveMemberships`) and answer as in §3.4.

```sql
UPDATE identity.resident_account SET last_app_open_at = now()
 WHERE id = :id AND (last_app_open_at IS NULL OR last_app_open_at < now() - interval '1 hour');
```

Two taps on "verify" cannot both sign in: the second finds `consumed_at` set (FR-15.4). Five guesses in parallel are at most five attempts, because the counter is one statement. The throttled update writes the column at most once an hour per account (AU-S09), so a resident who opens the app often does not produce a write per refresh.

### 5.3 Demo accounts and the fixed code

A resident account with `is_demo = true` (the demo building's accounts, DOC-36 §9.1) signs in with the fixed code `123456` and receives **no SMS** (DR-37, DR-60). The request path creates a real challenge row with a random hash that no one knows, and writes no SMS command. The verify path accepts the fixed code only when the challenge's phone belongs to a flagged account:

```sql
UPDATE identity.otp_challenge c SET consumed_at = now()
 WHERE c.id = :challenge_id AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
   AND EXISTS (SELECT 1 FROM identity.resident_account a WHERE a.phone = c.phone AND a.is_demo)
RETURNING phone;
```

The use case calls this statement only when `code = DEMO_FIXED_OTP`; for every other code, and for every non-flagged account, the ordinary statement runs. Run on PostgreSQL 18.6 (AU-S04): the flagged phone returned its row; the same statement for a non-flagged phone changed nothing. `DEMO_FIXED_OTP = '123456'` is a constant in the code, not configuration, so no environment can change it. The three guards against a fixed code reaching a real account: the statement's `is_demo` condition; the boot guard check 1 (a flagged account in a non-demo building stops `production` and `staging`, DOC-36 §10.1, test BD-30); and `SMS_DRIVER` check 4 of the same table.

### 5.4 The senders

`identity.send_sms` and `identity.send_mail` are afterSideEffect handlers in the worker (DOC-09 §5.2). The commands carry ids and an encrypted secret, never a number, an address or a plaintext code (DR-117).

**`identity.send_sms`**, per command:
1. If `expiresAt` has passed, return normally and write nothing (FR-15.7, MC-15).
2. Read the account (phone, `language`, `is_demo`). A demo account: return normally with the `warn` line `skipped_demo` (DOC-36 §9.2).
3. Decrypt `secretEnc` in memory (`SecretBox` with the settings key ring, DR-117), build the text, call `SmsSender.send`, forget the secret. A provider failure throws, and the outbox retries: class `sms`, at most 3 attempts (DOC-09 §4.2).

Texts have no diacritics and at most 160 characters (the brandname rule, DR-37). `{brand}` is `SMS_BRAND`.

| Kind | `vi` | `en` |
| --- | --- | --- |
| `otp` | `{code} la ma xac thuc dang nhap {brand}. Co hieu luc 5 phut. Khong chia se ma nay.` | `{code} is your {brand} login code. Valid for 5 minutes. Do not share it.` |
| `member_invitation` | `Ban duoc moi vao can ho {unitCode} tren ung dung {brand}. Tai ung dung va dang nhap bang so dien thoai nay: {appUrl}` | `You are invited to unit {unitCode} on the {brand} app. Get the app and sign in with this number: {appUrl}` |

Example: `482913 la ma xac thuc dang nhap SUNRISE. Co hieu luc 5 phut. Khong chia se ma nay.` is 84 characters. `{appUrl}` is `APP_DOWNLOAD_URL`.

**`identity.send_mail`** reads the address from `staff_account`, renders the mail in the staff member's `language` from the catalog, and sends it with `Mailer`. The mail holds only a link or a code and generic text (DR-58, DR-68). Subjects: invite "Set your password", reset "Reset your password", step-up code "Your confirmation code", notice "A sensitive change was made". A command past its `expiresAt` is skipped (the longest is the 24-hour invite).

**The SMS provider is down (DR-134).** UC-14 E4 wants 503 `sms_unavailable` when the provider is down, but sending is asynchronous. `POST /auth/otp` therefore asks whether the recent commands are failing, from the outbox of `identity` (cached 15 seconds in the process):

```sql
SELECT count(*) FILTER (WHERE last_error IS NOT NULL AND published_at IS NULL) AS failing,
       count(*) FILTER (WHERE published_at IS NOT NULL)                        AS delivered
  FROM identity.outbox_messages
 WHERE type = 'identity.sms_requested.v1' AND occurred_at > now() - interval '10 minutes';
```

The provider counts as down when `failing >= SMS_DOWN_FAILURES` (3) **and** `delivered = 0`. Then new challenges are refused with 503 `sms_unavailable` and `Retry-After: 60` until a command is delivered or the window passes. A command that was skipped as expired counts as delivered (it returned normally), which is a known false negative: if every command expires unsent, the provider check does not trigger; the alert `outbox lag` (DOC-40, RB-04) is the second net. The window is small (a few thousand rows at most), so the query is a scan of `identity.outbox_messages`, no new index. Tested on PostgreSQL 18.6 as part of AU-S10.

### 5.5 Drivers and the production check

| Environment | `SMS_DRIVER` | `MAIL_DRIVER` | What happens |
| --- | --- | --- | --- |
| `local`, `test` | `console` | `console` | The message, code included, is written to the log |
| `staging` | `allowlist` | `allowlist` | A real send only for numbers in `SMS_ALLOWLIST` and addresses in `MAIL_ALLOWLIST`; any other recipient is logged `not_allowlisted` and **returns normally** |
| `production` | `provider` | `smtp` | The adapter chosen by DR-68 (the Owner picks before P1-22); the brandname registered |

The boot guard refuses `production` when `SMS_DRIVER` is `console` or `allowlist` or the mail driver is the console (DOC-36 §10.1 check 4). The provider adapter (`modules/identity/src/infrastructure/sms/<provider>.ts`) is written in P1-22 after the Owner picks the provider (DR-68, Owner 2026-10-21); it needs only `send` and reports an HTTP failure as an exception. A delivery receipt is not used in phase 1. Until P1-22 there is no adapter behind the `allowlist` driver: P1-10 and P1-11 run on `console` and `allowlist` (every message to a recipient outside the list is logged `not_allowlisted`) and on Mailpit for local mail.

### 5.6 As built (P1-11, 2026-10-23, DR-256)

The resident side is `RequestOtp` and `VerifyOtp` (use cases), the aggregates `OtpChallenge` and `ResidentAccount` (`domain/`), `SmsCommands` and the handler `identity.send_sms`, and the routes `POST /auth/otp`, `POST /auth/otp/verify`, `GET /me`, `GET /me/sessions` and `DELETE /me/sessions/{id}`. What differs from the text above, or was left open:

- **The aggregate decides, one statement applies** (DR-255). `OtpChallenge.verify` returns the change that spends the challenge, `countFailure` the change that counts a wrong code and spends the challenge at the fifth; `decide` loads again after a lost race, so 50 guesses in parallel are five tries and two taps on "verify" sign in once. The demo statement of §5.3 is `OtpChallengeRepository.applyDemo`, which keeps the `EXISTS … is_demo` clause **in the statement**: the use case also checks `isDemo`, but the statement is what no race can bypass.
- **The resend gate is atomic.** The issue statement spends only a challenge whose `resend_after` has passed (DOC-16 §4.3), so two requests for one phone at the same instant leave one challenge and the loser gets 429 with `Retry-After` = `OTP_RESEND_AFTER_SECONDS`. Without the clause the later request consumed the earlier challenge and both answered 202.
- **SMS texts are catalog keys** `sms.otp` and `sms.member_invitation` (`@rms/i18n-catalog`, family `sms`), not a table in the handler; a test pins 160 characters and no diacritics in Vietnamese. `SMS_BRAND` and `APP_DOWNLOAD_URL` are the only parameters the handler adds.
- **Ports.** `SmsSender` (drivers `ConsoleSmsSender` and `AllowlistSmsSender` in the module; `SMS_DRIVER=provider` has no adapter before P1-22, so `apps/api` binds a sender that throws and the outbox retries, then the provider probe answers 503 `sms_unavailable`), `PhoneNumbers` (`libphonenumber-js/max` 1.13.15 behind a port, because `application/` may not import it), `SmsProviderProbe` (the query of §5.4, cached 15 s), and `ActiveMemberships` (`ResidencyApi.listActiveMemberships`, stood in by "none" until P1-12: the sign-in answers `memberships: []`).
- **Guards.** `resident()` verifies the token (`kind = resident`) and loads nothing else, as DOC-12 §5.3 says; `GET /me` answers 401 for an account that is `deleted`. The terms gate is `createTermsGate(building)` in `apps/api`: the `unit(capability)` guard of P1-12 calls it once it knows the building from the membership; a token-only route has no gate (DOC-35 §9.2, DR-143). `GET /me/terms` and `POST /me/terms` need that building, so they come with P1-12.
- **Not here.** `changeResidentPhone` and `queueMemberInvitation` (§2.2, DR-135, AU-52, AU-53) are consumed by the staff API and the household routes, so they join with P1-14 and P4-10 (*as built in P1-14, 2026-10-23, DR-261:* both are in `IdentityApi`, with `findResidentAccountsByPhoneFragment` and `listDeletionRequests`; AU-52 and AU-53 run in `modules/identity/test/resident-admin.integration.test.ts`) (*as built in P1-13, 2026-10-23, DR-258:* `findOrCreateResidentAccount` and `findResidentAccountsByPhones` are here, for the units import; AU-51 runs in `modules/identity/test/resident-lookup.integration.test.ts`); `PATCH /me` (the avatar needs `FilesApi`) with P1-16. The metrics of §10 wait for P1-18: the log lines `auth.otp_requested`, `auth.otp_verified`, `auth.sms` and the `warn` line `otp_daily_cap_reached` carry the outcomes meanwhile.

## 6. Rate buckets

All five families live in `identity.rate_bucket` (DOC-16 §4.6) so an unauthenticated flood cannot touch the table the rest of the API uses (DR-85). The acquire statement is DOC-16 §4.6's single upsert. A bucket has a capacity (the burst) and a refill rate; a limit of "N per period" is capacity `N` and rate `N / period`. The bucket therefore allows a burst of `N`, and up to about `2N` in any one period: at most 10 SMS for a phone and 40 challenges for an IP in any hour, which is what NFR-07 states (DR-171).

| Key | Capacity | Refill | Spent by | Refused answer |
| --- | --- | --- | --- | --- |
| `otp:ip:<ip>` | 20 (`OTP_PER_IP_PER_HOUR`) | 20 per hour | every `POST /auth/otp` | 429 `rate_limited` |
| `otp:phone:<e164>` | 5 (`OTP_PER_PHONE_PER_HOUR`) | 5 per hour | an issued OTP and a member invitation | 429 `rate_limited` |
| `staff-login:ip:<ip>` | 30 (`STAFF_LOGIN_PER_IP`) | 30 per 15 min | every `POST /auth/staff/login` | 429 `rate_limited` |
| `reset:email:<lower(email)>` | 3 (`RESET_PER_EMAIL_PER_HOUR`) | 3 per hour | every reset request | 429 `rate_limited` |
| `reset:ip:<ip>` | 10 (`RESET_PER_IP_PER_HOUR`) | 10 per hour | every reset request | 429 `rate_limited` |
| `stepup:staff:<id>` (in `platform.rate_bucket`: the caller is authenticated) | 5 (`STEPUP_REQUESTS_PER_HOUR`) | 5 per hour | every `POST /staff/step-up` | 429 `rate_limited` |

`Retry-After` after a refusal is `ceil((1 − tokens) / rate)` seconds, computed by a `SELECT` of the bucket in the same transaction. The client IP is the one the request context provides: the trusted-proxy rule that picks it from `CF-Connecting-IP` is DOC-39's (DR-07). Cloudflare also has one rule on `/api/v1/auth/*` (DR-64): it is the outer net; these buckets are the ones the tests prove. The sign-in lockout of §4.1 is a counter on the account, not a bucket.

## 7. Endpoints

Audience is the `audience` route metadata of DOC-12 §5.3 (`public`, `resident`, `staff`). Errors name only the codes this document adds meaning to; the catalog is DOC-42.

| Method and path | Audience | Success | Main errors | Section |
| --- | --- | --- | --- | --- |
| `POST /auth/staff/login` | public | 200 | 401 `invalid_credentials`, 423 `account_locked`, 429 | §4.1 |
| `POST /auth/staff/password-reset` | public | 202 | 429 | §4.3 |
| `POST /auth/staff/password` | public | 204 | 400 `token_invalid`, 400 `password_weak` | §4.3 |
| `POST /auth/staff/invite/resend` | staff: admin, manager | 204 | 403, 404, 409 `invalid_transition` | §4.4 |
| `POST /auth/otp` | public | 202 | 404 `phone_not_registered`, 429, 503 `sms_unavailable` | §5.1 |
| `POST /auth/otp/verify` | public | 200 | 400 `otp_invalid` | §5.2 |
| `POST /auth/refresh` | public (refresh token) | 200 | 401, 403 `forbidden` (cookie without the header) | §3.5 |
| `POST /auth/logout` | public (refresh token) | 204 | — | §3.7 |
| `POST /staff/step-up` | staff: admin | 204 | 429 | §4.5 |
| `GET/POST /staff/accounts`, `PATCH /staff/accounts/{id}` | staff: admin, manager | 200, 201 | 403, 409 `email_in_use`, `last_admin`, `staff_has_open_tickets`, `version_conflict`; 403 `step_up_required`, `step_up_failed` | §4.4 |
| `POST /staff/accounts/{id}/lock`, `…/unlock`, `…/disable`, `…/enable` | staff: admin, manager (lock, unlock: Technician and Guard) | 200 | as above | §4.4 |
| `GET /staff/me`, `PATCH /staff/me` (name, language, push, avatar) | staff | 200 | 400 | §4.4 |
| `GET /staff/sessions`, `DELETE /staff/sessions/{id}` | staff | 200, 204 | 404 | §3.7 |
| `GET /me`, `PATCH /me` (language, push, avatar; the name and the phone change only through the Manager) | resident | 200 | 400 | §1.2 |
| `GET /me/sessions`, `DELETE /me/sessions/{id}` | resident | 200, 204 | 404 | §3.7 |

`GET /me` answers the account and `memberships` as in §3.4 (the terms gate exempts it, DOC-35 §9.2); `GET /staff/me` answers the `staff` object of §3.4. Device tokens (`POST/DELETE /me/devices`, `/staff/devices`) belong to `notification` (DOC-31). `PATCH /staff/accounts/{id}`, with `If-Match`, returns the new `ETag`.

## 8. Transactions and concurrency

What commits together, and what arbitrates each race. Every statement named here is DOC-16's or this document's and was run (§13).

| Operation | Commits together | Arbiter | If the process dies |
| --- | --- | --- | --- |
| Staff sign-in | counter reset or increment, family, first token | the lockout `UPDATE` with its `WHERE` (one statement) | Nothing committed: the person tries again; a counted wrong password stays counted |
| Failed password | the lockout counter alone, committed before the 401 or 423 | one statement; 20 parallel wrong passwords leave `failed_attempts = 5` (IDM-S02) | The count is either committed or not |
| OTP issue | the consume of the older challenge, the new challenge, the SMS command | partial unique index `otp_challenge_one_live_per_phone` | No challenge and no SMS, or both |
| OTP verify | challenge consume, family, first token | `UPDATE … WHERE consumed_at IS NULL` | The code is consumed only if the session was created |
| Refresh | consume of the old token, successor, family `last_used_at` | the rotation `UPDATE`; the unique `token_hash` | The old token still works (rolled back) |
| Reuse | the revoke of family and tokens, the event | `UPDATE … WHERE revoked_at IS NULL`; committed before the 401 | Revoked or not, never half |
| Step-up request | consume of the older code, the new code, the mail command | partial unique index `password_token_one_live` | No code and no mail, or both |
| Step-up proof | consume of the code, the notices, **and the action itself** | the single-use `UPDATE`; the action's own arbiter | Rolled back: the code is still live, no notice |
| Step-up failure | `attempts + 1` and the lockout counter, **in their own transaction** | the attempts statement | The count is committed even though the action rolls back |
| Lock or disable a staff member | status, every family revoked, events, audit, reassignment | the row locks of §4.4 rule 3 | All or nothing |

**Several `api` replicas.** Nothing is cached across requests except the signing keys (read at start), the building settings (60 seconds, DOC-36 §3.1) and the SMS-down check (15 seconds). A lock, a revocation or a role change is read from the database on the next request, so two replicas never disagree.

## 9. Configuration

Environment keys, read by `identity`'s configuration slice (DOC-12 §2.3). The building settings `lockout.maxAttempts` (5) and `lockout.minutes` (15) are DOC-17 §1.2, not environment. DOC-41 lists every key; these are owed to it.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `JWT_KEYS` | secret map | — | `kid → PEM`, ES256 (DR-65) |
| `OTP_HMAC_KEY` | secret | — | HMAC key of OTP codes and step-up codes (DR-65) |
| `ACCESS_TOKEN_TTL_SECONDS` | int | 900 | Access token lifetime |
| `REFRESH_TTL_DAYS_STAFF`, `REFRESH_TTL_DAYS_RESIDENT` | int | 30, 180 | Sliding refresh lifetime |
| `FAMILY_MAX_DAYS_STAFF`, `FAMILY_MAX_DAYS_RESIDENT` | int | 90, 365 | Absolute family lifetime |
| `MAX_FAMILIES_PER_ACCOUNT` | int | 10 | Live sessions per account |
| `REFRESH_GRACE_SECONDS` | int | 10 | Window in which a rotated token is accepted once more |
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` | int | 19456, 2 | Argon2id parameters |
| `INVITE_TTL_HOURS`, `RESET_TTL_MINUTES`, `STEPUP_TTL_MINUTES` | int | 24, 30, 10 | Link and code lifetimes |
| `STEPUP_MAX_ATTEMPTS`, `STEPUP_REQUESTS_PER_HOUR` | int | 5, 5 | Wrong codes before the code dies; code requests per staff member |
| `OTP_TTL_SECONDS`, `OTP_RESEND_AFTER_SECONDS`, `OTP_MAX_ATTEMPTS` | int | 300, 45, 5 | OTP parameters (original SDD §7.3) |
| `OTP_PER_PHONE_PER_HOUR`, `OTP_PER_IP_PER_HOUR`, `OTP_DAILY_CAP` | int | 5, 20, 3000 | OTP limits (DR-37) |
| `STAFF_LOGIN_PER_IP`, `RESET_PER_EMAIL_PER_HOUR`, `RESET_PER_IP_PER_HOUR` | int | 30 per 15 min, 3, 10 | Sign-in and reset limits (DR-39) |
| `SMS_DOWN_FAILURES` | int | 3 | Failing commands that mark the provider down (§5.4) |
| `SMS_DRIVER`, `MAIL_DRIVER` | enum | `console` | `console`, `allowlist`, `provider` or `smtp` (§5.5) |
| `SMS_ALLOWLIST`, `MAIL_ALLOWLIST` | list | empty | Recipients that may receive a real message in `staging` |
| `SMS_BRAND`, `APP_DOWNLOAD_URL`, `ADMIN_BASE_URL` | string | — | Sender text, the invitation link, the base of invite and reset links |
| `SMS_*`, `SMTP_*` | secret | — | Provider credentials (DR-65) |

## 10. Metrics and logs

Names and labels follow DOC-40 (owed). All are counters unless the type says otherwise. A label never holds an email, a phone or an id of a person.

| Metric | Type | Labels |
| --- | --- | --- |
| `auth_staff_login_total` | counter | `outcome` (`ok`, `invalid`, `locked`, `rate_limited`) |
| `auth_lockouts_total` | counter | — |
| `auth_otp_requested_total` | counter | `outcome` (`issued`, `not_registered`, `resend_wait`, `phone_limited`, `ip_limited`, `daily_cap`, `sms_down`) |
| `auth_otp_verify_total` | counter | `outcome` (`ok`, `invalid`, `expired`, `exhausted`) |
| `otp_challenges_24h` | gauge | — (the count of §5.1 step 6) |
| `otp_daily_cap_reached_total` | counter | — |
| `auth_refresh_total` | counter | `outcome` (`ok`, `grace`, `reuse`, `expired`, `account_inactive`) |
| `auth_sessions_revoked_total` | counter | `reason` (the ten reasons of §3.8) |
| `auth_step_up_total` | counter | `action`, `outcome` (`requested`, `ok`, `failed`, `rate_limited`) |
| `sms_provider_down` | gauge | — (1 while §5.4 says down) |
| `sms_sent_total`, `mail_sent_total` | counter | `outcome` (`sent`, `expired`, `skipped_demo`, `not_allowlisted`, `failed`) |

**As built (P1-18, DOC-40 §4.3, DR-269).** All the metrics of this table exist, reported through `MetricsPort`. Where they count: `auth_staff_login_total` and `auth_lockouts_total` in `SignInStaff` (a lockout is the failed attempt that starts the lock); `auth_otp_requested_total` and `otp_daily_cap_reached_total` in `RequestOtp`; `auth_otp_verify_total` in `VerifyOtp`, where `expired` is an unknown, spent or late challenge (the answer to the caller is the same as for a wrong code, FR-15.3); `auth_refresh_total` in `RefreshSession`; `auth_sessions_revoked_total` in `SessionEvents.revoked`, once per revoked family, so every reason of §3.8 is counted in one place; `auth_step_up_total` in `RequestStepUp` and `VerifyStepUp`; `sms_sent_total` and `mail_sent_total` in the two handlers, with `skipped_unknown` for an account or staff member that no longer exists, `failed` for each failed try (the outbox retries) and `not_allowlisted` from the `allowlist` driver (`SmsSender.send` answers it, so it is not counted as `sent` too). `otp_challenges_24h` and `sms_provider_down` are gauges read at the scrape from the module's tables (`AppModule.gauges`).

Alerts owed to DOC-40, each with a runbook: the daily cap reached (`otp_daily_cap_reached_total` increases; RB-06), `auth_refresh_total{outcome="reuse"}` above 5 in 10 minutes (possible token theft), `auth_lockouts_total` above 10 in 15 minutes, and `sms_provider_down = 1` for 5 minutes (RB-06).

Log lines (`info` unless stated), fields `event`, `outcome`, `accountKind`, `accountId` when known, `ip`, `requestId`: `auth.staff_login`, `auth.otp_requested`, `auth.otp_verified`, `auth.refresh` (`warn` for `reuse`, with `sessionId`), `auth.session_revoked` (`reason`, `sessionId`), `auth.step_up` (`action`, `outcome`), `auth.sms` (`skipped_demo` is `warn`), `auth.boot_guard_failed` (`error`, DOC-36). The OTP code, the step-up code, a token, a password, an email and a phone are never logged, except by the `console` driver in `local` and `test`.

## 11. Errors and handling

| Situation | Behavior |
| --- | --- |
| Wrong password, unknown email, an account not `active` | 401 `invalid_credentials`, identical body (§4.1) |
| Temporary lock | 423 `account_locked`, `details.retryAfter`, `Retry-After` |
| A bucket is empty | 429 `rate_limited`, `Retry-After` |
| Unregistered phone | 404 `phone_not_registered`, 0 SMS |
| Wrong or stale OTP | 400 `otp_invalid`, `details.attemptsLeft` |
| SMS provider down, daily cap reached | 503 `sms_unavailable`, `Retry-After: 60` |
| Invalid or expired access token | 401 `unauthenticated` |
| Reuse of a refresh token | the family is revoked and committed, then 401 `unauthenticated`; the apps return to sign-in (FR-45.2) |
| A cookie refresh without `X-Requested-With` | 403 `forbidden` |
| Reset or invite link unknown, expired or used | 400 `token_invalid` |
| A sensitive request without `stepUp` / with a failed proof | 403 `step_up_required` / 403 `step_up_failed` |
| An email already used | 409 `email_in_use` |
| The last active Admin | 409 `last_admin` (new, owed to DOC-42) |
| A staff member with open tickets | 409 `staff_has_open_tickets` with `details.tickets` |
| The provider or the mail relay fails while sending | the outbox retries; an SMS is dropped after `expiresAt` (5 minutes), a mail after its own expiry |
| The key ring has no key for a token's `kid` | 401; the alert on `auth_refresh_total` does not fire (an access failure), the log has `reason: "unknown_kid"` |

## 12. Required tests

Prefix `AU-` (registered in master plan §0.2; DOC-88 indexes it). "(race)" tests run against a real PostgreSQL (DR-77); "fake clock" tests use `FakeClock`. IDs of the table tests of DOC-16 §9 (`IDM-`) are not repeated.

| ID | Scenario | Expected |
| --- | --- | --- |
| AU-01 | 20 parallel wrong passwords for one email (race, FR-13.1) | `failed_attempts` is 5, the account is locked 15 minutes, no request errors with 500 |
| AU-02 | The correct password during the lock | 423 `account_locked` with `retryAfter` between 1 and 900; the password is not verified (no Argon2 call, measured by a spy) |
| AU-03 | The first wrong password after the lock ended (fake clock +15 min 1 s) | 401; `failed_attempts` is 1 and `locked_until` is null |
| AU-04 | One IP makes 31 sign-in attempts across 31 emails in 15 minutes (FR-13.2) | the 31st is 429 `rate_limited` with `Retry-After` |
| AU-05 | A reset link used at 29 min 59 s, again, and at 30 min 01 s; a newer link requested before use | the first use works once; the second and the 30 min 01 s use are 400 `token_invalid`; the older link is refused after the newer is issued (FR-13.3) |
| AU-05b | The same reset link used twice in parallel (DR-255) | one sets the password; the other is 400 `token_invalid` |
| AU-06 | Reset for a known and an unknown email; 4 requests for one email in an hour; 11 from one IP | identical `202 {}` and body for the first two; the 4th for the email and the 11th for the IP are 429 (FR-13.4) |
| AU-07 | Passwords `abc12345`, `abcdefgh`, `12345678`, `abc1234`, 129 characters | the first is accepted; the others are 400 `password_weak` (FR-13.5); a link used with a weak password is not consumed |
| AU-08 | Manager unlocks a locked Technician; a completed reset of a temporarily locked Manager | sign-in works at once in both; a reset does not unlock a manual `locked` account (FR-13.6) |
| AU-09 | A wrong password for a known email and any password for an unknown email | the same 401, the same body bytes, and both call Argon2 once (spy) (ER-20) |
| AU-10 | Sign-in for an `invited`, a manually `locked` and a `disabled` account with the right password | each is 401 `invalid_credentials`; no counter moves |
| AU-11 | A stored hash with `m = 4096` and a right password | the sign-in works and the stored hash now has the configured `m` and `t` |
| AU-12 | A Manager creates a Technician, then an Admin; an Admin creates all four roles (FR-14.1) | Technician 201; Admin 403 `forbidden`; the Admin's four creations succeed (the Admin one with a valid step-up) |
| AU-13 | An invite used at 23 h and at 25 h; then resent | works at 23 h; at 25 h 400 `token_invalid` and the status stays `invited`; the resent link works (FR-14.2) |
| AU-14 | Lock a Technician holding tickets in `assigned`, `accepted`, `in_progress`, `on_hold`; then the Admin forces with `reassignTo` (FR-14.3) | the Manager gets 409 `staff_has_open_tickets` listing four tickets; the Admin's forced lock succeeds, the tickets are reassigned in the same transaction and one `identity.staff.force_lock` audit row exists |
| AU-15 | A staff role change, then a lock; the next request with the old access token (FR-14.4) | refused at once (the guard reads the row); every family is revoked with `role_changed` and `account_locked`; one event per family |
| AU-16 | Create an Admin, promote to Admin, change an email, each without a valid step-up (FR-14.5) | 403 `step_up_required` each; with a valid step-up each succeeds |
| AU-17 | Two Admins lock each other at the same moment, the building having only those two (race) | exactly one lock succeeds; the other is 409 `last_admin`; one Admin stays active |
| AU-18 | A Manager or an Admin locks, disables or changes the role of their own account | 403 `forbidden` with `details.reason = "self"` |
| AU-19 | A Manager locks, edits or resends the invite of an Admin or a Manager | 403 `forbidden` |
| AU-20 | OTP for a registered and an unregistered phone (FR-15.1) | the first is 202 with one SMS command; the second 404 `phone_not_registered` and no outbox row |
| AU-21 | Verify at 4 min 59 s and at 5 min 01 s; resend at 30 s and at 46 s (fake clock; FR-15.2) | the first verify works, the second 400 `otp_invalid`; the resend at 30 s is 429 with `Retry-After` 15, the one at 46 s is accepted and consumes the earlier challenge |
| AU-22 | Five wrong codes (FR-15.3) | each is 400 `otp_invalid` with `attemptsLeft` 4, 3, 2, 1, 0; the correct code afterwards is also `otp_invalid` |
| AU-23 | Two verifies of the correct code in parallel (race, FR-15.4) | exactly one 200; one family exists |
| AU-24 | 50 requests for one phone 46 s apart with a fake clock; 200 phones from one IP (FR-15.5, EXP-09, DR-171) | 8 SMS commands for the phone in 37.6 minutes (5 at once, then one per 12 minutes) and never more than 10 in any 60 minutes; at most 20 challenges for the IP; the 21st request from the IP is 429 even for unregistered phones |
| AU-25 | The 3,001st challenge in 24 hours | 503 `sms_unavailable`; `otp_daily_cap_reached_total` increases; the count ignores a challenge 24 h 1 min old |
| AU-26 | The code `123456` for a flagged demo account and for a non-flagged one (FR-15.6) | 200 for the first; 400 `otp_invalid` for the second (attempt counted); the demo request wrote no SMS command |
| AU-27 | Boot with a flagged account in a non-demo building, in `production` | the process exits 78 (the test is BD-30, run from here too) |
| AU-28 | An SMS command whose `expiresAt` is 6 minutes old; a provider that fails 3 times (FR-15.7) | nothing is sent for the first (no dead letter); the second is dead after 3 attempts |
| AU-29 | Three failing commands in 10 minutes and none delivered | `POST /auth/otp` is 503 `sms_unavailable` with `Retry-After: 60`; after one command is delivered the next request is 202 |
| AU-30 | The OTP command for code `482913` | the outbox payload holds neither the code nor the phone; `secretEnc` decrypts to the code (also MC-14) |
| AU-31 | An account with 3 sessions revokes one (FR-45.1) | its family and tokens are revoked (`user_revoked`), `identity.session_revoked.v1` is written, its refresh is 401; another account's session id is 404 |
| AU-32 | A rotated token used again 11 s after its rotation (FR-45.2) | 401, the whole family revoked with `token_reuse`, committed |
| AU-33 | The same token sent twice within 10 s (a lost response) | both are 200; the second creates a sibling; the first successor and the sibling both refresh once |
| AU-33b | Ten parallel refreshes of one token (DR-255) | exactly one spends it (`replaced_by_id` set once); the other nine mint a sibling; eleven tokens in the family, which stays live |
| AU-34 | Eleven sign-ins of one account (FR-45.3) | ten live families; the oldest is revoked with `cap_exceeded` and one event |
| AU-35 | Refresh at day 29, 31 (staff) and 179, 181 (resident) after the last use, and at day 91 and 366 after sign-in (fake clock; FR-45.4) | the sliding limit and the absolute limit each refuse; a refresh at day 29 extends to day 59 but never past day 90 |
| AU-36 | Refresh with a token of a revoked family | 401 and no new event |
| AU-37 | Refresh for a staff member locked or disabled after sign-in; for a deleted resident | 401; the family is revoked with `account_locked`, `account_disabled` or `deleted`; a temporarily locked (`locked_until`) staff member still refreshes |
| AU-38 | A token signed with `k1` while the ring holds `k1` and `k2`, and after `k1` is removed | verifies in the first case; 401 `unauthenticated` in the second; new tokens are signed with `k2` |
| AU-39 | The cookie of a web sign-in | `__Secure-rms_refresh`, `Path=/api/v1/auth`, `Secure`, `HttpOnly`, `SameSite=Strict`, no `Domain`, `Max-Age` ≤ 2,592,000 and ≤ the days left of the 90-day cap |
| AU-40 | `POST /auth/refresh` with the cookie and without `X-Requested-With`; with the header; with a body token | 403 `forbidden`; 200; 200 (the body is used) |
| AU-41 | A resident token on a `/staff/*` route and a staff token on `/me/*` (FR-16.4) | 401 `unauthenticated` each, whatever the role |
| AU-42 | An expired token, a token with a changed payload, `alg: none`, an unknown `kid`, `iss` other than `rms` | 401 `unauthenticated` each |
| AU-43 | A step-up code (FR-50.1) | 6 digits; valid 10 minutes (refused at 10 min 1 s); single use; a second request consumes the first |
| AU-43b | The right step-up code verified twice in parallel (DR-255) | one succeeds; the other is 403 `step_up_failed` |
| AU-44 | A proof with no `stepUp`, a wrong code, an expired code, a used code, a wrong password, another Admin's code (FR-50.2) | 403 `step_up_required` for the first; 403 `step_up_failed` for the other five; the action changed nothing |
| AU-45 | A code requested for `staff_email` used for `gateway_config` | 403 `step_up_failed` |
| AU-46 | Five wrong codes, then the right one (FR-50.3) | the fifth consumes the challenge; the right code is 403 `step_up_failed` with `attemptsLeft: 0`; the counts were committed although each action rolled back |
| AU-46b | Parallel wrong codes, four then three (DR-255) | each is counted until the fifth; the fifth consumes the challenge; the sixth and seventh count nothing; every answer is 403 `step_up_failed` |
| AU-47 | A wrong password in a step-up proof | 403 `step_up_failed`; `failed_attempts` of the Admin + 1; the code's `attempts` unchanged; five such proofs lock sign-in |
| AU-48 | A successful step-up change (FR-50.4) | one `step_up_notice` command per active Admin (actor included) and, after the relay, one inbox entry `staff.step_up_done` each; the audit row has the changed fields and no secret |
| AU-49 | A successful `verifyStepUp` followed by a business failure (409 `gateway_in_use`) | the transaction rolls back: the code is still live and no notice exists |
| AU-50 | Six step-up requests in an hour for one staff member | the sixth is 429 |
| AU-51 | `findOrCreateResidentAccount` twice for one phone in parallel, with two names (race) | one account; one call `created: true`; the name of the first is kept |
| AU-52 | `changeResidentPhone` to a free number and to a number with an account | all families revoked (`phone_changed`) and one event each; 409 `phone_in_use` for the second and nothing changes |
| AU-53 | `queueMemberInvitation` for a phone whose OTP bucket is empty | 429 `rate_limited`; the caller's insert rolls back |
| AU-54 | A resident opens the app 5 times in 30 minutes | `last_app_open_at` is written once |
| AU-55 | `GET /me/sessions` and `GET /staff/sessions` | the current session is marked; `client` is `web` for a staff sign-in with `client: "web"` and `app` otherwise; the `device` labels of `rms-resident/1.0.0 (iOS 19.1; iPhone17,1)` and of a Chrome on macOS user agent are `iPhone17,1, iOS 19.1` and `Chrome on macOS` |

**Run in P1-11 (2026-10-23, PostgreSQL 18.6; `modules/identity/test/otp.integration.test.ts`, `resident-sessions.integration.test.ts`, `apps/api/tests/integration/resident-auth.integration.test.ts`):** AU-20…26, AU-28 (the expiry and the provider failure of the handler; the three attempts and the dead letter are the relay's, MC-16), AU-29, AU-30, AU-31, AU-32, AU-34 and AU-35 for a resident, AU-37 for a deleted resident, AU-41 over HTTP, AU-54, AU-55 (the list in the module and over HTTP), AU-S04 and AU-S10. AU-24 ages the rate buckets by SQL with the fake clock, because the bucket reads the database clock (§6). AU-27 runs as `runBootGuard` with a fake `ResidencyApi` (§5.6); the process-level exit 78 waits for P1-12, which binds the real memberships (until then no account has one, so the check passes by construction). Not run: AU-51…53 (P1-12, P1-14). The 50 parallel wrong guesses, the two parallel verifies and the two parallel requests of one phone are tests of the module, not rows of the table above.

**Run in P1-14 (2026-10-23, PostgreSQL 18.6; `modules/identity/test/staff-accounts.integration.test.ts`, `resident-admin.integration.test.ts`, `src/domain/staff-account.test.ts`, `apps/api/tests/integration/staff-accounts.integration.test.ts`):** AU-12 (the four creations, the Admin one with a step-up; a Manager creating an Admin is 403 before a proof is asked, also over HTTP), AU-13 (23 h, 25 h, the resent link), AU-14 (four tickets block the Manager's lock, the Admin's forced lock moves them and writes one `identity.staff.force_lock` row with its reason; the assignee rule), AU-15 (a role change and a lock end every family, one event each; over HTTP the next request with the old access token is 401), AU-16 (creating an Admin, promoting to Admin and changing an email: 403 `step_up_required` without a proof, `step_up_failed` with a wrong one, success with a right one; over HTTP too; the audit row hides the new email), AU-17 (two Admins lock each other: one succeeds, the other is `last_admin`; AU-S08), AU-18 (self: lock, disable, role change; `details.reason = "self"`), AU-19 (a Manager locks, edits and unlocks only Technician and Guard accounts; no role or email), AU-08 (unlock of a manual lock and of a temporary lockout; `invalid_transition` otherwise), AU-37 for staff (disable ends every session; enable returns `active`, or `invited` with no password), AU-51 (earlier, P1-13), AU-52, AU-53, AU-S06 and the paging, filters and diacritic-free search of E-39 and the 404 of another building's id. Added and not in the table: the `If-Match` of E-42 (428, 409, two edits with one version), `Idempotency-Key` of E-40 (replay, 400, 422, `email_in_use`), the phone-fragment search, `listDeletionRequests` and `lastAppOpenAt`.

**DR-255 (2026-10-23).** The statements of §13 are no longer written in the repositories: `StaffAccount`, `RefreshFamily` and `PasswordToken` decide, and each repository applies the change in one guarded `UPDATE` (`applyTransition`); the lockout count and the code count decide again with `decide` (30 tries at most). AU-01…50 run unchanged. Set-based statements stay statements: the eviction of the oldest families, the revocation of every family of an account, and the supersede of an older link or code.

## 13. Statements run

Tested on PostgreSQL 18.6 (`postgres:18.6`, container removed afterwards) on 2026-10-20, on a database built from the DDL of DOC-16 §3.1 and §4 (the scripts are in the author's scratchpad and are not kept in the repository; the IDs are for DOC-88). Statements already tested in DOC-16 §9.3 (lockout, rotation, token consume, OTP issue and verify, deletion) are not repeated.

| ID | Statement | Result |
| --- | --- | --- |
| AU-S01 | Step-up issue (consume the live code, insert the new one) twice; then five wrong codes with the attempts statement; then the right code | the first code is consumed by the second request; attempts 1, 2, 3, 4, 5 and the challenge consumed at the fifth; the right code returns 0 rows |
| AU-S02 | The rolling count of challenges in the last 24 hours with rows 24 h 58 min, 2 h and 0 s old | the row of 25 h is excluded, count 2 |
| AU-S03 | Refresh: consume of a token already rotated 3 s ago; the classification query; the sibling insert; then the same token rotated 30 s ago | 0 rows for the consume; `in_grace` true; the sibling is added with no successor; at 30 s `in_grace` false, the family revoke returns the family once and a second call returns 0 rows |
| AU-S04 | The demo verify statement for a flagged and a non-flagged phone | the flagged phone returns its row, the other 0 rows |
| AU-S05 | The link consume with `kind IN ('reset', 'invite')`: an invite of 25 h, a reset, the reset again; then the password set (reset clears the lock, invite activates) | 0 rows; one row; 0 rows; `failed_attempts 0`, `locked_until` null; status `active` |
| AU-S06 | `changeResidentPhone` to an existing phone, then to a free one | `23505` on `resident_account_phone_key`; the free one succeeds |
| AU-S07 | `findOrCreate`: a new phone, the same phone with another name | the first returns the id (`created`); the second inserts nothing; the name is the first |
| AU-S08 | Two Admins lock each other: with the row lock of §4.4 rule 3, and without it | with it: A locked, B 0 rows (`last_admin`); without it: both locked, no active Admin |
| AU-S09 | `last_app_open_at` throttled update, twice | the first writes, the second 0 rows |
| AU-S10 | The SMS-down query over a seeded outbox: 3 failing, 0 delivered; then 3 failing, 1 delivered | `failing 3, delivered 0` (down); `failing 3, delivered 1` (not down) |
| AU-S11 | Session list; revoke of another account's session; revoke of one's own; revoke all of an account with `RETURNING id` | the list marks the current one; 0 rows; 1 row; one id per live family |
| AU-S12 | The revised CHECK of `refresh_family.revoked_reason` (DR-129) with `password_changed` and `account_disabled`; and `email_changed` | the first two are accepted, the third is `23514` |

Not run: the Argon2 and JWT code paths (run in P1-10), the SMS provider, the cookie behavior in a browser, and the race of verifyStepUp with its autonomous transaction (AU-46 runs it with the real pool). The Argon2 timing of §4.2 is from a development machine.

## 14. Decisions made while writing

Every new decision is a DR (decided, Claude delegated by the Owner) and is summarized here.

| ID | Decision | Where used |
| --- | --- | --- |
| DR-128 | Staff sign-in answers: one body for every credential failure; 423 only for an existing, temporarily locked account; no "tries left"; a dummy Argon2 verify keeps the timing class; manual lock, `disabled` and `invited` answer `invalid_credentials`; password rule with NFC; DOC-02 and DOC-04 wording revised | §4.1, §4.2 |
| DR-129 | One vocabulary of ten reasons for the revocation of a session, in the column and in the event; a password reset revokes every family; an email change does not; DOC-16 and DOC-09 revised | §3.8 |
| DR-130 | Token delivery: `client: "web" \| "app"`, the cookie `__Secure-rms_refresh`, the body credential wins over the cookie, logout takes the refresh token and is idempotent, a refresh re-checks the account | §3.3, §3.5, §3.7 |
| DR-131 | The refresh grace window mints a sibling token, because the raw token is never stored | §3.5 |
| DR-132 | Step-up internals: the code is an HMAC bound to staff and action, requests are throttled to 5 an hour, failures are counted in an autonomous transaction (`database.autonomous`), and `verifyStepUp` writes the notices | §4.5 |
| DR-133 | Staff account rules: a Manager only touches Technician and Guard; no self lock, disable or role change; the last active Admin is protected (`last_admin`) with a row lock; open tickets block lock, disable and role change (`OpenTicketsProbe`); only `active` staff can sign in or reset | §4.4 |
| DR-134 | OTP: the order of the checks, every request spends the IP token, the demo account gets a real challenge, the daily cap is a rolling 24 hours, `sms_unavailable` is derived from the outbox, `last_app_open_at` is written at most hourly, SMS texts and `SMS_BRAND` | §5 |
| DR-256 | The resident OTP as built: the resend gate is atomic (the issue statement spends only a challenge whose wait is over), the SMS texts are catalog keys, the phone parser, the SMS driver, the provider probe and the memberships sit behind ports, `resident()` loads nothing, the contract calls of DR-135 join with P1-12 and P1-14 | §5.6 |
| DR-261 | The staff accounts as built: a disabled account may have no password (check relaxed, migration `0003`), one step-up proof per request, `reassignTo` is the Admin's with a reason, lost races decide again, `OpenTicketsProbe` is a contract bound by a stand-in until P3; the four resident calls for `residency` | §4.4.1, §2.2 |
| DR-135 | `IdentityApi` gains `findOrCreateResidentAccount`, `changeResidentPhone`, `queueMemberInvitation`; `ResidencyApi` is asked for `listActiveMemberships` at sign-in | §2.2, §3.4 |

## 15. Not in this document

| Topic | Lives in |
| --- | --- |
| Tables, DDL, indexes and their tests | DOC-16 §4, §9 |
| Membership, `UnitContext`, the policy table, household, transfer, phone change on the residency side | DOC-27 |
| The terms gate and account deletion (workflow, job, audit) | DOC-35 §9, §10; DOC-20 §8 |
| The boot guard (all six checks) and the demo seed | DOC-36 §9, §10 |
| CORS list, security headers, the trusted-proxy rule, the endpoint × role matrix | DOC-39 |
| Message payloads, retry classes, the `ResidencyApi` calls other than the additions here | DOC-09 |
| The numbered endpoint catalog and request schemas | DOC-51 |
| Error catalog | DOC-42 §5.3 |
| Screens (`Login`, `OTP`, `W-Login`, `W-Reset`, `W-Step-Up`, `Sessions`, …) and their copy | DOC-57, DOC-60, DOC-64, DOC-68 |
| Metrics, alerts, runbooks (RB-06 SMS failures, RB-12 key rotation) | DOC-40, DOC-80, DOC-86 |
| Device tokens and push | DOC-31 |
| Job schedules (`otp_purge`, `token_purge`, `account_deletion`) | DOC-38 §4; purge statements DOC-20 §5 |

## 16. Traceability

| Section | Decisions | Requirements and tests |
| --- | --- | --- |
| §3 tokens and sessions | DR-38, DR-65, DR-129, DR-130, DR-131 | FR-16.3, FR-16.4, FR-45; NFR-08; AU-31…42, AU-55 |
| §4.1–§4.3 staff sign-in, invite, reset | DR-39, DR-107, DR-128 | FR-13, FR-14.2; AU-01…11, AU-13 |
| §4.4 staff accounts | DR-39, DR-133, DR-147, DR-261 | FR-14, FR-38.1; AU-12, AU-14…19 |
| §4.5 step-up | DR-39, DR-87, DR-132 | FR-50; AU-43…50 |
| §5 resident OTP | DR-37, DR-60, DR-68, DR-134, DR-135 | FR-15; NFR-07; AU-20…30, AU-51…54; EXP-09 |
| §6 buckets | DR-37, DR-39, DR-64, DR-85 | FR-13.2, FR-13.4, FR-15.5; AU-04, AU-06, AU-24, AU-50 |

## Open questions

None yet. Decisions made while writing are DR-128 to DR-135 and DR-261 (§14); they are decided and do not block Phase 1. The provider and brandname of the SMS adapter are the Owner's (DR-68: not chosen yet, ports and fake drivers first; the Owner picks before P1-22, which M1 needs for the real SMS OTP); the Argon2 parameters are confirmed on the staging host in P1-10 (DR-39).
