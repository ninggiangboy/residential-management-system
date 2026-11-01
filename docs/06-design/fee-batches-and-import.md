# Fee batches and import

> Status: **Draft** · Updated: 2026-11-01 (P1-27: the rows of §4.2 have their `DQ-62…81` numbers, `import_missing_column`, a cap on a line amount, DR-317) · 2026-10-28 (P1-26: the fee-notice PDF endpoints E-99, E-176, E-177 in §1, DR-293) · 2026-10-26 (P1-24: first version, DR-265, DR-266) · DOC-21
> Depends on: original SDD §5.1…5.3, §5.8, §11.2, [DR](../00-decision-register.md) (DR-09…12, 17, 19…22, 56, 74, 87, 97, 105, 109, 114, 149, 226, 243…245, DR-265, DR-266, DR-293, DR-317), [ADR-0005](../04-adr/0005-ledger-charges-and-allocations-paid-in-full.md), [ADR-0006](../04-adr/0006-allocation-write-path-all-or-nothing.md), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [DOC-03](../01-product/requirements.md) (FR-01…04, FR-12.4, FR-44, FR-49), [DOC-04](../01-product/use-cases.md) (UC-01, UC-04, UC-13), [DOC-09](../03-architecture/messaging-contracts.md) §3.4, §6, §7, [DOC-12](../03-architecture/code-architecture.md) §4.5, §9.5, [DOC-14](../05-data/data-conventions.md) §10, [DOC-15](../05-data/finance-model.md) §4, §5, §10.1, §11, §12, [DOC-18](../05-data/data-quality-rules.md) §1, [DOC-35](audit-privacy-and-terms.md) §4, [DOC-42](error-handling.md) §5, [DOC-06](../02-glossary.md)
> Main readers: P2-04 (fee import and draft editing), P2-05 (publish, close, extend, re-issue), P2-07 (recall, single void), P2-12 (publish notification), P2-15 and P2-16 (fee screens), DOC-18 §2, DOC-22, DOC-23, DOC-34, DOC-44 (FL), DOC-51, DOC-58, DOC-66, EXP-04, EXP-10

This document says how a **fee batch** lives: created as a draft, filled by an Excel file or by hand, published, extended, recalled, closed, re-issued, and how one wrong open charge is voided. It holds the fee import (template, rows, rounding, preview, commit transaction). It does not hold the tables (DOC-15 §5, §10.1), the validation catalog with `DQ-` numbers and message texts (DOC-18 §2, P1-27), the allocation of money, receipts, the money log, debt and the nightly check (DOC-22), the cancellation of payment links (DOC-23), the PDF of a bill (DOC-34) or the endpoint list with `E-xx` numbers (DOC-51; the numbers below are those of the catalog in `api-endpoints.md`).

**Statements run on 2026-10-26** on `postgres:18.6` (x86_64, Docker) on a database built from the DDL blocks of DOC-15 §3.1 and §4…§11, 240 charges with 480 lines. §11 lists what ran. Where a statement is a sample (`gen_random_uuid()` stands for the UUIDv7 that the application makes, DOC-14 §3), the line says so.

Every new decision in this document is recorded as DR-265 and DR-266 and summarized in §12.

## 1. Purpose and scope

| Component | Command or query | Runs in | Trigger | Reads | Writes | Task |
| --- | --- | --- | --- | --- | --- | --- |
| Create a batch | `CreateFeeBatch` | `api` | `POST /staff/fee-batches` (E-90) | `building` settings | `fee_batch`, `document_counter` | P2-04 |
| Edit a batch | `UpdateFeeBatch` | `api` | `PATCH /staff/fee-batches/{id}` (E-92) | `fee_batch` | `fee_batch` | P2-04, P2-05 |
| Edit a draft's charges | `ReplaceDraftCharge`, `AddDraftCharge`, `RemoveDraftCharge` | `api` | `PUT /staff/charges/{id}` (E-94), `POST /staff/fee-batches/{id}/charges` (E-170), `DELETE /staff/charges/{id}` (E-171) | `charge`, `charge_line`, `ResidencyApi.findUnitsByCodes` | `charge`, `charge_line` | P2-04 |
| Discard a draft | `DiscardFeeBatch` | `api` | `DELETE /staff/fee-batches/{id}` (E-172) | `fee_batch` | `fee_batch`, `charge`, `charge_line` | P2-04 |
| Validate a fee file | `ValidateFeeImport` | `api` | `POST /staff/imports` with `kind = fee_batch` (E-72) | the file, `fee_batch`, `ResidencyApi` | `import_job` | P2-04 |
| Commit a fee file | `CommitFeeImport` | `api` | `POST /staff/imports/{id}/commit` (E-74) | `import_job`, the file | `import_job`, `fee_batch`, `charge`, `charge_line` | P2-04 |
| Publish | `PublishFeeBatch` | `api` | `POST /staff/fee-batches/{id}/publish` (E-95) | `fee_batch`, `charge` | `fee_batch`, `charge`, outbox | P2-05 |
| Recall | `RecallFeeBatch` | `api` | `POST /staff/fee-batches/{id}/recall` (E-96) | `fee_batch`, `charge` | `fee_batch`, `charge`, `payment_intent`, outbox | P2-07 |
| Close | `CloseFeeBatch` | `api` | `POST /staff/fee-batches/{id}/close` (E-97) | `fee_batch` | `fee_batch` | P2-05 |
| Re-issue | `ReissueFeeBatch` | `api` | `POST /staff/fee-batches/{id}/reissue` (E-98) | `fee_batch`, `charge`, `charge_line` | `fee_batch`, `charge`, `charge_line`, `document_counter` | P2-05 |
| Void one open charge | `VoidCharge` | `api` | `POST /staff/charges/{id}/void` (E-100) | `charge`, `allocation` | `charge`, `payment_intent`, outbox | P2-07 |
| Reads | `FeeBatchQueries`, `FeeImportQueries` | `api` | E-71, E-73, E-89, E-91, E-93, E-169 | `fee_batch`, `charge`, `charge_line`, `import_job` | none | P2-04, P2-15 |
| Fee-notice PDFs (DR-293) | `RequestBatchPdf`; the job `fee_notice_run`; `DownloadFeeNoticePdf` | `api` (request, one notice), `worker` (bulk) | E-99 the bulk request (published or closed batch, 202 with the job); E-177 the job's state and ZIP; E-176 one unit's notice, drafts included with the draft mark | `fee_batch`, `charge`, `charge_line`, `fee_notice_job` | `fee_notice_job`, files | DOC-34 §6.3, §9 |
| Purge of old import jobs and files | `finance_purge` | `worker` | Sunday 04:00 | `import_job` | `import_job`, `FilesApi.remove` | DOC-38 §4, DOC-20 §2.4 |

One building per deployment (DR-115); every statement still carries `building_id` (DR-12). Every use case above is a staff operation: it exports its `<OPERATION>_ROLES = ['admin', 'manager']`, calls `requireRole(staff, <OPERATION>_ROLES)`, and its route reads the same constant (DOC-12 §4.5, DR-254). A Technician or a Guard gets 403 (FR-49.2).

## 2. Components and interfaces

### 2.1 What `finance` calls for batches

