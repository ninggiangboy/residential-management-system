# Error handling

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-28 (DR-279: §10 points to the usage endpoint) · 2026-10-26 (DR-268: the upload target is the S3 store, not R2; DR-267: `too_many_units`; earlier: P1-04: the handler and the request line are built, §3 has no `requestId` in the body, DR-247; earlier: DR-220: rule-code keys; DR-143, DR-149: `request_in_progress`, `one_change_only`, `min_properties`; DR-133, DR-134, DR-137, DR-139: `last_admin`, `sms_unavailable`, `member_exists`, `unit_code_in_use`, `can_pay_tenant_only`) · DOC-42
> Depends on: original SDD §17.3, §19.2, §19.3, [DR](../00-decision-register.md) (DR-57, 58, 62, 63, 71, 74, 84, 103, 117, 118, 127), [ADR-0023](../04-adr/0023-api-conventions.md), [ADR-0009](../04-adr/0009-transactional-outbox-inbox-and-contracts.md), [DOC-03](../01-product/requirements.md), [DOC-04](../01-product/use-cases.md), [DOC-09](../03-architecture/messaging-contracts.md) §4, [DOC-10](../03-architecture/quality-attributes.md) §8, [DOC-12](../03-architecture/code-architecture.md) §8, §12, [DOC-19](../05-data/db-roles-and-grants.md) §2, [DOC-35](audit-privacy-and-terms.md), [DOC-36](building-configuration-and-demo.md), [DOC-37](files-and-uploads.md), [DOC-38](jobs-and-outbox-runtime.md), [DOC-06](../02-glossary.md)
> Main readers: P1-03, P1-04 (`apps/api` error handler, request context, logger), P1-05, every task that adds an endpoint or a handler, DOC-24, DOC-26, DOC-28…DOC-33, DOC-40, DOC-50, DOC-51, DOC-68

This document is the one place that says how the system fails: the shape of an error answer, the exception classes and what each becomes, how a database error becomes an answer, the catalog of codes with their HTTP status, `details` and message key, what a worker handler does with each kind of failure (the mapping DOC-09 §4.4 leaves here), what is logged and what never is, and what a client does with each answer. It does not hold the endpoint list (DOC-51 gives each endpoint its codes by reference to this catalog), the UI text of each state (DOC-68), the metrics and alerts (DOC-40), or the retry numbers of the outbox (DOC-09 §4.2).

Every code in the documents written so far is in §5, including the ones earlier documents left as "refused (409; the exact code is fixed in DOC-50)". The new decision is DR-127 (§11). The SQLSTATE of a unique violation, a check, a not-null, a missing privilege and a lock timeout, and the content of their `DETAIL`, were observed on PostgreSQL 18.6 on 2026-10-19 (§14.1).

## 1. Scope and reading guide

| Question | Answer lives in |
| --- | --- |
| What does an error answer look like? | §3 |
| Which exception becomes which answer? | §4 |
| What is the list of codes? | §5 |
| What do the webhook, the SSE stream and public routes do differently? | §6 |
| What does a worker handler or a job do when something fails? | §7 |
| What is logged, at which level, and what never is? | §8 |
| What does a client do with each answer? | §9 |
| What do the apps report back? | §10 |
| How is it tested? | §14 |

## 2. Principles

1. **One shape, one catalog.** Every failure of the HTTP API is `{ "error": { "code", "message", "details" } }`; `code` is the stable part; a code is added in §5 in the same change as the code that throws it (ADR-0023).
2. **An outcome that is not an error is not an exception.** Money that cannot be posted is a returned `SettleOutcome` and a money-log row; the webhook answers 200 (DOC-12 §12, DR-84). Throwing there would roll the log row back.
3. **Fail closed, fail whole.** An unexpected error rolls the transaction back and answers 500 with no detail; nothing partial survives. A failed audit insert, a failed `pii.read` insert and a failed verification stop the action (DOC-35).
4. **A permanent failure must not poison a queue.** A handler that meets an error no retry can cure returns normally and says so in the log; it does not throw, because throwing dead-letters the message for every other recipient and consumer (§7).
5. **An error says what the caller may know.** A foreign object is 404, never 403; a wrong password and an unknown email are the same 401; `details` holds nothing the caller could not already see or that they did not send.
6. **Personal data stays out of errors and logs.** No phone, CCCD, token, code, password or signed URL in a message, a `details` or a log line (DR-58, §8).
7. **Every failure has a request id.** `X-Request-Id` is on every answer and on every log line; the message id or the `job_run` id plays that part in a worker (DOC-35 §3.2).

## 3. The error answer

```json
{
  "error": {
    "code": "charge_changed",
    "message": "This charge has just changed. Check the list and try again.",
    "details": { "charges": [ { "chargeId": "0192f3c4-…", "status": "paid", "version": 4 } ] }
  }
}
```

| Part | Rule |
| --- | --- |
| `code` | Lower snake case, from §5. The client branches on it, never on `message` or on the status alone |
| `message` | Text for a person, in the caller's language: the `Accept-Language` header for an unauthenticated call, the account's language for an authenticated one, then the building default, then `vi` (DR-71). It is looked up by the key `error.<code>` in `@rms/i18n-catalog` (ICU, with the parameters of `details`); the English text is in §5. A screen may show its own text for a code (DOC-68); the message is the fallback and what a log reader sees |
| `details` | Absent when §5 gives none. For `validation_failed` an array `[{ "path", "code", "message" }]`; for every other code an object whose keys §5 lists. A client ignores unknown keys. It never holds a secret, a token or the personal data of someone else |
| HTTP status | From §5. 5xx answers have no `details` |

