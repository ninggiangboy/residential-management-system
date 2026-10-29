# Web: residents

> Status: **Approved** (Owner, 2026-10-21, for the P1 screens; W-Vehicles is owed to P5) · Updated: 2026-10-29 (DR-309: the floor and type selects list `summary.floors` and `summary.bedrooms`) · 2026-10-21 (DR-226: recent-imports table on `W-Import`, E-169, UIWR-41, UIWR-42) · DOC-65
> Depends on: original SDD §18, [DR](../../00-decision-register.md) (DR-21, 22, 39, 40, 48, 58, 72, 74, 84, 128, 137, 138, 139, 141, 149, 226), [DOC-56](README.md) (convention, notes N10, N12), [DOC-53](../ux-principles-and-ia.md) §2 and §4, [DOC-54](../design-system.md) §6.4, [DOC-55](../client-architecture.md) §6–8 and §12, [DOC-27](../../06-design/residency-and-memberships.md) §3–§9, [DOC-18](../../05-data/data-quality-rules.md) §1, [DOC-51](../../07-api/api-endpoints.md) E-36, E-37, E-57…E-74, E-169, [DOC-42](../../06-design/error-handling.md) §5, [DOC-04](../../01-product/use-cases.md) UC-13, UC-27, [DOC-03](../../01-product/requirements.md) FR-18
> Main readers: P1-16 (web CMS shell: sign in, create staff, import units), P1-13, P1-14, DOC-68 (copy), DOC-88 (prefix `UIWR-`)

This document specifies the five web screens that set up the people of the building: the unit list, the unit detail, the resident list, the form that gives a person to a unit, and the Excel import of units and owners. The phase-1 screens are all five (`W-Units`, `W-Unit-Detail`, `W-Residents`, `W-Resident-Add`, `W-Import`); `W-Vehicles` (P5) and the money blocks of the unit detail (P2, P3) are only listed in "Specified before P5 and P3". The canvas draws the five screens but not their dialogs; the dialogs are specified here with small wireframes. Tokens and components are DOC-54, the endpoints are DOC-51, and the strings of the error codes are DOC-68.

Test prefix: `UIWR-` (DOC-56 §6.3; unused before this document; DOC-88 §15 indexes it).

## Screens in this file