| Contract | Used for | Why through a contract |
| --- | --- | --- |
| `ResidencyApi.findUnitsByCodes(buildingId, codes)` (**new**, DR-265) | The `db` layer of the import and the add of a charge by hand: unit codes to unit ids, with occupancy and whether an active owner exists | `unit` is `residency`'s table (ADR-0014) |
| `ResidencyApi.getUnits(ids)` | The unit code and floor beside a charge on `W-Fee-Batch` (finance stores only the snapshot `unit_code`, which is enough for lists; `getUnits` serves the current code in the unit filter) | Same |
| `BuildingApi.getSettings(buildingId)` | The time zone for `buildingToday` (publish check, extension, re-issue) and the building's fee-notice language | Settings are `building`'s |
| `GaplessCounter.next(scope, 'batch', 'YYMM')` | The batch code (DOC-12 §9.5, DR-10) | One helper for every series |
| `FilesApi.verify/read/remove` | The import file: size and type at validation, bytes at commit, removal by `finance_purge` | Files are `building`'s (DOC-37 §3) |
| `AuditApi.record` | The actions of §2.3, in the use case's transaction | Audit is `audit`'s |
| `IntentCancellation.cancelHolding(tx, chargeIds, reason)` | Recall and single void: every active intent holding one of the charges is marked `cancelling` as a whole and its cancel command is written. **A port inside `finance`**, built by DOC-23; the SQL and the outbox row are DOC-23's | One implementation for recall, void and supersede |

```ts
// modules/finance/src/application/ports.ts (the new contract is added to ResidencyApi, DOC-27 §2.1)
interface FoundUnitDto { unitId: Uuid; code: string; occupancy: 'occupied' | 'rented' | 'vacant'; hasActiveOwner: boolean }
// ResidencyApi.findUnitsByCodes: at most 5,000 codes, compared by lower(code), at most one row per code, a missing code is absent
findUnitsByCodes(buildingId: Uuid, codes: string[]): Promise<FoundUnitDto[]>

interface IntentCancellation {
  /** In the caller's transaction: intents of the building that hold any of the charges and are active → cancelling (whole intent). */
  cancelHolding(tx: Tx, scope: BuildingScope, chargeIds: Uuid[], reason: 'batch_recalled' | 'charge_voided'): Promise<{ intentIds: Uuid[] }>
}
```

### 2.2 Events

All events are written by the use case in its transaction (DOC-12 §8.3). Payloads are in DOC-09 §6.

| Event | Written by | Chunking | Consumers (DOC-09 §7) |
| --- | --- | --- | --- |
| `finance.batch_published.v1` | `PublishFeeBatch` | `unitIds` in parts of at most 500 (DOC-09 §3.4); a batch of 1,201 charged units writes three rows (MC-06) | `notification.inbox_on_finance_batch_published` |
| `finance.batch_due_extended.v1` | `UpdateFeeBatch` (published path) | the same | `notification.inbox_on_finance_batch_due_extended` |
| `finance.batch_recalled.v1` | `RecallFeeBatch` | the same | `notification.inbox_on_finance_batch_recalled` |
| `finance.charge_voided.v1` | `VoidCharge` | none (one charge) | `notification.inbox_on_finance_charge_voided` |
| `finance.intent_cancel_requested.v1` | `IntentCancellation.cancelHolding` | one per intent | `finance.cancel_intent_link` (DOC-23) |

Create, import commit, draft edits, close, re-issue and discard write no event: no resident sees a draft, and a close changes nothing a resident can act on (DR-20). Who is notified of a publish: the active owner, family members and tenants of each charged unit; helpers get nothing (DR-20, FR-03.3). The handler resolves them with `ResidencyApi.listRecipients(unitId, 'view_fees')` (DOC-09 §7.1); finance sends ids, not names.

### 2.3 Audit actions

Declared in the module manifest (`auditActions`, DOC-35 §3.3). `finance.batch.discard` is new (DR-265) and owed to DOC-35 §4.

| Action | Written by | Object | `changes` |
| --- | --- | --- | --- |
| `finance.batch.create` | `CreateFeeBatch` | `fee_batch` | — (`code`, `feeMonth` in `details`) |
| `finance.batch.import_commit` | `CommitFeeImport` | `import_job` | — (`created`, `replaced` in `details`) |
| `finance.batch.update` | `UpdateFeeBatch` (draft path) | `fee_batch` | `name`, `dueDate` |
| `finance.batch.publish` | `PublishFeeBatch` | `fee_batch` | `status` |
| `finance.batch.extend_due` | `UpdateFeeBatch` (published path) | `fee_batch` | `dueDate` |
| `finance.batch.recall` | `RecallFeeBatch` | `fee_batch` | `status` (reason class R) |
| `finance.batch.close` | `CloseFeeBatch` | `fee_batch` | `status` |
| `finance.batch.reissue` | `ReissueFeeBatch` | `fee_batch` (the new draft) | — (`replaces` in `details`) |
| `finance.batch.discard` (**new**) | `DiscardFeeBatch` | `fee_batch` | — (`code`, `chargeCount` in `details`) |
| `finance.charge.update` | the three draft charge use cases | `charge` | — (`op` = `replace`, `add`, `remove` and the unit code in `details`) |
| `finance.charge.void` | `VoidCharge` | `charge` | `status` (reason class R) |

## 3. The batch lifecycle

The state machines are in DOC-15 §5.1 (batch) and §5.2 (charge). This section gives the rules each transition needs and the statement it runs. Every guard of the database triggers (DOC-15 §11, DR-243) is a second net: a use case checks first and answers a typed error; the trigger only catches a bug.

### 3.1 Create and code

`POST /staff/fee-batches` takes the header the form shows (`W-Fee-Import`): bilingual `name` (`vi` required, `en` optional), `feeMonth` and `dueDate`. The route is marked `R` in the catalog, so it needs an `Idempotency-Key` (DOC-50 §8.1); a double click creates one batch and consumes one code. `POST /staff/imports` (E-72) is also `R`.

```json
{ "name": { "vi": "Phí tháng 10/2026", "en": "October 2026 fees" }, "feeMonth": "2026-10-01", "dueDate": "2026-10-15" }
```

1. `feeMonth` must be the first day of a month (`2026-10-15` is 400, as `ck_fee_batch_fee_month`). It is a `date`, never an instant (DR-09).
2. The code comes from the `batch` series with period `YYMM` of the **fee month** (not of today): `GaplessCounter.next(scope, 'batch', '2610')` gives 1 and the code is `PH-2610-01`; the second batch of the month is `PH-2610-02` (FR-03.4). A series that passes 99 prints `PH-2610-100`: the width is a minimum (DR-10).
3. The counter increment and the insert are one transaction. A rolled-back create leaves no code behind; a **discarded draft's code is not issued again** because the counter only moves forward and a draft is deleted, not renumbered (FR-02.4, §3.8). Batch codes need not be gapless (DR-10); a discard leaves a hole by design.
4. `status = 'draft'`, `version = 1`, `created_by` is the staff account. Nothing validates `dueDate` here: the publish check does (§3.3), so a Manager can start a draft before the date is settled.

### 3.2 Editing a draft

