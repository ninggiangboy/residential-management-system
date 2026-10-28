# Building configuration and demo

> Status: **Approved** (Owner, 2026-10-21) · Updated: 2026-10-28 (P1-26: a replaced logo is kept, DR-296, §4 and BD-10) · 2026-10-27 (P1-21: the demo seed, the reset, E-56, the nightly job, the mail skip and boot guard checks 2, 3, 5 and 6 as built, §13 run for the P1 modules, DR-270); earlier 2026-10-22 (P1-07: the module as built, §13 run, VietQR fields provisional, DR-252; DR-243: the `rms.demo_reset` setting holds the demo building's id; earlier DR-203: note on the resident contact block; earlier DR-140: boot guard check 1 uses `buildingIdsOfAccounts`) · DOC-36
> Depends on: original SDD §15, §21, [DR](../00-decision-register.md) (DR-26, 33, 36, 37, 39, 59, 60, 65, 74, 87, 98, 111, 112, 115, 126, 238), [ADR-0007](../04-adr/0007-payment-gateway-port-and-payment-link.md), [ADR-0026](../04-adr/0026-demo-building-and-fake-payment-driver.md), [DOC-03](../01-product/requirements.md) (FR-14, FR-15.6, FR-38, FR-41, FR-50), [DOC-09](../03-architecture/messaging-contracts.md) §7, [DOC-12](../03-architecture/code-architecture.md) §4.4, §8, [DOC-16](../05-data/identity-and-residency-model.md) §4.2, §4.4, [DOC-17](../05-data/operations-model.md) §1, [DOC-19](../05-data/db-roles-and-grants.md), [DOC-20](../05-data/data-lifecycle.md), [DOC-35](audit-privacy-and-terms.md), [DOC-37](files-and-uploads.md), [DOC-38](jobs-and-outbox-runtime.md), [DOC-06](../02-glossary.md)
> Main readers: P1-07 (`building` module), P1-11, P1-12, P1-16 (settings screens), P1-21 (demo seed and reset guard), P3-xx (gateway screen), DOC-24, DOC-26, DOC-41, DOC-51, DOC-67, DOC-70, DOC-102, RB-12

This document says how a building is configured and how the demo building is made safe: the contracts of the `building` module, the building and company data, the settings and when each takes effect, the encryption of secrets, the gateway-configuration screen and its step-up, the administration of terms versions, the demo building (what it holds, what is switched off in it), the boot guard, and the nightly and manual reset with its guard. It does not hold the tables (DOC-17 §1), the audit rules (DOC-35), the upload flow (DOC-37), the fake driver and the simulator (DOC-24), the OTP flow (DOC-26) or the demo script (DOC-102).

Everything new here is DR-126 (§14). The SQL was run on PostgreSQL 18.6 (`postgres:18.6`, aarch64) on 2026-10-19 against the DDL of DOC-14, DOC-16 and DOC-17 (§13.1); the encryption helper was run on Bun 1.4.3 (§6).

## 1. Scope and reading guide

| Question | Answer lives in |
| --- | --- |
| What can another module call? | §3 |
| How are the building and the company block edited? | §4 |
| What does each setting do, and when does a change apply? | §5 |
| How are secrets encrypted, and how does a key rotate? | §6 |
| How does the Admin change the payment gateway? | §7 |
| How are terms published? | §8 |
| What does the demo building hold, and what is switched off in it? | §9 |
| What stops the demo from touching real data? | §10 |
| How is it tested? | §13 |

## 2. Principles

1. **Configuration is data with a schema.** A setting is a key of one validated document; a value out of range is refused, never clamped (FR-38.2).
2. **Defaults live in code.** The database holds only what an Admin saved; a new key needs no migration (DR-111).
3. **A secret is never plain outside memory.** Stored encrypted, shown masked, never logged, never in an audit row (DR-33, DOC-35 §3.4).
4. **The sensitive change is the one that costs a second proof.** The gateway and the receiving account change only with a step-up (FR-50).
5. **The demo is safe because it is checked, not because it is separate.** One deployment holds both buildings, so every seam is a flag, a guard and a test (ADR-0026).
6. **One deployment, one real building.** A second real building is a second deployment (DR-115); the code still scopes everything by `building_id`.

## 3. Contracts of the `building` module

Provider: `building`. Callers: every module (DOC-07 §5.2). Signatures marked **new** are added to DOC-09 §7.4 with this document (DR-126).

```ts
interface BuildingApi {
  getSettings(buildingId: Uuid): Promise<BuildingSettings>                          // saved keys overlaid on defaults (DR-111)
  getBuilding(buildingId: Uuid): Promise<BuildingDto | null>                        // new
  listBuildings(): Promise<BuildingDto[]>                                           // new: the real building and the demo one
  isDemo(buildingId: Uuid): Promise<boolean>                                        // new
  getGatewayConfig(buildingId: Uuid, provider: GatewayProvider,
                   opts?: { lock?: 'share' }): Promise<GatewayConfigDto | null>     // `opts` new
  hasAcceptedLatestTerms(accountId: Uuid, buildingId: Uuid): Promise<boolean>       // DR-111
  missingTerms(accountId: Uuid, buildingId: Uuid): Promise<MissingTerm[]>           // new: the rows of DOC-35 §9.2
}
interface FeatureApi { get(buildingId: Uuid): Promise<Record<string, boolean>> }    // §3.3
interface BuildingDto { buildingId: Uuid; code: string; name: Bilingual; timeZone: string; isDemo: boolean }
interface MissingTerm { kind: 'terms' | 'privacy'; version: number; versionId: Uuid }
```

### 3.1 Behavior

| Call | Behavior |
| --- | --- |
| `getSettings` | One primary-key read of `building_setting`, overlaid on the code defaults. Cached in the process for 60 s per building; the process that saved a change clears its own entry at once, another process sees the change within 60 s. Keys that must not wait (the lockout, the deletion cooling-off) tolerate this: both are read per attempt or per daily run |
| `getBuilding`, `listBuildings`, `isDemo` | Read `building.building`; cached 60 s. `isDemo` of an unknown id is `false`; callers that act on it (the senders, the reset) first have a row from another read |
| `getGatewayConfig` | Reads the active row of `(buildingId, provider)` and decrypts in memory (`secrets` is a map of the driver's fields). With no option it may answer from a 60 s cache; with `{ lock: 'share' }` it bypasses the cache and runs `SELECT … FOR SHARE`, **inside the caller's transaction** (§7.3). Never logged; the blob is never returned |
| `hasAcceptedLatestTerms`, `missingTerms` | One statement, no cache (DOC-35 §9.2) |

### 3.2 `BuildingSettings`

```ts
interface BuildingSettings {
  defaultLanguage: 'vi' | 'en'
  defaultDueDays: number
  accountDeletionDays: number
  lockout: { maxAttempts: number; minutes: number }
  maxCarsPerUnit: number
  storageQuotaBytes: number
  feeNoticeLanguage: 'vi' | 'en' | 'both'
  reportColumns: Record<string, string[]>
}
```

The keys, defaults and ranges are DOC-17 §1.2; the TypeBox schema of §5.1 is their code form.

### 3.3 Feature flags

A flag is an environment variable read at boot; there is no table and no per-building override (DR-126). `FeatureApi.get(buildingId)` returns the same map for every building; the argument keeps the call stable if a flag ever becomes per building.

| Map key | Variable | Default | Effect | Source |
| --- | --- | --- | --- | --- |
| `ticketDeadlines` | `FEATURE_TICKET_DEADLINES` | `false` | When `true`, an overdue ticket raises an alert and a badge and the job `tickets_overdue` runs; `ticket.due_at` is set either way | DR-47, P4-12 |

An unknown `FEATURE_*` variable stops the boot (a typo must not leave a feature off silently). A flag is documented in DOC-41 when it is added; removing a flag removes the code path in the same change.

## 4. The building and the company block

`GET /staff/settings` returns the building row and the settings in one document; `PATCH /staff/settings` edits either or both. The Admin is the only audience (a Manager gets 403, FR-38.1).

```json
{
  "building": {
    "id": "018f0000-0000-7000-8000-000000000001", "code": "SUNRISE-A",
    "name": { "vi": "Chung cư Sunrise A", "en": "Sunrise A Apartments" },
    "company": { "name": { "vi": "Công ty TNHH Quản lý Tòa nhà Sunrise" }, "taxCode": "0312345678",
                 "address": "12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", "phone": "028 3822 0000" },
    "address": "12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", "hotline": "1900 1234",
    "workingHours": { "vi": "Thứ 2 – Thứ 6, 8:00 – 17:00" }, "email": "bql@sunrise.example",
    "logoFileId": "018f0000-0000-7000-8000-0000000000f1", "logoUrl": "https://…", "timeZone": "Asia/Ho_Chi_Minh", "isDemo": false
  },
  "settings": { "defaultLanguage": "vi", "defaultDueDays": 12, "accountDeletionDays": 30,
                "lockout": { "maxAttempts": 5, "minutes": 15 }, "maxCarsPerUnit": 2,
                "storageQuotaBytes": 53687091200, "feeNoticeLanguage": "vi", "reportColumns": {} },
  "saved": ["defaultDueDays"]
}
```

`ETag: "3.8"` is `"<building.version>.<building_setting.version>"`. `PATCH` requires `If-Match` with that value (missing: 428 `precondition_required`; stale: 409 `version_conflict` with the fresh document in `details.current`).

### 4.1 `PATCH` body

```json
{ "building": { "hotline": "1900 5678", "workingHours": { "vi": "Hằng ngày, 7:30 – 18:00" }, "logoFileId": null },
  "settings": { "defaultDueDays": 15, "maxCarsPerUnit": null } }
```

- `building` carries only the fields to change. `code`, `timeZone` and `isDemo` are **not editable** through the API: `additionalProperties: false` rejects them with 400 `validation_failed`. A time-zone change moves every "today" of the building (DOC-14 §7) and is a migration with a DR, not a form (DR-126).
- `settings` is a shallow merge: a key present is set, a key with `null` is **removed** and falls back to its default, a key absent is untouched. `lockout` is always sent whole (`maxAttempts` and `minutes` both required), so the shallow merge cannot leave half of it.
- Both parts run in one transaction (§4.3).

### 4.2 Field rules

| Field | Rule |
| --- | --- |
| `name.vi` | Required, 1…120 characters; `name.en` optional, ≤ 120 |
| `company.name.vi` | Required, 1…160; `en` optional |
| `company.taxCode` | Optional, `^[0-9]{10}(-[0-9]{3})?$` |
| `company.address`, `address` | 1…300 characters |
| `company.phone`, `hotline` | ≤ 30 characters, digits, spaces and `+().-` |
| `company.email`, `email` | A valid address, ≤ 254 |
| `company.representative` | ≤ 120 |
| `workingHours` | Bilingual, `vi` required when present, each ≤ 200 |
| `logoFileId` | A `verified` file of purpose `logo` registered by the Admin; `null` removes the logo. The old logo goes through `FilesApi.remove` in the same transaction (DOC-37). *Revised 2026-10-28 (DR-296):* the old logo is **not** removed and stays `attached`, because receipt snapshots name it by id and a later void copy must still print it (DOC-34 §8.4) |

A rule breach is 400 `validation_failed` with `details: [{path, code, message}]` and nothing changes. The logo is resized to 512 px once by the worker; the PDFs use that copy (DR-56, DOC-37 §10).

*Note (DR-203):* the resident app shows only the contact block that E-15 `GET /me/contact` returns: the building name, `hotline`, `workingHours` and `email`. The company line, an office location, a logo mark and an out-of-hours sentence are not shown because no field here backs them; an office location or the logo can be added to this block later (DOC-60 `Contact`, `Account-Phone`).

### 4.3 The transaction

```sql
-- inside one uow.run, after the guard `staff('admin')`; each statement only when its part is in the body
UPDATE building.building SET hotline = :hotline, working_hours = :working_hours, logo_file = :logo_file,
       version = version + 1, updated_at = now()
 WHERE id = :building_id AND version = :building_version RETURNING version;          -- 0 rows: 409 version_conflict

UPDATE building.building_setting
   SET data = (data || :set::jsonb) - :remove::text[],                              -- set: keys with values; remove: keys sent as null
       version = version + 1, updated_at = now()
 WHERE building_id = :building_id AND version = :setting_version RETURNING data, version;
```

Run on a settings row of version 7 holding `{"defaultDueDays":12,"maxCarsPerUnit":3}`, the second statement with `{"defaultDueDays":15,"feeNoticeLanguage":"both"}` and `['maxCarsPerUnit']` returned `{"defaultDueDays": 15, "feeNoticeLanguage": "both"}` at version 8; the same statement with version 7 again changed 0 rows (BD-05, BD-06). Then `AuditApi.record` writes `building.building.update` and/or `building.settings.update`, each with the changed fields as `changes` (DOC-35 §4.2), the cache entry is cleared, and the response is the new document. A request that changes only one part leaves the other row and its version alone.

## 5. Settings

### 5.1 Schema

Two definitions in `modules/building/src/contracts/settings-schema.ts` carry the rules, so each failure has the status FR-38.2 wants:

- `SettingsShapeSchema` is the TypeBox schema the route declares: names and **types** only, `additionalProperties: false` everywhere. A misspelled key or a wrong type is 400 `validation_failed` (`unknown_key`, `type`).
- `SETTING_RULES` is the table of ranges and enumerations below. The use case checks it after the shape passes, and a value outside it is 422 `validation_failed` with rule `setting_invalid` and the path of the setting (`settings.defaultDueDays`), so the Admin sees which one is out of range. `getSettings` runs the same table over what it read, and a stored value that fails it falls back to its default with an `error` log (a hand-edited row cannot break a request).

```ts
export const SettingsShapeSchema = Type.Object({
  defaultLanguage:     Type.String(),
  defaultDueDays:      Type.Integer(),
  accountDeletionDays: Type.Integer(),
  lockout:             Type.Object({ maxAttempts: Type.Integer(), minutes: Type.Integer() }, { additionalProperties: false }),
  maxCarsPerUnit:      Type.Integer(),
  storageQuotaBytes:   Type.Integer(),
  feeNoticeLanguage:   Type.String(),
  reportColumns:       Type.Record(Type.String({ pattern: '^[a-z_]+$' }), Type.Array(Type.String({ pattern: '^[a-zA-Z0-9_.]+$' }), { maxItems: 40 })),
}, { additionalProperties: false })
// a PATCH body is the same shape with every key optional and nullable (null removes a saved key)

export const SETTING_RULES = {
  defaultLanguage:       { oneOf: ['vi', 'en'] },
  defaultDueDays:        { min: 1, max: 60 },
  accountDeletionDays:   { min: 1, max: 365 },
  'lockout.maxAttempts': { min: 3, max: 10 },
  'lockout.minutes':     { min: 5, max: 120 },
  maxCarsPerUnit:        { min: 1, max: 20 },
  storageQuotaBytes:     { min: 1_073_741_824, max: 1_099_511_627_776 },
  feeNoticeLanguage:     { oneOf: ['vi', 'en', 'both'] },
} as const
```

`reportColumns` is checked against the kinds and column keys of each report by DOC-33 (an unknown kind or column is 400 `validation_failed` with the path); this document only guarantees its shape.

### 5.2 When a change takes effect

| Key | Effect | Delay |
| --- | --- | --- |
| `defaultLanguage` | The language preselected for a **new** resident account and for mail sent before the person has chosen one; existing accounts keep theirs | New accounts |
| `defaultDueDays` | The proposed due date of the next batch (creation date + days, FR-38.4); a batch already created keeps its date | Next batch |
| `accountDeletionDays` | Read by the daily job at run time, so an approval already given follows the new value (DOC-35 §10.1) | Next daily run |
| `lockout.maxAttempts`, `lockout.minutes` | Applied from the next failed sign-in; a lock already in force keeps its `locked_until` | ≤ 60 s on another process |
| `maxCarsPerUnit` | A warning at the next vehicle review, never a block (DR-49) | Next review |
| `storageQuotaBytes` | Applied by the next `register` call and by the hourly usage job. Lowering the quota under the current usage is allowed: uploads are refused (413 `quota_exceeded`) and the Admin alert fires at the next hourly run | ≤ 1 h for the alert |
| `feeNoticeLanguage` | The language of fee notices and receipts rendered **after** the change; a PDF already rendered keeps its language (the cache key includes it, DR-56) | Next render |
| `reportColumns` | The columns of the next report or export | Next report |

## 6. Encryption of secrets

Three kinds of secret use one format and one helper: gateway secrets (`SETTINGS_ENCRYPTION_KEYS`), the CCCD number (`PII_ENCRYPTION_KEYS`) and the one-time codes carried by the outbox commands (`SETTINGS_ENCRYPTION_KEYS`, DR-117). The format is the one of DR-33: `v1:<keyId>:<iv>:<ciphertext+tag>`, each part base64url, AES-256-GCM with a 12-byte random IV and a 128-bit tag.

### 6.1 `SecretBox`

`SecretBox` lives in `@core/kernel` as a local change recorded in `packages/CORE_VERSION` (like `GaplessCounter`, DOC-12 §13.1): every module and package may import `@core/kernel`, and WebCrypto is a global of Bun, so the file has no dependency (DR-126). The composition root reads a key ring from the environment and hands a `SecretBox` to the modules that need one.

```ts
type KeyRing = Readonly<Record<string, Uint8Array>>         // keyId → 32 bytes; ids match ^k[0-9]+$

interface SecretBox {
  seal(aad: string, plaintext: string): Promise<string>     // with the newest key
  open(aad: string, blob: string): Promise<string>          // with the key named in the blob; throws SecretOpenError
  keyIdOf(blob: string): string
}

export function newestKeyId(ring: KeyRing): string {        // the highest number: k10 > k9
  const ids = Object.keys(ring)
  if (ids.length === 0 || !ids.every((i) => /^k[0-9]+$/.test(i))) throw new Error('invalid key ring')
  return ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).at(-1)!
}
export async function seal(ring: KeyRing, aad: string, plaintext: string, iv = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const keyId = newestKeyId(ring)
  const key = await crypto.subtle.importKey('raw', ring[keyId]!, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 }, key, new TextEncoder().encode(plaintext)))
  return `v1:${keyId}:${Buffer.from(iv).toString('base64url')}:${Buffer.from(ct).toString('base64url')}`
}
// open() splits the blob, requires v1 and a key id present in the ring, and decrypts with the same aad
```

`SETTINGS_ENCRYPTION_KEYS` and `PII_ENCRYPTION_KEYS` are JSON objects `{"k1": "<base64 of 32 bytes>", "k2": "…"}` (DR-65, also accepted as `*_FILE`). **The newest key is the one with the highest number**, not the first in the file; a key id that does not match `^k[0-9]+$`, a key that is not 32 bytes or an empty ring stops the boot. `bun run keys:generate` writes `k1`.

### 6.2 AAD: the blob is bound to its place

The additional authenticated data is not stored in the blob; the caller recomputes it. A blob copied to another row, or a ciphertext swapped between two accounts, therefore fails to open (the tag does not verify).

| Use | AAD | Ring |
| --- | --- | --- |
| `gateway_config.secrets_enc` | `gateway_config\|<gateway_config.id>` | settings |
| `resident_profile.cccd_enc` | `cccd\|<building_id>\|<account_id>` | PII |
| `secretEnc` of an outbox command | `outbox\|<message type>` | settings |

Test vector (key ring `{k1: 32 × 0x01, k2: 32 × 0x02}`, IV 12 × 0x07, AAD `gateway_config|018f0000-0000-7000-8000-0000000000a1`, plaintext `{"clientId":"demo-client","apiKey":"demo-api-key","checksumKey":"demo-checksum-key"}`):

```
v1:k2:BwcHBwcHBwcHBwcH:-nG-fAwhipB-QPsrdllv5VkkLDRXsSzy86nHwM5okkzm8gGMrFjIVOspdSoryRg6koGxezCN0JSB9Qfr5bNKDgORccUla_0s_I_OkgexH-LqjpyVqFOeOiIIJCGdnpMN7UQU7w
```

It matches the `CHECK` of `gateway_config.secrets_enc` (DOC-17 §1.3), opens with the same AAD, fails with `OperationError` with another AAD, and `newestKeyId({k9, k10})` is `k10` (BD-14…BD-16, run on Bun 1.4.3).

### 6.3 Rotation

Add the new key to the environment (the old stays), deploy, run the re-encrypt job (RB-12), check that no blob names the old key, remove it:

```sql
-- keys still in use (before a key is removed from the environment); an empty result for the old key is the go-ahead
SELECT split_part(secrets_enc, ':', 2) AS key_id, count(*) FROM building.gateway_config GROUP BY 1 ORDER BY 1;
```

The re-encrypt job decrypts each row with its own key, seals with the newest, and writes with a compare-and-set on the old blob (DOC-17 §1.3), so a concurrent edit is never overwritten. It runs for `gateway_config` and for `resident_profile.cccd_enc` (with the PII ring). A **lost** key makes its blobs unreadable: a gateway configuration is entered again (no data lost); a lost PII key makes the CCCD numbers unrecoverable, which is why the sealed offline copy of DR-65 is mandatory. The boot guard (§10.1, check 6) refuses to start when a stored blob names a key that the ring no longer holds.

## 7. Gateway configuration

Screen `W-Gateway` (DOC-67). Audience: Admin. The provider is chosen with the `driver`: `payos` today, `vietqr` possibly (DR-25), `fake` only in a demo building. The fields each real driver needs are DOC-24's; the `building` module keeps them in a driver registry `{ driver: { fields: string[] } }` and validates against it.

### 7.1 Endpoints

| Endpoint | Does |
| --- | --- |
| `GET /staff/gateway` | The active configurations with **masked** secrets, the drivers allowed for this building, `lastCheckAt`, `lastCheckOk`, `ETag` of each |
| `PUT /staff/gateway` | Creates or changes a configuration; carries `stepUp` (§7.2) |
| `POST /staff/gateway/check` | "Check connection" (§7.4); no step-up: it has no side effect on the configuration except `last_check_*` |

```json
{
  "configs": [ {
    "id": "018f0000-0000-7000-8000-0000000000a1", "provider": "payos", "driver": "payos", "status": "active",
    "receivingAccount": { "bankBin": "970436", "bankName": "Vietcombank", "accountNumber": "0011001234567", "accountName": "CONG TY QUAN LY SUNRISE" },
    "secrets": { "clientId": "••••a1b2", "apiKey": "••••9z8y", "checksumKey": "••••4d5e" },
    "lastCheckAt": "2026-10-19T03:10:00Z", "lastCheckOk": true, "version": 3 } ],
  "drivers": { "payos": { "fields": ["clientId", "apiKey", "checksumKey"], "allowed": true },
               "vietqr": { "fields": ["…"], "allowed": true }, "fake": { "fields": [], "allowed": false } }
}
```

A secret is masked as `••••` plus its last 4 characters; one shorter than 8 characters shows `••••` only, so a short secret is not revealed (BD-18). `bankName` is looked up from the BIN (DR-27).

### 7.2 `PUT` and the step-up

```json
{ "provider": "payos", "driver": "payos", "status": "active",
  "receivingAccount": { "bankBin": "970422", "accountNumber": "0011009999999", "accountName": "CONG TY QUAN LY SUNRISE" },
  "secrets": { "apiKey": "new-api-key-value" },
  "stepUp": { "password": "…", "code": "482913" } }
```

- **Addressing** (*noted 2026-10-20, DR-148*): the body names the `provider`, which identifies the single active row; there is no `id`. `If-Match` carries the row's version and is required once the row exists (428 when missing); the first creation answers 201 and a change 200. `POST /staff/gateway/check` writes no audit row (it changes no business field).
- **Partial secrets.** A secret field that is present replaces the stored one; a field that is absent keeps it (the form shows masked values and sends only what the Admin retyped). A **new** configuration, or a change of `driver`, needs every field of the driver.
- **Step-up.** The Admin asks for a code with `POST /staff/step-up {"action": "gateway_config"}` (204; the code is mailed to the Admin, valid 10 minutes, single use). The names of the actions are the stored ones — `gateway_config`, `admin_change`, `staff_email` (DOC-16 §4.4) — and `IdentityApi.verifyStepUp` takes the same names; DOC-09 §7.3 is corrected (DR-126). A request without `stepUp` is 403 `step_up_required`; any failure of the proof is 403 `step_up_failed` (DOC-42).
- **Every change of this resource needs it:** secrets, receiving account, driver, status (enable, disable), including an unchanged `PUT` that only re-saves.

### 7.3 One transaction, in this order

1. `staff('admin')` guard; the body is validated (fields of the driver, `receivingAccount.bankBin` six digits, `accountNumber` 6…20 digits, `accountName` 1…50 upper-case ASCII letters, digits and spaces).
2. `IdentityApi.verifyStepUp(staff, 'gateway_config', proof)`: checks the password, consumes the live code, counts a wrong password toward the lockout (DOC-09 §7.3). It queues the notices to every active Admin of the building (`identity.mail_requested.v1`, kind `step_up_notice`, FR-50.4) in this same transaction, so they are sent only if the change commits.
3. `SELECT … FROM building.gateway_config WHERE id = :id AND version = :expected FOR UPDATE`: the row lock. Zero rows: 409 `version_conflict`.
4. **If the receiving account, the driver or the status changes**, ask `ActiveIntentProbe.hasActive(buildingId, provider)` (below). `true`: 409 `gateway_in_use` and nothing changes (FR-38.3). A change of secrets only does not ask: the checksum key of an intent already created is looked up when its webhook arrives.
5. Merge the secrets (decrypt the stored blob, apply the fields sent, seal with the newest key and the AAD of §6.2), set `last_check_at` and `last_check_ok` to `NULL`, `version + 1`.
6. `fake` is refused for a building that is not a demo building: 422 `validation_failed`, rule `driver_not_allowed` (DR-26). One `active` row per `(building, provider)`: the unique index decides a race; the loser gets 409 `version_conflict`.
7. `AuditApi.record` `building.gateway.update` with `changes` that list the fields changed (`secrets` as `[masked]`, `receivingAccount.accountNumber` masked to the last four digits) and `details.stepUp = true`.

```sql
SELECT id, version FROM building.gateway_config
 WHERE id = :id AND version = :expected FOR UPDATE;
UPDATE building.gateway_config
   SET secrets_enc = :blob, receiving_account = :account, driver = :driver, status = :status,
       last_check_at = NULL, last_check_ok = NULL, version = version + 1, updated_at = now()
 WHERE id = :id AND version = :expected RETURNING version;
```

Run on a row of version 1: the lock query returned it, the update returned version 2 and a second update with version 1 would change nothing (BD-24).

**The race with an intent being created.** An intent reads the gateway configuration in its own transaction. If it read a cached copy, an intent could be created with the old receiving account after the change committed. So intent creation (DOC-23) reads it with `getGatewayConfig(buildingId, provider, { lock: 'share' })`: either it holds the share lock first and step 4 of the change waits for it, then finds the new intent and refuses with `gateway_in_use`; or the change commits first and the intent reads the new row. The webhook path keeps the cached read: it only needs the checksum key (BD-25).

**The probe is a port, so the modules stay acyclic.** `building` cannot import `finance` (`finance` imports `building`, `no-circular`, DOC-12 §6). `building` declares the port in its contracts and `finance` implements it:

```ts
// @mod/building/contracts
interface ActiveIntentProbe { hasActive(buildingId: Uuid, provider: GatewayProvider): Promise<boolean> }   // pending, creating or cancelling intents
// @mod/finance/integrations/building: finance describes itself to building (DOC-12 §4.4), reads only its own tables
export const activeIntentProbe: ActiveIntentProbe = { hasActive: async (b, p) => /* SELECT 1 FROM payment_intent WHERE … LIMIT 1 */ }
```

`apps/api` passes it to `installBuilding`; a missing probe in production is a boot error (a gateway could then change under live intents).

### 7.4 Check connection

`POST /staff/gateway/check {configId}` (Admin; 10 per hour per building) calls the driver's `check()` (DOC-24): an authenticated call with no side effect, plus a self-signed sample webhook verified against the stored checksum key (DR-33). The call to the provider is made **outside any transaction**; then one short transaction stores `last_check_at`, `last_check_ok` and returns `{ ok, checkedAt, steps: [{ name, ok, message }] }`. The `fake` driver answers `ok` with the step list `["fake driver"]`. A failure is 200 with `ok: false` (the check ran); an unreachable provider is 502 `gateway_unavailable`.

## 8. Terms administration

Audience: Admin. `GET /staff/terms` lists every version of both kinds, newest first, with the text and `acceptedCount` (the index `ix_terms_acceptance_building_version`). `POST /staff/terms` publishes the next version:

```json
{ "kind": "terms", "text": { "vi": "## 1. Phạm vi\n…", "en": "## 1. Scope\n…" } }
```

- **Both languages are required** for a real building (the dossier supplies `vi` and `en`, P0-06); the demo building may publish `vi` only. `text` is checked by `platform.is_bilingual` (`vi` non-empty) and by the rules below.
- The version number is `max(version) + 1` of `(building, kind)`; two Admins publishing at once collide on `uq_terms_version_building_kind_version` and the loser gets 409 `version_conflict`. There is no draft and no edit: a correction is a new version (write-once, DR-111). Publishing writes `building.terms.publish` (DOC-35 §4.2); the next request of every resident is refused with `terms_required` until accepted (FR-41.1).
- **The text is Markdown, restricted to this subset** (DR-126): headings `##` and `###` (no `#`), paragraphs, bullet and numbered lists (two levels), `**bold**`, `*italic*`, line breaks, and links `[text](https://…)` with the `https` scheme. HTML, images, tables, code, `http`, `javascript:` and relative links are refused. At most 100 KB per language.
- The rule is one pure function, `parseTermsMarkdown(text): TermsBlock[] | TermsError` in `@rms/shared-types`: the API validates with it, the web CMS previews with it, and the web and native apps render its blocks (no Markdown library, no HTML injection). It returns the position of the first violation; 400 `validation_failed` carries it as `details[0].path = "text.vi:12"`.

## 9. The demo building

### 9.1 What exists

The demo building is a row of `building.building` with `is_demo = true`, in `staging` and in `production` (production needs it for store review, DR-60). Its data are a **versioned seed**, `scripts/seed-demo` (`DEMO_SEED_VERSION = 1`), the same code that fills `local` (`bun run seed:demo`, DOC-14 §14) and that the reset re-runs (§10.2).

| Part | Content |
| --- | --- |
| Building | Code `DEMO-A`; name "Chung cư Demo A" / "Demo A Apartments"; a fictional company; time zone `Asia/Ho_Chi_Minh`; default settings |
| Gateway | One `gateway_config` row: provider `payos`, driver `fake`, an empty secret blob, a sample receiving account (`bankBin 970436`, account `0000000000`) |
| Terms | `terms` v1 and `privacy` v1, `vi` only, titled "DEMO — not a legal text"; published once, kept across resets (terms are write-once) |
| Units | 240 units `A-0101`…`A-1516` (15 floors of 16); 200 occupied, 25 rented, 15 vacant; the owners' names are fictional |
| Staff | `admin`, `manager`, `technician`, `guard`: emails `<role>@demo.rms.invalid` (`.invalid` is reserved, RFC 2606: nothing can be delivered); the password is the secret `DEMO_STAFF_PASSWORD`, required in `production`, `demo-password-1` in `local` and `staging` |
| Residents | 8 accounts with `is_demo = true` (table below) |
| Money | A published batch for the previous month with 240 charges, 120 paid by `cash` or `bank_transfer` with receipts; the current month's charges are not seeded (the demo script imports them from the fixture `fees-current.xlsx`, 236 valid rows and 4 errors, written by the seed script) |
| Other | 6 tickets in different states; 3 notices (one pinned); 5 vehicles (2 pending); a library with 2 folders and 4 pages; inbox entries; QR credentials for the active memberships |

All dates are computed from the building's today when the seed runs, so the demo never looks stale (BD-31).

*As built (P1-21, 2026-10-27, DR-270):* the seed is **data**, not a script: `apps/api/src/demo/plan.ts` (`buildDemoPlan(): DemoPlan`, the type in `@rms/shared-types`) holds the building, the gateway, the two terms, the 240 units, the four staff and the eight accounts with their nine memberships, and each module reads its own part, so no module imports another's ids (DOC-12 §4.4). The ids are `018f0d<kind>-0000-7000-8000-<row>` constants. `bun run seed:demo` (`apps/api/scripts/seed-demo.ts`) creates the building row when the database has none and then runs the reset of §10.2; `db:reset` and `setup` run it. **What exists so far** is the `building`, `identity` and `residency` part: the building row with its settings, the `fake` gateway (its blob seals an empty object, so the row passes the format check of DOC-17 §1.3), the two terms, the units (the last of each floor is vacant, the fourteenth of each floor and a few more are rented, the household units A-1508 and A-0302 included: 200 / 25 / 15), the staff with one Argon2id hash of `DEMO_STAFF_PASSWORD` and the eight accounts flagged `is_demo` with their profiles and memberships (added by the demo Admin). Only these five units have an owner; every other unit has none until a staff member imports one, which is what the demo script does. The money, tickets, notices, vehicles, library, inbox and QR rows of the table join with the modules that own them: each adds its `seedDemo` to the host's list and its figures to the answer of E-56. The company block holds the fields of `CompanyBlock` (a fictional tax code `0000000000`).

| Phone (fictional) | Account | Memberships |
| --- | --- | --- |
| `+12025550101` | Demo Owner | owner of `A-1508` |
| `+12025550102` | Demo Family | family member of `A-1508` (can pay) |
| `+12025550103` | Demo Tenant | tenant of `A-1508` with `can_pay` |
| `+12025550104` | Demo Helper | helper of `A-1508` (the demo locks this one) |
| `+12025550105` | Demo Owner 2 | owner of `A-0302` |
| `+12025550106` | Demo Tenant 2 | tenant of `A-0302` without `can_pay` |
| `+12025550107` | Demo Owner 3 | owner of `A-0505` and `A-0506` (shows `Unit-Pick`) |
| `+12025550108` | Store review | owner of `A-0101` (given to the app stores) |

The phones are numbers of the North American range reserved for fiction (`555-0100` to `555-0199`): they are valid for `libphonenumber-js` (checked, version 1.13.15: `isValid()` is true), they can never belong to a real person, and no SMS is sent to them (§9.2). The app's phone field accepts any international number (DR-36).

### 9.2 What is switched off, and where

| Seam | Behavior in the demo | Enforced by |
| --- | --- | --- |
| OTP | The fixed code `123456` is accepted, only for a `resident_account` with `is_demo = true` | `identity` (DR-37); boot guard check 1 |
| SMS | The sender handler of `identity.sms_requested.v1` reads the recipient's `is_demo` and returns normally with a `warn` line `skipped_demo`; no provider call | `identity` handler; BD-34 |
| Mail | The sender handler of `identity.mail_requested.v1` skips a staff member whose building is a demo building (`BuildingApi.isDemo`) with the `warn` line `skipped_demo` and the counter `mail_sent_total{outcome="skipped_demo"}`; the address is `.invalid` anyway (built in P1-21) | `identity` handler; BD-35 |
| Step-up | Not available to the demo's Admin (the code cannot be mailed); the demo needs no gateway change because the `fake` driver has no secret. "Check connection" works without it | By design (DR-126) |
| Payment | The `fake` driver; links in `finance.fake_gateway_link`; the simulator posts signed webhooks (DOC-24) | `gateway_config` row; boot guard check 2 |
| Push | May reach real test devices (DR-60) | — |
| Scope | Every query is scoped by `building_id`, so a demo Admin sees only the demo building | `BuildingScope` (DOC-14 §5) |

### 9.3 Keeping the demo out of the real numbers

The demo building is in the same database as the real one (ADR-0026). Per-building screens, reports and exports already filter by scope. The system-wide gauges and alerts of business rows (`money_log_open`, `payment_intents_pending_overdue`, `ledger_invariant_violations`, `storage_usage_ratio`) must **exclude buildings with `is_demo`**, so a demo payment replayed five times never pages anyone; DOC-40 writes the queries that way and DOC-39 lists it in the checklist (BD-36). Operational gauges (outbox, jobs, backup) are system-wide. The demo's files count against its own quota.

## 10. The boot guard and the reset

### 10.1 Boot guard

`bootGuard()` runs in `api` and in `worker` after the migrations and before listening, as `rms_app` (read-only queries). A failed check logs `error` `boot_guard_failed` with the check number and the offending ids, and exits with code 78. In `local` and `test` a failure is a warning.

| # | Check | Query (shape) | Environments that refuse |
| --- | --- | --- | --- |
| 1 | A flagged account has a membership in a building that is not a demo building (DR-37, DR-60) | The query of DOC-16 §4.2: `is_demo` account ids → `ResidencyApi.buildingIdsOfAccounts` → `BuildingApi.isDemo` (DR-140) | `production`, `staging` |
| 2 | A gateway configuration with driver `fake` belongs to a building that is not a demo building (DR-26) | `SELECT g.id FROM building.gateway_config g JOIN building.building b ON b.id = g.building_id WHERE g.driver = 'fake' AND NOT b.is_demo` | `production`, `staging` |
| 3 | The deployment has more than one building that is not a demo building (DR-115) | `SELECT count(*) FROM building.building WHERE NOT is_demo` | none: `warn` only |
| 4 | `SMS_DRIVER` is `console` or `allowlist`, or the mail driver is the console, in production | Configuration | `production` (DOC-26, DOC-41) |
| 5 | The probe of §7.3 is not bound | Composition root | `production`, `staging` |
| 6 | A stored `secrets_enc` or `cccd_enc` names a key that the ring no longer holds | `SELECT DISTINCT split_part(secrets_enc, ':', 2) FROM building.gateway_config` compared with the ring (the same for the PII ring) | every environment |

*As built (P1-11, 2026-10-23, DR-256):* `bootGuard` exists in `apps/api/src/bootstrap/boot-guard.ts` and `main.ts` runs it before it listens, with **check 1 only**: `IdentityApi.listDemoAccountIds` → `buildingIdsOfAccounts` (a port with the call of `ResidencyApi`, in batches of 500) → `BuildingApi.isDemo`; `production` and `staging` log `boot_guard_failed` and exit 78, `local` and `test` warn. Since P1-12 the port is bound to `ResidencyApi.buildingIdsOfAccounts` (RM-50 runs it end to end in `apps/api/tests/integration/unit-guard.integration.test.ts`); before that it answered "none", which was exact: no membership existed. BD-30 runs as `runBootGuard` with a fake residency (`apps/api/src/bootstrap/boot-guard.test.ts`, `tests/integration/resident-auth.integration.test.ts`). Checks 2, 3, 5 and 6 join with P1-21; check 4 is a rule of the configuration.

*As built (P1-21, 2026-10-27, DR-270):* checks 1, 2, 3, 5 and 6 are in `runBootGuard` and `reportBootGuard` stops a process by the policy of the check: **check 1, 2 and 5 stop `production` and `staging`, check 6 stops every environment, check 3 never stops one** (the table above says the same). Check 2 is `BuildingApi.fakeGatewaysOutsideDemo` (the query of S-BD-6). Check 3 counts `listBuildings()` rows that are not demo buildings. Check 6 reads the key ids of the stored blobs (`BuildingApi.gatewayKeyIds`, `ResidencyApi.piiKeyIds`: the second part of `v1:<key id>:…`) and names `settings:<id>` or `pii:<id>`; a ring the process does not hold (`PII_ENCRYPTION_KEYS` in a `worker`) is not compared. **Check 5** is a rule about the container: a port bound to its stand-in (`ActiveIntentProbe` of `finance`, `OpenTicketsProbe` of `tickets`) fails the check only once the module that must answer it is in the module catalog, because until then the stand-in is the right answer; the `standIns` list is empty today and the check starts to bite when `finance` is added to `MODULE_CATALOG` without its probe. Check 4 stays a rule of the configuration. BD-28, 29 and 30 run on PostgreSQL 18.6 (`apps/api/tests/integration/demo.integration.test.ts`, `src/bootstrap/boot-guard.test.ts`).

The query of check 2, run on a seed with a `fake` configuration on a non-demo building, returned that row (S-BD-6, BD-28); the query of check 6, run on two rows sealed with `k1` and `k2`, returned both key ids, which the application compares with the ring (S-BD-5, BD-29). Check 1 is DOC-16's query, tested there (IDM).

### 10.2 The reset

`resetDemo` is a contract of every module, with a twin that seeds:

```ts
interface DemoResettable {
  readonly module: ModuleName
  resetDemo(buildingId: Uuid): Promise<Record<string, number>>             // rows deleted per table; asserts the building is a demo building first
  seedDemo(buildingId: Uuid, ctx: { today: LocalDate; plan: DemoPlan; password: string }): Promise<Record<string, number>>
}
```

1. **The assertion is in the module, not only in the caller.** The first statement of every `resetDemo` and `seedDemo` is `await building.assertDemo(buildingId)` (`BuildingApi.assertDemo`, which reads the row and never the cache), which throws `DemoResetRefusedError` (404 `not_found`) unless `building.is_demo` is true (an unknown id, a real building, or a demo flag set on another row all refuse). A CI test calls every module's `resetDemo` on the real building and on an unknown id and expects the refusal (DR-60, BD-37).
2. **Order.** Delete in reverse dependency order, then seed in forward order. Because no foreign key crosses a schema (ADR-0014) the order is a convention that keeps the contract checks true while the transaction runs:

   | Delete (first to last) | `reporting`, `realtime`, `notification`, `notices`, `access`, `vehicles`, `tickets`, `wiki`, `finance`, `residency`, `identity`, `building` |
   | --- | --- |
   | Seed (first to last) | `building`, `identity`, `residency`, `finance`, `wiki`, `tickets`, `vehicles`, `access`, `notices`, `notification` |

   `identity` deletes the staff accounts of the building, their tokens, every refresh family of the building's accounts, and the resident accounts with `is_demo = true`; `building` marks the demo's `file_object` rows `deleted`, writes one `building.file_delete_requested.v1` per file (DR-122) and deletes the demo's terms acceptances. `audit.audit_log`, `terms_version` and `building.job_run` are not touched (DR-60). Ledger tables are deleted by `rms_app`, which holds `DELETE` on them (DOC-19 §4.1); a delete-guard trigger on a ledger table, if DOC-15 adds one, must honor the transaction-local setting `rms.demo_reset = 'on'` that only `DemoReset` sets after the assertion, and must still refuse a row of a building that is not a demo building. *Revised 2026-10-22 (DR-243):* DOC-15 §11 adds the guards; `DemoReset` sets `set_config('rms.demo_reset', <demo building id>, true)` after the assertion, and a guard allows a delete only of a row whose `building_id` equals that value, so the setting cannot open another building's rows.
3. **One transaction.** The whole reset (deletes, seed, outbox commands for the files) is one `uow.run` under `pg_try_advisory_xact_lock(hashtext('job:demo_reset'))`, so a failure leaves yesterday's demo intact and two resets cannot overlap. A handler that finds an entity gone (a command queued before the reset) returns normally (DOC-42 §7).
4. **Cost.** 240 units, 8 residents, about 400 charges and the rest of the seed is some thousands of rows; the budget is 10 s on the staging host (planned, measured by BD-40).
5. **Identifiers.** The seed uses fixed UUIDv7-shaped constants (`apps/api/src/demo/plan.ts`) so a link in the demo script or a store reviewer's note stays valid after a reset. Sessions do not survive: every demo user signs in again after 04:00.

*As built (P1-21, 2026-10-27, DR-270):* `DemoResettable` and `DemoPlan` are in `@rms/shared-types`; `DemoReset.run(buildingId)` is in `building` (`application/demo-reset.ts`) and reads the modules of the host through a function, because `building` is installed before the modules it resets. It asserts the building, refuses a building other than the one of the plan, refuses to run without `DEMO_STAFF_PASSWORD` (before it deletes anything), takes the lock and sets `rms.demo_reset` to the building's id in the transaction (`SqlDemoResetLock`), runs the modules in the two orders above (a module with no place in the lists is a programming error), observes `demo_reset_duration_seconds` and logs `demo.reset` with the counts. `building` resets its own settings, gateway, acceptances and files (each file moves to `deleted` with one `building.file_delete_requested.v1`) and puts the building row back to the seed (one more `version`, no logo); `identity` deletes the staff of the building and the accounts flagged `is_demo`, with their families, tokens and challenges; `residency` deletes the unit history, memberships, profiles, import jobs and units of the building. **One deployment has one demo building**: `identity` deletes every account flagged `is_demo`, because an account has no building; a second demo building would lose its residents. A rejected reset (a stand-in module that fails to seed) rolls the whole transaction back (BD-39); a reset took 81 ms on a laptop for this seed.

### 10.3 The nightly job

`demo_reset` (building module, daily 04:00 local, mode `lock`, grace 2 h, DOC-38 §4): for each building from `BuildingApi.listBuildings()` with `isDemo`, call `DemoReset.run(buildingId)`; it returns `{buildings: n}` in `job_run.details`. A job that fails is retried only at the next slot; the alert is the gauge `job_last_success_timestamp{job="demo_reset"}`. The job writes no audit row (DOC-35 §3.6).

*As built (P1-21):* `demoResetJob` lists the buildings flagged `is_demo`, takes the job lock for each (`ctx.withLock`, the same lock as `DemoReset`) and returns `{buildings: n}`; the grace window is `JOB_DEMO_RESET_GRACE_MINUTES` (120).

### 10.4 The reset through the API

`POST /staff/demo/reset` (Admin). For a building that is not a demo building the answer is **404 `not_found`**, not 403: the endpoint does not reveal that it exists for another building. It runs the same `DemoReset.run` inline, under the same lock, and answers `200 { durationMs, deleted: {…}, created: {…} }`; if the lock is held, 409 `demo_reset_running`. Rate limit: 1 per minute per building (bucket `demo-reset:building:<id>`, 429 `rate_limited`). It writes `building.demo.reset` (DOC-35 §4.2). The demo script (DOC-102) uses it before a presentation. *As built (P1-21):* `ResetDemo` (`building`, E-56) calls `requireRole(staff, RESET_DEMO_ROLES)`, asserts the building (404 before anything else is read, so the limiter bucket of a real building is never created), takes the token of `SqlDemoResetLimiter` (one per minute, a bucket of `platform.rate_bucket`) and runs `DemoReset` and the audit row in one transaction; the answer is `{durationMs, deleted, created}`. The Admin's own session ends with the reset, like every demo session; the next sign-in works because the account is seeded again with the same id.

## 11. Configuration, metrics, logs

| Key | Type · default | Meaning |
| --- | --- | --- |
| `SETTINGS_ENCRYPTION_KEYS` | JSON `{k<n>: base64(32 bytes)}` · required | Gateway secrets and command secrets (§6) |
| `PII_ENCRYPTION_KEYS` | the same · required | CCCD numbers |
| `FEATURE_TICKET_DEADLINES` | boolean · `false` | §3.3 |
| `DEMO_STAFF_PASSWORD` | string ≥ 12 · required in `production` when a demo building exists | Password of the seeded demo staff |
| `SETTINGS_CACHE_SECONDS` | integer · 60 | TTL of §3.1 |

DOC-41 lists the keys; the settings of §5 are building settings, not environment. Metrics owed to DOC-40: `gateway_check_ok{building}` (gauge, 1/0 from `last_check_ok`; warning when 0 for 1 hour), `demo_reset_duration_seconds` (histogram, built in P1-21), `boot_guard_failures_total` (not scrapeable after exit: the log line is the signal). Logs: `settings.updated` (keys changed, no values), `gateway.updated` (fields changed, never values), `demo.reset` (counts). A secret, a blob, a code or a password never appears in a log line (BD-19).

## 12. Errors

| Situation | HTTP · code |
| --- | --- |
| A setting outside its range or enumeration | 422 `validation_failed`, rule `setting_invalid` (FR-38.2) |
| A field of the building out of its rules, an unknown key, a wrong type, an edit of `code`, `timeZone` or `isDemo` | 400 `validation_failed` (DOC-42 §5.2 holds the rule codes) |
| `fake` for a real building | 422 `validation_failed`, rule `driver_not_allowed` |
| Missing `If-Match` | 428 `precondition_required` |
| A stale version, a lost race on the active configuration or on a terms version | 409 `version_conflict` |
| A step-up missing or failed | 403 `step_up_required`, 403 `step_up_failed` |
| Changing the receiving account, driver or status while an intent is active | 409 `gateway_in_use` |
| The provider cannot be reached by "Check connection" | 502 `gateway_unavailable` |
| A Manager, Technician or Guard on any endpoint of this document | 403 `forbidden` |
| The demo reset on a real building | 404 `not_found` |
| The demo reset while another runs | 409 `demo_reset_running` |
| A terms text outside the subset | 400 `validation_failed`, `details[0].path = "text.vi:<line>"` |

## 13. Required tests

Prefix `BD-` (building and demo; unused before this document; DOC-88 indexes it). **(S)** marks a test whose SQL was run on PostgreSQL 18.6 (§13.1) and **(B)** one run on Bun 1.4.3; the others are application tests written in P1-07, P1-11, P1-12, P1-21 and P3-xx and are **not run** yet.

**Run in P1-21 (2026-10-27, PostgreSQL 18.6):** BD-28, BD-29 and BD-30 (`src/bootstrap/boot-guard.test.ts` and `apps/api/tests/integration/demo.integration.test.ts`, which also run the checks on a seeded database), BD-32 (`modules/identity/test/demo.integration.test.ts` and the API test, with the eight phones through the routes), BD-34 and BD-35 (`modules/identity/test/demo.integration.test.ts`), BD-37 for `building`, `identity` and `residency` (each module's `resetDemo` and `seedDemo` on the real building and on an unknown id, in `modules/*/test/demo.integration.test.ts`), BD-38 for the same three (same ids after the reset, sessions revoked, one delete command per file, `audit_log` unchanged), BD-39 (a stand-in module that fails to seed, in `modules/building/test/demo.integration.test.ts`; the real `finance.seedDemo` comes with finance), BD-41 (the lock held by another session), BD-42 and BD-43 (over HTTP and as the job), BD-48 (`modules/identity/src/infrastructure/phone/libphonenumber-phones.test.ts`). **Not run:** BD-31 (no dated row is seeded before `finance`), BD-36 (the business gauges of the modules to come), BD-40 (the staging host; 81 ms on a laptop) and BD-37 to BD-39 for the modules not built.

**Run in P1-07 (2026-10-22, PostgreSQL 18.6, SeaweedFS or a fake store; `modules/building/test` and `packages/core-kernel`):** BD-01, 02, 04…19, 23…27 and 44…46. BD-20 is run up to the verifier (a missing proof is 403 `step_up_required`, a failed one stops the save and changes nothing); the password, the code, the five-attempt rule and the notice to the Admins (BD-20…22) are `identity`'s, P1-10. BD-03 is `finance`'s, BD-28…30, BD-31…43 and BD-48 are P1-11, P1-12 and P1-21, BD-33 is `check:arch`, BD-47 is the configuration test CF. BD-17 and BD-14…16 are in `packages/core-kernel/src/secret-box.test.ts`. The routes of §4, §7.1 and §8 are not mounted yet: the use cases are (`BuildingSettingsService`, `GatewayService`, `TermsService`), tested without HTTP, because the routes need the guards of P1-10 and P1-11 (DR-252). The fields of the VietQR driver in §7.1 (`clientId`, `apiKey`) are provisional until DOC-24.

| ID | Scenario | Expected |
| --- | --- | --- |
| BD-01 | The Admin saves valid values; a Manager tries | The Admin succeeds and `building.settings.update` is audited; the Manager gets 403 (FR-38.1) |
| BD-02 | `defaultDueDays` = −1; `feeNoticeLanguage` = `fr`; `lockout.minutes` = 4; then an unknown key and `defaultDueDays` = "ten" | 422 `setting_invalid` for the first three; 400 `unknown_key` and 400 `type` for the last two; nothing changes (FR-38.2) |
| BD-03 | A batch created on 2026-10-05 with `defaultDueDays` 10 | The proposed due date is 2026-10-15 (FR-38.4) |
| BD-04 | `getSettings` for a building with `{}` saved, then with two keys saved | The defaults; then the two keys over the defaults |
| BD-05 | `PATCH` sets two keys and removes one (§4.3) | `data` holds the two keys; the removed one answers its default; version + 1 (S) |
| BD-06 | `PATCH` with a stale `If-Match`; with none | 409 `version_conflict` with the fresh document; 428 `precondition_required` (S) |
| BD-07 | `PATCH` changes only `hotline` | `building.version` + 1; the settings version unchanged |
| BD-08 | `PATCH` carries `timeZone` | 400; nothing changes |
| BD-09 | Two Admins save the settings at the same version | One succeeds; the other 409 |
| BD-10 | A logo is replaced | The new file is attached, the old goes through `FilesApi.remove` in the same transaction; a rollback keeps the old logo. *Revised 2026-10-28 (DR-296):* the old file stays `attached` (no `remove`, no delete command); a rollback keeps the old logo as the building's |
| BD-11 | `getSettings` after a save in another process | The new value within `SETTINGS_CACHE_SECONDS`; in the saving process at once |
| BD-12 | `storageQuotaBytes` lowered under the usage | Accepted; the next `register` is 413; the hourly job alerts |
| BD-13 | `accountDeletionDays` changed from 30 to 7 | An account approved 8 days ago is executed by the next run (AD-45) |
| BD-14 | `seal` with the vector's ring, IV and AAD | The blob of §6.2 (B) |
| BD-15 | `open` with another AAD; with a blob moved to another row id | Fails (B) |
| BD-16 | `newestKeyId` for `{k9, k10}`; for `{kA}`; for `{}` | `k10`; error; error (B) |
| BD-17 | `open` with a ring that lacks the blob's key | `SecretOpenError` (not run) |
| BD-18 | `GET /staff/gateway` | Every secret `••••` + last 4; a 6-character secret shows `••••` only; no blob in the response |
| BD-19 | A `PUT` with a secret in the body | The secret is in no log line, no audit `changes` (`[masked]`) and no error `details` |
| BD-20 | A `PUT` with no `stepUp`; with a wrong code, an expired code, a reused code, a wrong password, another Admin's code | 403 `step_up_required`, then 403 `step_up_failed` ×5; nothing changes (FR-50.2) |
| BD-21 | Five wrong codes | The challenge is consumed; a sixth attempt with the right code fails (FR-50.3) |
| BD-22 | A successful `PUT` | Every active Admin has the mail command and the inbox entry `staff.step_up_done`; the audit row lists the fields and `details.stepUp = true` (FR-50.4) |
| BD-23 | A `PUT` that sends only `apiKey` | The other two secrets are unchanged after decrypt |
| BD-24 | The lock and version statements of §7.3 | The lock returns the row; the update returns version 2; a second update at version 1 changes 0 rows (S) |
| BD-25 | An intent creation and a receiving-account change started together (race harness) | Either the change gets 409 `gateway_in_use` or the intent holds the new account; never an intent on the old account after the commit |
| BD-26 | Receiving account changed while an intent is `pending` | 409 `gateway_in_use`; secrets-only change in the same state succeeds (FR-38.3) |
| BD-27 | A `fake` configuration on the real building via `PUT` | 422 `driver_not_allowed` |
| BD-28 | Boot guard check 2 on a seed with a `fake` row on a non-demo building | Production boot fails with exit 78 and names the row (S) |
| BD-29 | Boot guard check 6 with `secrets_enc` of `k1` and `k2` and a ring that holds only `k2` | Boot refuses and names `k1` (S) |
| BD-30 | Boot guard check 1 with a flagged account that has a membership in the real building | Production boot fails (FR-15.6) |
| BD-31 | The seed runs on 2026-10-19 and on 2027-03-02 | Every date is relative to that day; the previous-month batch exists in both |
| BD-32 | The fixed code `123456` for a flagged account and for a real one | Accepted for the first, refused for the second (FR-15.6) |
| BD-33 | `check:arch` over the modules | `building` imports no `finance` module; `finance/integrations/building` exists |
| BD-34 | An SMS command for a demo resident | No provider call; a `skipped_demo` log line; the message is done |
| BD-35 | A mail command for the demo's Admin | No provider call; done |
| BD-36 | The system-wide business gauges with a demo payment replayed five times | The gauges do not move; no alert |
| BD-37 | `resetDemo` of every module on the real building, and on an unknown id | `DemoResetRefusedError` for each |
| BD-38 | A reset | Yesterday's demo rows are gone, the seed is back with the same ids, sessions are revoked, the demo's files have one delete command each, `audit_log` is unchanged |
| BD-39 | A reset that fails in `finance.seedDemo` | The whole transaction rolls back; the old demo is intact |
| BD-40 | A reset on the staging host | Under 10 s (planned) |
| BD-41 | Two resets at once (API and job) | One runs; the other gets 409 `demo_reset_running` |
| BD-42 | `POST /staff/demo/reset` by the real building's Admin | 404 `not_found` |
| BD-43 | The nightly job on a deployment with the real and the demo building | Only the demo building is reset |
| BD-44 | Terms: a `##` heading and a list; an HTML tag; an image; a link with the `http` scheme; a `#` heading; 101 KB | The first accepted; each of the rest 400 `terms_text` with the line |
| BD-45 | Publish `terms` v2 at the same time from two Admins | One v2; the other 409 |
| BD-46 | Publish with `vi` only for the real building | 400; for the demo building, accepted |
| BD-47 | An unknown `FEATURE_FOO=1` | The boot fails |
| BD-48 | `libphonenumber-js` on the eight demo phones `+12025550101`…`0108` | All valid, E.164 unchanged (B, B-BD-2) |

### 13.1 Statements and helpers run

| ID | What | Result |
| --- | --- | --- |
| S-BD-1 | Settings merge, set two keys and remove one, at version 7 | `{"defaultDueDays": 15, "feeNoticeLanguage": "both"}`, version 8 |
| S-BD-2 | The same statement at version 7 again | 0 rows |
| S-BD-3 | Composite ETag from the two versions | `3.8` |
| S-BD-4 | `SELECT … FOR UPDATE` and the guarded update of a gateway row | Row returned; version 2 |
| S-BD-5 | Keys in use over two rows (`k1`, `k2`) | `k1` 1, `k2` 1 |
| S-BD-6 | `fake` outside a demo building | The offending row id |
| B-BD-1 | `seal` with the test vector; `open`; wrong AAD; `newestKeyId` | The blob of §6.2; opens; `OperationError`; `k10` (Bun 1.4.3) |
| B-BD-2 | `parsePhoneNumberFromString(...).isValid()` for the eight demo phones | `true` for each (libphonenumber-js 1.13.15) |

## 14. Decisions made while writing

| ID | Decision | Where used |
| --- | --- | --- |
| DR-126 | `GET/PATCH /staff/settings` is one document with a composite ETag; `code`, `timeZone` and `isDemo` are not editable; `null` removes a saved key; step-up action names are the stored ones (DOC-09 corrected); `SecretBox` in `@core/kernel` with the newest key the highest `k<n>` and an AAD bound to the row; the active-intent check is a port that `finance` implements, closed against the intent race by a row lock; feature flags are environment variables; terms text is a Markdown subset parsed by one pure function; the demo's accounts use fictional numbers, its staff password is a secret, its reset is one transaction guarded in every module and runnable through `POST /staff/demo/reset`; the boot guard has six checks; `BuildingApi` gains `getBuilding`, `listBuildings`, `isDemo`, `missingTerms` and the `lock` option | §3…§10 |
| DR-270 | The demo seed is a `DemoPlan` built in `apps/api/src/demo/plan.ts` and read by each module; `building` runs the reset (`DemoReset`) over a function that lists the modules; `BuildingApi.assertDemo` reads the row; boot guard checks 2, 3, 5 and 6 with a policy per check; check 5 bites once the module that answers the port is installed; mail to a demo building's staff is skipped; one deployment has one demo building | §9.1, §10 |

## 15. Not in this document

| Topic | Lives in |
| --- | --- |
| Tables and the audit row | DOC-17 §1, DOC-35 |
| The fields of each gateway driver; the fake driver; the simulator | DOC-24 |
| The step-up code, password and lockout mechanics | DOC-26 |
| Screens `W-Building`, `W-Gateway`, `W-Step-Up` | DOC-67 |
| The upload flow of the logo | DOC-37 |
| The job runtime of `demo_reset` | DOC-38 |
| Metrics and alerts | DOC-40 |
| Keys of the environment | DOC-41 |
| Rotating keys step by step | RB-12 |
| The demo script and the store-review notes | DOC-102 |

## 16. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| §3 contracts | DR-42, DR-87, DR-111, DR-126 | NFR-08; BD-33 |
| §4, §5 building and settings | DR-60, DR-111 | FR-38.1, FR-38.2, FR-38.4; BD-01…13 |
| §6 encryption | DR-33, DR-65, DR-117, DR-126 | FR-38.3; BD-14…17 |
| §7 gateway | DR-33, DR-39, DR-26, DR-126 | FR-38.3, FR-50; BD-18…27 |
| §8 terms | DR-59, DR-111, DR-126 | FR-41; BD-44…46 |
| §9 demo | DR-60, DR-37, DR-36, DR-26, ADR-0026 | FR-15.6; BD-31…36, BD-48 |
| §10 guard and reset | DR-60, DR-26, DR-126 | FR-15.6; BD-28…30, BD-37…43 |

## Open questions

None. The names of the fields of the payOS and VietQR drivers (§7.1) are DOC-24's and wait for the gateway sandbox (DR-25); they change the driver registry, not this document.
