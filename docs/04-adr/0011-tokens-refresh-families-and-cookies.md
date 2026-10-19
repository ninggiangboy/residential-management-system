# ADR-0011: Sign short-lived ES256 access tokens, rotate refresh families with reuse detection, and keep the web refresh token in a SameSite=Strict cookie

- Status: Accepted
- Date: 2026-10-19 · Related: DR-38, DR-36, DR-39, DR-83, FR-45, NFR-07, NFR-08, EXP-10

## Context

Staff use the web CMS (`admin.<domain>`, static on Cloudflare Pages) and the staff app; residents use the resident app. The API is `api.<domain>` through the Tunnel, so the web CMS and the API are **same-site but cross-origin** (DR-83). Residents sign in with an SMS they must wait for and rarely sign out. Needs: revoke a session or a whole account fast, rotate signing keys without a downtime, survive a stolen refresh token, and let every user see and end their sessions (original SDD §7.6).

## Options considered

1. **Opaque server sessions only.** Revocation is instant — but every request hits the database for the session and the mobile and web clients still need a refresh story.
2. **Long-lived JWTs.** No refresh flow — but nothing can be revoked before it expires.
3. **Shared-secret signing (HS256).** Simpler — but every verifier holds the signing key and rotation has no overlap.
4. **Short-lived asymmetric access token plus rotating, revocable refresh tokens in families.** Cookie for the browser, secure storage for native.
5. **Browser refresh token in `localStorage`.** Works cross-origin without CORS cookies — but script-readable, so any XSS steals the session.

## Decision

Option **4** is chosen.

- **Claims.** Staff `{sub, kind:"staff", role, bid, sid, iat, exp}`; resident `{sub, kind:"resident", sid, iat, exp}` — no building claim and no unit permission (ADR-0010). Header `kid`. Access lifetime 15 minutes.
- **Signing.** ES256. `JWT_KEYS` holds several `kid → PEM`: sign with the newest, verify with all. Rotation (RB-12): add the new key, deploy, wait 15 minutes plus the access lifetime, remove the old key.
- **Refresh tokens.** 256-bit random, stored as SHA-256, rotated on every use with reuse detection and a 10-second grace window; reuse outside the window revokes the family (FR-45.2). A family is one device (`sid`). At most 10 live families per account; the 11th sign-in revokes the oldest.
- **Lifetimes: sliding with an absolute cap.** Staff 30 days sliding, 90 absolute; resident 180 sliding, 365 absolute.
- **Web CMS.** The refresh token is a cookie `Secure; HttpOnly; SameSite=Strict; Path=/api/v1/auth`, host-only on `api.<domain>`. The SPA sends `credentials: 'include'`; CORS allows only the admin origin with credentials; the required header `X-Requested-With: rms` on refresh and logout forces a preflight, which together with `SameSite=Strict` is the CSRF protection.
- **Mobile.** The refresh token is in the request body and kept in the platform secure store; no cookies in native apps.
- **Revocation.** Locking or deleting an account, a resident phone change and a staff role change revoke every family; the staff role and status are also re-read on each request, so a locked staff member is refused at once. `GET /me/sessions` and `DELETE /me/sessions/{id}` (and the staff equivalents) back the session lists.
- Step-up for sensitive staff actions (DR-39) is separate and does not change a session.

## Consequences

**Positive**

- A stolen access token dies in 15 minutes; a stolen refresh token is detected on first reuse and the family is revoked.
- Key rotation is a deploy; no downtime and no forced sign-out.
- The browser never exposes the refresh token to script.

**Negative**

- The CSRF defense depends on `SameSite=Strict` and on the two domains staying same-site. Moving the web CMS to a different registrable domain breaks the cookie and needs a new decision.
- Reuse detection with a 10-second grace window accepts a replay inside the window.
- Access tokens are not revocable before expiry; only the database re-read of the role and status closes that gap for staff, and the membership read for residents (ADR-0010).
- Native refresh tokens are as safe as the device's secure store.

**Follow-up work**

- Write DOC-26 (endpoints, rate buckets, revocation matrix, `AU-` tests) and DOC-39 (CORS, cookie and header rules); RB-12 for key rotation.
- Container and trust boundaries: [DOC-07](../03-architecture/system-context-and-containers.md); library choices: DOC-11.