A draft is the only editable state. Two kinds of edit exist.

**The header** (`PATCH`, `If-Match: "<version>"`, DOC-50 §9): `name` and `dueDate`. The **fee month cannot change** (DR-265): the code encodes it and every imported row must carry it (§4.2), so a wrong month is fixed by discarding the draft and creating another. A stale `If-Match` is 409 `version_conflict` with `details.current` (DR-74). Statement:

```sql
UPDATE finance.fee_batch
   SET name = :name, due_date = :due_date, version = version + 1, updated_at = now()
 WHERE id = :batch_id AND building_id = :building_id AND status = 'draft' AND version = :expected_version
RETURNING version;
-- 0 rows: stale version (409 version_conflict) or not a draft (409 invalid_transition); the use case reads the row to tell which
```

**The charges.** One unit's charge is replaced, added or removed without touching the others (FR-02, original SDD §5.3):

| Use case | Endpoint | Body | Guard | Effect |
| --- | --- | --- | --- | --- |
| `ReplaceDraftCharge` | `PUT /staff/charges/{id}` (E-94), `If-Match` | `{ lines: [...] }` | `charge.version`, batch `draft` | All lines of that charge are deleted and re-inserted; `amount` is recomputed; `charge.version + 1` |
| `AddDraftCharge` | `POST /staff/fee-batches/{id}/charges` (E-170) | `{ unitCode, lines: [...] }` | batch `draft`, no charge of that unit yet in the batch | One charge; the unit is looked up like an import row (§4.3) |
| `RemoveDraftCharge` | `DELETE /staff/charges/{id}` (E-171), `If-Match` | none | `charge.version`, batch `draft` | The charge and its lines are deleted (hard, a draft) |

A line in the body is `{ kind, itemName: { vi, en? }, quantity, unitPrice, amount?, note? }` with the rules of §4.2. The charge total must stay above zero: otherwise 422 `charge_total_zero`. The two-writer case of FR-02.2:

```sql
-- first statement of ReplaceDraftCharge; the lines follow only when it returns a row
UPDATE finance.charge SET amount = :new_total, version = version + 1, updated_at = now()
 WHERE id = :charge_id AND building_id = :building_id AND status = 'draft' AND version = :expected_version
RETURNING id;
-- 0 rows: the other Manager saved first (409 version_conflict with the fresh charge), or an import replaced the charge (404)
```

Every edit also bumps the **batch** `version` (`UPDATE fee_batch SET version = version + 1 … WHERE status = 'draft'`), so a publish that was prepared from an older screen is refused (§3.3). The audit row is `finance.charge.update`.

### 3.3 Publish

`POST /staff/fee-batches/{id}/publish` with `If-Match` (FR-03).

**Checks**, in this order, before any write; the first that fails answers and nothing changes (FR-03.1):

| Check | Failure | Code |
| --- | --- | --- |
| The batch is `draft` | 409 | `invalid_transition` |
| At least one charge | 400 | `no_charges` |
| Every charge total above zero | 400 | `charge_total_zero` (lists the units) |
| `due_date >= buildingToday` | 400 | `due_date_in_past` |

Then the statement of DOC-15 §5.1: the batch is updated `WHERE status = 'draft' AND version = :expected_version`, and its charges `draft → open` in the same statement. Three triggers back it: `trg_charge_guard` refuses `draft → open` when the charge's amount differs from the sum of its lines (FNM-21), and nothing but `status`, `version` and `updated_at` of a charge may change on the way. The use case then writes `finance.batch_published.v1` (chunked), the audit row and the log line, and commits.

**Two Managers pressing "Publish"** (FR-03.2): the two `UPDATE … WHERE status = 'draft'` statements serialize on the batch row; the second finds `published` and updates nothing (FNM-S01: 3 charges opened, then 0), answers 409 `invalid_transition` with the fresh batch, and writes **no** event. One publish, one round of push, 240 charges `open`.

**Edit against publish.** A charge edit or an import commit bumps the batch `version` (§3.2, §4.5). A publish that carries the older version updates zero batch rows and answers 409 `version_conflict`, so a Manager never publishes a draft that has changed since it was read.

### 3.4 Extend the due date

The only edit of a published batch (FR-44, DR-20): `PATCH /staff/fee-batches/{id}` with `{ dueDate }` and `If-Match`. `UpdateFeeBatch` takes this path when the batch is `published`; a `closed` or `recalled` batch is 409 `invalid_transition`; any other field in the body is 409 `invalid_transition` (FR-44.2).

```sql
UPDATE finance.fee_batch
   SET due_date = :new_due_date, version = version + 1, updated_at = now()
 WHERE id = :batch_id AND building_id = :building_id AND status = 'published'
   AND version = :expected_version AND due_date < :new_due_date
RETURNING due_date, version;
-- 0 rows: stale version, or the new date is not later → the use case reads the row and answers 409 version_conflict or 400 due_date_not_later
```

The later-date rule lives in the statement as well as in the use case, so two Managers cannot move a date backwards by racing (run: 2026-10-25 accepted, 2026-10-10 and a stale version both 0 rows). The date may be earlier than today only if it is later than the current one. Aging follows without any other write, because debt is computed (FR-44.3, DOC-22 §8). The use case writes `finance.batch_due_extended.v1` and the audit row `finance.batch.extend_due` with the old and new dates.

### 3.5 Recall

`POST /staff/fee-batches/{id}/recall { reason }` with `If-Match` (FR-04, original SDD §5.8). The reason is required, 5 to 500 characters (422 `reason_too_short`), and lives in the audit row only: `fee_batch` has no reason column (DOC-35 §3.5). The arbiter of the race with a payment is the charge row (DOC-22 §10).

1. Lock and move the batch: `UPDATE fee_batch SET status = 'recalled', recalled_at, recalled_by, version + 1 WHERE id AND status = 'published' AND version = :v RETURNING id`. Zero rows: a `closed` or `recalled` batch is 409 `invalid_transition` (FR-04.4); a stale version is 409 `version_conflict`.
2. Read the expected count **after** the batch row is locked: `SELECT count(*) FROM charge WHERE batch_id AND status <> 'void'` (DR-97). A charge voided alone earlier is not counted.
3. `UPDATE charge SET status = 'void', void_kind = 'recall', voided_at = now(), voided_by = :staff WHERE batch_id AND status = 'open'`. If the updated count differs from the expected count, a charge is `paid`: **ROLLBACK** and answer 409 `batch_has_payments` with `{ paidCount }` (FR-04.2). Nothing is left half done, including the batch status of step 1.
4. `IntentCancellation.cancelHolding(tx, scope, chargeIds, 'batch_recalled')`: every active intent that holds one of the charges becomes `cancelling` **as a whole**, including a charge of another batch in it (FR-04.1); each gets a `finance.intent_cancel_requested.v1`.
5. Write `finance.batch_recalled.v1` (chunked), the audit row with the reason, commit.

Run on 2026-10-26: a batch of 240 charges with one charge voided alone → `expected 239`, `updated 239`, recalled. With a paid charge the same statements update 239 of 240 and the transaction is rolled back (FNM-S04: `recalled, 2 of 2` then `409 batch_has_payments (2 of 3)`).