**Headers.** `X-Request-Id` on every answer (the caller's, if it sent a valid one of at most 64 characters, else generated). `Retry-After` (seconds) on 429 and 503. `Idempotent-Replayed: true` on a replayed answer (DR-74). `Content-Type: application/json`. A request that Caddy refuses before the API (body over 2 MB) is a bare 413 without this shape; a client treats a 413 without `error.code` as `payload_too_large`.

**Validation.** A request that does not match the declared schema (types, required fields, lengths, ranges, formats, counts) is 400 `validation_failed`. A request that is well-formed but breaks a business rule is 400 or 422 `validation_failed` according to the rule (§5.2, DR-127); the client shows the `details` in both cases.

```json
{ "error": { "code": "validation_failed", "message": "Some values are not valid.",
             "details": [ { "path": "reason", "code": "reason_too_short", "message": "Write at least 5 characters." },
                          { "path": "lines[2].amount", "code": "minimum", "message": "Must be at least 0." } ] } }
```

`path` is a dotted path with array indexes (`lines[2].amount`); a violation of the whole body has path `""`.

## 4. From an exception to an answer

The domain and application layers throw typed errors and never build a response; the error handler of `@core/http` maps them (DOC-12 §12). The classes come from the reference `DomainError(code, message, kind)`; the kinds and codes are this project's.

### 4.1 Classes

| Class (`kind`) | HTTP | Carries | Thrown when |
| --- | --- | --- | --- |
| `ValidationError` (`validation`) | 400 | `details[]` | The request is invalid in itself: schema, limits, formats |
| `RuleViolationError` (`validation`) | 422 | `details[]` | Well-formed values that a business rule refuses (§5.2) |
| `UnauthorizedError` (`unauthorized`) | 401 | `code` | No or invalid credential, wrong password, invalid webhook signature |
| `ForbiddenError` (`forbidden`) | 403 | `code`, `details` | Authenticated but not allowed; step-up missing or failed; terms not accepted |
| `NotFoundError` (`not_found`) | 404 | `code` | Missing, or outside the caller's building or unit; unknown route |
| `ConflictError` (`conflict`) | 409 | `code`, `details` | A conditional update changed zero rows; a unique index refused; a state does not allow the action |
| `VersionConflictError` (`conflict`) | 409 | `details.current` | `If-Match` does not match |
| `PreconditionRequiredError` (`precondition`) | 428 | — | An edit of a versioned resource without `If-Match` |
| `PayloadTooLargeError` (`too_large`) | 413 | — | Quota or body limit |
| `UpgradeRequiredError` (`upgrade_required`) | 426 | `details.minVersion` | `X-App-Version` below `MIN_APP_VERSION` |
| `LockedError` (`locked`) | 423 | `details.retryAfter` | A staff account in its temporary lock |
| `RateLimitedError` (`rate_limited`) | 429 + `Retry-After` | `details.scope` | A bucket is empty |
| `UnavailableError` (`unavailable`) | 503 + `Retry-After` | — | A dependency the request needs is down or saturated |
| `BadGatewayError` (`bad_gateway`) | 502 | — | The payment provider failed or refused the request |
| `InvariantError` (`internal`) | 500 | — | A programming error: no transaction open, an undeclared audit action, a missing mapping |
| `RetryLaterError` (messaging) | — | `retryAfterMs` | A handler defers without spending an attempt (§7) |
| anything else | 500 `internal_error` | — | An unexpected error |

`ValidationError` and `RuleViolationError` are the two classes DOC-12 §12 showed as one (`ValidationError`, 422): schema violations are 400 and rule violations 422 (DR-127). Both have the code `validation_failed`.

### 4.2 Database errors

The repository does not translate SQLSTATE; the **use case wrapper** and the error handler do, from this table. A unique index that can be hit by a legitimate race is mapped by constraint name in the module's `constraintErrors` (a map `constraint → ConflictError`); a constraint that is not in the map is a bug and is answered 500.

| SQLSTATE | Meaning | Answer |
| --- | --- | --- |
| `23505` unique_violation | An index refused a row | The mapped `ConflictError` of the constraint (`uq_…` → `phone_in_use`, `plate_in_use`, `already_rated`, `version_conflict` for the active gateway row, …). Unmapped: 500 `internal_error` and an `error` log with `constraint` |
| `23503` foreign_key_violation | A foreign key inside a schema | 500 (a bug: the application checks first) |
| `23514` check_violation, `23502` not_null_violation | The database net caught what the application should have | 500 and an `error` log with the constraint name |
| `22P02`, `22003`, `22007` invalid text, numeric or datetime | A value the schema let through | 500 |
| `40001` serialization_failure, `40P01` deadlock_detected | A conflict between transactions | Retried up to 3 times by the use case wrapper with 20–60 ms of jitter (FR-08.8, DOC-12 §8.1); then 503 `service_unavailable` with `Retry-After: 1` |
| `55P03` lock_not_available (`lock_timeout` 10 s) | A row lock was held too long | 503 `service_unavailable` |
| `57014` query_canceled (`statement_timeout` 30 s) | A statement ran too long | 503 `service_unavailable`, and a `warn` log naming the route |
| `53300` too_many_connections, a pool wait over the request timeout | The pool is exhausted | 503 `service_unavailable` |
| `08xxx` connection exceptions, `57P01` admin_shutdown | The database is gone | 503 `service_unavailable`; readiness fails (DOC-38 §5.2) |
| `42501` insufficient_privilege | A missing grant | 500 and an `error` log: a deploy defect |

Five of these were reproduced on PostgreSQL 18.6 and returned the SQLSTATE of the table: `23505`, `23514`, `23502`, `42501` and `55P03` (§14.1). The other rows are PostgreSQL's documented classes and are tested with a fault-injecting driver in the application tests.

### 4.3 What the handler does with it

1. Build the answer from §5; fill `message` by the language rule of §3.
2. Set the headers of §3.
3. Log it by §8 (the level depends on the class).
4. Count it: `http_request_duration_seconds` already carries the status; the counter `api_errors_total{code,status}` is added for `code` (DOC-40).
5. A 5xx never echoes the exception message, a stack or a SQL fragment to the client.

## 5. The catalog

"Class" is §4.1. The sources are the requirements and use cases cited in each row. The **message key** of a code is always `error.<code>` (for example `error.charge_changed`) in `@rms/i18n-catalog`, with ICU parameters taken from `details`; the English text is in the last column, the Vietnamese text is listed in DOC-68. The build fails when a code has no key in both languages (ER-03).

### 5.1 Every request

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `validation_failed` | 400 · 422 | `ValidationError` · `RuleViolationError` | §3, §5.2 | `[{path, code, message}]` | Some values are not valid. |
| `malformed_request` | 400 | `ValidationError` | The body is not valid JSON, the content type is wrong, a webhook body is over 16 KB (UC-08 E2) | — | The request could not be read. |
| `invalid_cursor` | 400 | `ValidationError` | A list cursor that cannot be decoded or does not match the sort (DR-74) | — | The list position is no longer valid. Reload the list. |
| `unauthenticated` | 401 | `UnauthorizedError` | No token, an expired access token, a revoked session or a refresh token used twice (FR-45.2) | — | Please sign in again. |
| `forbidden` | 403 | `ForbiddenError` | The role or the capability does not allow the action (FR-14.1, FR-16.2); a staff member locking, disabling or changing the role of their own account; a refresh by cookie without `X-Requested-With` | `{reason: "self"}` for the self case, else — | You do not have permission to do this. |
| `not_found` | 404 | `NotFoundError` | A missing object, an object of another building or unit, a route that does not exist, a session of another account | — | We could not find this. |
| `method_not_allowed` | 405 | `NotFoundError` | A known path with a wrong method | — | This action is not available. |
| `version_conflict` | 409 | `VersionConflictError` | `If-Match` is stale, or two writers raced on one aggregate (DR-74) | `{current}` (the fresh resource when the caller may see it) | This was changed by someone else. Reload and try again. |
| `precondition_required` | 428 | `PreconditionRequiredError` | An edit without `If-Match` | — | Reload and try again. |
| `payload_too_large` | 413 | `PayloadTooLargeError` | A body over its limit that reached the API | `{maxBytes}` | The request is too large. |
| `request_in_progress` | 409 | `ConflictError` | A duplicate of a create whose key was committed `in_progress` before an outside call and has not completed (DOC-50 §8, DR-143) | — | This request is still being processed. Try again in a moment. |
| `idempotency_key_reuse` | 422 | `RuleViolationError` | The same `Idempotency-Key` with another body (DR-74) | — | This request was already used with different content. |
| `upgrade_required` | 426 | `UpgradeRequiredError` | `X-App-Version` below `MIN_APP_VERSION` | `{minVersion, storeUrl}` | Update the app to continue. |
| `rate_limited` | 429 | `RateLimitedError` | A bucket is empty (DR-64) | `{scope}` (`otp`, `intent`, `upload`, …) | Too many attempts. Try again later. |
| `internal_error` | 500 | `InvariantError` or unexpected | Anything not mapped | — | Something went wrong. Try again later. |
| `service_unavailable` | 503 | `UnavailableError` | A database or pool failure (§4.2), a saturated dependency | — | The service is busy. Try again in a moment. |
| `maintenance` | 503 | `UnavailableError` | The maintenance flag is set (DOC-38 §5.3) | — | The system is being updated. Try again in a few minutes. |

### 5.2 `validation_failed`: rule codes and their status

Both statuses carry the same code; a client shows `details` the same way. The status is a property of the **rule code** and is listed here, so a test can pin it (DR-127). The generic rules come from the schema (TypeBox kinds) and are always 400.

The message key of a rule code is `error.<rule code>`, in the same namespace as the top-level codes; a rule code never reuses the name of a top-level code (DR-220, test UICP-06).

| Rule code (`details[].code`) | HTTP | Meaning | Source |
| --- | --- | --- | --- |
| `required`, `type`, `format`, `enum`, `pattern`, `min_length`, `max_length`, `minimum`, `maximum`, `max_items`, `min_items`, `unknown_key` | 400 | The schema of the endpoint | DR-74 |
| `file_type_not_allowed`, `file_too_large` | 400 | The declared type or size of an upload is outside its purpose (DOC-37 §4) | DR-61 |
| `too_many_rows`, `too_many_charges`, `too_few_charges` | 400 | An import over 5,000 rows or 5 MB; 0 or 11 charges selected for an intent (FR-01.2, FR-07.2) | FR-01, FR-07 |
| `amount_below_minimum` | 400 | An intent total under the minimum for online payment | FR-07.6 |
| `password_weak` | 400 | A password that breaks the rule (8 to 128, letters and digits) | FR-13.5 |
| `phone_invalid` | 400 | A number that is valid in no country | FR-17 |
| `received_on_future`, `received_on_too_old` | 400 | A manual payment dated in the future or more than 90 days back | FR-05.5 |
| `no_charges`, `charge_total_zero`, `due_date_in_past` | 400 | A batch that cannot be published (FR-03.1) | FR-03 |
| `due_date_not_later` | 400 | A due-date extension that is not later than the current date | FR-44.1 |
| `no_unit_selected` | 400 | A reminder with no unit | FR-12 |
| `too_many_units` | 400 | A reminder request with more than 500 units (DR-267); details `{max}` | FR-12 |
| `audience_empty`, `notice_rule` | 400 | A notice that would reach nobody; a body, attachment or link outside the rules of the notice | FR-27 |
| `folder_depth`, `external_url`, `unsafe_link` | 400 | A library folder deeper than 5 levels; an external image or a link that is not allowed | FR-32 |
| `terms_text` | 400 | A terms text outside the Markdown subset; `path` names the line | DOC-36 §8 |
| `reason_too_short` | 422 | A reason under 5 characters on a reason action (DOC-35 §3.5) | FR-06.2, FR-49.2, FR-42.2, FR-46 |
| `same_assignee` | 422 | A ticket reassigned to the person who holds it | FR-20.3 |
| `assignee_locked` | 422 | The chosen assignee is locked or not a Technician | UC-20 E4 |
| `setting_invalid` | 422 | A building setting outside its range or enumeration | FR-38.2 |
| `one_change_only` | 400 | A membership `PATCH` body with two keys or none (DOC-27 §6, DR-139) | FR-17.3 |
| `min_properties` | 400 | An empty `PATCH` body (the schema rule `minProperties`) | DR-74 |
| `can_pay_tenant_only` | 422 | `can_pay` set on a member who is not a tenant (DOC-27 §6, DR-139) | FR-17.3 |
| `driver_not_allowed` | 422 | The `fake` driver for a building that is not a demo building | DR-26 |

A new rule code is added to this table in the change that throws it, with its status.

### 5.3 Sign-in, accounts and consent

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `invalid_credentials` | 401 | `UnauthorizedError` | A wrong password, or an unknown email: the same answer (FR-13.4) | — | The email or password is not correct. |
| `account_locked` | 423 | `LockedError` | A staff sign-in during the temporary lock (FR-13.1) | `{retryAfter}` seconds | Too many attempts. Try again in {minutes} minutes. |
| `otp_invalid` | 400 | `ValidationError` | A wrong or expired OTP (FR-15.3) | `{attemptsLeft}` | Wrong code. {attemptsLeft} tries left. |
| `phone_not_registered` | 404 | `NotFoundError` | OTP requested for an unknown phone (FR-15.1) | — | This number is not registered. |
| `token_invalid` | 400 | `ValidationError` | A reset or invite link that is unknown, expired or used | — | This link is no longer valid. Ask for a new one. |
| `step_up_required` | 403 | `ForbiddenError` | A sensitive action without `stepUp` (FR-50.2) | `{action}` | Confirm with your password and the code we emailed you. |
| `step_up_failed` | 403 | `ForbiddenError` | A wrong password, wrong, expired, used or foreign code; the same answer for each | `{attemptsLeft}` | The password or code is not correct. |
| `phone_in_use` | 409 | `ConflictError` | The new login phone has an account (FR-18.4) | — | This number already belongs to another account. |
| `email_in_use` | 409 | `ConflictError` | A staff email that exists (FR-14) | — | This email is already used. |
| `staff_has_open_tickets` | 409 | `ConflictError` | Locking a staff member who holds tickets (FR-14.3) | `{tickets: [{ticketId, code, status}]}` | This person still has open requests. Reassign them first. |
| `last_admin` | 409 | `ConflictError` | Locking, disabling or demoting the last active Admin of the building (DOC-26 §4.4, DR-133) | — | The building needs at least one active administrator. |
| `membership_inactive` | 403 | `ForbiddenError` | The membership is locked or removed (FR-16.1) | — | You no longer have access to this home. |
| `terms_required` | 403 | `ForbiddenError` | The latest terms are not accepted (FR-39.1) | `{required: [{kind, version, versionId}]}` | Please accept the updated terms to continue. |
| `terms_version_superseded` | 409 | `ConflictError` | Accepting a version that is no longer the latest (DOC-35 §9.3) | `{current: [{kind, version, versionId}]}` | The terms were updated. Please read the new version. |
| `deletion_not_requested` | 409 | `ConflictError` | Approving a deletion nobody requested (DOC-35 §10.1) | — | This account has not asked to be deleted. |
| `owner_must_transfer` | 409 | `ConflictError` | Approving the deletion of the active owner of a unit (FR-39.4) | `{unitIds}` | Transfer ownership of the unit first. |
| `invalid_signature` | 401 | `UnauthorizedError` | A webhook whose HMAC does not verify (FR-08.5) | — | — (no body is read by the provider) |

### 5.4 Residency and imports

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `import_expired` | 409 | `ConflictError` | A commit of a preview older than 24 h (FR-01.4) | — | This preview has expired. Upload the file again. |
| `import_not_ready` | 409 | `ConflictError` | A commit of a job that is not `validated` (DR-21) | `{status}` | This import is not ready to commit. |
| `import_stale` | 409 | `ConflictError` | The data changed between the preview and the commit (DR-114) | `{rows}` | The data changed since the preview. Upload the file again. |
| `member_exists` | 409 | `ConflictError` | The same account added to a unit twice, or the transfer target is already the owner (DOC-27 §6, DR-137) | `{membershipId, memberType?}` | This person is already a member of this home. |
| `unit_has_owner` | 409 | `ConflictError` | A Manager adds an owner to a unit that already has one (DOC-27 §5) | `{ownerMembershipId}` | This unit already has an owner. Transfer ownership instead. |
| `unit_code_in_use` | 409 | `ConflictError` | The unit code exists; mapped from the constraint `unit_code_key` (DOC-27 §4) | — | This unit code is already used. |
| `invalid_transition` | 409 | `ConflictError` | A generic refusal: the object's state does not allow the action (see below) | `{entity, status, action}` | This can no longer be done in its current state. |

### 5.5 Finance

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `charge_changed` | 409 | `ConflictError` | A selected charge was paid, recalled or voided since the list was loaded (FR-05.3, FR-07) | `{charges: [{chargeId, status, version}]}` | This charge has just changed. Check the list and try again. |
| `payment_in_progress` | 409 | `ConflictError` | Another member holds an intent on part of the selection (FR-07.4) | `{holder, startedAt}` | A payment for this is already open, started by {holder}. |
| `allocation_mismatch` | 422 | `RuleViolationError` | The request carries an `amount` that differs from the sum of the charges (FR-05.2) | `{expected, got}` | The amount does not match the selected charges. |
| `intent_not_cancellable` | 409 | `ConflictError` | A cancel of an intent that is no longer `pending` | `{status}` | This payment can no longer be cancelled. |
| `batch_has_payments` | 409 | `ConflictError` | A recall when a charge of the batch is paid (FR-04.2) | `{paidCount}` | This batch has payments and cannot be recalled. Void individual charges instead. |
| `charge_not_voidable` | 409 | `ConflictError` | A void of a `paid` charge or a charge with a live allocation (FR-49.2) | `{status}` | This charge has been paid and cannot be voided. |
| `payment_not_voidable` | 409 | `ConflictError` | A void of an `online` payment (FR-06.3) | `{kind}` | Money confirmed by the bank cannot be undone here. Refund it outside the system. |
| `money_log_already_reviewed` | 409 | `ConflictError` | A second review of a money-log row (FR-46.1) | `{reviewedAt}` | This row has already been reviewed. |
| `gateway_unavailable` | 502 | `BadGatewayError` | The provider refused or did not answer a link request, or a connection check (UC-18) | — | The payment service is not available. Try again later. |
| `gateway_in_use` | 409 | `ConflictError` | A change of the receiving account, driver or status while an intent is active (FR-38.3) | — | Online payments are in progress. Try again when none is open. |
| `foreign_building` | 400 | `ValidationError` | A webhook order code that belongs to another building (UC-08 E2) | — | — |
| `sms_unavailable` | 503 | `UnavailableError` | An OTP request while recent SMS commands are failing (three failing and none delivered in 10 minutes), or the daily cap of 3,000 is reached (UC-14 E4; DOC-26 §5.1, §5.4, DR-134) | — | Could not send the code. Try again later. |

### 5.6 Tickets, vehicles, notices and the library

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `ticket_already_accepted` | 409 | `ConflictError` | A resident cancels a ticket the Manager has assigned (FR-19.3) | `{ticket}` (the fresh ticket) | This request has already been accepted and can no longer be cancelled. |
| `ticket_reassigned` | 409 | `ConflictError` | The assignee acts on a ticket the Manager reassigned (FR-21.1) | `{ticket}` | This job was reassigned. |
| `already_rated` | 409 | `ConflictError` | A second rating of a ticket (FR-23.3) | — | This request has already been rated. |
| `rating_window_closed` | 409 | `ConflictError` | A rating more than 14 days after closing (FR-23.3) | — | The time to rate this request has passed. |
| `plate_in_use` | 409 | `ConflictError` | A second `pending` or `approved` vehicle with the same plate key (FR-30.2) | — | This plate is already registered. |

`invalid_transition` also covers: recall of a `closed` or `recalled` batch (UC-04 E2); an edit of any field other than the due date on a published batch (FR-44.2); a ticket transition that is not in the table (FR-22.3, FR-42.2); the Manager's close of a ticket that is not `resolved`; the edit of a `sent` notice (FR-27); an action on a `retired` vehicle. The caller reads `details` to decide whether to reload.

### 5.7 Files and building

| Code | HTTP | Class | When | `details` | English message |
| --- | --- | --- | --- | --- | --- |
| `file_not_verified` | 422 | `RuleViolationError` | Verify finds the object missing, oversize, of the wrong type or unreadable; attach of an unverified, foreign or attached file (FR-40.2) | `[{code}]`, `code` ∈ `missing`, `too_large`, `empty`, `wrong_type`, `bad_content`, and `not_verified` for an attach of a file that is not `verified`, not the caller's or attached already (DR-252). The class takes the answer code (`RuleViolationError(rule, message, path, code)`) | The file could not be used. Choose it again. |
| `quota_exceeded` | 413 | `PayloadTooLargeError` | A register at 100% of the quota (FR-40.1) | `{usedBytes, quotaBytes}` | Storage is full. Contact the administrator. |
| `demo_reset_running` | 409 | `ConflictError` | A demo reset while another runs (DOC-36 §10.4) | — | A reset is already running. |

### 5.8 Codes owed by documents not yet written

A document that adds a code adds its row here in the same change (§2, principle 1). Known now: DOC-23 (intent creation: the lock rules), DOC-25 (statement lines: `statement_line_not_assignable`), DOC-30 (vehicle review), DOC-33 (`too_many_rows` for an export over 50,000 rows, as a rule code), DOC-31 (notice send). The names above are reserved.

## 6. Routes that answer differently

| Route | Rule |
| --- | --- |
| **Payment webhook** `POST /payments/webhooks/<provider>/{gatewayConfigId}` | An authenticated confirmation is answered **200 whatever the outcome**, posted or logged (DR-84, DR-29). `invalid_signature` is 401 and writes `webhook_rejection`; a malformed body or one over 16 KB is 400 `malformed_request`; an unknown configuration id is 404 with no row; an order code of another building is 400 `foreign_building`. A database failure is 503 so the provider retries (original SDD §19.3). The provider reads only the status; the body keeps the shape for the logs. Never 5xx for a business reason |
| **Health** `/health/live`, `/health/ready` | `ready` answers 503 `{ "status": "degraded" }` or `stopping`, not the error shape (DOC-38 §5.2) |
| **SSE** `GET /staff/events` | An error before the stream starts is the usual shape (401, 429 for a fourth stream). Once started, a stream ends with the event `session.revoked` or by closing; the client reconnects with `Last-Event-ID` and falls back to refetch on focus |
| **Public** `/public/*`, `/auth/*` | The same shape. `/auth/*` answers do not reveal whether an account exists beyond `phone_not_registered` (an accepted trade-off, original SDD §7.3) |
| **Upload to the S3 store** | The PUT goes to the store (SeaweedFS behind `files.<domain>` in `vn`, R2 in `global`), not the API; the store's own 403 `SignatureDoesNotMatch` XML is not this shape. The app treats any non-2xx from the bucket as "upload failed" and registers again (DOC-37 §6) |

## 7. Workers: what a handler or a job does with a failure

DOC-09 §4.4 says a handler may throw, throw `RetryLaterError` or return normally, and leaves the mapping from failure to outcome here. The rule behind the table: **retry what time can cure; give up quietly on what only a change of data can cure; never drop silently.**

### 7.1 Handlers (outbox and inbox)

| Failure | Outcome | Level and metric |
| --- | --- | --- |
| A database error: connection, timeout, deadlock, serialization | **Throw**; the relay backs off (5 s doubling) | `warn` |
| A provider answers 5xx, times out or the network fails (SMS, SMTP, Expo, the S3 store, payOS) | **Throw** | `warn` |
| A provider answers 429 or a quota error | **`RetryLaterError`** with the provider's `Retry-After`, else 30 s; the attempt is given back, the 24 h budget applies | `info`; `handler_outcomes_total{outcome="deferred"}` |
| A provider answers 401 or 403: our credentials are wrong or revoked | **`RetryLaterError`** with 300 s; the operator fixes the credential; messages wait (an SMS code expires on its own) | `error` `provider_auth_failed`; alert (DOC-40) |
| A permanent failure for one recipient: an invalid phone or email, a bounced address, an Expo `DeviceNotRegistered` | **Return normally**; delete the device token where it applies; the other recipients of the message proceed | `warn`; `delivery_failed_total{channel,reason}` |
| The command's `expiresAt` has passed (an OTP after 5 minutes, a step-up code) | **Return normally**; nothing is sent | `info` `skipped_expired` |
| The recipient is in a demo building | **Return normally** (DOC-36 §9.2) | `warn` `skipped_demo` |
| The entity the message refers to is gone (deleted by the demo reset, a cleared account) | **Return normally** | `info` `entity_gone` |
| A duplicate delivery (the inbox row exists, a natural key conflicts) | **Return normally** | `debug` |
| The payload does not match its schema, or an invariant is broken (a bug) | **Throw**: it dead-letters after the class limit and alerts (RB-05); a poison message is never dropped silently | `error` |
| Delete of an object in the store that is already absent (404) | **Success**: the goal is reached | `debug` |
| Expo accepts a push but the receipt later says an error | Per receipt: `DeviceNotRegistered` as above; other errors count as "push failed" (UC-24) | `warn` |

A handler sets its own client timeout (10 to 30 s) so a pass stays under the 60 s lease (DOC-38 §2.3). The retry classes are DOC-09 §4.2; a *throw* above spends one attempt of the class of the message type:

| Class | Attempts | Types | Waits after attempts 1…7 |
| --- | --- | --- | --- |
| `default` | 8 | every type not named below | 5, 10, 20, 40, 80, 160, 320 s; dead on the 8th failure, about 10 min 35 s after the first |
| `sms` | 3 | `identity.sms_requested.v1` | 5, 10 s; dead on the 3rd failure |
| `push` | 3 | `notification.push_requested.v1` | 5, 10 s |
| `intent_cancel` | 8 | `finance.intent_cancel_requested.v1` | as `default` |

A `RetryLaterError` spends no attempt and has its own 24 h budget from `occurred_at`; after the budget the message is dead. A dead message raises `outbox_dead_letters` and RB-05 (DOC-38 §2.3).

### 7.2 Jobs

| Failure | Behavior |
| --- | --- |
| The job body throws | One `job_run` row `failed` with the error text cut at 2,000 characters; no retry inside the slot (DR-121); the next tick or slot runs it; the alert is the gauge at twice the interval |
| One item of a batch job fails (a PDF, an export, a fee notice) | The item is marked `failed` with a code and the job goes on; the job succeeds unless the failure is systemic (the database is down, the lock is lost). A failed item is retried by the next run when the job's design says so (DOC-34, DOC-33) |
| The job is cancelled by shutdown | A batch job checks `ctx.signal` between batches and returns (DOC-38 §3.4); nothing is half-written |
| A purge fails | The next slot repeats it; the statements are idempotent (DOC-20 §5) |

### 7.3 The settlement path

The one place an exception is **forbidden** for a business outcome: `settle(confirmation)` returns a `SettleOutcome` (`posted`, `charge_already_paid`, `amount_mismatch`, `charge_recalled`, …) and writes the money-log row in the same transaction. It throws only for infrastructure failures, which roll the transaction back and make the webhook answer 503 (§6). A savepoint taken after the `gateway_event` claim keeps the claim when an allocation step fails (DR-14, DOC-23).

## 8. Logging

Structured JSON with `pino` (10.4.0), collected by Grafana Alloy into Loki, 14 days (DR-63). There is no third-party error tracker (DR-103): the logs and the request id are the tool.

### 8.1 A request line

One line per request, at the end:

```json
{"level":"info","time":"2026-10-19T03:10:00.123Z","msg":"request","requestId":"0192f3c4-9d02-7000-8000-00000000f001",
 "method":"POST","route":"/api/v1/staff/payments","status":201,"durationMs":42,
 "accountKind":"staff","accountId":"0192f3c4-…","role":"manager","buildingId":"0192f3c4-…"}
```

| Field | Rule |
| --- | --- |
| `route` | The route **template** (`/api/v1/staff/payments/{id}`), never the raw URL: a query string can hold a phone fragment, a search term or a signed URL |
| `status`, `code` | `code` is the `error.code` of a non-2xx answer |
| `accountKind`, `accountId`, `role`, `buildingId`, `unitId` | Ids only. No name, phone or email |
| `ip` | Only on `/auth/*` lines and on 401, 403, 423 and 429 answers (abuse analysis); 14 days like every log |
| Bodies and headers | **Never logged**: not the request body, not the response body, not `Authorization`, `Cookie`, `Set-Cookie`, `Idempotency-Key` values or the webhook signature |

### 8.2 Levels

| Case | Level |
| --- | --- |
| 2xx, 3xx | `info` (`/health/*` at `debug`) |
| 400, 404, 409, 422 | `info`: expected outcomes of normal use |
| 401 `unauthenticated` | `info`; `invalid_signature`, `invalid_credentials`, `account_locked`, `step_up_failed`, 403 `forbidden`, 429, 426 | `warn` |
| 5xx | `error` |
| A handler outcome of §7.1 | As the table says |
| A boot guard failure | `error` then exit 78 (DOC-36 §10.1) |

### 8.3 An exception line

```json
{"level":"error","msg":"unhandled_error","requestId":"…","route":"/api/v1/staff/payments","status":500,
 "err":{"type":"InvariantError","message":"no transaction is open","stack":"InvariantError: …\n    at …"},
 "sql":{"sqlstate":"23514","constraint":"ck_payment_amount","table":"payment"}}
```

- `err.message` and `stack` are logged as they are, because the code writes messages without personal data (a message is a fixed English string plus ids). A thrown message that interpolates a request value is a defect found by the review checklist.
- **A database error is logged by its SQLSTATE, constraint, table and column only.** The PostgreSQL `detail` (`Key (phone)=(+84…) already exists`) and `where` carry values and are dropped before the line is written (AD-29, ER-30).
- The `cause` chain is logged to depth 3. A line is cut at 16 KB.
- The `pino` `redact` list removes `req.headers.authorization`, `req.headers.cookie`, any key named `password`, `code`, `otp`, `token`, `refreshToken`, `secrets`, `secretEnc`, `cccd`, `stepUp`, and phone-shaped strings in `msg` are masked by the same `maskPhone` as the audit log (DOC-35 §3.4). It is a net: the rule is not to pass these values to the logger.

### 8.4 What never appears in a log

OTP codes, tokens (access, refresh, reset, invite, QR), passwords, step-up codes, the full CCCD, full phone numbers, gateway secrets and the checksum key, signed URLs, request and response bodies, SQL parameter values, card or bank account numbers beyond the last four digits (DR-58, DOC-37 §2).

### 8.5 Metrics owed to DOC-40

`api_errors_total{code,status}`, `handler_outcomes_total{handler,outcome}` (`ok`, `deferred`, `skipped`, `failed`), `delivery_failed_total{channel,reason}`, `client_errors_total{app,kind}`. The alert on `provider_auth_failed` (an `error` count over 10 minutes) and the routes of the runbooks are DOC-40's.

## 9. What a client does with an answer

| Answer | Client behavior |
| --- | --- |
| 401 `unauthenticated` | Refresh the access token once with the refresh token and replay the request; if the refresh fails (401), go to sign-in (FR-45) |
| 403 `terms_required` | Show `Terms-Update`; after acceptance, replay |
| 403 `membership_inactive` | Return to `Unit-Pick` |
| 403 `step_up_required` | Open `W-Step-Up`, then replay with `stepUp` |
| 409 `version_conflict`, `charge_changed`, `invalid_transition`, `ticket_*` | Reload the resource (use `details.current` or `charge`/`ticket` when present), show the message, let the user retry |
| 409 any other | Show the message; no automatic retry |
| 400, 422 `validation_failed` | Show each `details[]` against its field (`path`) |
| 413 `quota_exceeded` | Show the message; no retry |
| 426 `upgrade_required` | Block with the update screen |
| 429, 503 | Wait `Retry-After` (default 2 s), retry **with the same `Idempotency-Key`**; at most 3 tries for a `POST`, then show the message. A payment screen keeps polling (original SDD §6.1) |
| 500 `internal_error`, 502 | Show the message with the request id ("Reference: …"); a `GET` may retry once; a `POST` is not retried unless it carries an `Idempotency-Key` |
| A network failure (no answer) | A `POST` with an `Idempotency-Key` is retried as above; one without is shown as "not sent, try again" |
| Unknown `code` | Show `message`; treat by status class |

The key is generated once per user intent and kept across retries (ADR-0023, DOC-50).

## 10. Errors the apps report

The apps log through one public endpoint, `POST /client-errors` (DR-63, DR-127; DOC-51 assigns its `E-xx`). It exists because there is no hosted tracker (DR-103).

| Rule | Value |
| --- | --- |
| Audience | Public (a crash can happen before sign-in); the token, if there is one, is read but not required |
| Body | `{ app, appVersion, platform, kind, screen, errorName, message, stack?, requestId? }`; `kind` ∈ `crash`, `unhandled_rejection`, `render`, `network`; `message` ≤ 500 characters, `stack` ≤ 4 KB; the whole body ≤ 8 KB; unknown keys are refused |
| Limits | 10 per minute per IP and 30 per hour per account (PostgreSQL buckets, DR-64); beyond that 429, silently dropped by the app |
| Handling | Answers 204. Writes one `warn` line `client_error` with the fields above, the account id when known, and the route-free `screen`; increments `client_errors_total{app,kind}`. The `message` and `stack` pass through `maskPhone` and the redact list of §8.3. Nothing is stored in the database |
| As built (P1-16, DR-264) | The web CMS reports (`packages/client-core/src/reporter.ts`, `apps/cms-web/src/lib/report-error.ts`); the apps report through EAS Observe (DOC-55 §15). The tests ER-43 and ER-44 run in `apps/api/tests/integration/client-errors.integration.test.ts` |
| The app's duty | Never send user input, form values, tokens, URLs with a query string or a response body; send the error class, the message of the error and the stack |

**Usage events are not errors.** `POST /me/usage-events` and `POST /staff/usage-events` (E-173, E-174, DR-279, DOC-104) are the other endpoints that the clients call for themselves. It adds no error code: a bad body is `validation_failed` 400, a body over 16 KB is `payload_too_large` 413, a limit is `rate_limited` 429 with `scope: "usage_events"` (the buckets and keys are DOC-39 §6, DOC-41 §7), maintenance is 503, a missing token is 401. The apps drop the batch on every one of them and never show it (DOC-104 §5.3).

## 11. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-127 | Validation splits into `ValidationError` 400 (schema and limits) and `RuleViolationError` 422 (business rules), with the status listed per rule code; `invalid_transition` is the generic 409 for a state that does not allow an action, with named codes where a screen branches; the codes that earlier documents left open are fixed (`charge_not_voidable`, `payment_not_voidable`, `money_log_already_reviewed`, `plate_in_use`, `rating_window_closed`, `gateway_in_use`, `email_in_use`, `token_invalid`, `step_up_required`, `step_up_failed`, `precondition_required`, `malformed_request`, `invalid_cursor`, `terms_version_superseded`, `deletion_not_requested`, `demo_reset_running`); pool, timeout and serialization exhaustion are 503 `service_unavailable`; the mapping from failure to handler outcome; the log fields and the rule that a database error is logged without its `detail`; `POST /client-errors` | §3…§10 |

## 12. Not in this document

| Topic | Lives in |
| --- | --- |
| Endpoint list and the codes of each endpoint | DOC-51 (by reference to §5) |
| UI text of each state, the Vietnamese messages | DOC-68 |
| Metrics, alerts and dashboards | DOC-40 |
| Retry classes, backoff, dead letters | DOC-09 §4, DOC-38 §2 |
| The audit log | DOC-35 |
| The error handler plugin code | `@core/http` (P1-03) |

## 13. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| §3 shape | DR-74, DR-71, ADR-0023 | NFR-13; ER-01…06 |
| §4 classes, SQLSTATE | DR-74, DR-127 | FR-08.8; ER-07…16 |
| §5 catalog | DR-74, DR-84, DR-127 | every FR error row; ER-17…24 |
| §6 routes | DR-29, DR-32, DR-84 | FR-08; ER-25…28 |
| §7 workers | DR-62, DR-118, DR-117 | FR-15.7, NFR-09; ER-31…40 |
| §8 logging | DR-58, DR-63, DR-103 | NFR-14; ER-29, ER-30, AD-29 |
| §9, §10 clients | DR-74, DR-127 | ER-41…45 |

## 14. Required tests

Prefix `ER-` (error handling; unused before this document; DOC-88 indexes it). **(S)** marks a test whose SQL part was run on PostgreSQL 18.6 (§14.1); the application part of it is not run. The others are application tests written in P1-03, P1-04, P1-05 and with each module and are **not run** yet, except those P1-04 ran on 2026-10-21 with fault-injecting errors (`packages/core-http/src/error-handler.plugin.test.ts`, `packages/core-telemetry/src/logger.test.ts`, `apps/api/src/app.test.ts`): ER-01, 04, 06, 07, 14, 15, 19, 28, 29 and 30 (the SQLSTATE rows 40001, 40P01, 57014 and 08xxx are mapped to 503 and tested with a thrown error; the retry loop of ER-10 and ER-11 is the use case wrapper of P1-06).

| ID | Scenario | Expected |
| --- | --- | --- |
| ER-01 | Every class of §4.1 thrown from a route | The shape of §3, the status of the table, `X-Request-Id` present |
| ER-02 | A caller with `Accept-Language: en`, an account in `vi`, a building default | The message in the language of §3's order |
| ER-03 | A code with no catalog text | The build fails (`error.<code>` parity, NFR-13) |
| ER-04 | `Retry-After` | Present on 429 and 503, absent elsewhere |
| ER-05 | A schema violation and a rule violation in one request | 400 with the schema violations only; the rule is checked when the schema passes |
| ER-06 | A 5xx | No `details`, no stack, no exception text in the body |
| ER-07 | `23505` on `uq_*` mapped to `phone_in_use`; on an unmapped constraint | 409 `phone_in_use`; 500 `internal_error` and an `error` line with the constraint (S) |
| ER-08 | `23514` and `23502` | 500; the line carries the constraint name, no values (S) |
| ER-09 | `42501` (a missing grant) | 500 (S) |
| ER-10 | `40001` once, then success | The wrapper retries; the caller sees success |
| ER-11 | `40001` four times | 503 `service_unavailable` with `Retry-After: 1` |
| ER-12 | `57014` (a query over `statement_timeout`) | 503 and a `warn` naming the route |
| ER-13 | `55P03` from `lock_timeout` | 503 (S) |
| ER-14 | The pool is exhausted | 503 `service_unavailable`; readiness fails |
| ER-15 | A unique-violation message with `Key (phone)=(+84…)` | The log line has no phone (ER-30) |
| ER-16 | A thrown error whose message interpolates a phone | The review checklist test (a lint over `throw new …(\`…${…}\`)` of request fields) fails |
| ER-17 | The catalog of §5 against the codes thrown in the code base (static check) | Every thrown code is in §5, every §5 code is thrown or reserved |
| ER-18 | Every `details[].code` of `validation_failed` | In §5.2 with its status |
| ER-19 | A reason of 4 characters; a title of 121 characters; `defaultDueDays` −1; an unknown key | 422 `reason_too_short`; 400 `max_length`; 422 `setting_invalid`; 400 `unknown_key` |
| ER-20 | A wrong password and an unknown email | The same 401 `invalid_credentials`, body and timing class |
| ER-21 | A foreign unit id, a foreign ticket, a foreign session | 404 `not_found`, never 403 |
| ER-22 | Recall of a recalled batch; a void of an online payment; a second review of a log row; a duplicate plate; a rating after 15 days | 409 `invalid_transition`; `payment_not_voidable`; `money_log_already_reviewed`; `plate_in_use`; `rating_window_closed` |
| ER-23 | `PUT /staff/gateway` while an intent is `pending` | 409 `gateway_in_use` |
| ER-24 | An edit without `If-Match`; with a stale one | 428; 409 `version_conflict` with `details.current` |
| ER-25 | A webhook that is paid in full, short, late, for a recalled charge | 200 each; the money-log row for each non-posted outcome (FR-08) |
| ER-26 | A webhook with a wrong signature; malformed; 17 KB; unknown configuration; foreign order code | 401, 400, 400, 404, 400 `foreign_building`; `webhook_rejection` rows where specified |
| ER-27 | A webhook while the database is down | 503 |
| ER-28 | `/health/ready` while degraded | 503 `{status}` |
| ER-29 | A request with a phone in the query string and a bearer token | The line has the route template and no query, no `Authorization` |
| ER-30 | A `23505` on the phone index | The line has `sqlstate`, `constraint`, `table`; no `detail` |
| ER-31 | An SMS handler and a provider 503 | Throws; retried; dead-lettered after 3 attempts |
| ER-32 | An SMS handler and a provider 429 with `Retry-After: 40` | `RetryLaterError`; the attempt is given back; the message returns in 40–44 s |
| ER-33 | An SMS handler and a provider 401 | `RetryLaterError` 300 s; an `error` line; the alert counter rises |
| ER-34 | A push to 100 tokens, 3 of them `DeviceNotRegistered` | The message is done; the 3 tokens deleted; 97 delivered |
| ER-35 | An SMS command 6 minutes old | Not sent; done |
| ER-36 | A command for a demo recipient | Not sent; done; `skipped_demo` |
| ER-37 | A command for an entity deleted by the demo reset | Done; `entity_gone` |
| ER-38 | A message whose payload fails its schema | Dead-lettered after 8 attempts; `outbox_dead_letters` = 1 |
| ER-39 | A batch of 10 PDFs with one that fails | 9 rendered, 1 marked `failed`; the job succeeds |
| ER-40 | `settle()` with a recalled charge | Returns `charge_recalled`, writes the log row, commits; the webhook is 200 |
| ER-41 | The client with 401 → refresh → success; with 401 → refresh 401 | Replays once; goes to sign-in |
| ER-42 | The client with 503 and `Retry-After: 2` on a `POST` with a key | Retries with the same key; the server replays, no duplicate (LG-, IN-) |
| ER-43 | `POST /client-errors` with a stack of 5 KB, an unknown key, a phone in `message` | 400; 400; the phone masked in the line |
| ER-44 | `POST /client-errors` 11 times in a minute from one IP | The 11th is 429 |
| ER-45 | An unknown `code` in a client | The client shows `message` and treats the status class |

### 14.1 Statements run

| ID | What | Result |
| --- | --- | --- |
| S-ER-1 | Insert a duplicate `resident_account.phone` | `23505`, constraint `resident_account_phone_key` |
| S-ER-2 | Insert a `terms_version` with `kind = 'x'`; a `NULL` `kind` | `23514` `ck_terms_version_kind`; `23502`. Both `DETAIL` lines contain the whole failing row |
| S-ER-3 | A role holding only `SELECT, INSERT` on `audit.audit_log` runs `DELETE` | `42501` `permission denied for table audit_log` |
| S-ER-4 | `lock_timeout = '200ms'` and a second session updating a locked row | `55P03` |
| S-ER-5 | The `DETAIL` of the `23505` error | `Key (phone)=(+84901234567) already exists.`: the number, in clear (why §8.3 drops `detail`) |

S-ER-3 used a throwaway role with the two privileges `rms_app` holds on `audit.audit_log` (DOC-19 §4.1), not the full grants step, which is DOC-19's test (GRT-17). S-ER-4 used two `psql` sessions, one holding the row for 3 seconds.

## Open questions

None.
