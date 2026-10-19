# ADR-0022: Classify personal data, protect it by field, keep push payloads generic and send no error data to a third-party tracker

- Status: Accepted
- Date: 2026-10-19 · Related: DR-52, DR-58, DR-83, DR-57, DR-59, DR-68, DR-63, NFR-14, FR-29.3, FR-37.5, FR-39.3, DOC-07, DOC-12

## Context

The system holds national ID numbers (CCCD), dates of birth, phones, names, vehicle papers and plate photos of about 650 residents (DOC-01). Decree 13/2023/NĐ-CP applies, and NFR-14 says who may see each field. The original SDD §19.1 wanted the data in Vietnam; the Owner's topology (DR-83) puts the edge and the file and backup buckets on Cloudflare, outside Vietnam, and push goes through Expo, FCM and APNs. The Owner recorded the residency question on 2026-10-18 and deferred it: the design proceeds on DR-83, and the question is reviewed before any real personal data is loaded into staging or production, at the latest at the go-live gate (DOC-103), together with the legal dossier (P0-06). This ADR records the protection that holds meanwhile and holds under any answer.

## Options considered

1. **Encrypt everything at application level, one key per resident or building.** Strongest, but it breaks search and exports and puts key custody on a one-person team. Rejected: only the CCCD number is sensitive enough.
2. **Log every read of every personal field, row by row.** Satisfies "access is logged" literally, but a list of 300 residents would write 300 audit rows and bury the useful ones. Rejected (DR-58): detail views and exports are logged, list views show masked values.
3. **Rich push text** (amounts, names, ticket text) for convenience. Rejected (DR-52): Expo, FCM and APNs sit outside Vietnam and a lock screen shows the text to bystanders.
4. **A hosted error tracker** (stack traces and request context sent to a processor). Rejected: it would add a cross-border processor that DR-58 does not list ("only Expo/FCM/APNs receive anything"), and request bodies and headers are exactly where phones and tokens appear. Errors are already in the logs with a request id, and the metrics and alerts of DR-63 cover the rest.
5. **Host everything in Vietnam now.** Decided otherwise by the Owner (DR-83); deferred, with a fallback below.
6. **Classify fields, protect by class, minimal cross-border flow.** Chosen.

## Decision

Option **6** (DR-58, DR-52, DR-83).

- **Classes.** Every field is `sensitive` (CCCD number), `personal` (date of birth, phone, email, names, vehicle papers and plate photos) or `operational` (ticket text and media). Every new field is classified in DOC-16/17 when it is added.
- **Protection by class.**
  - CCCD number: AES-256-GCM encrypted column with the PII key (DR-65), masked everywhere except the profile detail for Manager and Admin.
  - Date of birth: returned only to Manager and Admin, logged with the CCCD view.
  - Phone and email: visible to Manager, Admin and the unit's own members; Guards see the phone masked (DR-48); logs mask them (`+84•••••123`).
  - Vehicle papers and plate photos: private bucket prefix, signed URLs of 5 minutes (DR-61).
- **Logging of reads.** The detail view of a profile with CCCD or date of birth is one `pii.read` audit row; an export containing them is one row with the record count (DR-57, FR-37.5). List views are not logged per row. Never logged: OTP, tokens, passwords, CCCD, full phone numbers, QR tokens.
- **Push payload.** Title and body come from templates in the recipient's language and carry no amount, name, phone number or ticket text; `data` is `{route, unitId, entityId}` only. Details are fetched in the app after authentication (DR-52, FR-29.3).
- **Cross-border flows, and only these:** Expo, FCM and APNs receive the generic payload; Cloudflare (edge, Pages, R2) is a processor listed in the privacy notice and the impact assessment (DR-83); the SMS and mail providers are chosen from Vietnam-hosted vendors where possible (DR-68).
- **No third-party error tracker.** Errors go to the structured logs with the request id, collected by Alloy into Loki, plus the metrics of DR-63. Adding a tracker needs a new DR that adds it to the cross-border list.
- **Residency handling until the legal dossier answers** (DR-83): backups are ciphertext with the key kept off R2; the files bucket takes no CCCD images; if counsel rejects that, vehicle papers and photos move to a Vietnam-hosted S3-compatible store behind the same `FilesApi`, a configuration change and not a redesign.
- **Deletion.** Account deletion clears name, avatar and profile fields, frees the phone, and keeps financial rows with the payer-name snapshot and audit rows with ids only (DR-59, FR-39.3).

## Consequences

**Positive**

- A reviewer has one table to check a new field or endpoint against.
- A leaked push, log line or lock screen reveals no money or health-related text.
- The residency answer can change the storage location without changing the design.

**Negative**

- The encrypted CCCD column cannot be searched or sorted in SQL; staff look residents up by name, phone or unit. The PII key is one more secret to keep and rotate (RB-12).
- Generic push text forces a resident to open the app to learn anything; some will find it less useful.
- Without an error tracker, exceptions are not grouped or de-duplicated; debugging depends on log search and on discipline in adding request ids and context to log lines.
- Personal data (vehicle papers, plate photos) is stored outside Vietnam until the review; if counsel rejects option 6's handling, there is rework in `FilesApi` and a migration of objects.
- Logging only detail views leaves a Manager's list-level exposure to masked values unlogged by design.

**Follow-up work**

- DOC-35 holds the inventory, the audit writer and the retention table; DOC-39 the STRIDE rows and the masking tests; DOC-20 the purge jobs; DOC-31 the push templates.
- Tests `AD-` for `pii.read` per view and per export, masking per role, and the push payload (FR-29.3).
- The legal dossier P0-06 and the residency review before real personal data is loaded; DOC-103 carries the closing item.