### 3.6 Close

`POST /staff/fee-batches/{id}/close` (DR-20): a manual freeze **for reporting only**. `UPDATE fee_batch SET status = 'closed', closed_at, closed_by, version + 1 WHERE id AND status = 'published' AND version = :v`. Open charges stay `open`, payable and in debt; debt counts closed batches (DOC-22 §8); a closed batch cannot be recalled (FR-04.4) or extended (§3.4). Nothing closes automatically. No event, no notification. Manager and Admin may close (`CLOSE_FEE_BATCH_ROLES`).

### 3.7 Re-issue

`POST /staff/fee-batches/{id}/reissue` creates a corrected draft from a **recalled** batch (FR-04.5, DR-20). A batch in another status is 409 `invalid_transition`.

| Item | Rule |
| --- | --- |
| Batch | A new `draft` with `replaces_batch_id` = the recalled batch, a new code from the counter (`PH-2610-02`), the same `name` and `fee_month`, a `due_date` that the request may set (default: the old one) and that the publish check will test |
| Charges | Every charge of the recalled batch **except those voided alone** (`void_kind = 'single'`): such a charge was wrong by itself and is corrected by hand (DR-265). A charge voided by the recall is copied, with new ids |
| Lines | Copied with the charge, new ids, same positions, amounts and notes |
| A second re-issue | Allowed while the first draft exists or was discarded: the recalled batch keeps no pointer to its children, `ix_fee_batch_building_replaces` answers "re-issued as" (DOC-15 §5.1) |

The copy is `INSERT … SELECT` with new ids made in the application and mapped old → new (run on 2026-10-26 with `gen_random_uuid()` standing in: 239 charges and 478 lines copied from a recalled batch of 240 charges that had one charge voided alone, new code `PH-2610-02`, `replaces_batch_id` set). The copy runs in one transaction with the counter increment. The Manager then edits the draft (§3.2) and publishes it as a new batch; residents see two different batches and never an amount that changed under a code (original SDD §5.2).

### 3.8 Discard

`DELETE /staff/fee-batches/{id}` with `If-Match` (DR-265, E-172) hard-deletes a **draft** and, by cascade, its charges and lines (DR-12). `DELETE … WHERE id AND building_id AND status = 'draft' AND version = :v RETURNING code`; zero rows is 409. `trg_fee_batch_guard` refuses the delete of a published batch (run: `cannot be deleted once published`). A pending import job of the batch stays `validated` until it expires; its commit finds no batch and answers 404 `not_found`. The audit row is `finance.batch.discard` (§2.3). The code is not issued again (§3.1).

### 3.9 Void one open charge

`POST /staff/charges/{id}/void { reason }` with `If-Match` (FR-49, DR-19, DR-20). It is for one wrong charge inside a batch that cannot be recalled because another unit has paid.

| Rule | Value |
| --- | --- |
| Who | Manager, Admin (`VOID_CHARGE_ROLES`); a Technician is 403 |
| When | The charge is `open` and has no live allocation. A `paid` charge or one with a live allocation is 409 `charge_not_voidable`; an already `void` one is 409 `invalid_transition` (FR-49.2) |
| Reason | 5 to 500 characters after trimming, else 422 `reason_too_short` / `reason_too_long`; stored in `charge.void_reason` |
| Guard | `charge.version` from `If-Match` |

```sql
UPDATE finance.charge
   SET status = 'void', void_kind = 'single', void_reason = :reason, voided_at = now(), voided_by = :staff_id,
       version = version + 1, updated_at = now()
 WHERE id = :charge_id AND building_id = :building_id AND status = 'open' AND version = :expected_version
RETURNING id, unit_id;
-- 0 rows: paid meanwhile, already void, or stale → 409 with the fresh charge (FR-49.5)
```

Then, in the same transaction, `IntentCancellation.cancelHolding(tx, scope, [chargeId], 'charge_voided')` cancels every intent holding the charge **as a whole** and the resident is told to start again; `finance.charge_voided.v1` and the audit row follow. A late exact confirmation of such an intent finds the charge `void` and goes to the money log as `charge_recalled` (DOC-22 §9). The voided charge is never reopened: the corrected charge goes into a new draft batch (FR-49.4). The other charges of the batch are untouched; a batch with a charge voided alone can still be recalled (§3.5). Void is independent of the money log: the system never creates or pre-fills it from a log row (DR-16, DR-19).

Race with a settlement: the statement above and the settlement's `UPDATE … WHERE status = 'open'` serialize on the charge row; exactly one wins (FR-49.5; DOC-22 §10, EXP-04).

## 4. The fee import

### 4.1 Flow

The import has two steps and no worker (DR-21, NFR-12).

```mermaid
sequenceDiagram
  autonumber
  participant M as Manager (W-Fee-Import)
  participant API as API (finance)
  participant S as Object storage
  participant DB as PostgreSQL
  M->>API: POST /staff/uploads {purpose: import} (DOC-37)
  API-->>M: presigned PUT
  M->>S: PUT the .xlsx (at most 5 MB)
  M->>API: POST /staff/uploads/{id}/verify
  M->>API: POST /staff/imports {kind: "fee_batch", fileKey, batchId}
  API->>DB: batch is a draft of this building?
  API->>S: read the object (streaming)
  API->>API: file, row and set rules; ResidencyApi.findUnitsByCodes (one call)
  API->>DB: INSERT import_job (validated | failed, result = the preview)
  API-->>M: 201 the preview
  M->>API: POST /staff/imports/{id}/commit
  API->>DB: one transaction: claim the job, replace the draft's charges
  API-->>M: 200 {created, replaced}
```

The diagram shows that validation is part of the request and the commit is one transaction; nothing waits for a job and nothing polls (DR-21). `batchId` is required (DOC-15 §10.1, FNM-108): the header (name, fee month, due date) comes from the form, not from the file (DR-22). A `batchId` that is not a draft of this building is 409 `invalid_transition` and no job is stored.

### 4.2 The file and the rows

`GET /staff/imports/templates/fee_batch` (E-71) returns an `.xlsx` with the first sheet named `Phí` (or `Fees`), row 1 as the header, in the requesting user's language, and one example row per kind. The workbook limits, the header-key folding and the reader options are DOC-18 §1.1 and apply unchanged: `.xlsx` only, first sheet only, 5 MB, 5,000 rows, unknown columns ignored with a warning, a blank row skipped.

| Canonical column | Aliases (compared by key, DOC-18 §1.1) | Required | Cell |
| --- | --- | --- | --- |
| `unit_code` | Mã căn hộ, Mã căn, Căn hộ, Unit code, Unit, Apartment | Yes | Text |
| `fee_month` | Tháng phí, Kỳ phí, Fee month, Month | Yes | Text `MM/YYYY` or a date |
| `item_name` | Tên khoản, Khoản phí, Item name, Item | Yes | Text |
| `item_name_en` | Tên khoản (EN), Item name (EN) | No | Text |
| `quantity` | Số lượng, SL, Quantity, Qty | No (default 1) | Number |
| `unit_price` | Đơn giá, Unit price, Price | One of price or amount | Whole number |
| `amount` | Thành tiền, Số tiền, Amount, Total | One of price or amount | Whole number |
| `kind` | Loại, Kind, Type | No (default `fee`) | `fee` or `adjustment` (also `phí`, `điều chỉnh`) |
| `note` | Ghi chú, Note, Reason | Required for `adjustment` | Text |