| Screen | Canvas title | Purpose | Roles | Phase | Prototype | Section |
| --- | --- | --- | --- | --- | --- | --- |
| `W-Units` | BQL: Danh sách căn hộ | Unit list, filters, add a unit | Admin, Manager | P1 | designed (dialog `Thêm căn` to design) | [W-Units](#w-units) |
| `W-Unit-Detail` | BQL: Chi tiết căn hộ | Members, history, edit, transfer, phone change, lock, remove | Admin, Manager | P1 (members, history) | designed (dialogs, history tab to design) | [W-Unit-Detail](#w-unit-detail) |
| `W-Residents` | BQL: Cư dân | Resident accounts, filters, profile, deletion approval | Admin, Manager | P1 | designed (profile dialog to design) | [W-Residents](#w-residents) |
| `W-Resident-Add` | BQL: Gán chủ hộ | Create a person for a unit or link an existing account | Admin, Manager | P1 | designed | [W-Resident-Add](#w-resident-add) |
| `W-Import` | BQL: Nhập căn hộ từ Excel | Upload, validate, preview, save valid rows | Admin, Manager | P1 | designed (steps 1 and 3 to design) | [W-Import](#w-import) |

## Rules shared by the five screens

| Topic | Rule |
| --- | --- |
| Who | Admin and Manager have the same rights here (DOC-27 §3.3, PS-1, PS-2). A Technician or a Guard on the web lands on `/wrong-app` (DR-174). Every request is scoped to the building of the token; another building's id is a 404 (DOC-51 §10) |
| Step-up | None of the actions here needs it. The step-up actions are `admin_change`, `staff_email` and `gateway_config` only (DOC-26 §4.5). A lock, a transfer or a phone change is protected by the dialog sentence of UX-14, the reason where the API wants one, and the audit row |
| Personal data | A list shows the full login phone and the ID number masked (`•••• 2345`), never a date of birth, never an email in the import preview. The full ID number and the date of birth appear in one place only: the profile dialog of `W-Residents` (E-65, which writes `pii.read`). No other screen of this file calls E-65 (UX-18, DOC-35 §6) |
| Concurrency | The unit loaded by E-59 keeps its `ETag` (the `version`) and sends it as `If-Match` on E-60 and E-61. On 409 `version_conflict` the page refetches, keeps what the user typed, shows the message and waits (UX-02). No write is replayed by the client |
| Idempotency | Creates (E-58, E-64, E-72) carry one `Idempotency-Key` per intent, reused on a retry and renewed only when the form changes (DOC-55 §4) |
| Query keys | `staffKey('units', filters)`, `staffKey('units', 'detail', unitId)`, `staffKey('units', 'detail', unitId, 'history')`, `staffKey('residents', filters)`, `staffKey('residents', 'detail', accountId)`, `staffKey('imports', importId)`. A write invalidates `['staff','units']` and `['staff','residents']`; the profile dialog's query is never cached (`gcTime: 0`, E-65 is `no-store`) |
| Real-time | None. The residency module emits no web event (DR-75). Lists refetch on window focus and after the page's own write (`staleTime` 30 s) |
| Phone display | The API sends `+84901234567`. The web shows `0901 234 567` (national format, groups 4-3-3) and sends E.164 or the national form the user typed; the API parses it (DOC-51 E-61) |
| Language | Every string is a catalog key `web.<screen>.<element>` (DOC-56 §6.4); member-type labels are `common.member-type.<type>`, status labels `status.<entity>.<value>` and error messages `error.<code>`, owned by DOC-68 |

Tags for the statuses are fixed by DOC-54 §6.4: unit `occupied` success "Đang ở", `rented` info "Cho thuê", `vacant` neutral "Trống"; membership `active` success "Đang dùng", `locked` danger "Đã khóa"; resident account never signed in neutral "Chưa đăng nhập", `deletion_requested` warning "Yêu cầu xóa tài khoản".

---

## W-Units

> Status: Review · Prototype: designed (dialog `Thêm căn` to design) · Phase: P1 · DOC-65

### 1. Persona, use cases, permissions

PS-2 Manager (PS-1 Admin the same); UC-13 (set up and look up units), FR-18; capability: staff role `admin` or `manager`. Residents and the Guard do not see this screen (the Guard looks up through E-70, P5).

### 2. URL and search params

`/units`. Search parameters (DOC-53 §4, with one addition, DR-212): `q` string (unit-code prefix, at least 2 characters), `occupancy` `occupied` | `rented` | `vacant`, `floor` integer, `bedrooms` integer 0…20, `cursor`, `limit` (default 50). A changed filter drops `cursor`. `dialog=add` opens the add dialog.

### 3. Prototype

Artboard `W-Units` (canvas title "BQL: Danh sách căn hộ", 1440 × 1060). Regions, top to bottom: web shell (sidebar group "Cư dân", entry "Căn hộ" active; top bar with breadcrumb "Cư dân / Căn hộ", language switch, bell); page header (h1 "Căn hộ", summary line, buttons "Nhập từ Excel", "Xuất Excel", "Thêm căn"); filter row (`SearchField`, `SelectField` × 3: Tầng, Loại, Trạng thái); table card with a 960 px minimum width (columns Mã căn `Plate`, Tầng, Loại, Diện tích, Trạng thái `Tag`, Chủ hộ with phone, Thành viên, Phương tiện, caret) and a footer with the range and two icon buttons.

Do not copy:

- The sample summary "240 căn, 198 đang ở, 31 cho thuê, 11 trống" and the sample rows: the numbers come from E-57 (`summary`).
- The "Xuất Excel" button: no endpoint exports units before P6 (E-167 is the export centre, DOC-33). It is hidden until a units export exists (DR-196).
- The column "Phương tiện": the vehicles module ships in P5. The column appears with `W-Vehicles` (N12-style rule, DR-196).
- The search placeholder "Tìm mã căn, chủ hộ, SĐT": E-57 searches the unit code only. The owner is found on `W-Residents` (DR-212).
- The footer "1–10 trên 240 căn": the list is a cursor list without a total of the filtered rows (DR-212).
- Owner phones as drawn (`0986 210 334`) are a display format of the E.164 value ("Rules shared" above).

### 4. Regions and components

| Region | Components (DOC-54) | Shown state |
| --- | --- | --- |
| Header | `Button` outline "Nhập từ Excel" (links to `/import`), `Button` primary with `plus` "Thêm căn" | always |
| Filters | `SearchField`, `SelectField` (the floors are E-57 `summary.floors`, the building's distinct floors whatever the filters, plus the floor of the URL if no unit has it; DR-309), `SelectField` (Loại = bedrooms, the options are E-57 `summary.bedrooms` the same way; DR-309), `SelectField` (Trạng thái) | the active filters |
| Table | `Plate` (code), `Tag` (status), `Avatar`-less text for the owner, caret icon | rows; the row is a link to `/units/$unitId` |
| Owner cell | name and phone; for a unit without an owner "Chưa có chủ hộ" (muted) and a ghost link "Gán chủ hộ bằng SĐT" to `/residents/new?unitId=` | per row |
| Footer | `IconButton` × 2 (previous, next) and the text "Trang {page}" | hidden when `q` is set (no cursor) |
| Add dialog | `Dialog`, `TextField`, `SelectField`, `Button` | `dialog=add` |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Page of units, summary | E-57 `GET /staff/units` | `['staff','units',filters]` | `limit` 50; `q` makes a search capped at 20 with no cursor; the header line reads `summary`, which ignores the filters (DR-212); `useInfiniteQuery` keeps the cursors visited so "Trang trước" works (the cursor is opaque and never built by the client, DOC-55 §4) |

Refetch: on focus after 30 s, after E-58, E-60, E-61, E-72 commit and E-69 (counts of members). Real-time: none.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Type in the search field (after 300 ms, at least 2 characters) | E-57 with `q` | list replaced by the search result | 400 `validation_failed` → inline error under the field; with 1 character the hint "Nhập ít nhất 2 ký tự." shows and no request is sent |
| Change a filter | E-57 | list reloaded, URL updated, `cursor` dropped | `error.invalid_cursor` (400) → drop `cursor` and reload |
| Next / previous page | E-57 with the stored cursor | page replaced | as above |
| Open a row | none | navigate to `/units/$unitId` | |
| "Nhập từ Excel" | none | navigate to `/import` | |
| "Thêm căn" → submit | E-58 `POST /staff/units` (`Idempotency-Key`) | dialog closes, toast "Đã thêm căn {code}", the new unit is opened | 409 `unit_code_in_use` → error on the code field; 400 `validation_failed` → field errors from `details[{path,code,message}]`; 422 `idempotency_key_reuse` → reload the form |

Dialog "Thêm căn hộ" (not drawn; the form of E-58):

```
+----------------------------------------+
| Thêm căn hộ                         [x]|
| Mã căn *              Tình trạng       |
| [ VD: A-1509     ]   [ Trống        v] |
| Tầng      Số phòng ngủ   Diện tích     |
| [ VD: 15 ] [ VD: 3 ]   [ VD: 82,5  m²] |
| Ghi chú                                |
| [ Thông tin thêm về căn hộ           ] |
| [                                    ] |
|----------------------------------------|
|                 [ Hủy ] [ Thêm căn ]   |
+----------------------------------------+
```

The dialog opens with the caret in "Mã căn"; the placeholders are examples, never the only hint (DOC-54 §17.9). The edit dialog of `W-Unit-Detail` has the same fields and layout.

### 7. States

Loading: 8 skeleton rows after 150 ms. Empty with no filter: title and body below, buttons "Nhập từ Excel" and "Thêm căn". Empty with a filter: "Không có căn nào khớp bộ lọc" and "Xóa bộ lọc". Error: the generic error state of DOC-68 with the request id and a retry. Stale: the generic banner. Forbidden: `/wrong-app` or Forbidden (DOC-53 §4). Offline: not applicable (web).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.units.title` | Căn hộ | Units |
| `web.units.subtitle` | {total} căn, {occupied} đang ở, {rented} cho thuê, {vacant} trống | {total} units, {occupied} occupied, {rented} rented, {vacant} vacant |
| `web.units.cta.import` | Nhập từ Excel | Import from Excel |
| `web.units.cta` | Thêm căn | Add unit |
| `web.units.field.search.label` | Tìm căn hộ | Search units |
| `web.units.field.search.placeholder` | Tìm theo mã căn | Search by unit code |
| `web.units.field.search.hint` | Nhập ít nhất 2 ký tự. | Type at least 2 characters. |
| `web.units.field.floor.label` | Tầng | Floor |
| `web.units.field.floor.all` | Tất cả tầng | All floors |
| `web.units.field.bedrooms.label` | Loại | Type |
| `web.units.field.bedrooms.all` | Tất cả loại | All types |
| `web.units.field.bedrooms.option` | {count}PN | {count} BR |
| `web.units.field.occupancy.label` | Trạng thái | Status |
| `web.units.field.occupancy.all` | Tất cả | All |
| `web.units.col.code` | Mã căn | Unit |
| `web.units.col.floor` | Tầng | Floor |
| `web.units.col.type` | Loại | Type |
| `web.units.col.area` | Diện tích | Area |
| `web.units.col.status` | Trạng thái | Status |
| `web.units.col.owner` | Chủ hộ | Owner |
| `web.units.col.members` | Thành viên | Members |
| `web.units.owner.none` | Chưa có chủ hộ | No owner yet |
| `web.units.action.assign-owner` | Gán chủ hộ bằng SĐT | Assign an owner by phone |
| `web.units.pager.page` | Trang {page} | Page {page} |
| `web.units.pager.previous` | Trang trước | Previous page |
| `web.units.pager.next` | Trang sau | Next page |
| `web.units.empty.title` | Chưa có căn hộ nào | No units yet |
| `web.units.empty.body` | Nhập danh sách căn hộ từ file Excel hoặc thêm từng căn. | Import the unit list from Excel or add units one by one. |
| `web.units.empty-filter.title` | Không có căn nào khớp bộ lọc | No unit matches the filters |
| `web.units.empty-filter.body` | Bỏ bớt bộ lọc hoặc tìm theo mã căn khác. | Remove a filter or search for another unit code. |
| `web.units.action.clear-filters` | Xóa bộ lọc | Clear filters |
| `web.units.dialog.add.title` | Thêm căn hộ | Add a unit |
| `web.units.dialog.add.field.code.label` / `.placeholder` | Mã căn / VD: A-1509 | Unit code / e.g. A-1509 |
| `web.units.dialog.add.field.floor.label` / `.placeholder` | Tầng / VD: 15 | Floor / e.g. 15 |
| `web.units.dialog.add.field.bedrooms.label` / `.placeholder` | Số phòng ngủ / VD: 3 | Bedrooms / e.g. 3 |
| `web.units.dialog.add.field.area.label` / `.placeholder` / `.suffix` | Diện tích / VD: 82,5 / m² | Area / e.g. 82.5 / m² |
| `web.units.dialog.add.field.occupancy.label` | Tình trạng | Occupancy |
| `web.units.dialog.add.field.note.label` / `.placeholder` | Ghi chú / Thông tin thêm về căn hộ | Note / Anything else about this unit |
| `web.units.dialog.add.confirm` | Thêm căn | Add unit |
| `web.units.toast.created` | Đã thêm căn {code} | Unit {code} added |

Errors use `error.unit_code_in_use`, `error.validation_failed`, `error.invalid_cursor`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWR-01 | **Given** the sample building (240 units) **When** a Manager opens `/units` **Then** E-57 is called with `limit=50`, 50 rows show with `Plate`, status tag and owner, and the header reads the counts of `summary` | web-e2e |
| UIWR-02 | **Given** `/units?occupancy=vacant&floor=23` **When** the page loads **Then** only vacant units of floor 23 show, the two selects show the values, and changing the floor drops `cursor` from the URL | web-e2e |
| UIWR-03 | **Given** the search field **When** the Manager types `a-15` **Then** one request with `q=a-15` is sent after the pause, at most 20 rows show, the pager is hidden; typing one character sends no request and shows the hint | web-e2e |
| UIWR-04 | **Given** a vacant unit without an owner **When** its row shows **Then** the owner cell says "Chưa có chủ hộ" and the link opens `/residents/new?unitId=<id>` | web-e2e |
| UIWR-05 | **Given** the add dialog **When** the code `a-1509` is submitted **Then** E-58 is called with an `Idempotency-Key`, the toast appears and `/units/<new id>` opens; submitting the same code again shows the `unit_code_in_use` error on the field | web-e2e |
| UIWR-06 | **Given** a Guard token **When** `/units` is opened **Then** the page is `/wrong-app` and E-57 is never called | web-e2e |

### 10. E2E cases

File `apps/cms-web/e2e/units.spec.ts`: UIWR-01…UIWR-06 (list, filters in the URL, search, add). Part of the P1-16 run "sign in, create staff, import units".

### 11. Open questions

None.

---

## W-Unit-Detail

> Status: Review · Prototype: designed (dialogs and the history tab to design) · Phase: P1 (members, history); P2 debt; P3 money; P4 requests; P5 vehicles · DOC-65

### 1. Persona, use cases, permissions

PS-2 Manager (PS-1 Admin the same); UC-13 (flows "transfer ownership" and "change a login phone", alternatives 3c and 3d), UC-15 4c (lock and remove), FR-17.4, FR-18.3, FR-18.4, FR-18.6. Roles `admin`, `manager`. A lock by the Manager can be undone only by the Manager (FR-17.4); the page always offers "Mở khóa" to the Manager.

### 2. URL and search params

`/units/$unitId`. Search: `tab` `members` (default) | `history` in P1 (then `debt`, `vehicles`, `money`, `tickets`, see "Specified before P5 and P3" and DOC-53 §4); `dialog` `edit` | `transfer` | `phone` | `member`; with `phone` and `member` the parameter `membershipId` names the row. A dialog reopens after a reload (DOC-53 §4 rule 4).

### 3. Prototype

Artboard `W-Unit-Detail` (canvas title "BQL: Chi tiết căn hộ", 1440 × 900). Regions: shell with breadcrumb "Cư dân / Căn hộ / A-1508"; header row (`Plate` large with the code, h1 "Tầng 15, 3 phòng ngủ, 85 m²", status `Tag`, subtitle "Chủ hộ Trần Minh Anh, 0912 345 678", button "Sửa thông tin căn"); `Tabs` (Thành viên 3, Phương tiện 2, Phí và công nợ, Phiếu hỗ trợ); left column: members table (Thành viên with `Avatar` and role, SĐT đăng nhập, Quyền, Trạng thái `Tag`, Thao tác with ghost buttons; a tenant's Quyền cell holds the labelled switch "Được phép thanh toán") and an info line; right column: card "Công nợ hiện tại" (amount, two batches with `Plate` codes) and card "Phương tiện" (two plates with status tags).

Do not copy:

- The cards "Công nợ hiện tại" and "Phương tiện" and the tabs "Phương tiện", "Phí và công nợ", "Phiếu hỗ trợ" in P1: they belong to P2, P5 and P4 and stay hidden until their phase ships (DR-196). From P3 the money log joins the debt block as `UnitMoneyPanel` (N12).
- The tab counts as drawn: only the Thành viên count is shown in P1.
- Batch codes as drawn; the real codes are `PH-YYMM-NN` (DOC-14).
- The drawn actions are incomplete: the owner row offers "Đổi SĐT" and "Khóa" but not "Mở khóa", the change of member type or the pay permission, and the page has no "Chuyển chủ hộ" and no history. They are added below.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | `Plate` lg, `Tag` (unit status), `Button` outline "Sửa thông tin căn", `Button` outline "Chuyển chủ hộ" (hidden when the unit has no owner; then `Button` primary "Gán chủ hộ" to `/residents/new?unitId=`) | always |
| Tabs | `Tabs` with `members` and `history` | P1 |
| Members table | `Avatar`, text, `Tag` (membership status), `Button` ghost (row actions), `IconButton` `dots-three` for the overflow menu | one row per non-removed membership, owner first |
| Row actions | owner: "Đổi SĐT", "Khóa" / "Mở khóa"; others: "Đổi SĐT", "Khóa" / "Mở khóa", "Xóa"; overflow menu on a family member or a tenant: "Đổi thành Người thuê" / "Đổi thành Thành viên gia đình" | per row |
| Permission cell | text of the role; on a tenant also a labelled switch "Được phép thanh toán" under the text (a permission, not a row action) | per row |
| History list | `ListItem`-style rows: kind, actor, details, time | tab `history` |
| Dialogs | `Dialog` (edit unit, transfer, change phone, confirm lock, confirm unlock, confirm remove) | by `dialog` |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Unit, owner, members, debt | E-59 `GET /staff/units/{id}` | `['staff','units','detail',unitId]` | keeps the `ETag` for E-60 and E-61; the `debt` object is ignored in P1 (it is zeros until `finance` exists) and read from P2; `phone` is shown in full to Admin and Manager (the Guard's mask is a P5 screen, DR-48) |
| History | E-62 `GET /staff/units/{id}/history` | `[…,'history']` | `useInfiniteQuery`, 50 per page, "Xem thêm" loads the next cursor; no phone in the answer |
| Phone lookup in the transfer dialog | E-63 `GET /staff/residents?q=<digits>` | not cached | same rule as `W-Resident-Add` (its Data section); shows name and masked ID number only |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Sửa thông tin căn" → save | E-60 `PATCH /staff/units/{id}` with `If-Match` | dialog closes, the page refetches, toast "Đã lưu thông tin căn" | 409 `version_conflict` → refetch with `details.current`, keep the typed values, show the message; 409 `unit_code_in_use` → field error; 428 never (the client always sends `If-Match`); 400 → field errors |
| "Chuyển chủ hộ" → confirm | E-61 `POST /staff/units/{id}/owner` with `If-Match` | dialog closes, toast "Đã chuyển chủ hộ, đã xóa {removedMembers} người khỏi căn", page refetches, history tab gets a row | 409 `version_conflict` (another transfer or edit won) → refetch, keep the form; 409 `member_exists` → "Số này đang là chủ hộ của căn."; 400 `phone_invalid`; 422 `reason_too_short` (the client checks the 5 characters first) |
| "Đổi SĐT" → save | E-67 `PATCH /staff/residents/{accountId}/phone` | dialog closes, toast, refetch (the new phone shows) | 409 `phone_in_use` → "This number already belongs to another account." under the field and nothing changes; 400 `phone_invalid`; 404 `not_found` |
| "Khóa" → confirm | E-69 `PATCH /staff/memberships/{id}` `{status:"locked"}` | row becomes "Đã khóa" | 409 `invalid_transition` (already locked by the Manager) → refetch and show the message |
| "Mở khóa" → confirm | E-69 `{status:"active"}` | row becomes "Đang dùng" | 409 `invalid_transition` → refetch |
| "Xóa" → confirm | E-69 `{status:"removed"}` | row disappears; history gets `member_removed` | 409 `owner_must_transfer` (the owner's row has no "Xóa"; shown if raced) → message with a link to the transfer dialog |
| "Đổi thành …" | E-69 `{memberType}` | row role changes | 409 `invalid_transition` → refetch |
| Switch "Được phép thanh toán" | E-69 `{canPay}` (tenant only) | the thumb moves to the value being saved at once, then the switch is disabled while the call runs (no spinner); the cache is not updated before the answer, and the thumb returns if the call fails | 422 `can_pay_tenant_only` (not reachable from the UI); 409 → refetch |
| Open the member's name | none | navigate to `/residents?dialog=profile&accountId=…` (the profile dialog of `W-Residents`) | |

Every successful write above refetches E-59 and, for E-61, E-60 and E-69 removals, E-62. A member's own sessions end by `credential_version` (the person's next request is 403 `membership_inactive`, DOC-27 §6); this page does not show sessions.

Dialogs (not drawn):

```
Chuyển chủ hộ · A-1508                       Đổi SĐT đăng nhập · Trần Minh Khoa
+---------------------------------------+    +--------------------------------------+
| SĐT chủ hộ mới *   [ 0912 345 678   ] |    | SĐT hiện tại   0903 111 222          |
| (banner when the phone has an account:|    | SĐT mới *      [ 0987 654 321      ]   |
|  "SĐT này đã có tài khoản: Trần Thị   |    | Mọi phiên đăng nhập của người này sẽ |
|   Bình" - the name is not changed)    |    | bị đăng xuất. Tài khoản và các căn   |
| Họ tên *           [ Trần Thị Bình  ] |    | giữ nguyên (áp dụng cho mọi căn).    |
| [ ] Giữ lại các thành viên khác (3)   |    |            [ Hủy ] [ Đổi SĐT ]       |
| Lý do * (ít nhất 5 ký tự)             |    +--------------------------------------+
| [                                   ] |
| Chủ hộ hiện tại Nguyễn Văn An sẽ bị   |    Khóa / Xóa · confirm (one sentence + button
| xóa khỏi căn. Phí, biên lai và yêu    |    named after the action, never "OK")
| cầu vẫn thuộc về căn.                 |
|            [ Hủy ] [ Chuyển chủ hộ ]  |    Sửa thông tin căn: the fields of E-60 (code,
+---------------------------------------+    floor, bedrooms, area, occupancy, note)
```

The "Giữ lại các thành viên khác" box is unticked by default (members are removed, DR-40) and shows the member count; ticked, only the old owner is removed. The reason box is mandatory (E-61 `reason`). When the phone matches an existing account the name field is filled from E-63 and disabled (an existing account keeps its name, DQ-44), and the request still sends `fullName`.

History tab (not drawn): a list newest first; each row: kind label, "bởi {actor}" (staff, resident or "Hệ thống"), a one-line detail (`owner_changed`: "từ {from} sang {to}, đã xóa {removedMembers} thành viên"; `member_added`/`member_removed`: name or phone is **not** shown, only the member type), and the time (`dd/MM/yyyy HH:mm` building time).

### 7. States

Loading: header and table skeleton. Not found: E-59 404 → `NotFound` with a link to `/units`. A vacant unit without an owner: the subtitle says "Chưa có chủ hộ", the members table can still list members, the button "Gán chủ hộ" replaces "Chuyển chủ hộ". Empty members: "Căn này chưa có thành viên." History empty: "Chưa có thay đổi nào." Locked row: the `Tag` carries the text and a tooltip "Khóa bởi BQL" or "Khóa bởi chủ hộ" from `lockedBy`. Stale/error/forbidden: DOC-68 patterns. Offline: not applicable.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.unit-detail.title` | Tầng {floor}, {bedrooms} phòng ngủ, {area} m² | Floor {floor}, {bedrooms} bedrooms, {area} m² |
| `web.unit-detail.title.fallback` | Căn hộ {code} | Unit {code} |
| `web.unit-detail.subtitle.owner` | Chủ hộ {name}, {phone} | Owner {name}, {phone} |
| `web.unit-detail.subtitle.no-owner` | Chưa có chủ hộ | No owner yet |
| `web.unit-detail.cta.edit` | Sửa thông tin căn | Edit unit |
| `web.unit-detail.cta.transfer` | Chuyển chủ hộ | Transfer ownership |
| `web.unit-detail.cta.assign` | Gán chủ hộ | Assign an owner |
| `web.unit-detail.tab.members` | Thành viên | Members |
| `web.unit-detail.tab.history` | Lịch sử | History |
| `web.unit-detail.col.member` | Thành viên | Member |
| `web.unit-detail.col.phone` | SĐT đăng nhập | Login phone |
| `web.unit-detail.col.permission` | Quyền | Permissions |
| `web.unit-detail.col.status` | Trạng thái | Status |
| `web.unit-detail.col.actions` | Thao tác | Actions |
| `web.unit-detail.permission.owner` | Toàn quyền, quản lý thành viên | Full access, manages members |
| `web.unit-detail.permission.family` | Như chủ hộ, trừ quản lý thành viên | Same as the owner, except managing members |
| `web.unit-detail.permission.tenant` | Như chủ hộ, trừ quản lý thành viên | Same as the owner, except managing members |
| `web.unit-detail.permission.can-pay` | Được phép thanh toán | May pay |
| `web.unit-detail.permission.helper` | Bản tin chung và mã QR | General notices and QR code |
| `web.unit-detail.action.change-phone` | Đổi SĐT | Change phone |
| `web.unit-detail.action.lock` | Khóa | Lock |
| `web.unit-detail.action.unlock` | Mở khóa | Unlock |
| `web.unit-detail.action.remove` | Xóa | Remove |
| `web.unit-detail.action.retype-tenant` | Đổi thành Người thuê | Change to Tenant |
| `web.unit-detail.action.retype-family` | Đổi thành Thành viên gia đình | Change to Family member |
| `web.unit-detail.locked-by.manager` | Khóa bởi BQL | Locked by the office |
| `web.unit-detail.locked-by.owner` | Khóa bởi chủ hộ | Locked by the owner |
| `web.unit-detail.banner.members` | Thành viên do chủ hộ tạo trên App cư dân; BQL xem và khóa, xóa khi cần. | Members are added by the owner in the resident app; the office can view, lock and remove them. |
| `web.unit-detail.empty.title` | Căn này chưa có thành viên | This unit has no members yet |
| `web.unit-detail.history.empty` | Chưa có thay đổi nào | No changes yet |
| `web.unit-detail.history.kind.owner_changed` | Đổi chủ hộ | Owner changed |
| `web.unit-detail.history.kind.moved_in` | Có người chuyển vào | Moved in |
| `web.unit-detail.history.kind.moved_out` | Chuyển đi | Moved out |
| `web.unit-detail.history.kind.member_added` | Thêm thành viên | Member added |
| `web.unit-detail.history.kind.member_removed` | Xóa thành viên | Member removed |
| `web.unit-detail.history.actor` | bởi {name} | by {name} |
| `web.unit-detail.history.actor.system` | bởi hệ thống | by the system |
| `web.unit-detail.history.more` | Xem thêm | Load more |
| `web.unit-detail.dialog.edit.title` | Sửa thông tin căn | Edit unit |
| `web.unit-detail.dialog.edit.confirm` | Lưu | Save |
| `web.unit-detail.dialog.transfer.title` | Chuyển chủ hộ · {code} | Transfer ownership · {code} |
| `web.unit-detail.dialog.transfer.field.phone.label` | SĐT chủ hộ mới | New owner's phone |
| `web.unit-detail.dialog.transfer.field.name.label` | Họ tên | Full name |
| `web.unit-detail.dialog.transfer.field.keep.label` | Giữ lại các thành viên khác ({count}) | Keep the other members ({count}) |
| `web.unit-detail.dialog.transfer.field.reason.label` | Lý do (ít nhất 5 ký tự) | Reason (at least 5 characters) |
| `web.unit-detail.dialog.transfer.field.reason.placeholder` | VD: Đã bán căn, hợp đồng mua bán ngày 20/10 | e.g. Unit sold, sale contract of 20 Oct |
| `web.unit-detail.dialog.transfer.body` | Chủ hộ hiện tại {name} sẽ bị xóa khỏi căn. Phí, biên lai và yêu cầu vẫn thuộc về căn. | The current owner {name} will be removed from the unit. Fees, receipts and requests stay with the unit. |
| `web.unit-detail.dialog.transfer.existing` | SĐT này đã có tài khoản: {name}. Tên trong hồ sơ được giữ nguyên. | This phone already has an account: {name}. The name on the profile is kept. |
| `web.unit-detail.dialog.transfer.confirm` | Chuyển chủ hộ | Transfer ownership |
| `web.unit-detail.toast.transferred` | Đã chuyển chủ hộ, đã xóa {count} người khỏi căn | Ownership transferred, {count} people removed from the unit |
| `web.unit-detail.dialog.phone.title` | Đổi SĐT đăng nhập · {name} | Change login phone · {name} |
| `web.unit-detail.dialog.phone.field.phone.label` | SĐT mới | New phone |
| `web.unit-detail.dialog.phone.body` | Mọi phiên đăng nhập của người này sẽ bị đăng xuất. Tài khoản và các căn giữ nguyên (áp dụng cho mọi căn). | All of this person's sessions are signed out. The account and its units stay the same (applies to every unit). |
| `web.unit-detail.dialog.phone.confirm` | Đổi SĐT | Change phone |
| `web.unit-detail.dialog.lock.title` | Khóa {name}? | Lock {name}? |
| `web.unit-detail.dialog.lock.body` | Người này không dùng được căn {code} cho đến khi BQL mở khóa. Chủ hộ không tự mở khóa được. | This person cannot use unit {code} until the office unlocks them. The owner cannot unlock them. |
| `web.unit-detail.dialog.lock.confirm` | Khóa | Lock |
| `web.unit-detail.dialog.unlock.title` | Mở khóa {name}? | Unlock {name}? |
| `web.unit-detail.dialog.unlock.confirm` | Mở khóa | Unlock |
| `web.unit-detail.dialog.remove.title` | Xóa {name} khỏi căn {code}? | Remove {name} from unit {code}? |
| `web.unit-detail.dialog.remove.body` | Người này mất quyền vào căn ngay. Tài khoản của họ không bị xóa. | This person loses access to the unit at once. Their account is not deleted. |
| `web.unit-detail.dialog.remove.confirm` | Xóa khỏi căn | Remove from unit |
| `web.unit-detail.toast.saved` | Đã lưu thông tin căn | Unit saved |

Errors use `error.version_conflict`, `error.unit_code_in_use`, `error.member_exists`, `error.phone_in_use`, `error.phone_invalid`, `error.invalid_transition`, `error.owner_must_transfer`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWR-07 | **Given** A-1508 with an owner and 2 members **When** the Manager opens `/units/<id>` **Then** E-59 is called once, the owner row is first, each row shows the phone in full, the permission text and the status tag, and the tabs show only "Thành viên" and "Lịch sử" | web-e2e |
| UIWR-08 | **Given** the transfer dialog with a phone that has no account **When** the Manager enters a name, leaves "Giữ lại các thành viên khác" unticked, types a 5-character reason and confirms **Then** E-61 is sent with `If-Match` equal to the loaded version and `keepMembers=false`, the toast reports the removed count, and the history tab shows an `owner_changed` row | web-e2e |
| UIWR-09 | **Given** a second Manager edited the unit after this page loaded **When** the first confirms a transfer **Then** the 409 `version_conflict` message shows, the page refetches, the typed phone and reason stay in the form, and nothing was transferred | web-e2e |
| UIWR-10 | **Given** the change-phone dialog **When** the new number already has an account **Then** the field shows "This number already belongs to another account." (`phone_in_use`), the dialog stays open and the sessions of the person are not revoked | web-e2e |
| UIWR-11 | **Given** a family member **When** the Manager locks, unlocks and removes them **Then** the tag reads "Đã khóa", then "Đang dùng", then the row disappears and the history tab shows `member_removed` without a name or phone | web-e2e |
| UIWR-12 | **Given** a tenant **When** the Manager switches "Được phép thanh toán" **Then** E-69 `{canPay:true}` is sent, the thumb moves at once and the switch is disabled during the call, and the switch stays labelled "Được phép thanh toán" in the Quyền cell | web-e2e |
| UIWR-13 | **Given** the owner row **Then** it offers no "Xóa" and no retype; a raced removal answering `owner_must_transfer` shows the message with a link that opens the transfer dialog | web-e2e |
| UIWR-14 | **Given** a vacant unit with no owner **Then** the subtitle says "Chưa có chủ hộ" and the primary button opens `/residents/new?unitId=<id>` | web-e2e |
| UIWR-15 | **Given** a unit of another building **When** its id is opened **Then** E-59 answers 404 and the page is `NotFound` | api |

### 10. E2E cases

File `apps/cms-web/e2e/unit-detail.spec.ts`: UIWR-07…UIWR-15, in the flows "household management" (UIWR-07, 11, 12, 13), "transfer" (UIWR-08, 09, 14) and "login phone" (UIWR-10).

### 11. Open questions

None.

---

## W-Residents

> Status: Review · Prototype: designed (profile dialog and deletion approval to design) · Phase: P1 · DOC-65

### 1. Persona, use cases, permissions

PS-2 Manager (PS-1 Admin the same); UC-13 alternative 3b (search), UC-27 (approve an account deletion), FR-18.5, FR-39. Roles `admin`, `manager`. Opening a profile writes one `pii.read` row (FR-37.5).

### 2. URL and search params

`/residents`. Search parameters (DOC-53 §4 plus three, DR-212): `q`, `unitId`, `memberType` `owner` | `family` | `tenant` | `helper`, `status` `active` | `locked` (membership status), `deletion` `requested`, `neverSignedIn` boolean, `cursor`, `limit` (50), `dialog` `profile`, `accountId` (with `dialog=profile`). The select "Trạng thái tài khoản" writes exactly one of `status`, `deletion`, `neverSignedIn`, or none.

### 3. Prototype

Artboard `W-Residents` (canvas title "BQL: Cư dân", 1440 × 1060). Regions: shell (group "Cư dân", entry "Cư dân"); header (h1 "Cư dân", subtitle "612 tài khoản", buttons "Nhập từ Excel", "Xuất Excel", "Tạo chủ hộ"); filter row (`SearchField`, `SelectField` "Trạng thái tài khoản"); `Chip` row (Tất cả, Chủ hộ, Người thuê, Thành viên gia đình, Giúp việc); table card (Họ tên with `Avatar`, SĐT đăng nhập, Căn và vai trò with one `Plate` and role per unit, Email, Trạng thái `Tag`, pencil `IconButton` "Sửa hồ sơ {name}"); footer pager; info line "Cư dân đổi số điện thoại thì liên hệ BQL. Mở hồ sơ cư dân, chọn Cập nhật SĐT đăng nhập; tài khoản và các căn giữ nguyên."

Do not copy:

- The "Email" column: E-63 does not return an email, and an address is personal data kept off lists (UX-18). The column is dropped; the email is in the profile dialog.
- The search placeholder "Tìm tên, SĐT, mã căn, email": E-63 searches name (3 folded characters) and phone (4 digits, suffix). A unit is chosen with the `unitId` filter, which opens a unit picker (E-57); an email is not searchable (DR-212).
- The count "612 tài khoản" as a sample; it is `summary.total`.
- The button "Xuất Excel": no export before P6; hidden (DR-196).
- "Tạo chủ hộ" opens `W-Resident-Add`; the button text stays, the form also adds other member types (DR-214).

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | h1, subtitle, `Button` × 2 ("Nhập từ Excel" → `/import`, "Tạo chủ hộ" → `/residents/new`) | always |
| Filters | `SearchField`, `SelectField` (Trạng thái tài khoản: Tất cả, Đang dùng, Chưa đăng nhập, Yêu cầu xóa tài khoản, Đã khóa), `SelectField`/picker "Căn" (sets `unitId`), `Chip` × 5 (member type) | active filters in the URL |
| Table | `Avatar`, `Plate` sm + role, `Tag`, `IconButton` pencil | rows |
| Row status | one tag by priority: deletion requested (warning) > any membership locked (danger) > never signed in (neutral) > active (success) | per row |
| Profile dialog | `Dialog` with `TextField` × 5, `Banner`, `Button` | `dialog=profile` |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Page of residents, total | E-63 `GET /staff/residents` | `['staff','residents',filters]` | with `q` the page is capped at 20 with no cursor; a name needs 3 folded characters ("nguyen" finds "Nguyễn"), a phone 4 digits (suffix); shorter input shows the hint and sends no request; the list shows `cccdMasked` only in the profile, not as a column; `lastAppOpenAt` and `summary.total` are additions (DR-212) |
| Profile | E-65 `GET /staff/residents/{accountId}` | `['staff','residents','detail',accountId]`, `gcTime: 0` | opens with the dialog; writes `pii.read`; `Cache-Control: no-store`; never prefetched, never refetched on focus |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Search, filter, chip | E-63 | list reloaded, URL updated | 400 `invalid_cursor` → drop the cursor |
| Pencil / member name from `W-Unit-Detail` | E-65 | profile dialog fills | 404 `not_found` → close with the message; 500 `internal_error` (the audit insert failed, no data returned) → the generic error with a retry |
| Profile → save | E-66 `PATCH /staff/residents/{accountId}` with `If-Match` = `profile.version` | dialog closes, toast "Đã lưu hồ sơ"; the answer is masked, so the page does not call E-65 again | 409 `version_conflict` → close the dialog, show the message, the user reopens it (a reopen is a new `pii.read`); 400 `validation_failed` rule `format` on the ID number → field error |
| Profile → "Cập nhật SĐT đăng nhập" | E-67 | as in `W-Unit-Detail` (shared dialog) | `phone_in_use`, `phone_invalid` as there |
| Profile → "Duyệt yêu cầu xóa" (shown only for `deletion_requested`) → confirm | E-68 `POST /staff/residents/{accountId}/deletion/approve` | banner becomes "Đã duyệt, sẽ xóa vào {executeAfter}" and the button goes; the lists refetch and the row keeps its one tag "Yêu cầu xóa tài khoản" (*as built, P1-16:* the detail E-65 `deletion` carries `executeAfter`, so a reopened profile shows the same date; the list has no tag for "approved") | 409 `owner_must_transfer` → message "Chuyển chủ hộ của căn {codes} trước." with links to `/units/$id` from `details.unitIds`; 409 `deletion_not_requested` → refetch the list |

Profile dialog (not drawn):

```
+-----------------------------------------------------------+
| Hồ sơ cư dân · Nguyễn Văn An                           [x]|
| (warning banner if deletion requested: "Yêu cầu xóa tài   |
|  khoản ngày 18/10/2026"  [ Duyệt yêu cầu xóa ])            |
| SĐT đăng nhập  0901 234 567        [ Cập nhật SĐT đăng nhập]|
| Họ tên *   [ Nguyễn Văn An ]   Email [ an@example.com ]    |
| Số CCCD    [ 079085012345 ]   Ngày sinh [ 03/04/1985 ]     |
| Ghi chú    [                                      ]        |
| Các căn:  A-1508 Chủ hộ · A-0603 Người thuê                |
| Mỗi lần mở hồ sơ được ghi vào nhật ký.                     |
|                              [ Đóng ] [ Lưu hồ sơ ]         |
+-----------------------------------------------------------+
```

Only changed fields are sent; a cleared optional field is sent as `null`. The ID number is 9 or 12 digits (spaces are removed by the API). The date is `dd/MM/yyyy` on screen and `YYYY-MM-DD` on the wire.

### 7. States

Loading: skeleton rows. Empty with no filter: "Chưa có cư dân nào" and the buttons "Nhập từ Excel" and "Tạo chủ hộ". Empty with a filter: "Không có cư dân nào khớp". Search hint: "Nhập tên từ 3 ký tự hoặc SĐT từ 4 chữ số." Error, stale, forbidden: DOC-68. A profile that fails to open leaves the list as it was. Offline: not applicable.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.residents.title` | Cư dân | Residents |
| `web.residents.subtitle` | {total} tài khoản | {total} accounts |
| `web.residents.cta.import` | Nhập từ Excel | Import from Excel |
| `web.residents.cta` | Tạo chủ hộ | Add owner |
| `web.residents.field.search.label` | Tìm cư dân | Search residents |
| `web.residents.field.search.placeholder` | Tìm theo tên hoặc SĐT | Search by name or phone |
| `web.residents.field.search.hint` | Nhập tên từ 3 ký tự hoặc SĐT từ 4 chữ số. | Type at least 3 letters of a name or 4 digits of a phone. |
| `web.residents.field.status.label` | Trạng thái tài khoản | Account status |
| `web.residents.field.status.all` | Tất cả | All |
| `web.residents.field.unit.label` | Căn | Unit |
| `web.residents.field.unit.all` | Tất cả căn | All units |
| `web.residents.tab.all` | Tất cả | All |
| `web.residents.col.name` | Họ tên | Name |
| `web.residents.col.phone` | SĐT đăng nhập | Login phone |
| `web.residents.col.units` | Căn và vai trò | Units and roles |
| `web.residents.col.status` | Trạng thái | Status |
| `web.residents.action.edit` | Sửa hồ sơ {name} | Edit profile of {name} |
| `web.residents.banner.phone-change` | Cư dân đổi số điện thoại thì liên hệ BQL. Mở hồ sơ cư dân, chọn Cập nhật SĐT đăng nhập; tài khoản và các căn giữ nguyên. | A resident who changes phone contacts the office. Open the resident's profile and choose Update login phone; the account and its units stay the same. |
| `web.residents.empty.title` | Chưa có cư dân nào | No residents yet |
| `web.residents.empty.body` | Nhập từ file Excel hoặc tạo chủ hộ cho một căn. | Import from Excel or add an owner to a unit. |
| `web.residents.empty-filter.title` | Không có cư dân nào khớp | No resident matches |
| `web.residents.dialog.profile.title` | Hồ sơ cư dân · {name} | Resident profile · {name} |
| `web.residents.dialog.profile.field.name.label` | Họ tên | Full name |
| `web.residents.dialog.profile.field.email.label` | Email | Email |
| `web.residents.dialog.profile.field.cccd.label` | Số CCCD | ID number |
| `web.residents.dialog.profile.field.cccd.placeholder` | 12 chữ số | 12 digits |
| `web.residents.dialog.profile.field.dob.label` | Ngày sinh | Date of birth |
| `web.residents.dialog.profile.field.note.label` | Ghi chú | Note |
| `web.residents.dialog.profile.units` | Các căn | Units |
| `web.residents.dialog.profile.audit-note` | Mỗi lần mở hồ sơ được ghi vào nhật ký. | Each time a profile is opened it is written to the log. |
| `web.residents.dialog.profile.action.phone` | Cập nhật SĐT đăng nhập | Update login phone |
| `web.residents.dialog.profile.confirm` | Lưu hồ sơ | Save profile |
| `web.residents.banner.deletion` | Yêu cầu xóa tài khoản ngày {date} | Account deletion requested on {date} |
| `web.residents.banner.deletion-approved` | Đã duyệt, sẽ xóa vào {date} | Approved, will be deleted on {date} |
| `web.residents.action.approve-deletion` | Duyệt yêu cầu xóa | Approve deletion |
| `web.residents.dialog.approve-deletion.title` | Duyệt xóa tài khoản của {name}? | Approve deleting {name}'s account? |
| `web.residents.dialog.approve-deletion.body` | Sau thời gian chờ của tòa nhà, tài khoản và dữ liệu cá nhân của người này sẽ bị xóa. Không hoàn tác được. | After the building's waiting period the account and personal data are deleted. This cannot be undone. |
| `web.residents.dialog.approve-deletion.confirm` | Duyệt xóa | Approve deletion |
| `web.residents.dialog.approve-deletion.owner` | Chuyển chủ hộ của căn {codes} trước. | Transfer ownership of unit {codes} first. |
| `web.residents.toast.saved` | Đã lưu hồ sơ | Profile saved |

Errors use `error.version_conflict`, `error.owner_must_transfer`, `error.deletion_not_requested`, `error.phone_in_use`, `error.invalid_cursor`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWR-16 | **Given** a resident "Nguyễn Văn An" with phone `+84901234567` **When** the Manager searches "nguyen", "van an" and "4567" **Then** the resident is found by each, and the input "45" sends no request and shows the hint | web-e2e |
| UIWR-17 | **Given** the list **Then** no column shows an ID number, a date of birth or an email, and the network responses of E-63 hold only `cccdMasked` | web-e2e |
| UIWR-18 | **Given** accounts that are active, never signed in, locked and deletion-requested **When** the status select picks each value **Then** the URL carries exactly one of `status=active`, `neverSignedIn=true`, `status=locked`, `deletion=requested`, and each row shows its single tag by priority | web-e2e |
| UIWR-19 | **Given** a member-type chip "Người thuê" **When** it is selected **Then** E-63 is called with `memberType=tenant` and the chip is selected after a reload of the URL | web-e2e |
| UIWR-20 | **Given** the pencil on a row **When** it is clicked **Then** E-65 is called once and the dialog shows the full ID number and the date of birth; closing and reopening calls E-65 again (a new `pii.read`); the focus refetch never calls it | web-e2e |
| UIWR-21 | **Given** the profile dialog **When** only the email is edited and saved **Then** E-66 sends `If-Match` = the profile version and only `email`, and the answer is not followed by an E-65 call | web-e2e |
| UIWR-22 | **Given** a `deletion_requested` account that owns A-0703 **When** the Manager approves **Then** E-68 answers 409 `owner_must_transfer`, the dialog names A-0703 with a link to its detail, and the row is unchanged | web-e2e |
| UIWR-23 | **Given** a `deletion_requested` account that owns no unit **When** the Manager approves **Then** the banner shows the execution date from `executeAfter`, the button goes, and the row keeps the deletion tag after the refetch | web-e2e |

### 10. E2E cases

File `apps/cms-web/e2e/residents.spec.ts`: UIWR-16…UIWR-23, in the flows "search and filters" (UIWR-16…19) and "profile and deletion" (UIWR-20…23). UIWR-17 is the Playwright check "no CCCD in `W-Residents`" of UX-18.

### 11. Open questions

None.

---

## W-Resident-Add

> Status: Review · Prototype: designed · Phase: P1 · DOC-65

### 1. Persona, use cases, permissions

PS-2 Manager (PS-1 Admin the same); UC-13 alternative 3a, FR-18 (E-64), FR-16.5 (one owner per unit). Roles `admin`, `manager`. No invitation SMS is sent by this form (DR-137).

### 2. URL and search params

`/residents/new` (a side panel over `/residents`). Search: `unitId` (prefilled unit; from `W-Units` or `W-Unit-Detail`).

### 3. Prototype

Artboard `W-Resident-Add` (canvas title "BQL: Gán chủ hộ", 1440 × 900): the resident list dimmed behind a panel "Gán chủ hộ cho căn A-2304" with: `TextField` "SĐT đăng nhập" (icon phone), a `Banner` info "SĐT này đã có tài khoản" with the person card (name, phone, current unit and role), `SelectField` "Căn" (helper "Tầng 23, 1PN, đang trống"), disabled `SelectField` "Vai trò ở căn này" (helper "Mỗi căn có đúng một chủ hộ"), a read-only block "Hồ sơ cư dân, lấy từ hồ sơ hiện có" (Họ tên, Email, Số CCCD, Ngày sinh), an info line, and the footer buttons "Hủy" and "Liên kết căn A-2304".

Do not copy:

- The read-only block with the full "Số CCCD" and "Ngày sinh" and the email: a lookup by phone never shows them. The panel shows the name and the masked ID number from E-63 and nothing else (UX-18, DR-215).
- The disabled role select as the only role: E-64 also takes `family`, `tenant` and `helper` (DR-214).
- The list behind the panel is the real `W-Residents` list, not the drawn rows.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Phone | `TextField` type `tel` | always |
| Lookup result | `Banner` info + person card (`Avatar`, name, phone, masked ID number, memberships as `Plate` + role) | when an account matches |
| Unit | `SelectField` with a typeahead (E-57 `q`), helper "Tầng {floor}, {bedrooms}PN, {occupancy}" | always |
| Role | `SelectField`: Chủ hộ, Thành viên gia đình, Người thuê, Giúp việc; for a tenant a `Checkbox` "Được phép thanh toán" | always |
| Person fields | `TextField` Họ tên (required), Email, Ghi chú | only when no account matches |
| Footer | `Button` ghost "Hủy", `Button` primary | label by case |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Existing account for the phone | E-63 `GET /staff/residents?q=<digits>` | not cached | sent when at least 9 digits are typed; the match is the item whose `phone` digits equal `84` + the typed digits without a leading `0` (the endpoint is a suffix search and may return more); no match → new account |
| Unit options | E-57 `GET /staff/units?q=` | `['staff','units',{q}]` | at least 2 characters; `owner` null tells whether the unit is ownerless; the prefilled unit is read by E-59 |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Submit | E-64 `POST /staff/residents` (`Idempotency-Key`) body `{unitId, phone, fullName, memberType, canPay, email, note}` | panel closes, toast ("Đã tạo chủ hộ và tài khoản" when `accountCreated`, else "Đã liên kết căn {code}"), navigate to `/units/$unitId` | 409 `unit_has_owner` → error under "Vai trò" with a link to the transfer dialog of that unit, the unit option is refreshed; 409 `member_exists` → "Người này đã là thành viên của căn."; 404 `not_found` (unit) → refresh options; 400 `phone_invalid` → field error; 422 `can_pay_tenant_only` (the checkbox only shows for a tenant); 422 `idempotency_key_reuse` → reload the form |

There is no `phone_in_use` here. An existing phone is the **link** case: the person's account is reused and the name in the form is not applied (DQ-44, DOC-27 §5.1). `phone_in_use` belongs to the change of a login phone (`W-Unit-Detail`, E-67).

### 7. States

Loading: the lookup shows a small spinner in the phone field only. Unit without an owner chosen: role "Chủ hộ" preselected; unit with an owner chosen: "Chủ hộ" is disabled with the helper "Căn này đã có chủ hộ. Muốn đổi chủ hộ, dùng Chuyển chủ hộ." Lookup failure (network): the form keeps working as a "new person" form; the API links an existing account anyway. Submit disabled until the phone, the unit and (for a new person) the name are filled. Error, forbidden: DOC-68.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.resident-add.title` | Gán chủ hộ cho căn {code} | Assign an owner to unit {code} |
| `web.resident-add.title.generic` | Thêm cư dân | Add a resident |
| `web.resident-add.field.phone.label` | SĐT đăng nhập | Login phone |
| `web.resident-add.banner.existing.title` | SĐT này đã có tài khoản | This phone already has an account |
| `web.resident-add.banner.existing.body` | Hệ thống sẽ liên kết thêm căn {code} với vai trò {role}, không tạo tài khoản mới. | The system will link unit {code} as {role} and will not create a new account. |
| `web.resident-add.existing.line` | {phone}, tài khoản đang dùng | {phone}, active account |
| `web.resident-add.field.unit.label` | Căn | Unit |
| `web.resident-add.field.unit.hint` | Tầng {floor}, {bedrooms}PN, {occupancy} | Floor {floor}, {bedrooms} BR, {occupancy} |
| `web.resident-add.field.role.label` | Vai trò ở căn này | Role in this unit |
| `web.resident-add.field.role.hint.owner` | Mỗi căn có đúng một chủ hộ | Each unit has exactly one owner |
| `web.resident-add.field.role.owner-taken` | Căn này đã có chủ hộ. Muốn đổi chủ hộ, dùng Chuyển chủ hộ. | This unit already has an owner. To change the owner, use Transfer ownership. |
| `web.resident-add.field.can-pay.label` | Được phép thanh toán | May pay |
| `web.resident-add.field.name.label` | Họ tên | Full name |
| `web.resident-add.field.email.label` | Email (không bắt buộc) | Email (optional) |
| `web.resident-add.field.note.label` | Ghi chú (không bắt buộc) | Note (optional) |
| `web.resident-add.profile.heading` | Hồ sơ cư dân, lấy từ hồ sơ hiện có | Resident profile, taken from the existing profile |
| `web.resident-add.profile.cccd` | CCCD {masked} | ID number {masked} |
| `web.resident-add.info` | Cư dân đăng nhập App cư dân bằng SĐT + OTP. Hệ thống không gửi tin nhắn mời. | The resident signs in to the resident app with phone + OTP. The system sends no invitation message. |
| `web.resident-add.cta.link` | Liên kết căn {code} | Link unit {code} |
| `web.resident-add.cta.owner` | Tạo chủ hộ | Create owner |
| `web.resident-add.cta.member` | Thêm cư dân | Add resident |
| `web.resident-add.cta.cancel` | Hủy | Cancel |
| `web.resident-add.toast.created` | Đã tạo tài khoản và thêm vào căn {code} | Account created and added to unit {code} |
| `web.resident-add.toast.linked` | Đã liên kết căn {code} với tài khoản có sẵn | Unit {code} linked to the existing account |

Roles use `common.member-type.<type>`. Errors use `error.unit_has_owner`, `error.member_exists`, `error.phone_invalid`, `error.not_found`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWR-24 | **Given** `/residents/new?unitId=<A-2304>` (vacant, no owner) and a new phone **When** the Manager enters the phone, a name and submits **Then** E-64 is sent with `memberType=owner` and an `Idempotency-Key`, the toast says the account was created, and `/units/<A-2304>` shows the owner | web-e2e |
| UIWR-25 | **Given** a phone that already has an account (Phạm Thu Hà, tenant of A-1102) **When** the 9th digit is typed **Then** E-63 is called, the banner shows the name and the masked ID number, the name field is hidden, no email, no full ID number and no date of birth appears anywhere in the panel, and submitting links the unit (`accountCreated=false`) | web-e2e |
| UIWR-26 | **Given** a unit that already has an owner **Then** "Chủ hộ" is disabled with the transfer hint; picking "Người thuê" shows the "Được phép thanh toán" box and E-64 sends `canPay` | web-e2e |
| UIWR-27 | **Given** two Managers add an owner to the same ownerless unit **When** the second submits **Then** 409 `unit_has_owner` shows under "Vai trò" with a link to the transfer dialog, and the panel stays open | web-e2e |
| UIWR-28 | **Given** the same person is added twice to a unit **Then** the second answer 409 `member_exists` shows "Người này đã là thành viên của căn." and no second row exists | web-e2e |
| UIWR-29 | **Given** an invalid phone **When** it is submitted **Then** the field shows `phone_invalid` and no account is created | web-e2e |

### 10. E2E cases

File `apps/cms-web/e2e/resident-add.spec.ts`: UIWR-24…UIWR-29, one flow "give a person to a unit".

### 11. Open questions

None.

---

## W-Import

> Status: Review · Prototype: designed (steps 1 and 3, the warnings, the resume states and the recent-imports table to design) · Phase: P1 · DOC-65

### 1. Persona, use cases, permissions

PS-2 Manager (PS-1 Admin the same); UC-13 main flow "import" steps 1 to 5, FR-01.2, FR-18.1, FR-18.2, NFR-12; data rules DOC-18 §1. Roles `admin`, `manager`. This screen handles `kind = unit_owner` only; the fee batch import is `W-Fee-Import` (P2, E-72 with `kind = fee_batch`). Step 1 also shows the recent imports of the building (E-169, DR-226).

### 2. URL and search params

`/import`. Search: `kind` `unit_owner` (default and only value in P1), `importId` (a job: the page reopens it through E-73 after a reload, DR-21; a row of the recent-imports table sets it).

### 3. Prototype

Artboard `W-Import` (canvas title "BQL: Nhập căn hộ từ Excel", 1440 × 1060) shows step 2: h1 "Nhập căn hộ từ Excel" with the subtitle "Kiểm tra từng dòng trước khi lưu vào danh sách căn hộ"; a three-step bar (Chọn file ✓, 2 Kiểm tra, 3 Lưu); the file card (name, "240 dòng, tải lên 09:24, 09/10/2026 bởi …", buttons "Tải file mẫu", "Chọn file khác"); three count cards (236 dòng hợp lệ, 4 dòng lỗi, 12 căn đã có, sẽ cập nhật); the section "Dòng lỗi" (table Dòng, Mã căn, Cột, Lỗi và cách sửa); a warning `Banner` "Dòng lỗi sẽ bị bỏ qua nếu bạn lưu ngay"; the action bar "Hủy", "Tải danh sách lỗi", "Lưu 236 dòng hợp lệ".

Do not copy:

- The three sample error messages "Diện tích để trống…" and "Tầng ghi 21, không khớp mã căn A-2010…": the area is optional (DQ-13) and no rule compares the floor with the code. The messages shown are the `message` of each issue from the API, in the language of the request, and they are the texts of DOC-18 §1.2.
- The drawn "Trạng thái" error with the sample value "dang o": the real column header is "Tình trạng" (E-71) and the accepted words are in DQ-14.
- The uploader name "bởi …": a resumed job has no uploader (E-73), so the clause is shown only for the job created in this session.
- The file name `can-ho-moc-mien-10-2026.xlsx` and counts are sample data.
- The canvas has no list of earlier imports. The "Nhập gần đây" table below is specified from E-169 (DR-226) and is owed an artboard.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Step bar | three-step indicator built from `lamp`/`teal` tokens (DOC-54), not a `Tabs` | step 1 `idle`, `uploading`; step 2 `validating`, `validated`, `failed`, `expired`; step 3 `committing`, `committed` |
| File picker (step 1) | drop zone + `Button` "Chọn file Excel", link "Tải file mẫu", rule line "Tệp .xlsx, tối đa 5 MB và 5.000 dòng" | `idle` |
| File card | `Card` with the file name, row count, time, buttons | steps 2 and 3 |
| Count cards | three `Card`s (valid, errors, units to update) and one muted line (new units, new accounts, linked accounts, owners added, warnings) | `validated` |
| Issue tables | two tables: "Dòng lỗi" (errors, first 50 then "Xem thêm") and "Cảnh báo" (collapsed) | `validated`, `failed` |
| Recent imports (step 1) | `Card` titled "Nhập gần đây" with a table: file name, uploaded time and date, uploader, result ("{valid}/{rows} dòng hợp lệ, {errors} lỗi"), status `Tag` (`status.import.*`), row action "Mở"; "Xem thêm" loads the next cursor; a muted line says rows are kept 30 days | `loading`, `loaded`, `empty`, `error` |
| Valid rows | collapsed section "Xem trước {n} dòng hợp lệ đầu tiên": row, unit code, owner name, phone, masked ID number, notes | `validated` |
| Banner | `Banner` warning (errors exist), `Banner` danger (`failed`, `expired`, `import_stale`) | by state |
| Action bar | `Button` ghost "Hủy", `Button` outline "Tải danh sách lỗi", `Button` primary with `check` "Lưu {n} dòng hợp lệ" | `validated` |
| Result (step 3) | `Card` with the committed counts and two buttons | `committed` |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Template file | E-71 `GET /staff/imports/templates/unit_owner` | none (a download) | fetched with the bearer token and saved as a file from `Content-Disposition`; headers follow the staff member's `language` |
| Job (resume, result) | E-73 `GET /staff/imports/{id}` | `['staff','imports',importId]` | read when `importId` is in the URL; `status` `validated`, `failed`, `committed`, `expired` (a `validated` job past `expiresAt` already reads `expired`) |

| Recent imports | E-169 `GET /staff/imports?limit=10` | `['staff','imports','list']` (`useInfiniteQuery`, 10 per page) | shown on step 1 only; refetched after a commit and on window focus after 30 s; `kind=unit_owner` is the only kind in P1; a `validated` job past `expiresAt` already reads `expired` |

E-73 reads one job by id; E-169 lists the building's jobs of the last 30 days, newest first (DR-226; DR-213 had left the history out of phase 1). Real-time and polling: none, because validation is synchronous (DR-21).

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Pick a file | none (client checks: extension `.xlsx`, size ≤ 5 MB) | upload starts | wrong extension → "Chỉ nhận tệp Excel .xlsx."; over 5 MB → "Tệp vượt quá 5 MB." |
| Upload | E-36 `POST /staff/uploads` `{purpose:"import", module:"residency", mime, size}` (`Idempotency-Key`) → `PUT` to the returned URL with its headers → E-37 `POST /staff/uploads/{id}/verify` | `fileId` obtained | 400 `file_type_not_allowed` / `file_too_large`; 413 `quota_exceeded`; 429 `rate_limited`; 422 `file_not_verified` with `details[0].code` (`missing` → retry the `PUT` once; `wrong_type`, `bad_content`, `empty`, `too_large` → "Không đọc được tệp. Hãy chọn lại.") (DOC-55 §12) |
| Validate (automatic after the upload) | E-72 `POST /staff/imports` `{kind:"unit_owner", fileId}` (`Idempotency-Key`; client timeout 30 s) | `importId` goes into the URL, the preview shows (≤ 10 s for 2,000 rows, NFR-12) | 400 `validation_failed` rule `too_many_rows` → "Tệp có hơn 5.000 dòng. Hãy tách thành nhiều tệp."; rule `file_too_large`; 422 `file_not_verified`; 422 `idempotency_key_reuse` → restart; a file-layer failure is **not** an error: the job is created with `status: "failed"` and one `fail` issue (`import_no_header`, `import_file_type`, `import_duplicate_column`, `import_empty`) shown in a danger banner |
| "Tải file mẫu" | E-71 | file saved | 403/404 → generic error |
| "Mở" on a row of the recent imports | none (the row already holds `importId`) | `importId` goes into the URL and E-73 shows the right step: the preview for `validated` (with the save button), the counts for `committed`, the banner for `failed` and `expired` | 404 `not_found` (purged meanwhile) → generic error and the list refetches |
| "Xem thêm" under the recent imports | E-169 with `cursor` | the next rows are appended | 400 `invalid_cursor` → drop the cursor and refetch the first page |
| "Chọn file khác" / "Hủy" | none | the page returns to step 1 and `importId` leaves the URL; the stored job expires in 24 h and its file is deleted by the job (DOC-27 §9) | |
| "Tải danh sách lỗi" | none (built in the browser, DR-213) | CSV `import-errors-<importId>.csv` (UTF-8 with BOM; columns row, unit code, column, severity, message) from `issues` | when `issuesTruncated` the file holds the first 500 and the page says so |
| "Lưu {n} dòng hợp lệ" | E-74 `POST /staff/imports/{id}/commit` (no body, no key; the job status is the arbiter) | step 3 with `committed` counts; `importId` stays in the URL | 409 `import_expired` → danger banner "Bản kiểm tra đã hết hạn. Hãy tải tệp lên lại." and step 1; 409 `import_not_ready` → refetch E-73; 409 `import_stale` → danger banner "Dữ liệu đã thay đổi từ lúc kiểm tra. Hãy tải tệp lên lại." with "Chọn file khác"; 500 `internal_error` (post-check failed, rolled back) → generic error with the request id; a second press (double click or two tabs) returns the same 200 and shows the same result |

The button is disabled while the commit runs and when `counts.valid = 0`. Rows with an error are skipped by the commit; the banner says so before the press (DR-21, FR-18.1).

### 7. States

| State | Screen |
| --- | --- |
| `idle` | Step 1: drop zone, the rules line, template link |
| `uploading` | Progress bar with the file name and a "Hủy" that aborts the `PUT` |
| `validating` | "Đang kiểm tra {fileName}…" with a skeleton of the count cards; after 10 s the line adds "Việc này lâu hơn bình thường, vui lòng chờ." (the client waits up to 30 s, then offers a retry with the same key) |
| `validated` with errors | Count cards, "Dòng lỗi" table, warning banner, action bar |
| `validated` without errors | Count cards, a success line "Không có dòng lỗi", action bar without the download button |
| `failed` | Danger banner with the issue message, "Chọn file khác" only |
| `expired` | Danger banner and "Chọn file khác"; the counts stay readable |
| `committed` | Step 3: "Đã lưu: {unitsCreated} căn mới, {unitsUpdated} căn cập nhật, {accountsCreated} tài khoản mới, {accountsLinked} tài khoản liên kết, {ownersAdded} chủ hộ" and the buttons "Xem danh sách căn hộ" (`/units`) and "Nhập file khác" |
| Recent imports `loading` / `empty` / `error` | A skeleton of three rows; "Chưa có lần nhập nào trong 30 ngày qua."; the generic error `Banner` with a retry (the rest of step 1 stays usable) |
| Issues over 500 | the table says "Hiển thị 500 lỗi đầu tiên" (`issuesTruncated`); the counts stay complete |

Error, forbidden: DOC-68. Offline: not applicable; a lost connection during the commit leaves the job `validated` or `committed`, and the page reopens the right state through `importId`.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.import.title` | Nhập căn hộ từ Excel | Import units from Excel |
| `web.import.subtitle` | Kiểm tra từng dòng trước khi lưu vào danh sách căn hộ | Check every row before saving to the unit list |
| `web.import.step.file` | Chọn file | Choose file |
| `web.import.step.check` | Kiểm tra | Check |
| `web.import.step.save` | Lưu | Save |
| `web.import.dropzone.title` | Chọn hoặc kéo thả tệp Excel | Choose or drop an Excel file |
| `web.import.dropzone.rules` | Tệp .xlsx, tối đa 5 MB và 5.000 dòng. Cột chủ hộ có thể để trống. | .xlsx file, up to 5 MB and 5,000 rows. The owner columns may be left empty. |
| `web.import.cta.choose` | Chọn file Excel | Choose Excel file |
| `web.import.action.template` | Tải file mẫu | Download the template |
| `web.import.action.other-file` | Chọn file khác | Choose another file |
| `web.import.file.meta` | {rows} dòng, tải lên {time}, {date} | {rows} rows, uploaded {time}, {date} |
| `web.import.file.meta.by` | {rows} dòng, tải lên {time}, {date} bởi {name} | {rows} rows, uploaded {time}, {date} by {name} |
| `web.import.validating` | Đang kiểm tra {fileName}… | Checking {fileName}… |
| `web.import.validating.slow` | Việc này lâu hơn bình thường, vui lòng chờ. | This is taking longer than usual, please wait. |
| `web.import.count.valid` | dòng hợp lệ | valid rows |
| `web.import.count.errors` | dòng lỗi | rows with errors |
| `web.import.count.update` | căn đã có, sẽ cập nhật | existing units, will be updated |
| `web.import.count.detail` | {created} căn mới, {accountsNew} tài khoản mới, {accountsLinked} tài khoản liên kết, {owners} chủ hộ, {warnings} cảnh báo | {created} new units, {accountsNew} new accounts, {accountsLinked} linked accounts, {owners} owners, {warnings} warnings |
| `web.import.no-errors` | Không có dòng lỗi. | No rows with errors. |
| `web.import.errors.title` | Dòng lỗi | Rows with errors |
| `web.import.warnings.title` | Cảnh báo ({count}) | Warnings ({count}) |
| `web.import.valid.title` | Xem trước {count} dòng hợp lệ đầu tiên | Preview of the first {count} valid rows |
| `web.import.col.row` | Dòng | Row |
| `web.import.col.unit` | Mã căn | Unit |
| `web.import.col.column` | Cột | Column |
| `web.import.col.message` | Lỗi và cách sửa | Error and how to fix it |
| `web.import.col.owner` | Chủ hộ | Owner |
| `web.import.col.note` | Ghi chú | Notes |
| `web.import.column.unit_code` | Mã căn hộ | Unit code |
| `web.import.column.floor` | Tầng | Floor |
| `web.import.column.bedrooms` | Số phòng ngủ | Bedrooms |
| `web.import.column.area_m2` | Diện tích (m²) | Area (m²) |
| `web.import.column.occupancy` | Tình trạng | Occupancy |
| `web.import.column.owner_name` | Họ tên chủ hộ | Owner full name |
| `web.import.column.owner_phone` | SĐT chủ hộ | Owner phone |
| `web.import.column.owner_email` | Email chủ hộ | Owner email |
| `web.import.column.owner_id_number` | CCCD chủ hộ | Owner ID number |
| `web.import.column.owner_dob` | Ngày sinh chủ hộ | Owner date of birth |
| `web.import.more` | Xem thêm | Load more |
| `web.import.truncated` | Hiển thị 500 lỗi đầu tiên. Số liệu ở trên là đầy đủ. | Showing the first 500 errors. The counts above are complete. |
| `web.import.banner.errors.title` | Dòng lỗi sẽ bị bỏ qua nếu bạn lưu ngay | Rows with errors are skipped if you save now |
| `web.import.banner.errors.body` | Sửa {errors} dòng lỗi trong file rồi chọn file khác để kiểm tra lại, hoặc lưu {valid} dòng hợp lệ và nhập các dòng còn lại sau. | Fix the {errors} rows in the file and choose another file to check again, or save the {valid} valid rows and import the rest later. |
| `web.import.banner.expired` | Bản kiểm tra đã hết hạn. Hãy tải tệp lên lại. | This check has expired. Upload the file again. |
| `web.import.banner.stale` | Dữ liệu đã thay đổi từ lúc kiểm tra. Hãy tải tệp lên lại. | The data changed since the check. Upload the file again. |
| `web.import.banner.failed` | Không thể kiểm tra tệp này. | This file cannot be checked. |
| `web.import.cta.cancel` | Hủy | Cancel |
| `web.import.action.download-errors` | Tải danh sách lỗi | Download the error list |
| `web.import.cta` | Lưu {count} dòng hợp lệ | Save {count} valid rows |
| `web.import.error.extension` | Chỉ nhận tệp Excel .xlsx. | Only Excel .xlsx files are accepted. |
| `web.import.error.size` | Tệp vượt quá 5 MB. | The file is larger than 5 MB. |
| `web.import.error.unreadable` | Không đọc được tệp. Hãy chọn lại. | The file could not be read. Choose it again. |
| `web.import.error.too-many-rows` | Tệp có hơn 5.000 dòng. Hãy tách thành nhiều tệp. | The file has more than 5,000 rows. Split it into several files. |
| `web.import.result.title` | Đã lưu | Saved |
| `web.import.result.body` | {unitsCreated} căn mới, {unitsUpdated} căn cập nhật, {accountsCreated} tài khoản mới, {accountsLinked} tài khoản liên kết, {ownersAdded} chủ hộ. | {unitsCreated} new units, {unitsUpdated} updated units, {accountsCreated} new accounts, {accountsLinked} linked accounts, {ownersAdded} owners. |
| `web.import.result.cta.units` | Xem danh sách căn hộ | Go to the unit list |
| `web.import.result.cta.again` | Nhập file khác | Import another file |
| `web.import.expires` | Bản kiểm tra giữ đến {time}, {date} | The check is kept until {time}, {date} |
| `web.import.history.title` | Nhập gần đây | Recent imports |
| `web.import.history.empty` | Chưa có lần nhập nào trong 30 ngày qua. | No imports in the last 30 days. |
| `web.import.history.note` | Danh sách giữ 30 ngày gần nhất. | The list keeps the last 30 days. |
| `web.import.history.col.file` | Tệp | File |
| `web.import.history.col.when` | Tải lên | Uploaded |
| `web.import.history.col.by` | Người nhập | Imported by |
| `web.import.history.col.result` | Kết quả | Result |
| `web.import.history.result` | {valid}/{rows} dòng hợp lệ, {errors} lỗi | {valid} of {rows} rows valid, {errors} with errors |
| `web.import.history.open` | Mở | Open |

Issue messages are not keys of this screen: each row shows `issues[].message` as the API rendered it (the texts of DQ-01…DQ-46, DOC-18 §1.2), and the stored `code` and `params` can be re-rendered by the catalog. Errors use `error.import_expired`, `error.import_not_ready`, `error.import_stale`, `error.file_not_verified`, `error.quota_exceeded`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWR-30 | **Given** the sample file of 240 units with 4 bad rows **When** the Manager picks it **Then** the page runs E-36, the `PUT`, E-37 and E-72 in that order, `importId` appears in the URL, and the cards read 236 / 4 / 12 | web-e2e |
| UIWR-31 | **Given** a file of 2,000 rows with 40 errors **When** it is chosen **Then** the preview shows within 10 s of the upload (NFR-12) and the errors table lists 40 rows with the unit code, the localized column name and the API message | web-e2e |
| UIWR-32 | **Given** the preview **When** the Manager presses "Lưu 236 dòng hợp lệ" **Then** E-74 is called once, the button is disabled during the call, step 3 shows the committed counts, and the unit list afterwards contains the new units | web-e2e |
| UIWR-33 | **Given** the preview **When** the Manager double-clicks the save button or presses it in two tabs **Then** one commit happens (the second answer is the same 200) and the units exist once | web-e2e |
| UIWR-34 | **Given** a preview older than 24 hours (clock moved) **When** the page is reopened with `importId` **Then** the status is `expired`, the danger banner shows and there is no save button; a direct E-74 gives 409 `import_expired` | web-e2e |
| UIWR-35 | **Given** a `.xlsx` with no unit-code header **Then** the job is `failed`, a danger banner shows the `import_no_header` message, and there is no save button | web-e2e |
| UIWR-36 | **Given** a file of 5,001 rows **Then** E-72 answers 400 `too_many_rows`, the page shows "Tệp có hơn 5.000 dòng…" and no `importId` is created; a file of 5.2 MB is stopped in the browser | web-e2e |
| UIWR-37 | **Given** the preview **Then** no ID number appears unmasked, no date of birth and no email appears anywhere on the page, and the response bodies of E-72 and E-73 hold none | web-e2e |
| UIWR-38 | **Given** the error list with `issuesTruncated` **When** "Tải danh sách lỗi" is pressed **Then** a CSV with a BOM and at most 500 rows downloads, and the page says the list is cut | web-e2e |
| UIWR-39 | **Given** the data changed between the preview and the commit **Then** E-74 answers 409 `import_stale` and the page shows the "Dữ liệu đã thay đổi…" banner and "Chọn file khác" | web-e2e |
| UIWR-40 | **Given** `/import?importId=<id>` of a `validated` job **When** the page loads **Then** E-73 is called and the same preview shows without a new upload | web-e2e |
| UIWR-41 | **Given** three jobs (one `committed` 2,000-row job, one `validated` job, one `failed` job) **When** step 1 loads **Then** E-169 is called once with `limit=10`, the table lists them newest first with the uploader's name, the result text and a status `Tag`, and the 30-day note shows | web-e2e |
| UIWR-42 | **Given** the recent-imports table **When** the Manager presses "Mở" on the `validated` job and then on the `committed` job **Then** `importId` is set in the URL each time, E-73 shows the preview with the save button for the first and the committed counts without a save button for the second | web-e2e |

### 10. E2E cases

File `apps/cms-web/e2e/import.spec.ts`: the flow "import units" (UIWR-30, 31, 32, 33, 37, 38) is the P1-16 case "import units"; the flow "bad files and expiry" holds UIWR-34, 35, 36, 39, 40; the flow "recent imports" holds UIWR-41, 42. The 2,000-row fixture is the one of IM-30.

### 11. Open questions

None.

---

## Specified before P5 and P3

These parts of the screens above have no section yet. They are listed so that the later phase adds a row, not a rewrite (DR-196).

| Part | Screen | Phase | Specified in | What is needed |
| --- | --- | --- | --- | --- |
| Debt card and tab "Phí và công nợ" | `W-Unit-Detail` | P2 | DOC-66 (`W-Debts`, `W-Fee-Record`) | E-59 `debt`; link "Xem công nợ" to `/debts/$unitId`; batch codes `PH-YYMM-NN` |
| `UnitMoneyPanel` (log rows of the unit) | `W-Unit-Detail` | P3 | DOC-66 | component to design (DR-72, N12) |
| Tab "Phiếu hỗ trợ" | `W-Unit-Detail` | P4 | DOC-64 | `tab=tickets` is added to the URL map of DOC-53 §4 |
| Vehicles card and tab "Phương tiện" | `W-Unit-Detail` | P5 | this file, then DOC-65 §`W-Vehicles` | vehicle list of the unit (endpoint of DOC-30, not numbered yet) |
| `W-Vehicles` | own route `/vehicles` | P5 | this file (section to add) | review with photos, approve and reject; canvas artboard `W-Vehicles` exists |
| Column "Phương tiện" | `W-Units` | P5 | this file | `vehicleCount` in E-57 |
| Export buttons "Xuất Excel" | `W-Units`, `W-Residents` | P6 | DOC-33 | an export kind for units and residents, if the Owner wants it |

## Decisions proposed in this document

| ID | Title | Decided by | Write to |
| --- | --- | --- | --- |
| DR-212 | The unit and resident lists get the fields their screens draw: E-57 gains the filter `bedrooms`, the item field `memberCount` and `summary {total, occupied, rented, vacant}` (whole building, ignoring the filters); E-63 gains `summary {total}`, the item field `lastAppOpenAt` and the filter `neverSignedIn`; the search boxes search only what the endpoints search (unit code on `W-Units`; name and phone on `W-Residents`); the pager is forward with a client stack of cursors, with no filtered total | Claude (delegated by Owner) | DOC-51 E-57, E-63, DOC-53 §4, DOC-27 §11 |
| DR-213 | Import: each `issues[]` entry of E-72/E-73 carries `unitCode` (nullable), so the error table can show the "Mã căn" the canvas draws; the error list is a CSV built in the browser; there is no list of past imports in phase 1 (*revised 2026-10-21, DR-226: the list is E-169*) | Claude (delegated by Owner) | DOC-51 E-72, E-73, DOC-18 §1.4 |
| DR-214 | `W-Resident-Add` offers the four member types, because E-64 accepts them (the canvas draws the owner only); "Chủ hộ" is disabled for a unit that has an owner, with a link to the transfer | Claude (delegated by Owner) | DOC-27 §5.1, DOC-56 |
| DR-215 | The lookup of an existing phone in `W-Resident-Add` and in the transfer dialog uses E-63 and shows the name and the masked ID number only; the canvas's read-only full ID number, date of birth and email are not shown, because only E-65 may return them (UX-18, DOC-35 §6) | Claude (delegated by Owner) | DOC-35 §6, DOC-56 |

### DR-212 · Fields the list screens draw and the endpoints do not return

- **Problem:** `W-Units` draws a summary line, a "Loại" filter, a member count and a "1–10 trên 240" pager; `W-Residents` draws "612 tài khoản", a "Chưa đăng nhập" status and a search by unit code and email. E-57 and E-63 return none of these, and the cursor lists have no filtered total.
- **Decision:** Add to E-57 the query `bedrooms` (0…20), the item field `memberCount` (non-removed memberships including the owner's) and `summary {total, occupied, rented, vacant}` for the whole building. Add to E-63 `summary {total}`, the item field `lastAppOpenAt` (`resident_account.last_app_open_at`, null = never signed in) and the query `neverSignedIn` (boolean). Search stays what the endpoints do: unit-code prefix for units; folded name and phone suffix for residents; an email or a unit code is not searched on the resident list (the `unitId` filter covers the unit). The pager keeps the cursors it has visited so "Trang trước" works and shows "Trang {n}" without a filtered total. Hidden for now: the "Phương tiện" column (P5) and "Xuất Excel" (P6).
- **Consequences:** two small query changes and three response fields in DOC-51 (Draft); RM-35, RM-36 get a case each; DOC-53's URL rows gain `bedrooms`, `neverSignedIn`, `dialog=profile&accountId`.
- **Write to:** DOC-51 E-57 and E-63, DOC-53 §4, DOC-27 §11.

### DR-213 · The import preview names the unit of an issue; the error list is a browser CSV

- **Problem:** The canvas's error table has a "Mã căn" column and a download "Tải danh sách lỗi". An issue of E-72 has `row`, `column`, `code`, `params` and `message`; the unit code is in `params` for some codes only, and a row with an error is not in `validRows`. No endpoint downloads the errors, and E-73 reads one job by id, so there is no history to list.
- **Decision:** Each entry of `preview.issues` also carries `unitCode` (the normalized code of the row, `null` when the row has none). The download is generated in the browser from `issues` (CSV with a BOM, at most 500 rows). The import page has no list of past imports; a job is reopened through `?importId=`. *Revised 2026-10-21 (DR-226):* step 1 lists the recent imports (E-169) and a row sets `?importId=`.
- **Consequences:** one field in the E-72/E-73 examples and DOC-18 §1.4; no new endpoint; IM-30 asserts the field.
- **Write to:** DOC-51 E-72, E-73, DOC-18 §1.4.

### DR-214 · The add form takes the four member types

- **Problem:** UC-13 3a says "create an owner by phone", the canvas draws only that, but E-64 accepts `family`, `tenant` and `helper`, and DOC-27 §5.1 lets the Manager add them.
- **Decision:** The role select lists the four types. "Chủ hộ" is selectable only for a unit without an owner; for the others it is disabled with the hint "Căn này đã có chủ hộ. Muốn đổi chủ hộ, dùng Chuyển chủ hộ." A tenant gets the "Được phép thanh toán" box.
- **Consequences:** more copy keys (above); UIWR-26.
- **Write to:** DOC-27 §5.1, DOC-56.

### DR-215 · A phone lookup never shows more than the list does

- **Problem:** The canvas shows, for an existing phone, the person's full ID number, date of birth and email in a read-only block. Only E-65 returns those, and it writes `pii.read`; a create form must not read personal data.
- **Decision:** The lookup calls E-63, whose items hold the name, the phone and the masked ID number. The panel shows those and the person's units; nothing else.
- **Consequences:** UIWR-25 is the test; the profile dialog of `W-Residents` stays the only place of the full values.
- **Write to:** DOC-35 §6, DOC-56.

## Not yet in the canvas

The following are specified above with wireframes and still need an artboard (DOC-56 §4 lists the owner and phase; these rows are owed there): `W-Units` dialog "Thêm căn hộ"; `W-Unit-Detail` dialogs (edit unit, transfer ownership, change login phone, confirm lock, unlock and remove), the history tab and the row overflow menu; `W-Residents` profile dialog and the deletion approval; `W-Import` steps 1 and 3, the recent-imports table (DR-226), the warnings section and the failed, expired and committed states. All belong to P1.