**Row rules.** A rejected row names its `column` and `code`; the codes below are the contract with the client, and DOC-18 §2.2 gives each rule its `DQ-` number and its vi/en text (the column *DQ* below). `error` rejects the row, `warning` accepts it.

| DQ | Layer | Rule | Severity | Code |
| --- | --- | --- | --- | --- |
| 01, 03, 04, 05, 06 | file | A file-level rule of DOC-18 §1.2 (type, duplicate column, empty, too many rows, unknown column) | fail / 400 / warning | `import_file_type`, `import_duplicate_column`, `import_empty`, `too_many_rows`, `import_unknown_column` |
| 62 | file | No column resolves to `unit_code`, `fee_month` or `item_name` (*DR-317: was `import_no_header`*) | fail | `import_missing_column` |
| 63 | file | Neither `unit_price` nor `amount` has a column | fail | `import_no_price` |
| 64 | row | Unit code is 1–20 characters of `^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$` | error | `unit_code_invalid` |
| 65, 66 | row | `fee_month` parses (`MM/YYYY`, `YYYY-MM`, a date cell, an Excel serial) and equals the batch's fee month | error | `fee_month_invalid`, `fee_month_mismatch` |
| 67 | row | `item_name` 1–120 characters after trimming; `item_name_en` at most 120 | error | `item_name_invalid` |
| 68 | row | `kind` is `fee` or `adjustment` (blank = `fee`) | error | `kind_invalid` |
| 69 | row | `quantity` ≥ 0 with at most 3 decimals (`.` or `,` as the mark), at most 999,999,999.999 | error | `quantity_invalid` |
| 70 | row | `unit_price` a whole number ≥ 0, at most 9,999,999,999 | error | `unit_price_invalid` |
| 71 | row | Fee row: `amount` a whole number > 0. Adjustment row: whole number ≠ 0. Both at most 99,999,999,999 in absolute value (*DR-317*) | error | `amount_invalid` |
| 72 | row | Both given: `amount` equals the half-up product (below); a mismatch is an error and **never silently recomputed** (FR-01.5) | error | `amount_mismatch` |
| — | row | Only `unit_price` given (fee): the amount is computed; only `amount` given: quantity 1 and `unit_price` = `amount` for a fee; an adjustment takes `quantity` 1 and `unit_price` 0 | — | — |
| 73 | row | An adjustment row has a non-blank `note` of at most 500 characters | error | `adjustment_note_required` |
| 74 | row | A `note` longer than 500 characters | error | `note_too_long` |
| 75 | set | The same unit and item name twice in one file (compared by the folded key) | error | `charge_item_duplicate` |
| 76 | set | The sum of the unit's lines is above zero; a unit whose total is ≤ 0 loses all its rows | error | `charge_total_zero` |
| 77 | db | The unit exists in the building (`ResidencyApi.findUnitsByCodes`) | error | `unit_not_found` |
| 78 | db | The unit has an active owner: a charge needs someone to notify | error | `unit_without_owner` |

**The half-up rule** (DR-11, FR-01.5): `amount = (quantity_milli × unit_price + 500) / 1000` with integer division, quantity held as integer thousandths. Run on 2026-10-26 (§9.1) against the formula and `ck_charge_line_amount`:

| Quantity | Unit price | Product | Rounded line amount | A file saying … |
| --- | --- | --- | --- | --- |
| 1 | 2,488,000 | 2,488,000 | 2,488,000 | accepted |
| 12.345 | 15,000 | 185,175.0 | 185,175 | 185,000 → `amount_mismatch` |
| 0.001 | 500 | 0.5 | 1 | 0 → `amount_invalid`; 1 accepted |
| 0.001 | 499 | 0.499 | 0 | a fee row of 0 → `amount_invalid` (the row is refused, not rounded up) |
| 3.333 | 1,000 | 3,333.0 | 3,333 | accepted |
| 2.5 | 1 | 2.5 | 3 | accepted (half up) |
| 1 | 0 | 0 | 0 | `amount_invalid` for a fee |

An adjustment row has no product rule: its amount is typed (a discount `-200000`, an offset `-35175`), the quantity is 1 and the unit price 0, as in the receipt snapshot of DOC-15 §7.3. A charge of one unit is the sum of its lines; a unit with `Phí quản lý 2,488,000`, `Nước 185,175` and `Điều chỉnh −35,175` (note "Trừ phí nước tính thừa tháng 9") has a charge of 2,638,000 đ (FNM fixture). Adjustment lines are typed **by the Manager**; the system never creates, suggests or pre-fills one from a log row or a wrong transfer (DR-19, DR-16).

### 4.3 The `db` layer: one contract call

The unit codes are trimmed, lower-cased and de-duplicated in code, then one call answers for the whole file (the 2,000-row file of NFR-12 makes one call, not 2,000):

```ts
const found = await residency.findUnitsByCodes(scope.buildingId, codesLower)   // ≤ 5,000
// per row: no entry → unit_not_found; entry with hasActiveOwner = false → unit_without_owner
```

The rule "not vacant-without-owner" of original SDD §5.3 is `hasActiveOwner = false`: a vacant unit that has an owner is charged (the owner is notified); a unit with no owner is refused, because nobody could be told. `occupancy` is returned for the preview's display only. The contract serves `lower(code)` through `unit_code_prefix_idx` (DOC-18 §1.5) with `= ANY`.

### 4.4 The preview

The preview is the `result` of `finance.import_job` and is the response of `POST /staff/imports`. It holds **no personal data**: a fee file has none (DOC-15 §10.1), so the valid rows are listed whole.

```json
{
  "counts": { "rows": 240, "valid": 236, "errors": 4, "warnings": 0, "charges": 112, "lines": 236, "totalAmount": 281644000 },
  "validRows": [
    { "row": 2, "unitCode": "A-1508", "itemName": "Phí quản lý", "kind": "fee", "quantity": "1", "unitPrice": 2488000, "amount": 2488000 }
  ],
  "issues": [
    { "row": 12, "unitCode": "A-9999", "column": "unit_code", "severity": "error", "code": "unit_not_found", "params": { "code": "A-9999" } },
    { "row": 57, "unitCode": "A-1510", "column": "fee_month", "severity": "error", "code": "fee_month_mismatch", "params": { "expected": "10/2026", "got": "11/2026" } },
    { "row": 58, "unitCode": "A-1510", "column": "item_name", "severity": "error", "code": "charge_item_duplicate", "params": { "item": "Phí quản lý", "firstRow": 56 } },
    { "row": 201, "unitCode": "A-1520", "column": "amount", "severity": "error", "code": "amount_mismatch", "params": { "expected": 185175, "got": 185000 } }
  ],
  "issuesTruncated": false
}
```

`validRows` lists the first 50 valid rows, `issues` up to 500 (errors first), `counts` are complete, the API adds a rendered `message` per issue in the request language and the stored `jsonb` keeps `{code, params}` (DR-21, DR-22, DOC-18 §1.4). `charges` is the number of units that will get a charge: a unit one of whose rows is wrong is **not** partly saved; only its valid rows are, and the preview says so (see §4.5). The 240-row file of FR-01.1 gives 236 valid rows and 4 errors.

A file with a `fail` rule makes the job `failed` and nothing can be committed (409 `import_not_ready`).

### 4.5 The commit

`POST /staff/imports/{id}/commit` is one transaction (FR-01.3, FR-02.1). It reads the file again (the preview lists only 50 rows), re-runs the `file`, `row` and `set` layers and the one `findUnitsByCodes` call, and compares the counts with the stored ones; a difference is 409 `import_stale` and nothing is written (the rule of DOC-18 §1.6, DQ-50, applies to fee imports too).

1. **Claim the job.** `UPDATE import_job SET status = 'committed', committed_at = now() WHERE id AND building_id AND status = 'validated' AND expires_at > now() RETURNING result, params`. Zero rows and the job is already `committed`: answer the first result again (a double click, IM-33 pattern); a `validated` job past `expires_at` is 409 `import_expired` (FR-01.4); a `failed` job is 409 `import_not_ready`.
2. **Lock the batch and bump its version**: `UPDATE fee_batch SET version = version + 1, updated_at = now() WHERE id = :batchId AND building_id AND status = 'draft' RETURNING version`. Zero rows: the batch was published, recalled or discarded since the preview: ROLLBACK, 409 `invalid_transition`. This statement is what makes a **publish racing the commit** safe: a publish prepared from before the commit carries the old version and updates nothing (§3.3).
3. **Replace the draft's charges.** `DELETE FROM charge WHERE batch_id AND building_id AND status = 'draft'` (the lines cascade; DR-12 allows it only for a draft). The charges **added by hand** to the draft are replaced too: the file overwrites the draft (FR-02.1, original SDD §5.3).
4. **Insert** the charges (`amount` = sum of the lines, `unit_code` = the code stored in the unit, status `draft`) and their lines in bulk from the rows (`INSERT … SELECT FROM unnest(…)` in chunks of 1,000 rows, the same transaction). Positions run 1… in file order per unit.
5. `finance.batch.import_commit` audit row with `created` and `replaced`; commit. The file object stays until `finance_purge` removes it after 30 days (DR-22; a fee file holds no personal data).

Run on 2026-10-26: the commit of a validated job with 240 charges and 480 lines wrote 240 and 480 and returned version 2; the same claim again returned 0 rows; a re-import that replaced the draft deleted 240 charges and 480 lines in one statement. A job whose batch had been published failed step 2 with 0 rows.

**What a row error costs.** Only valid rows are saved (FR-01.1): a unit with two rows, one valid and one wrong, gets a charge of the valid row only, and the preview lists the wrong row as an error so the Manager sees it before pressing "Save". A unit whose every row is wrong gets no charge. The Manager completes the draft by editing it (§3.2) or by importing a corrected file, which replaces it.

### 4.6 Cost

Measured by NFR-12's definition on a developer machine: DOC-18 §1.4 measured the read and row checks of 2,000 rows at 77 to 83 ms. The fee file adds one `findUnitsByCodes` call (an index scan of at most 2,000 codes) and the `import_job` insert; nothing else touches the database before the commit. The commit's cost is the delete and the two bulk inserts. **P2-04 measures both** with the 2,000-row file of FR-01.7 (IM-77) against the 10 s target; until then the figures are plans (DOC-10).

## 5. Transactions and concurrency

| Race | Arbiter | Loser sees | Test |
| --- | --- | --- | --- |
| Two publishes | `UPDATE fee_batch … WHERE status = 'draft'` | 409 `invalid_transition`; no event | LG-61 |
| Publish vs charge edit or import commit | The batch `version` | 409 `version_conflict` | LG-62 |
| Two edits of one draft charge | `charge.version` | 409 `version_conflict` with the fresh charge | LG-63 |
| Two commits of one job | `UPDATE import_job … WHERE status = 'validated'` | The first result again | IM-72 |
| Commit vs publish | The batch row lock and `version + 1` (§4.5 step 2) | 409 `invalid_transition` on the commit, or 409 `version_conflict` on the publish | IM-73 |
| Two due-date extensions | `version` and `due_date < :new` in the statement | 409 `version_conflict` or 400 `due_date_not_later` | LG-66 |
| Recall vs settlement | The charge row (`status = 'open'`) | Whichever commits second: 409 `batch_has_payments`, or a log row `charge_recalled` | LG-81 (DOC-22 §10), EXP-04 |
| Void vs settlement | The charge row | 409 on the void, or a log row `charge_recalled` | LG-79 |
| Recall of a recalled batch, close of a recalled batch | `status = 'published'` in the statement | 409 `invalid_transition` | LG-67 |

Rules that hold for every use case here (CLAUDE.md, DOC-12 §14): the change, its outbox rows and its audit row commit in **one transaction**; no network call runs inside it (the gateway cancel is a command, DOC-23); every business query carries the `BuildingScope` taken from the token, never from the body; a conditional update has a race test above; the batch version is the optimistic lock a Manager sees as `If-Match`. A use case that fails after the first write rolls everything back, including the counter, so no batch code is lost to a failed create.

## 6. Configuration

No new key. The file and row limits are the existing `FILES_MAX_IMPORT_BYTES` (5 MB, DOC-41) and the constants of DR-21 (5,000 rows, 500 listed issues, 50 listed valid rows, 24 h expiry), which are code constants, not settings: changing them is a DR. The building's time zone is `building.time_zone` (DR-09). The batch code and the 500-id chunk of the publish event have no key (DR-10, DOC-09 §3.4).

## 7. Metrics and logs

Metrics are DOC-40's; this document adds none.

| Metric | Used here | Note |
| --- | --- | --- |
| `import_validate_duration_seconds` | `ValidateFeeImport` | The same histogram as the units import; the log field `kind` tells them apart |
| `import_commits_total{outcome}` | `CommitFeeImport` | `committed`, `expired`, `stale`, `not_ready` |

Log lines are structured (`event`, `buildingId`, `batchId`, `actor`, `ms`; no amount and no name): `fee_batch.created`, `fee_batch.published` (with `charges` and `parts`), `fee_batch.due_extended`, `fee_batch.recalled`, `fee_batch.closed`, `fee_batch.reissued`, `fee_batch.discarded`, `fee_import.validated` (with `rows`, `valid`, `errors`), `fee_import.committed`, `charge.voided`. A refused recall logs `fee_batch.recall_refused` with `paidCount`.

## 8. Errors and handling

Codes and their wording are DOC-42 §5; the status here is the one the use case answers.

| Code | Status | When | Section |
| --- | --- | --- | --- |
| `version_conflict` | 409 | A stale `If-Match` on a batch or charge | §3.2, §3.3 |
| `precondition_required` | 428 | `If-Match` missing on a versioned edit | §3.2 |
| `invalid_transition` | 409 | The batch or charge is not in the state the action needs (publish of a published batch, recall of a closed one, edit of a published one, void of a paid charge) | §3 |
| `no_charges`, `charge_total_zero`, `due_date_in_past` | 400 | Publish checks | §3.3 |
| `due_date_not_later` | 400 | An extension to the same or an earlier date | §3.4 |
| `batch_has_payments` | 409 | Recall when a charge is paid; details `{ paidCount }` | §3.5 |
| `charge_not_voidable` | 409 | Void of a `paid` charge or one with a live allocation; details `{ status }` | §3.9 |
| `reason_too_short`, `reason_too_long` | 422 | A recall or void reason outside 5…500 | §3.5, §3.9 |
| `import_expired`, `import_stale`, `import_not_ready` | 409 | The commit of an old, changed or failed job | §4.5 |
| `import_missing_column` and `import_no_price` (**new**), the row codes of §4.2 | job `failed` / row issues | The file or a row is wrong | §4.2 |
| `too_many_rows` | 400 | More than 5,000 rows; no job is stored | §4.2 |

`import_missing_column`, `import_no_price` and the row codes of §4.2 are not HTTP errors: they are `issues` of the preview (or the job's `failed` result). DOC-42 §5 lists the HTTP codes; the issue codes and their texts are DOC-18 §2.2 (P1-27). The two codes here that DOC-42 lacks are `import_missing_column` and `import_no_price`, file-level `fail` rules listed in DOC-18 §2.2 with the others.

## 9. Required tests

Prefix `IM-` continues the numbering of DOC-18 (IM-01…43, DOC-18 §4; DOC-21 starts at 50, DOC-88 §15). The ledger prefix `LG-` is numbered by DOC-22 (`LG-01…`); DOC-21 takes `LG-61…LG-81` for batch rules (DR-265). Statement tests that need a clock use `FakeClock`.

| ID | Scenario | Expected |
| --- | --- | --- |
| IM-50 | The 240-row file of FR-01.1 (rows 12, 57, 58, 201 wrong) | 236 valid rows, 4 errors with `row`, `column`, `code`; the job is `validated` |
| IM-51 | 5,001 rows; 5,000 rows | 400 `too_many_rows`, no job; 5,000 accepted |
| IM-52 | A 5.2 MB file | Refused at `FilesApi.verify`, no job |
| IM-53 | Headers in Vietnamese and in English mixed | Resolved to the same canonical columns; an unknown column is one warning |
| IM-54 | No `unit_price` and no `amount` column | Job `failed`, `import_no_price`, 409 `import_not_ready` on commit |
| IM-55 | The half-up table of §4.2 | Every row of the table as listed |
| IM-56 | Quantity `12,345` with a comma; `12.3456`; `-1` | Accepted as 12.345; `quantity_invalid`; `quantity_invalid` |
| IM-57 | Fee row amount 0; negative fee row; adjustment −200,000; adjustment 0 | `amount_invalid`; `amount_invalid`; accepted when the unit total stays above 0; `amount_invalid` |
| IM-58 | An adjustment without a note | `adjustment_note_required` |
| IM-59 | A unit whose lines sum to −5,000 | `charge_total_zero` on every row of the unit |
| IM-60 | The same unit and item twice, in different letter case | `charge_item_duplicate` on the second row |
| IM-61 | Fee month `11/2026` in a batch of 10/2026 | `fee_month_mismatch` |
| IM-62 | An unknown unit code; a unit with no owner; a vacant unit with an owner | `unit_not_found`; `unit_without_owner`; accepted |
| IM-63 | The unit code `a-1508` in lower case | Matches `A-1508`; the charge stores the unit's code |
| IM-64 | A `batchId` that is published, or of another building | 409 `invalid_transition`; 404; no job stored |
| IM-65 | Commit of the IM-50 job | Exactly 236 rows saved; the batch `version` increased; the job `committed` |
| IM-66 | Re-import of 200 valid rows into a draft of 240 charges | The draft has exactly 200 charges; none of the earlier 240 remain (FR-02.1) |
| IM-67 | A charge added by hand, then an import commit | The hand-added charge is gone: the file overwrites the draft |
| IM-68 | A commit of a job older than 24 h (FakeClock) | 409 `import_expired`; nothing written |
| IM-69 | A commit after the unit list changed (a unit lost its owner) | 409 `import_stale`; nothing written |
| IM-70 | A commit of a `failed` job | 409 `import_not_ready` |
| IM-71 | A discarded draft's job committed | 404 `not_found` |
| IM-72 | Two commits of one job in parallel (barrier) | One commit; the second returns the first result; the draft has the rows once (FR-01.3) |
| IM-73 | A commit and a publish at the same instant (barrier) | One wins; a publish that carried the old version gets 409 `version_conflict`; never a published batch with a half-replaced charge list |
| IM-74 | The preview of a 2,000-row file with 40 errors | `issues` has 40 entries, `validRows` has 50, `counts` are complete (the IM-30 shape of DOC-18) |
| IM-75 | A file with 600 errors | `issues` has 500 entries, errors first, `issuesTruncated = true`, `counts.errors = 600` |
| IM-76 | The preview of a sample with one error of each code of §4.2 | The set of codes found equals the set in the table (the P1-27 fixture) |
| IM-77 | The 2,000-row file of FR-01.7, validated and committed | Validation ≤ 10 s (NFR-12); the commit time is recorded in the result file |
| LG-61 | Two Managers publish the same draft of 240 charges (barrier) | One succeeds; 240 charges `open`; exactly one `batch_published.v1` set; the second gets 409 `invalid_transition` (FR-03.2, FNM-S01) |
| LG-62 | A charge edit and a publish at the same instant | Either the publish sees the edit, or the publish fails with 409 `version_conflict`; never a published charge that differs from the screen |
| LG-63 | Two Managers save charge A-1508 at `version` 3 | The first succeeds (4); the second 409 `version_conflict` with the fresh charge (FR-02.2) |
| LG-64 | Publish of a draft with no charge; with a charge of total 0; with `due_date` yesterday in building time | 400 `no_charges`; 400 `charge_total_zero`; 400 `due_date_in_past`; nothing changes (FR-03.1) |
| LG-65 | The batch created at 00:30 on the 1st (UTC 17:30 on the 31st) | The code uses the fee month; `due_date` is compared with building today |
| LG-66 | Extend the due date to 2026-10-25, then to 2026-10-10, then with a stale `If-Match` | Accepted and audited; 400 `due_date_not_later`; 409 `version_conflict` (FR-44.1); a notification `fee.batch_due_extended` |
| LG-67 | Patch the name of a published batch; recall a closed batch; close a recalled batch | 409 `invalid_transition` each (FR-44.2, FR-04.4) |
| LG-68 | Create the first and the second batch of 10/2026; create one in 11/2026 | `PH-2610-01`, `PH-2610-02`, `PH-2611-01` (FR-03.4); a failed create leaves the counter unchanged |
| LG-69 | Discard a draft `PH-2611-02`, then create another batch of 11/2026 | The batch and its charges are gone; the new code is `PH-2611-03` (FR-02.4) |
| LG-70 | Recall of 240 `open` charges with an intent holding two of them and a charge of another batch | 240 charges `void` (`void_kind = recall`); the intent `cancelling` as a whole; `batch_recalled.v1` and one `intent_cancel_requested.v1` written (FR-04.1) |
| LG-71 | Recall with one `paid` charge; recall with a reason of 4 characters | 409 `batch_has_payments`, every charge unchanged, the batch still `published` (FR-04.2); 422 `reason_too_short` |
| LG-72 | 239 `open` + 1 voided alone, no payment | Recalled (DR-97) |
| LG-73 | Re-issue of a recalled batch with 240 charges (one voided alone) | A new draft with `replaces_batch_id`, 239 charges and their lines under new ids, a new code; `fee_month` kept, `due_date` editable (FR-04.5) |
| LG-74 | Re-issue of a published batch | 409 `invalid_transition` |
| LG-75 | Close a published batch; pay one of its open charges; debt | The charge is payable; debt counts it; recall refused (DR-20) |
| LG-76 | Void an `open` charge with the reason "billed to the wrong unit" | `void`, `void_kind = single`, one audit row, `charge_voided.v1`, the other 239 untouched (FR-49.1) |
| LG-77 | Void a `paid` charge; a reason of 4 characters; as a Technician; with a stale `If-Match` | 409 `charge_not_voidable`; 422 `reason_too_short`; 403; 409 `version_conflict` (FR-49.2) |
| LG-78 | Void a charge held by an intent with another charge | The intent is `cancelling` as a whole in the same transaction (FR-49.3) |
| LG-79 | A void and an exact settlement of one charge at the same instant (barrier, 200 rounds) | Exactly one wins each round; no `void` charge has a live allocation (FR-49.5, EXP-04) |
| LG-80 | Direct `UPDATE charge SET amount` on an `open` charge; `UPDATE charge_line` of an open charge | Rejected by the trigger (`23000`, FR-02.3, FNM-28…31) |
| LG-81 | A recall of a batch of 240 charges and an exact settlement of one charge at the same instant (barrier, 200 rounds) | Exactly one wins each round: the batch is recalled and the transfer is a log row `charge_recalled`, or the charge is paid and the recall is 409 `batch_has_payments`; 0 recalled batches with a live allocation (FR-04.3, EXP-04) |

### 9.1 Statements run

Run on 2026-10-26 on `postgres:18.6` (x86_64, Docker, session zone UTC), on the DDL of DOC-15, as `psql` scripts that are **not committed**: P2-04 and P2-05 turn the tables above into `bun test` cases against a template database, as DOC-15 §13 does.

| Check | Result |
| --- | --- |
| Create batch with the counter upsert | `PH-2610-01`; a second upsert returns 2 |
| The nine rows of the half-up table (§4.2) as the formula and as inserts | The formula gives 2,488,000, 185,175, 1, 0, 3,333, 3 as listed; `ck_charge_line_amount` refused 12.345 × 15,000 = 185,000, `ck_charge_line_sign` refused a fee line of 0, and 2.5 × 1 = 3 and 0.001 × 500 = 1 were accepted |
| Commit of a validated job: claim, batch version bump, delete drafts, insert 240 charges and 480 lines | 240 and 480; version 2; the second claim of the job returned 0 rows |
| Re-import: delete of the draft's charges | 240 charges and 480 lines in one statement (cascade) |
| Publish (DOC-15 §5.1) of the 240 charges | 240 `open`; the sum trigger accepted every charge |
| Extend the due date to 2026-10-25; to 2026-10-10; with a stale version | `2026-10-25, version 4`; 0 rows; 0 rows |
| Name edit and delete of a published batch; edit of an open charge's line | Each refused by its trigger |
| Single void, then recall | expected 239, updated 239 |
| Re-issue copy | `PH-2610-02`, `replaces_batch_id` set, 239 charges, 478 lines |
| Discard of the draft | `PH-2610-02` deleted, 0 charges left, the counter stays at 2 |
| Close of a recalled batch | 0 rows |

## 10. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-265 | Batch rules the catalog and DR-20 leave open: (1) the fee month of a draft is fixed at creation; the header edit changes the name and the due date; (2) three endpoints the catalog lacks, `POST /staff/fee-batches/{id}/charges` (E-170), `DELETE /staff/charges/{id}` (E-171) and `DELETE /staff/fee-batches/{id}` (E-172); (3) a new contract `ResidencyApi.findUnitsByCodes`; (4) an import commit and every draft edit bump the batch `version`, so a stale publish gets 409; (5) a re-issue copies every charge except one voided alone; (6) the audit action `finance.batch.discard` | §2.1, §2.3, §3 |
| DR-266 | The nightly check runs 19 queries, not 20: the 17 finance corruptions of DR-78 and the two table checks of DOC-15 §12.2; the three membership and notice corruptions belong to `integrity_weekly` and `integrity_notices` | DOC-22 §13 (decided there); listed here because DOC-21's tests rely on the same split |

Both are recorded in the decision register (section C, after DR-245) as proposed by Claude under delegation and approved by the Owner on 2026-10-26.

## 11. Not in this document

| Topic | Lives in |
| --- | --- |
| Tables, constraints, triggers, indexes | DOC-15 |
| The DQ numbers and texts of the fee import rules | DOC-18 §2 (P1-27) |
| Allocation, manual payment, void of a payment, receipts, the money log, debt, aging, the nightly check, the recall-vs-payment race in full | DOC-22 |
| Cancelling a payment link, intent states, `settle()` | DOC-23 |
| The PDF of a bill and the bulk ZIP | DOC-34 |
| Notification texts and push | DOC-31 |
| Endpoint numbers beyond those named, request and response samples | DOC-51 |
| Screens `W-Fee-Import`, `W-Fee-Batch`, `W-Fees` | DOC-66 |
| Flows FL-01…09 | DOC-44 |

## 12. Traceability

| Item here | Decision | Requirements and tests |
| --- | --- | --- |
| §3.1 create and code | DR-10 | FR-03.4; LG-65, LG-68 |
| §3.2 draft edit | DR-12, DR-265 | FR-02; LG-63, IM-66, IM-67 |
| §3.3 publish | DR-20, DR-243 | FR-03; LG-61, LG-62, LG-64 |
| §3.4 extend | DR-20 | FR-44; LG-66 |
| §3.5 recall | DR-19, DR-20, DR-97 | FR-04.1…4; LG-70…72, LG-81 |
| §3.6 close | DR-20 | FR-04.4; LG-75 |
| §3.7 re-issue | DR-20, DR-265 | FR-04.5; LG-73, LG-74 |
| §3.8 discard | DR-12, DR-265 | FR-02.4; LG-69 |
| §3.9 void a charge | DR-19, DR-20, DR-244 | FR-49; LG-76…79 |
| §4 import | DR-11, DR-21, DR-22, DR-109, DR-149 | FR-01.1…7, FR-02.1; IM-50…77 |
| §5 concurrency | DR-14, ADR-0006 | FR-03.2, FR-04.3, FR-49.5; LG-61…81 |

## Open questions

None. DR-265 and DR-266 are approved by the Owner (2026-10-26). The row codes of §4.2 have their `DQ-` numbers (DOC-18 §2, P1-27, DR-317). The document stays **Draft** until DOC-51 numbers E-170…E-172 and the sample owed for E-95, E-96 and E-100, and the P2 tasks have run the tests of §9.
