# Web CMS: finance

> Status: **Draft** · Updated: 2026-11-01 (DR-325, DR-326, DR-329: online payment is in P2; `W-Transactions`, `W-Money-Log` and `UnitMoneyPanel` written; `W-Fee-Record` and `W-Fee-Notice` follow Stripe) · 2026-11-01 (P1-27: the nine P2 screens `W-Fees`, `W-Fee-Import`, `W-Fee-Batch`, `W-Fee-Notice`, `W-Fee-Record`, `W-Fee-Recall`, `W-Charge-Void`, `W-Fee-Reissue`, `W-Debts` written; the P3 and P6 screens are owed; DR-324) · DOC-66
> Depends on: original SDD §5, §18, [DR](../../00-decision-register.md) (DR-09, 11, 18, 19, 20, 22, 23, 24, 72, 84, 97, 194, 196, 265, 267, 293, 304, 306, 324, 325, 326, 327, 329), [DOC-56](README.md) (convention, notes N4, N5, N6, N12), [DOC-53](../ux-principles-and-ia.md), [DOC-54](../design-system.md) §17 (the web quality bar), [DOC-55](../client-architecture.md) §12, [DOC-21](../../06-design/fee-batches-and-import.md), [DOC-22](../../06-design/ledger-and-allocation.md), [DOC-18](../../05-data/data-quality-rules.md) §2, [DOC-34](../../06-design/pdf-rendering.md) §6, §9, [DOC-23](../../06-design/payment-intents-and-settlement.md), [DOC-24](../../06-design/payment-gateway-drivers.md), [DOC-51](../../07-api/api-endpoints.md) (E-71…E-74, E-89…E-106, E-169…E-172, E-176, E-177), [DOC-65](web-residents.md) (`W-Unit-Detail` debt card), [DOC-58](resident-fees-payment.md) (what the resident sees)
> Main readers: P2-16 (the fee screens), P2-15 (the finance API), P2-13 (the PDF screens), P2-04 (fee import), P3 and P6 writers of this file, P1-09 (catalog keys), DOC-68, DOC-88 (`UIWF-`)

This document specifies the web screens of the finance group that a Manager or Admin uses to bill and to collect: the list of fee batches, the Excel import, the draft editor and the published batch, the notice preview, the unit's debt with manual payment, the recall, the void of one charge, the re-issue, and the debt list. **Written now (P2): twelve screens** (the nine of fees and debts, and `W-Transactions`, `W-Money-Log`, `UnitMoneyPanel`, which moved from P3 with the online payment, DR-325). `W-Statement` is P3; `W-Reports` and `W-Export-Center` are P6; they are listed at the end and written when their phase starts (master plan §3.2). The visual source of truth is the canvas (<https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj>, design system "Hiên"); this file adds data, interactions, states, copy keys and acceptance criteria (DR-194).

## Screens in this file

| Section | Screen | Role | Phase | Prototype | Route |
| --- | --- | --- | --- | --- | --- |
| `W-Fees` | Fee batches: code, status, units, total, collected | Admin, Manager | P2 | designed | `/fees` |
| `W-Fee-Import` | Create a batch and import its lines from Excel | Admin, Manager | P2 | designed (step 2) | `/fees/import` |
| `W-Fee-Batch` | One batch: the draft editor, or a published batch with its actions | Admin, Manager | P2 | designed (the draft) | `/fees/$batchId` |
| `W-Fee-Notice` | The fee notice, VI/EN/both, one unit or all | Admin, Manager | P2 | designed | `/fees/$batchId/notice` |
| `W-Fee-Record` | A unit's debt, manual payment, receipts | Admin, Manager | P2 | designed | `/debts/$unitId` |
| `W-Fee-Recall` | Recall a published batch, with the 409 result | Admin, Manager | P2 | to design | dialog of `W-Fee-Batch` |
| `W-Charge-Void` | Void one open charge | Admin, Manager | P2 | to design | dialog |
| `W-Fee-Reissue` | Re-issue a recalled batch as a new draft | Admin, Manager | P2 | to design | dialog |
| `W-Debts` | Debt per unit, aging, push reminders | Admin, Manager | P2 | designed | `/debts` |
| `W-Transactions` | Online payments (intents), re-query, cancel | Admin, Manager | P2 | designed | `/transactions` |
| `W-Money-Log` | Money to check: unposted confirmations, refunds, disputes | Admin, Manager | P2 | to design | tab `/transactions?tab=log` |
| `UnitMoneyPanel` | The log rows of one unit | Admin, Manager | P2 | to design | component |
| `W-Statement` | Bank-statement reconciliation | Admin, Manager | P3 | — | owed |
| `W-Reports`, `W-Export-Center` | Reports and exports | Admin, Manager | P6 | — | owed |

**What every screen here shares.**

- **Roles.** The route guard admits `admin` and `manager` (`staff(...roles)`, DOC-12 §5.3); a Technician or Guard is redirected to the dashboard, and the sidebar group "Tài chính" is not drawn for them. Each use case exports its `<OPERATION>_ROLES` and the screen reads the same constant for its guard (DR-254).
- **Sidebar.** Group "Tài chính": "Đợt phí" (`/fees`), "Công nợ" (`/debts`), "Giao dịch online" (`/transactions`), "Báo cáo" (P6). A draft and the unit pages are reached from inside.
- **Quality bar** (DOC-54 §17, DR-304, DR-306). Nothing jumps when data arrives: tables keep their header and their column widths and fill with row-shaped skeletons (`SkeletonRows`), a new filter or page keeps the previous rows (`keepPreviousData`, `DataTable busy`); an indicator waits 150 ms and then stays 300 to 400 ms (`useDelayedFlag`); every overlay animates in and out (`useExit` for a dialog a search param unmounts); a button that sends is disabled at once and shows its spinner after 150 ms. The checks Q1…Q8 run at `DEV_LATENCY_MS` 400 and 0. This file does not restate them per screen; it names the places they matter.
- **Forms** follow §17.9: example placeholders, `required` asterisks, units as `suffix` ("đ", "m³"), growing text areas, rule-code error sentences from the API under the field.
- **Money** is `2.838.000 đ` (vi) or `2,838,000 đ` (en), in tabular numerals, right-aligned; a negative adjustment is `−35.175 đ`. Dates `dd/MM/yyyy` in building time (DR-09). Codes in a `Plate`: `PH-2610-01` batch, `BL-2610-0153` receipt (N4).
- **Concurrency.** A write carries `If-Match: "<version>"` read from the last response; a 409 `version_conflict` shows the fresh object and the two choices of DR-310 ("Xem bản mới nhất" / "Ghi đè bằng thay đổi của tôi" only where DOC-21 allows an overwrite; a money action never offers an overwrite).

---

## W-Fees

> Status: Draft · Prototype: designed · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1 Admin, PS-2 Manager. UC-01 (publish a fee batch), UC-04 (recall), FR-03, FR-04, FR-44. `admin`, `manager`.

### 2. URL and search params

`/fees`. Search: `status` (`all` default, `draft`, `published`, `closed`, `recalled`), `month` (`YYYY-MM` or empty), `q` (a code or a name fragment), `cursor` (kept in a stack for "back", not in the URL).

### 3. Prototype

Artboard `W-Fees` (title "BQL: Đợt phí", 1440 × 940): shell with the sidebar group "Tài chính", entry "Đợt phí" active; page header (h1 "Đợt phí", the muted line "Không có kỳ cố định, mỗi đợt gắn nhãn phí của tháng nào", buttons "Tải file mẫu" and "Nhập đợt phí" with a plus); a row with `Tabs` (Tất cả, Nháp 1, Đã phát hành 2, Đã đóng), a `SearchField` "Tìm theo mã hoặc tên đợt" and a month `SelectField` ("Mọi tháng"); a table (Mã đợt in a `Plate`, Tên đợt with the fee-month line, Trạng thái `Tag`, Số căn, Tổng tiền, Đã thu with a progress bar and the amount, Hạn thanh toán, Người tạo, a caret); a footer "1–7 trên 7 đợt phí" with two arrows.

Do not copy:

- The tabs: N5 adds **Thu hồi** (`recalled`) and the sample counts are data. "Đã đóng" is the Manager's manual freeze for reporting; its charges stay payable (DR-20).
- The "Đã thu" bar for a **recalled** batch: its charges are void, so the cell shows "—".
- The sample names ("đợt 2: Bảo dưỡng hệ thống PCCC") and the creators: data.
- The tab counts as shown: each count is the number of batches in that status for the whole building, independent of the other filters.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | `PageHeader` h1, muted line; `Button` outline "Tải file mẫu" (E-71 `fee_batch`), `Button` primary with `plus` "Nhập đợt phí" | always |
| Filters | `Tabs` (with counts), `SearchField` (debounced 300 ms), `SelectField` "Mọi tháng" listing the fee months that have a batch | |
| Table | `DataTable`: columns `code` (`Plate`), `name` (+ "Phí của tháng {m}/{y}"), `status` (`Tag` tones: draft neutral, published info, closed success, recalled warning), `units`, `total`, `collected` (bar + percent + amount), `due`, `createdBy`, caret; row click opens `W-Fee-Batch` | `loading`, `loaded`, `empty`, `busy` |
| Footer | range text and previous/next (`IconButton`) over a cursor stack | |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Batches | E-89 `GET /staff/fee-batches?status&month&q&limit=20&cursor` | `['staff','fee-batches',{status,month,q},cursor]` | newest fee month first, then code descending; each item: `id`, `code`, `name {vi,en}`, `feeMonth`, `status`, `unitCount`, `total`, `collected` (Σ `paid` charges), `collectedRate`, `dueDate`, `createdBy {id,name}`, `version`; `counts {draft,published,closed,recalled}` and `totalCount` come with the first page |
| Template | E-71 `GET /staff/imports/templates/fee_batch` | a download | saved as a file, headers in the staff member's language |

`collected` and `collectedRate` follow DOC-22 §8.1 (paid ÷ billed, void and draft excluded); a draft shows "Chưa phát hành". No polling; the list refetches on window focus after 30 s and after any write elsewhere that invalidates `['staff','fee-batches']`.

### 6. Interactions

| Action | Result |
| --- | --- |
| Tab, search, month | the search params change; the previous rows stay under the busy bar (§17.3) |
| Row | `/fees/$batchId` |
| "Nhập đợt phí" | `/fees/import` |
| "Tải file mẫu" | E-71, file saved; 403/404 → the generic error toast |
| Previous / next | the cursor stack |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | the real header; rows as skeletons under fixed widths; the tab counts show a 2-digit placeholder |
| `empty` (no batch at all) | `EmptyState` "Chưa có đợt phí nào" with the primary action "Nhập đợt phí" |
| `empty` (filters match nothing) | "Không có đợt phí khớp bộ lọc" with "Xóa bộ lọc" |
| `error` | the generic error `Banner` with a retry; the last rows stay |
| `forbidden` | a role without access never reaches the route (redirect); a 403 shows DOC-68 forbidden |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fees.title` | Đợt phí | Fee batches |
| `web.fees.subtitle` | Không có kỳ cố định, mỗi đợt gắn nhãn phí của tháng nào | There is no fixed cycle; each batch is tagged with the month its fees belong to |
| `web.fees.action.template` | Tải file mẫu | Download the template |
| `web.fees.action.import` | Nhập đợt phí | Import a batch |
| `web.fees.tabs.label` | Trạng thái đợt phí | Batch status |
| `web.fees.tab.all` / `.draft` / `.published` / `.closed` / `.recalled` | Tất cả / Nháp / Đã phát hành / Đã đóng / Đã thu hồi | All / Draft / Published / Closed / Recalled |
| `web.fees.search` | Tìm theo mã hoặc tên đợt | Search by code or name |
| `web.fees.month.all` | Mọi tháng | Any month |
| `web.fees.col.code` … `.createdBy` | Mã đợt, Tên đợt, Trạng thái, Số căn, Tổng tiền, Đã thu, Hạn thanh toán, Người tạo | Code, Name, Status, Units, Total, Collected, Due date, Created by |
| `web.fees.row.month` | Phí của tháng {month}/{year} | Fees for {month}/{year} |
| `web.fees.row.unissued` | Chưa phát hành | Not published |
| `web.fees.footer` | {from}–{to} trên {total} đợt phí | {from}–{to} of {total} batches |
| `web.fees.empty.title` | Chưa có đợt phí nào | No fee batches yet |
| `web.fees.empty.filtered` | Không có đợt phí khớp bộ lọc | No batch matches the filters |
| `web.fees.filter.clear` | Xóa bộ lọc | Clear filters |
| `status.fee-batch.draft` … `.recalled` | Nháp, Đã phát hành, Đã đóng, Đã thu hồi | Draft, Published, Closed, Recalled |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-01 | **G** batches in all four statuses **W** `/fees` opens **T** the five tabs show their counts, "Tất cả" lists newest fee month first, and a recalled batch has a warning `Tag` and "—" in "Đã thu" | web-e2e |
| UIWF-02 | **G** a published batch of 240 charges with 168 paid **W** its row renders **T** "Đã thu" shows 70 % and the amount of the paid charges | api, web-e2e |
| UIWF-03 | **G** the filter changes **W** the new page loads at 400 ms **T** the old rows stay dimmed under the bar and the header does not move (Q1…Q8) | web-e2e |
| UIWF-04 | **G** a Technician **W** `/fees` is opened **T** the app redirects to the dashboard and the sidebar has no "Tài chính" group | web-e2e |
| UIWF-05 | **G** no batch exists **W** the page opens **T** the empty state offers "Nhập đợt phí" | web-e2e |

### 10. E2E cases

Playwright: `fees-list.spec.ts` (UIWF-01, 03, 05), `fees-guard.spec.ts` (UIWF-04). UIWF-02 is an API test of E-89 with one assertion.

### 11. Open questions

None.

---

## W-Fee-Import

> Status: Draft · Prototype: designed (step 2; the settings card is partly drawn) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-01 steps 1 to 4, FR-01 (every invalid row reported, valid rows saved, limits, saving twice saves once, stale job), FR-02.1 (a re-import overwrites the draft), FR-03.4 (the code). Data rules DOC-18 §2; flow DOC-21 §4.

### 2. URL and search params

`/fees/import`. Search: `batchId` (import into an existing **draft**: the settings are read from it and the fee month is locked, DR-265), `importId` (reopen a job through E-73 after a reload, DR-21).

### 3. Prototype

Artboard `W-Fee-Import` (title "BQL: Nhập đợt phí từ Excel", 1440 wide) shows step 2: h1 "Nhập đợt phí từ Excel", the line "Bước 2 trên 2, kiểm tra trước khi lưu. Chỉ dòng hợp lệ được lưu vào đợt nháp." and buttons "Nhập lại file" and "Lưu nháp 236 dòng"; a card "Cài đặt đợt" (Tên đợt "Phí tháng 9/2026, đợt 3: Nước bổ sung", Phí của tháng 9/2026, Hạn thanh toán 20/10/2026); a card "File đã tải lên" (file name, "240 dòng, 46 KB, tải lên 16:38, 08/10/2026", the template note, "Tải file mẫu") with the sentence about re-importing; four stat tiles (240 dòng trong file, 236 dòng hợp lệ, 4 dòng lỗi, 18.420.000 đ tổng); "Xem trước dòng hợp lệ" (5 of 236 rows: Dòng, Căn, Tên khoản, Tháng, Số lượng, Đơn giá, Thành tiền, with a note under the item); "Lỗi theo dòng" (4 messages with "Dòng 33, A-0408"); "Lịch sử nhập file" (file, who, time, batch code, result).

Do not copy:

- The error texts of the artboard ("Thành tiền 72.000 khác số lượng × đơn giá 60.000", "Mã căn A-3001 không tồn tại", "Đơn giá để trống", "Tháng áp dụng 08/2026 khác tháng của đợt 9/2026"): the messages shown are the `message` of each issue from the API, in the request language, and they are the texts of DOC-18 §2.2 (`amount_mismatch`, `unit_not_found`, `unit_price_invalid`, `fee_month_mismatch`). A blank unit price is **valid** when the amount is given (DQ-72): "Đơn giá để trống" is not an error.
- "Thành tiền 72.000 khác số lượng × đơn giá 60.000": a mismatch is reported with the expected product, never recomputed silently (FR-01.5).
- The sample file name, the sizes, the times and the creators: data.
- The unit of measure in the quantity cell ("3 m³"): the file has none (DR-13); the cell shows the number.
- "Bước 2 trên 2": the page has **three** steps (Cài đặt và chọn file, Kiểm tra, Lưu), as `W-Import`; step 1 is the settings and the file together.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Step bar | the three-step indicator of `W-Import` | `idle`, `uploading`, `validating`, `validated`, `failed`, `expired`, `committing`, `committed` |
| Settings card (step 1) | `Form`: name `vi` (required, default "Phí tháng {m}/{y}"), name `en` (collapsed "Thêm tên tiếng Anh", default "{Month} {y} fees"), fee month (`MonthField`, required, locked when `batchId` is set), due date (`DateField`, required, default today + the building's `defaultDueDays`) | `idle` |
| File picker | drop zone, rules line "Tệp .xlsx, tối đa 5 MB và 5.000 dòng", link "Tải file mẫu" | `idle`, `uploading` |
| File card | name, rows, size, time, "Nhập lại file" | steps 2, 3 |
| Count tiles | four tiles: rows, valid, errors (`danger` ink when > 0), total of the valid rows | `validated` |
| Valid rows | collapsed "Xem trước {n} dòng hợp lệ đầu tiên" (≤ 50 rows) | `validated` |
| Errors | table "Lỗi theo dòng" (≤ 500, errors first, `issuesTruncated` note), warning list collapsed | `validated`, `failed` |
| Recent imports | `Card` "Lịch sử nhập file" over E-169 `kind=fee_batch` | step 1 |
| Action bar | `Button` ghost "Hủy", outline "Tải danh sách lỗi", primary with `check` "Lưu nháp {n} dòng" | `validated` |
| Result | `Card` with the counts and the buttons "Mở đợt nháp" (`/fees/$batchId`) and "Nhập file khác" | `committed` |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Settings of an existing draft | E-91 `GET /staff/fee-batches/{id}` | `['staff','fee-batches',batchId]` | only with `batchId`; a batch that is not a draft is 409 on the import, so the page shows the danger banner and a link to the batch |
| Template | E-71 `fee_batch` | download | |
| Job | E-73 `GET /staff/imports/{id}` | `['staff','imports',importId]` | `kind = fee_batch`; `status` `validated`, `failed`, `committed`, `expired` |
| Recent imports | E-169 `GET /staff/imports?kind=fee_batch&limit=10` | `['staff','imports','list','fee_batch']` | step 1 only; kept 30 days |
| Default due days | `['building','settings']` (E-47) | cached | `defaultDueDays` (10) |

Validation is synchronous (DR-21); there is no polling.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Pick a file | none (extension `.xlsx`, ≤ 5 MB) | the form enables "Kiểm tra" | "Chỉ nhận tệp Excel .xlsx." / "Tệp vượt quá 5 MB." |
| "Kiểm tra" (new batch) | E-36 upload → PUT → E-37 verify; then **E-90 `POST /staff/fee-batches`** (`Idempotency-Key`) with the settings; then E-72 `POST /staff/imports {kind:"fee_batch", fileId, batchId}` (`Idempotency-Key`, timeout 30 s) | `batchId` and `importId` go into the URL; the preview shows (≤ 10 s for 2,000 rows, NFR-12) | 400 `validation_failed` on `dueDate`, `feeMonth` (not the first of a month), `name`; 400 `too_many_rows` → "Tệp có hơn 5.000 dòng. Hãy tách thành nhiều tệp."; 409 `invalid_transition` (batch not a draft) → banner; a file-layer failure is a job with `status: "failed"` and one `fail` issue (`import_missing_column`, `import_no_price`, …), not an error |
| "Kiểm tra" (existing draft) | the same without E-90 | the preview | as above |
| "Lưu nháp {n} dòng" | E-74 `POST /staff/imports/{id}/commit` (no body, no key) | step 3 with `created`, `replaced`; the batch `version` rose | 409 `import_expired` → "Bản kiểm tra đã hết hạn. Hãy tải tệp lên lại."; 409 `import_stale` → "Dữ liệu đã thay đổi từ lúc kiểm tra. Hãy tải tệp lên lại."; 409 `import_not_ready`; 409 `invalid_transition` (the batch was published or discarded meanwhile) → "Đợt phí không còn là bản nháp." with a link; 500 `import_integrity` → generic error with the request id |
| "Nhập lại file" / "Hủy" | none | back to step 1 with the settings kept; an unsaved job expires in 24 h | |
| "Tải danh sách lỗi" | none (built in the browser) | CSV `fee-import-errors-<importId>.csv` (row, unit code, column, severity, message), UTF-8 with BOM | when `issuesTruncated` the file holds the first 500 |
| "Mở" on a recent import | none | `importId` into the URL | 404 → generic error |

**What saving costs.** The commit replaces **all** charges of the draft, including those added by hand (FR-02.1, DOC-21 §4.5). When the draft already has charges the action bar adds a warning line before the press: "Đợt này đã có {n} khoản phí. Lưu sẽ thay thế toàn bộ." Only valid rows are saved; the banner says how many rows are skipped (FR-01.1).

**A draft nobody saved.** "Kiểm tra" creates the draft first (the code is consumed, DOC-21 §3.1). A Manager who leaves after the preview keeps an empty draft with no charges in `W-Fees` (tab "Nháp"), and discards it from `W-Fee-Batch`. This is the price of a code decided before the lines (DR-324).

### 7. States

| State | Screen |
| --- | --- |
| `idle` | Step 1: settings and drop zone |
| `uploading` | Progress with the file name and "Hủy" |
| `validating` | "Đang kiểm tra {fileName}…" and a skeleton of the tiles; after 10 s "Việc này lâu hơn bình thường, vui lòng chờ."; after 30 s a retry with the same key |
| `validated` with errors | Tiles, "Lỗi theo dòng", warning `Banner`, action bar |
| `validated` without errors | Tiles, "Không có dòng lỗi.", action bar |
| `failed` | Danger `Banner` with the issue message (a missing column names the column), "Nhập lại file" only |
| `expired` | Danger `Banner` and "Nhập lại file"; the counts stay readable |
| `committed` | Step 3: "Đã lưu {created} khoản phí cho {units} căn" (+ "Đã thay thế {replaced} khoản cũ" when > 0) and the buttons |
| Recent imports `loading`/`empty`/`error` | skeleton rows; "Chưa có lần nhập nào trong 30 ngày qua."; the generic error with a retry |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-import.title` | Nhập đợt phí từ Excel | Import a fee batch from Excel |
| `web.fee-import.subtitle` | Kiểm tra từng dòng trước khi lưu vào đợt nháp. Chỉ dòng hợp lệ được lưu. | Check every row before saving to the draft. Only valid rows are saved. |
| `web.fee-import.step.settings` / `.check` / `.save` | Cài đặt và chọn file / Kiểm tra / Lưu | Settings and file / Check / Save |
| `web.fee-import.settings.title` | Cài đặt đợt | Batch settings |
| `web.fee-import.field.name` | Tên đợt | Batch name |
| `web.fee-import.field.name.placeholder` | Phí tháng 10/2026 | October 2026 fees |
| `web.fee-import.field.name-en` | Tên tiếng Anh (không bắt buộc) | English name (optional) |
| `web.fee-import.field.month` | Phí của tháng | Fee month |
| `web.fee-import.field.month.locked` | Tháng phí không đổi được sau khi tạo đợt. Muốn đổi, hãy xóa bản nháp và tạo đợt mới. | The fee month cannot change once the batch exists. To change it, discard the draft and create a new one. |
| `web.fee-import.field.due` | Hạn thanh toán | Due date |
| `web.fee-import.dropzone.rules` | Tệp .xlsx, tối đa 5 MB và 5.000 dòng. Cột đơn giá hoặc thành tiền phải có ít nhất một. | .xlsx file, up to 5 MB and 5,000 rows. The file needs a unit price or an amount column. |
| `web.fee-import.cta.check` | Kiểm tra | Check |
| `web.fee-import.cta.save` | Lưu nháp {count} dòng | Save {count} rows to the draft |
| `web.fee-import.replace-warning` | Đợt này đã có {count} khoản phí. Lưu sẽ thay thế toàn bộ, kể cả khoản thêm bằng tay. | This batch already has {count} charges. Saving replaces all of them, including ones added by hand. |
| `web.fee-import.count.rows` / `.valid` / `.errors` / `.total` | Dòng trong file / Dòng hợp lệ / Dòng lỗi, không được lưu / Tổng tiền các dòng hợp lệ | Rows in the file / Valid rows / Rows with errors, not saved / Total of the valid rows |
| `web.fee-import.errors.title` | Lỗi theo dòng | Errors by row |
| `web.fee-import.errors.where` | Dòng {row}, {unit} | Row {row}, {unit} |
| `web.fee-import.errors.hint` | Sửa trong file rồi nhập lại, hoặc lưu nháp rồi thêm khoản bằng tay cho các căn này trong đợt. | Fix them in the file and import again, or save the draft and add the charges by hand. |
| `web.fee-import.done` | Đã lưu {charges} khoản phí cho {units} căn. | Saved {charges} charges for {units} units. |
| `web.fee-import.done.replaced` | Đã thay thế {replaced} khoản cũ. | Replaced {replaced} earlier charges. |
| `web.fee-import.not-draft` | Đợt phí không còn là bản nháp. | The batch is no longer a draft. |
| `web.fee-import.history.title` | Lịch sử nhập file | Import history |

The error messages and the file-level messages are the catalog entries of DOC-18 §2.2, not keys of this file.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-06 | **G** the 240-row file of FR-01.1 (rows 12, 57, 58, 201 wrong) **W** "Kiểm tra" runs **T** E-90 then E-72 are sent once, the tiles read 240 / 236 / 4 / the total, and the four errors name their row, unit and column with the texts of DOC-18 §2.2 | api, web-e2e |
| UIWF-07 | **G** a double click on "Kiểm tra" **W** two requests are made with the same keys **T** one batch exists and one code `PH-yymm-nn` is consumed | api, web-e2e |
| UIWF-08 | **G** a file without a "Tháng phí" column **W** it is checked **T** the job is `failed`, the banner names the column, and no save button exists | api, web-e2e |
| UIWF-09 | **G** a draft with 12 hand-added charges **W** a file with 200 valid rows is saved **T** the warning line showed first, the draft then holds exactly 200 charges, and the 12 are gone | api, web-e2e |
| UIWF-10 | **G** a job older than 24 h **W** "Lưu nháp" is pressed **T** 409 `import_expired` shows the danger banner and nothing is saved | api, web-e2e |
| UIWF-11 | **G** the batch is published in another tab **W** "Lưu nháp" is pressed **T** 409 `invalid_transition` shows "Đợt phí không còn là bản nháp." with a link to the batch | api, web-e2e |
| UIWF-12 | **G** 600 errors **W** the preview shows **T** 500 are listed, the note says so, the tile still reads 600 and "Tải danh sách lỗi" holds 500 rows | api, web-e2e |
| UIWF-13 | **G** `?batchId=` of a draft **W** the page opens **T** the settings are filled from the batch and the fee month cannot be edited | web-e2e |
| UIWF-14 | **G** the same file saved twice (two tabs) **W** both press "Lưu nháp" **T** one commit happens and the second tab shows the first result | api, web-e2e |

### 10. E2E cases

Playwright: `fee-import.spec.ts` (UIWF-06, 07, 08, 12, 13), `fee-import-commit.spec.ts` (UIWF-09, 10, 11, 14). All use the generated files of DOC-21 §9 (IM-50…77).

### 11. Open questions

None.

---

## W-Fee-Batch

> Status: Draft · Prototype: designed (the draft; the published view is to design) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-01 (edit and publish), UC-04 (extend, close, recall, re-issue), FR-02, FR-03, FR-04, FR-36.4, FR-44, FR-49. `admin`, `manager`.

### 2. URL and search params

`/fees/$batchId`. Search: `view` (`all` default, `missing` for units without a charge), `q` (a unit code or an owner name), `unit` (a unit whose lines are open for editing), `dialog` (`recall`, `void`, `reissue`, `extend`, `publish`, `discard`, `close`) with `charge` for `void`, `cursor`.

### 3. Prototype

Artboard `W-Fee-Batch` (title "BQL: Đợt phí nháp", 1440 wide) draws a **draft**: breadcrumb; the batch header (a `Plate` "PH-2609-03", a `Tag` "Nháp", the name, the line "Phí của tháng 9/2026, hạn 20/10/2026, nhập từ file lúc 16:42, 08/10/2026"); buttons "Xuất PDF hàng loạt", "Xem mẫu thông báo", primary "Phát hành đợt phí"; a warning `Banner` "Còn 4 căn chưa có khoản phí do lỗi file. Thêm bằng tay hoặc nhập lại trước khi phát hành." with "Lọc 4 căn này"; a row with `Tabs` (Tất cả căn, Chưa có khoản phí 4 căn) and a `SearchField`; a table (Căn, Chủ hộ, Số khoản, Tổng, edit and delete buttons) in which one row (A-1508) is **open**: a sub-table of its lines (Tên khoản, Số lượng, Đơn giá, Thành tiền, delete), a button "Thêm khoản" and "Hủy" and "Lưu căn A-1508"; the footer "6–10 trên 10 căn khớp "A-15"" and a total bar "Tổng đợt: 236 căn có khoản phí, 4 căn chưa có | 237 | 18.420.000 đ".

Do not copy:

- "Xuất PDF hàng loạt" on a **draft**: the bulk request is 409 `invalid_transition` for a draft (DOC-34 §6.3). On a draft the screen offers "Xem mẫu thông báo" only (one unit at a time, with the draft mark); the bulk button appears when the batch is `published` or `closed`.
- The footer count "237": a count of lines, not of units; the bar says "{units} căn có khoản phí, {missing} căn chưa có" and "{lines} khoản, {total}".
- The "Chủ hộ" of a unit with no owner: such a unit is not chargeable (`unit_without_owner`, DQ-78); it is not listed under "Chưa có khoản phí".
- Editing the **name or the fee month** inline: the name and the due date are edited in the header (a pencil opens a small form); the fee month is read-only (DR-265).
- The published view is not drawn. It is specified here from DOC-21: the same header and table, read-only, with the actions of §6.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | `Plate` code, status `Tag`, name (bilingual, shown in the UI language), muted line "Phí của tháng {m}/{y}, hạn {date}, {source}"; a pencil `IconButton` (draft: name and due date) | by status |
| Header actions | by status (see the table below) | |
| Banner | warning for `missing > 0` in a draft (with "Lọc {n} căn này"); info for `recalled` ("Đợt này đã thu hồi. {n} khoản đã hủy.") with the link to the replacement batch (`replacedBy`) and to the original (`replaces`); info for `closed` ("Đợt đã đóng chỉ để báo cáo. Các khoản chưa thu vẫn thanh toán được.") | |
| Filters | `Tabs` "Tất cả căn" / "Chưa có khoản phí {n}" (draft only), `SearchField` | |
| Table | `DataTable` of charges: unit, owner, lines count, total, **status** (published views: `open`, `paid`, `void` with `void_kind`), row actions; an open row expands in place (draft) | `loading`, `loaded`, `empty`, `busy` |
| Line editor | rows of `TextField` name (vi, with the English name under a "EN" toggle), `NumberField` quantity (suffix none, 3 decimals), `NumberField` unit price (suffix "đ"), amount (read-only, computed half-up, DR-11), a `kind` select (Phí / Điều chỉnh) and, for an adjustment, a required note; delete `IconButton`; "Thêm khoản" | `idle`, `dirty`, `saving`, `conflict` |
| Add a charge | for the tab "Chưa có khoản phí", each row has "Thêm khoản phí" which opens the same editor on a new charge | |
| Totals bar | "{units} căn có khoản phí, {missing} căn chưa có", "{lines} khoản", the total | |

**Header actions by status** (all with `If-Match` on the batch `version`):

| Status | Buttons | Endpoint |
| --- | --- | --- |
| `draft` | "Nhập lại file" (`/fees/import?batchId=`), "Xem mẫu thông báo" (`W-Fee-Notice`), **primary "Phát hành đợt phí"**, a `⋯` menu with "Xóa bản nháp" | E-95, E-172 |
| `published` | "Xuất PDF hàng loạt" (`W-Fee-Notice`), "Gia hạn", "Đóng đợt", `⋯` menu with **"Thu hồi đợt"** (opens `W-Fee-Recall`) | E-99, E-92, E-97, E-96 |
| `closed` | "Xuất PDF hàng loạt" only | E-99 |
| `recalled` | **"Phát hành lại"** (opens `W-Fee-Reissue`) and nothing else | E-98 |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The batch | E-91 `GET /staff/fee-batches/{id}` | `['staff','fee-batches',batchId]` | `id`, `code`, `name`, `feeMonth`, `dueDate`, `status`, `version`, `createdBy`, `publishedAt`, `replaces {id,code}`, `replacedBy {id,code}[]`, `counts {charges, lines, open, paid, void, missing}`, `total`, `source {importedAt}`. `missing` is the number of units with an active owner and no charge in this batch (`ownedUnitCount − chargedUnitCount`, DR-324); only a draft shows it |
| The charges | E-93 `GET /staff/fee-batches/{id}/charges?view&q&limit=50&cursor` | `['staff','fee-batches',batchId,'charges',{view,q},cursor]` | each: `chargeId`, `unitId`, `unitCode`, `ownerName`, `amount`, `status`, `voidKind`, `version`, `lineCount`, and `lines[]` when the row is open; `view=missing` returns `{unitId, unitCode, ownerName}` for chargeable units without a charge (keyset on unit code) |
| The lines of one charge | E-93 item with `include=lines` | inside the row's cache entry | read when the row opens |

The draft keeps no polling. A published batch refetches `counts` and the visible page every 30 s while the tab is focused, because payments arrive (a charge turns `paid`); the refetch uses `keepPreviousData` and never moves a row under the cursor.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Open a row (draft) | E-93 `include=lines` | the row expands; `unit` in the URL | |
| Edit the lines, "Lưu căn {unit}" | E-94 `PUT /staff/charges/{id}` `{lines}` with `If-Match` (charge `version`) | the row collapses; the totals refetch; the batch `version` rose | 409 `version_conflict` → the conflict panel of DR-310 with the fresh lines ("Xem bản mới nhất" / "Ghi đè bằng thay đổi của tôi"); 422 `charge_total_zero` → "Tổng các khoản phải lớn hơn 0." under the table; 400 on a line (`quantity_invalid`, `unit_price_invalid`, `amount_invalid`, `amount_mismatch`, `adjustment_note_required`, `note_too_long`, `item_name_invalid`) → the rule-code sentence under the field, the texts of DOC-18 §2.2 |
| "Thêm khoản phí" for a unit | E-170 `POST /staff/fee-batches/{id}/charges` `{unitCode, lines}` | the row joins the table | 404 `unit_not_found`; 409 (a charge of the unit already exists) → "Căn này đã có khoản phí trong đợt."; `unit_without_owner` |
| Delete a charge (trash on the row) | E-171 `DELETE /staff/charges/{id}` with `If-Match`, after a confirm | the row leaves; `missing` rises | 409 `version_conflict` |
| Pencil in the header | E-92 `PATCH /staff/fee-batches/{id}` `{name?, dueDate?}` with `If-Match` | the header refreshes | 409 `version_conflict`; 400 `validation_failed` |
| **"Phát hành đợt phí"** | opens the publish dialog (below), then E-95 `POST …/publish` with `If-Match` | the page becomes the published view; a toast "Đã phát hành {code}. {units} căn nhận thông báo." | 400 `no_charges`, 400 `charge_total_zero` (lists the units, each a link), 400 `due_date_in_past` (focus the due date), 409 `version_conflict` (the draft changed: refetch and ask again), 409 `invalid_transition` (published by someone else: the page reloads as published) |
| "Xóa bản nháp" | confirm dialog, then E-172 `DELETE …` with `If-Match` | `/fees` with a toast; the code is not reused | 409 `version_conflict`; 409 `invalid_transition` (published) |
| "Gia hạn" (published) | dialog with a `DateField`; E-92 `PATCH {dueDate}` with `If-Match` | the header refreshes; residents are notified (`fee.batch_due_extended`) | 400 `due_date_not_later`; 409 `version_conflict` |
| "Đóng đợt" | confirm dialog; E-97 `POST …/close` with `If-Match` | status `closed`; no notification | 409 `invalid_transition` |
| "Thu hồi đợt" | `W-Fee-Recall` | | |
| "Hủy khoản này" on an `open` charge of a published batch | `W-Charge-Void` | | |
| "Phát hành lại" (recalled) | `W-Fee-Reissue` | | |
| "Xuất PDF hàng loạt" | `/fees/$batchId/notice` with the bulk panel focused | | |

**The publish dialog** (nothing is sent until "Phát hành"): "Phát hành {code}?" with the summary {units} căn, {lines} khoản, the total, the due date and the sentence "Cư dân của {units} căn sẽ nhận thông báo ngay. Sau khi phát hành, bạn chỉ có thể gia hạn, đóng hoặc thu hồi đợt." It shows the same checks the server will make as inline lines before the press: no charge, a charge total of 0 (with the units), a due date before today. The button is disabled with a reason while a check fails; the server stays the arbiter.

### 7. States

| State | Screen |
| --- | --- |
| `loading` | the header skeleton and the table header with row skeletons |
| `draft` | as §4; the banner for `missing` |
| `draft, editing` | one open row with its editor; leaving the row with unsaved lines asks "Bỏ thay đổi của căn {unit}?" |
| `published` | read-only table with the charge `status` column; banner none |
| `closed` | the info banner |
| `recalled` | the info banner; the table shows every charge `void` (`recall` or `single`) |
| `empty` (draft with no charges) | `EmptyState` "Đợt nháp chưa có khoản phí" with "Nhập lại file" and "Thêm khoản phí" |
| `error`, `forbidden`, `not found` | DOC-68; a discarded batch is 404 and the page says "Đợt phí không còn tồn tại." with a link to `/fees` |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-batch.breadcrumb` | Tài chính / Đợt phí / {code} | Finance / Fee batches / {code} |
| `web.fee-batch.meta` | Phí của tháng {month}/{year}, hạn {date} | Fees for {month}/{year}, due {date} |
| `web.fee-batch.meta.imported` | , nhập từ file lúc {time}, {date} | , imported from a file at {time}, {date} |
| `web.fee-batch.action.publish` | Phát hành đợt phí | Publish the batch |
| `web.fee-batch.action.preview` | Xem mẫu thông báo | Preview the notice |
| `web.fee-batch.action.bulk` | Xuất PDF hàng loạt | Export all as PDF |
| `web.fee-batch.action.reimport` | Nhập lại file | Import the file again |
| `web.fee-batch.action.discard` | Xóa bản nháp | Discard the draft |
| `web.fee-batch.action.extend` | Gia hạn | Extend the due date |
| `web.fee-batch.action.close` | Đóng đợt | Close the batch |
| `web.fee-batch.action.recall` | Thu hồi đợt | Recall the batch |
| `web.fee-batch.action.reissue` | Phát hành lại | Re-issue |
| `web.fee-batch.banner.missing` | Còn {count} căn chưa có khoản phí. Thêm bằng tay hoặc nhập lại trước khi phát hành. | {count} units have no charge yet. Add them by hand or import again before publishing. |
| `web.fee-batch.banner.missing.filter` | Lọc {count} căn này | Show these {count} units |
| `web.fee-batch.banner.recalled` | Đợt này đã thu hồi. {count} khoản đã hủy. | This batch was recalled. {count} charges were voided. |
| `web.fee-batch.banner.recalled.replaced` | Đã phát hành lại thành {code}. | Re-issued as {code}. |
| `web.fee-batch.banner.closed` | Đợt đã đóng chỉ để báo cáo. Các khoản chưa thu vẫn thanh toán được. | A closed batch is for reporting only. Unpaid charges can still be paid. |
| `web.fee-batch.tab.all` / `.missing` | Tất cả căn / Chưa có khoản phí | All units / No charge yet |
| `web.fee-batch.search` | Tìm theo mã căn hoặc chủ hộ | Search by unit or owner |
| `web.fee-batch.col.unit` … | Căn, Chủ hộ, Số khoản, Tổng, Trạng thái, Thao tác | Unit, Owner, Lines, Total, Status, Actions |
| `web.fee-batch.line.name` / `.qty` / `.price` / `.amount` / `.kind` / `.note` | Tên khoản / Số lượng / Đơn giá / Thành tiền / Loại / Lý do | Item / Quantity / Unit price / Amount / Kind / Reason |
| `web.fee-batch.line.add` | Thêm khoản | Add a line |
| `web.fee-batch.charge.save` | Lưu căn {unit} | Save unit {unit} |
| `web.fee-batch.charge.add` | Thêm khoản phí | Add a charge |
| `web.fee-batch.charge.discard-changes` | Bỏ thay đổi của căn {unit}? | Discard changes to unit {unit}? |
| `web.fee-batch.totals` | {units} căn có khoản phí, {missing} căn chưa có | {units} units with charges, {missing} without |
| `web.fee-batch.totals.lines` | {lines} khoản · {total} | {lines} lines · {total} |
| `web.fee-batch.publish.title` | Phát hành {code}? | Publish {code}? |
| `web.fee-batch.publish.body` | Cư dân của {units} căn sẽ nhận thông báo ngay. Sau khi phát hành, bạn chỉ có thể gia hạn, đóng hoặc thu hồi đợt. | Residents of {units} units will be notified at once. After publishing you can only extend, close or recall the batch. |
| `web.fee-batch.publish.toast` | Đã phát hành {code}. {units} căn nhận thông báo. | Published {code}. {units} units notified. |
| `web.fee-batch.discard.title` | Xóa bản nháp {code}? | Discard draft {code}? |
| `web.fee-batch.discard.body` | Bản nháp và các khoản phí của nó sẽ bị xóa. Mã {code} không được dùng lại. | The draft and its charges are deleted. The code {code} is not used again. |
| `web.fee-batch.extend.title` | Gia hạn thanh toán | Extend the due date |
| `web.fee-batch.extend.field` | Hạn mới | New due date |
| `web.fee-batch.extend.hint` | Hạn mới phải sau hạn hiện tại ({date}). | The new date must be after the current one ({date}). |
| `web.fee-batch.close.title` | Đóng đợt {code}? | Close {code}? |
| `web.fee-batch.close.body` | Đóng đợt chỉ để báo cáo. Các khoản chưa thu vẫn thanh toán được và vẫn tính vào công nợ. | Closing is for reporting only. Unpaid charges can still be paid and still count as debt. |
| `web.fee-batch.empty.title` | Đợt nháp chưa có khoản phí | This draft has no charges yet |
| `web.fee-batch.gone` | Đợt phí không còn tồn tại. | This batch no longer exists. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-15 | **G** a draft of 236 charges and 4 units without one **W** it opens **T** the banner says 4 units, "Lọc 4 căn này" shows exactly those, and the totals bar reads 236 / 4 | api, web-e2e |
| UIWF-16 | **G** unit A-1508 with 2 lines **W** the row opens, a third line (4 × 12.000) is added and saved **T** E-94 is sent with the charge `If-Match`, the row total reads the sum, and the amount cell shows 48.000 đ computed half-up | api, web-e2e |
| UIWF-17 | **G** two Managers edit A-1508 **W** both save **T** the second gets 409 `version_conflict` and the panel shows the first's lines with the two choices | api, web-e2e |
| UIWF-18 | **G** a draft with a charge total of 0 **W** "Phát hành" is opened **T** the dialog lists the unit, the button is disabled, and a forced E-95 answers 400 `charge_total_zero` | api, web-e2e |
| UIWF-19 | **G** two Managers press "Phát hành" **W** both confirm **T** one publish happens, 240 charges are `open`, and the second sees 409 `invalid_transition` and the page reloads as published | api, web-e2e |
| UIWF-20 | **G** a draft **W** "Xóa bản nháp" is confirmed **T** the page leaves to `/fees`, and the next batch of that month gets the next code, not the discarded one | api, web-e2e |
| UIWF-21 | **G** a published batch **W** "Gia hạn" is set to an earlier date **T** the dialog says the date must be later and no request is sent; a later date is accepted and the header shows it | api, web-e2e |
| UIWF-22 | **G** a published batch **W** the page is inspected **T** the header offers "Xuất PDF hàng loạt", "Gia hạn", "Đóng đợt" and, in the menu, "Thu hồi đợt", and no editing control exists on any row | web-e2e |
| UIWF-23 | **G** a draft **W** the header is inspected **T** "Xuất PDF hàng loạt" is absent and "Xem mẫu thông báo" is present | web-e2e |
| UIWF-24 | **G** a payment is posted on a published batch while the page is open **W** 30 s pass **T** the charge turns `paid` in place and no row moves | web-e2e |
| UIWF-25 | **G** a closed batch **W** the page opens **T** the info banner shows, and an open charge can still be voided alone | web-e2e |

### 10. E2E cases

Playwright: `fee-batch-draft.spec.ts` (UIWF-15, 16, 17, 20, 23), `fee-batch-publish.spec.ts` (UIWF-18, 19), `fee-batch-published.spec.ts` (UIWF-21, 22, 24, 25).

### 11. Open questions

None.

---

## W-Fee-Notice

> Status: Draft · Prototype: designed · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-01 ("export the notices"), UC-25 (bulk PDF), FR-36. `admin`, `manager`.

### 2. URL and search params

`/fees/$batchId/notice`. Search: `unit` (the unit shown in the preview, default the first), `lang` (`vi`, `en`, `both`; default the building's `feeNoticeLanguage`).

### 3. Prototype

Artboard `W-Fee-Notice` (title "BQL: Mẫu thông báo phí", 1440 wide): h1 "Mẫu thông báo phí" with the line "Phí tháng 10/2026, đợt 1, phát hành 01/10/2026, 240 căn" and the buttons "Tải PDF căn này" and "Xuất PDF 240 căn"; a card "Tùy chọn xem" (a `SegmentedControl` "Ngôn ngữ thông báo phí": Tiếng Việt, English, Song ngữ; a `SelectField` "Căn xem thử" with "A-1508, Trần Minh Anh"; the note "Logo và thông tin công ty lấy từ Tòa nhà và cấu hình."); and the **A4 preview**: the company logo and name, address, hotline and e-mail, the title "Thông báo phí tháng 10/2026 / Fee notice for October 2026", a 2 × 2 block (Căn hộ, Chủ hộ, Đợt phí, Ngày phát hành), the table (Khoản phí / Item, Cách tính / Basis, Thành tiền / Amount), the total, the due date, "Hướng dẫn nộp phí / How to pay" with two numbered lines and the closing line.

Do not copy:

- The preview of a **draft** without the draft mark: DOC-34 §6.1 prints "BẢN NHÁP · DRAFT" diagonally on a draft's notice; the HTML preview shows the same mark.
- The unit of measure in "Cách tính" ("85 m² × 12.000 đ"): the basis is `quantity × unit price` (DR-13).
- The two "How to pay" lines as fixed text: the first ("pay in the app") appears only when the building's gateway is `active` (the app line no longer says QR: DR-325), the second only when the building has working hours (DOC-34 §6.1).
- "Xuất PDF 240 căn" as an immediate download: it starts a **job** (E-99) and the panel below shows its progress and the ZIP link.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | h1, muted line (fee month, issue date, unit count), `Button` outline "Tải PDF căn này", `Button` primary "Xuất PDF {n} căn" | by status |
| View options | `SegmentedControl` language, `SelectField` unit (searchable over the batch's charges, E-93), muted note with a link "Tòa nhà và cấu hình" (`/building`, Admin only) | |
| Preview | an A4-ratio `Card` rendering the notice in HTML: header, 2 × 2 block, `DataTable` lines, total, due date, "How to pay", closing line, the draft mark | `loading`, `loaded` |
| Bulk panel | a `Card` titled "Xuất hàng loạt" with the language, the status (`queued`, `running` with "{done} / {total} căn", `ready` with the ZIP link and size, `failed` with the error, `expired`), and the button | by job |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The batch | E-91 | `['staff','fee-batches',batchId]` | |
| The charge shown | E-93 `?q=<unit>&include=lines&limit=1` | `['staff','fee-batches',batchId,'charge',unit]` | the lines and the owner name; the preview is HTML built from E-91, E-93 and the building contact (E-15-like read of `building.company`) |
| Settings | `['building','settings']` | cached | `feeNoticeLanguage` |
| Bulk job | E-177 `GET /staff/fee-batches/{id}/pdf` | `['staff','fee-batches',batchId,'pdf']` | polled every 5 s while `queued` or `running` and the tab is visible, then stops; 404 means no job yet |

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Language, unit | none | the preview re-renders at once from the cached lines |
| "Tải PDF căn này" | E-176 `GET /staff/charges/{chargeId}/pdf?lang=` | the PDF is saved; for a draft it carries the draft mark; 409 `invalid_transition` (a charge voided alone, a recalled batch) → "Khoản phí này không còn hiệu lực." |
| "Xuất PDF {n} căn" | E-99 `POST /staff/fee-batches/{id}/pdf {language}` | 202 and the job shows `queued`; a repeat while one is active returns that job (no second job) | 409 `invalid_transition` (a draft or a recalled batch) → the button is disabled with the reason |
| ZIP link | the signed URL of E-177 (15 minutes) | the browser downloads `PH-2610-01-both.zip`; when `expired` a new request is offered |
| Leave the page | none | the job continues on the server; reopening shows its state |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | the card frames with skeleton lines in the preview's shape |
| `preview` | as §4; a draft shows the diagonal mark |
| Bulk `none` | the button "Xuất PDF {n} căn" |
| Bulk `queued`, `running` | a progress bar "{done} / {total} căn" and "Bạn có thể rời trang, việc xuất vẫn tiếp tục." |
| Bulk `ready` | "Sẵn sàng: {fileName}, {size}" and "Tải về"; "Liên kết có hiệu lực 15 phút" |
| Bulk `failed` | the danger `Banner` with the error (`all_units_failed`, `attempts_exhausted`) and "Thử lại" |
| Bulk `expired` | "Tệp đã hết hạn sau 7 ngày." and "Xuất lại" |
| `error`, `forbidden` | DOC-68 |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-notice.title` | Mẫu thông báo phí | Fee notice template |
| `web.fee-notice.subtitle` | {batch}, phát hành {date}, {units} căn | {batch}, issued {date}, {units} units |
| `web.fee-notice.subtitle.draft` | {batch}, bản nháp, {units} căn | {batch}, draft, {units} units |
| `web.fee-notice.action.one` | Tải PDF căn này | Download this unit's PDF |
| `web.fee-notice.action.bulk` | Xuất PDF {count} căn | Export {count} units as PDF |
| `web.fee-notice.options.title` | Tùy chọn xem | View options |
| `web.fee-notice.lang.label` | Ngôn ngữ thông báo phí | Fee notice language |
| `web.fee-notice.lang.vi` / `.en` / `.both` | Tiếng Việt / English / Song ngữ | Vietnamese / English / Both |
| `web.fee-notice.unit` | Căn xem thử | Unit to preview |
| `web.fee-notice.note` | Logo và thông tin công ty lấy từ Tòa nhà và cấu hình. | The logo and company details come from the building and its settings. |
| `web.fee-notice.draft-mark` | BẢN NHÁP · DRAFT | BẢN NHÁP · DRAFT |
| `web.fee-notice.bulk.title` | Xuất hàng loạt | Bulk export |
| `web.fee-notice.bulk.running` | Đang tạo {done} / {total} căn. Bạn có thể rời trang, việc xuất vẫn tiếp tục. | Creating {done} of {total} units. You can leave the page; the export continues. |
| `web.fee-notice.bulk.ready` | Sẵn sàng: {fileName}, {size} | Ready: {fileName}, {size} |
| `web.fee-notice.bulk.link` | Liên kết có hiệu lực 15 phút. | The link works for 15 minutes. |
| `web.fee-notice.bulk.expired` | Tệp đã hết hạn sau 7 ngày. | The file expired after 7 days. |
| `web.fee-notice.bulk.retry` | Thử lại | Try again |
| `web.fee-notice.void` | Khoản phí này không còn hiệu lực. | This charge is no longer valid. |

The words inside the preview ("Thông báo phí tháng …", "Khoản phí", "Cách tính", "Hướng dẫn nộp phí") are the PDF's own strings (DOC-34 §6), shared with the render.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-26 | **G** a published batch **W** the language is switched to `both` **T** every line shows the Vietnamese and English names, and the title is bilingual | web-e2e |
| UIWF-27 | **G** a draft **W** the page opens **T** the preview carries the draft mark, "Tải PDF căn này" works, and the bulk button is disabled | api, web-e2e |
| UIWF-28 | **G** a published batch of 240 units **W** "Xuất PDF 240 căn" is pressed twice **T** one job exists, the panel shows progress from E-177, and on `ready` the ZIP link downloads a file with 240 PDFs and a manifest | api, web-e2e |
| UIWF-29 | **G** the job is running **W** the user leaves and returns **T** the panel shows the same job with its progress | web-e2e |
| UIWF-30 | **G** a charge voided alone **W** its unit is chosen **T** "Tải PDF căn này" answers 409 and the toast says the charge is no longer valid | api, web-e2e |
| UIWF-31 | **G** a building without working hours **W** the preview renders **T** the "How to pay" office line is absent, and with no gateway the app line is absent too | api, web-e2e |

### 10. E2E cases

Playwright: `fee-notice.spec.ts` (UIWF-26, 27, 30, 31), `fee-notice-bulk.spec.ts` (UIWF-28, 29).

### 11. Open questions

None.

---

## W-Fee-Record

> Status: Draft · Prototype: designed (the form is changed by N6) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-02 (record a manual payment), UC-05 (debt of a unit), FR-05, FR-06, FR-12, FR-49. `admin`, `manager`; the back-dating beyond 90 days is Admin only (FR-05.5).

### 2. URL and search params

`/debts/$unitId`. Search: `dialog` (`payment`, `void-payment`, `void`) with `charge` or `payment` ids; `payments` (a cursor for the receipt list). Reached from `W-Debts` ("Ghi nhận nộp") and from the debt card of `W-Unit-Detail` ("Xem công nợ").

### 3. Prototype

Artboard `W-Fee-Record` (title "BQL: Công nợ căn", 1440 wide): breadcrumb; h1 "Công nợ căn" with the `Plate` "A-1508" and the line "Chủ hộ Trần Minh Anh, 0912 345 678, tầng 15, 85 m²"; buttons "Nhắc nợ" and primary "Ghi nhận nộp"; three tiles (2.838.000 đ còn nợ, 2 đợt chưa nộp; 15/10/2026 hạn gần nhất, còn 6 ngày; 0 đ quá hạn); a table "Đợt chưa nộp" (Mã đợt, Tên đợt, Hạn thanh toán, Trạng thái `Tag`, Còn nợ) with the total row "Tổng còn nợ"; a table "Lịch sử phiếu thu" (code, batch name, method, date, amount); and the **dialog** "Ghi nhận nộp cho A-1508" ("Trần Minh Anh, còn nợ 2.838.000 đ") with: "Đợt nộp" (a select of two batches), "Hình thức" (Tiền mặt / Chuyển khoản), **"Số tiền" (1.500.000)**, "Người nộp", "Ngày nộp", "Ghi chú", a checkbox "Gửi phiếu thu cho cư dân trên app", the line "Ghi nhận sai có thể sửa hoặc hủy, mọi thay đổi đều ghi vào nhật ký thao tác." and the buttons "Hủy", "Ghi nhận và tạo phiếu thu".

Do not copy (N4, N6, DR-84):

- The **"Số tiền" field and the partial 1.500.000 đ** ("phần còn lại nộp trước 15/10"): there is no partial payment and no credit. The dialog selects **whole charges**; the system computes the sum and the form shows it read-only.
- A "Đợt nộp" **select** of one batch: the dialog lists the open charges with a checkbox each (1 to 50), so one payment can cover several batches.
- The receipt code `PT-0915-0118`: a receipt number is `BL-2610-0153` (DR-10).
- The checkbox "Gửi phiếu thu cho cư dân trên app": a posted payment always notifies the unit's members with `view_fees` (`payment.received`, DOC-31); the checkbox is dropped (DR-324).
- "Ghi nhận sai có thể sửa hoặc hủy": a wrong entry is **voided** (with a reason) and re-entered; there is no edit (DOC-22 §6). The sentence becomes "Ghi nhận sai thì hủy phiếu thu rồi nhập lại. Mọi thay đổi đều ghi vào nhật ký thao tác."
- Phone and floor in the owner line are data from `ResidencyApi`; the phone is shown in full to both roles (DOC-27 §3.2); the area is the unit's.
- The tile "0 đ quá hạn": "quá hạn" counts days past due, and a charge due today is not overdue (FR-12.1).

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | breadcrumb "Tài chính / Công nợ / {unit}", h1, `Plate`, owner line, buttons "Nhắc nợ" (E-103 for this unit) and primary "Ghi nhận nộp" (disabled with no open charge) | |
| Tiles | three `Card`s: outstanding (count of batches), nearest due date (days left), overdue amount | |
| Open charges | `DataTable`: checkbox (opens the payment dialog with it ticked), batch `Plate`, name, due date, status `Tag` (overdue danger, due soon warning, else neutral), amount, a warning icon "Đang có thanh toán online từ {time}" when an intent holds it (FR-05.6), a `⋯` with "Hủy khoản này" (`W-Charge-Void`); total row | `loading`, `loaded`, `empty` |
| Receipt history | `DataTable`: receipt number(s), batch(es), method, date, payer, amount, status (`Tag` `Hiệu lực` / `Đã hủy`), a second `Tag` "Đã hoàn tiền" or "Bị khiếu nại" linking to the money-log row when the payment has one (DR-327), actions "Xem biên lai" (E-106 PDF) and "Hủy phiếu thu" (cash and bank transfer only) | `loading`, `loaded`, `empty` |
| Payment dialog | `Dialog`: the open charges as checkable rows with amounts, the computed sum (read-only, `suffix` đ), "Hình thức" (`RadioGroup`: Tiền mặt, Chuyển khoản), "Người nộp" (required, default the owner), "Ngày nộp" (`DateField`, not after today, not before today − 90 days unless Admin), "Số tham chiếu ngân hàng" (only for transfer), "Ghi chú", the dry-run summary, buttons | `idle`, `planning`, `saving`, `conflict` |
| Void-payment dialog | reason `Textarea` (5 to 500), the list of charges that become open again and of receipts that become void | |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Debt of the unit | E-102 `GET /staff/units/{id}/debt` | `['staff','debt',unitId]` | `unit {id,code,floor,areaM2}`, `owner {name, phone}`, `summary {outstanding, openCharges, nearestDue, overdueAmount}`, `openCharges[]` (`chargeId`, `batch {code,name,feeMonth}`, `amount`, `dueDate`, `daysPastDue`, `version`, `activeIntent {since}`), and `payments[]` (first 20: `paymentId`, `source`, `amount`, `receivedAt`, `payerName`, `status`, `moneyLogFlags[] {rowId, outcome}` for `refunded` and `disputed`, `receipts[] {id, number, chargeId, status}`) with `nextCursor` (DR-324) |
| More payments | E-102 with `paymentsCursor` | the same key, appended | |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Tick charges, open "Ghi nhận nộp" | none | the dialog shows the computed sum | |
| Any change in the dialog | E-104 with `dryRun: true` (debounced 300 ms) | the plan: the sum, the number of receipts, warnings (`active_intent` per charge with its time) | 409 `charge_changed` → the list refetches and the dialog says "Có khoản phí đã được thanh toán hoặc hủy. Danh sách đã được cập nhật." |
| "Ghi nhận và tạo phiếu thu" | E-104 `POST /staff/payments` `{unitId, chargeIds, method, payerName, receivedOn, bankReference?, note?}` with `Idempotency-Key` (one per dialog open) | 201: a success `Banner` with the receipt numbers (`BL-…`) and links "Xem biên lai"; the debt and the receipts refetch; a replay (200 `Idempotent-Replayed`) shows the same banner | 409 `charge_changed` as above; 400 `received_on_future`, `received_on_too_old`, `too_many_charges`; 422 `allocation_mismatch` (never sent by this form); 422 `idempotency_key_reuse` → the dialog restarts with a new key |
| "Xem biên lai" | E-106 `GET /staff/receipts/{id}/pdf` | the PDF opens in a new tab; a void receipt is watermarked | 404 |
| "Hủy phiếu thu" | dialog; E-105 `POST /staff/payments/{id}/void {reason}` | the payment turns `Đã hủy`, its charges are open again in the table above, a toast "Đã hủy phiếu thu. {n} khoản phí được mở lại." | 409 `payment_not_voidable` (an online payment: "Thanh toán online không hủy được trong hệ thống. Hoàn tiền ở trang quản trị của cổng thanh toán.", even when the payment has a `refunded` or `disputed` row: that row is only a cross-check, DR-327); 409 `invalid_transition` (already void); 422 `reason_too_short` |
| "Hủy khoản này" | `W-Charge-Void` | | |
| "Nhắc nợ" | E-103 `POST /staff/debts/reminders {unitIds:[id]}` with `Idempotency-Key` | toast "Đã gửi nhắc nợ" or "Hôm nay đã nhắc căn này rồi" (`alreadyRemindedToday`) | 429 `rate_limited` → "Bạn gửi nhắc nợ quá nhiều lần. Thử lại sau."; `noDebt` → "Căn này không còn nợ." |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | tiles and the two tables as skeletons in their shape |
| `loaded` | as §4 |
| `no debt` | the tiles read 0, the open table says "Căn hộ không còn khoản phí nào chưa nộp", "Ghi nhận nộp" is disabled |
| `no payments` | the receipt table says "Chưa có phiếu thu nào" |
| `planning` | the sum and the receipt count show a skeleton line for at most the dry run |
| `saving` | the dialog's button disabled with its spinner after 150 ms |
| `conflict` | `charge_changed` banner and the refreshed list |
| `error`, `forbidden`, `not found` | DOC-68; an unknown unit is 404 |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-record.title` | Công nợ căn | Unit balance |
| `web.fee-record.owner` | Chủ hộ {name}, {phone} | Owner {name}, {phone} |
| `web.fee-record.action.remind` | Nhắc nợ | Send a reminder |
| `web.fee-record.action.pay` | Ghi nhận nộp | Record a payment |
| `web.fee-record.tile.outstanding` | Còn nợ, {count} đợt chưa nộp | Owed, {count} batches unpaid |
| `web.fee-record.tile.nearest` | Hạn gần nhất, {days, plural, one {còn # ngày} other {còn # ngày}} | Nearest due date, {days} days left |
| `web.fee-record.tile.overdue` | Quá hạn | Overdue |
| `web.fee-record.open.title` | Đợt chưa nộp | Unpaid batches |
| `web.fee-record.open.total` | Tổng còn nợ | Total owed |
| `web.fee-record.open.empty` | Căn hộ không còn khoản phí nào chưa nộp. | This unit has no unpaid fees. |
| `web.fee-record.intent-warning` | Đang có thanh toán online từ {time} | An online payment has been open since {time} |
| `web.fee-record.receipts.title` | Lịch sử phiếu thu | Receipt history |
| `web.fee-record.receipts.empty` | Chưa có phiếu thu nào. | No receipts yet. |
| `web.fee-record.pay.title` | Ghi nhận nộp cho {unit} | Record a payment for {unit} |
| `web.fee-record.pay.subtitle` | {owner}, còn nợ {amount} | {owner}, owes {amount} |
| `web.fee-record.pay.charges` | Các khoản phí được nộp | Fees being paid |
| `web.fee-record.pay.sum` | Số tiền | Amount |
| `web.fee-record.pay.sum.hint` | Tổng của các khoản đã chọn. Mỗi khoản nộp đủ, không nộp một phần. | The total of the fees selected. Each fee is paid in full, never in part. |
| `web.fee-record.pay.method` | Hình thức | Method |
| `web.fee-record.pay.method.cash` / `.bank_transfer` | Tiền mặt / Chuyển khoản | Cash / Bank transfer |
| `web.fee-record.pay.payer` | Người nộp | Paid by |
| `web.fee-record.pay.date` | Ngày nộp | Date paid |
| `web.fee-record.pay.bank-ref` | Số tham chiếu ngân hàng | Bank reference |
| `web.fee-record.pay.note` | Ghi chú | Note |
| `web.fee-record.pay.receipts` | Sẽ tạo {count, plural, one {# phiếu thu} other {# phiếu thu}} | {count, plural, one {# receipt} other {# receipts}} will be issued |
| `web.fee-record.pay.hint` | Ghi nhận sai thì hủy phiếu thu rồi nhập lại. Mọi thay đổi đều ghi vào nhật ký thao tác. | If an entry is wrong, void the receipt and enter it again. Every change is written to the audit log. |
| `web.fee-record.pay.submit` | Ghi nhận và tạo phiếu thu | Record and issue the receipt |
| `web.fee-record.pay.changed` | Có khoản phí đã được thanh toán hoặc hủy. Danh sách đã được cập nhật. | A fee was paid or voided. The list has been updated. |
| `web.fee-record.pay.done` | Đã ghi nhận {amount}. Phiếu thu: {numbers}. | Recorded {amount}. Receipts: {numbers}. |
| `web.fee-record.receipt.view` | Xem biên lai | View receipt |
| `web.fee-record.receipt.void` | Hủy phiếu thu | Void the receipt |
| `web.fee-record.receipt.status.valid` / `.void` | Hiệu lực / Đã hủy | Valid / Void |
| `web.fee-record.void.title` | Hủy phiếu thu? | Void this receipt? |
| `web.fee-record.void.body` | {count} khoản phí sẽ được mở lại và cư dân thanh toán được ngay. Biên lai {numbers} chuyển sang đã hủy, số biên lai được giữ nguyên. | {count} fees will be open again and the resident can pay them at once. Receipts {numbers} become void; their numbers are kept. |
| `web.fee-record.void.reason` | Lý do (ít nhất 5 ký tự) | Reason (at least 5 characters) |
| `web.fee-record.void.done` | Đã hủy phiếu thu. {count} khoản phí được mở lại. | Receipt voided. {count} fees are open again. |
| `web.fee-record.void.online` | Thanh toán online không hủy được trong hệ thống. Hoàn tiền ở trang quản trị của cổng thanh toán. | An online payment cannot be voided here. Refund it in the payment gateway's dashboard. |
| `web.fee-record.remind.done` | Đã gửi nhắc nợ. | Reminder sent. |
| `web.fee-record.remind.today` | Hôm nay đã nhắc căn này rồi. | This unit was already reminded today. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-32 | **G** A-1508 with open charges A (2,488,000) and B (350,000) **W** both are ticked and "Ghi nhận nộp" opens **T** the sum reads 2.838.000 đ, there is no amount field to edit, and the dry run says 2 receipts | web-e2e |
| UIWF-33 | **G** the dialog is confirmed **W** E-104 answers 201 **T** the debt tiles read 0, both charges leave the open table, and the receipt table shows `BL-…-0001` and `BL-…-0002` | api, web-e2e |
| UIWF-34 | **G** a double click on the submit button **W** two requests share one key **T** one payment exists and the second response is the replay | api, web-e2e |
| UIWF-35 | **G** a charge is paid online while the dialog is open **W** the Manager confirms **T** 409 `charge_changed` shows the refreshed list and the message, and nothing is recorded | api, web-e2e |
| UIWF-36 | **G** an online intent holds charge B **W** the dialog opens **T** B shows "Đang có thanh toán online từ …" and the entry is still allowed | api, web-e2e |
| UIWF-37 | **G** a Manager picks a date 91 days back **W** it is submitted **T** 400 `received_on_too_old`; an Admin may | api, web-e2e |
| UIWF-38 | **G** a cash receipt **W** "Hủy phiếu thu" is confirmed with the reason "Nhập nhầm căn" **T** the payment is `Đã hủy`, the two charges are open again, and the receipts are void with their numbers kept | api, web-e2e |
| UIWF-39 | **G** an online payment **W** its row is inspected **T** there is no "Hủy phiếu thu"; a forced E-105 answers 409 `payment_not_voidable` | api, web-e2e |
| UIWF-40 | **G** a unit with nothing open **W** the page opens **T** "Ghi nhận nộp" is disabled and the empty text shows | web-e2e |
| UIWF-41 | **G** "Nhắc nợ" is pressed twice the same day **W** the second runs **T** the toast says the unit was already reminded today | api, web-e2e |
| UIWF-42 | **G** a charge due today **W** the tiles render **T** it is not overdue and its `Tag` says "Hạn hôm nay" | api, web-e2e |

### 10. E2E cases

Playwright: `fee-record-pay.spec.ts` (UIWF-32, 33, 34, 35, 36, 37), `fee-record-void.spec.ts` (UIWF-38, 39), `fee-record-state.spec.ts` (UIWF-40, 41, 42).

### 11. Open questions

None.

---

## W-Fee-Recall

> Status: Draft · Prototype: to design (a wireframe below) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-04 (recall), FR-04.1 (all charges void, intents cancelled whole), FR-04.2 (a paid charge blocks the recall), FR-04.3. `admin`, `manager`. A dialog of `W-Fee-Batch` (`?dialog=recall`), never a page.

### 2. URL and search params

`/fees/$batchId?dialog=recall`. The dialog is unmounted with `useExit` so it animates out.

### 3. Wireframe

```text
┌───────────────────────────────────────────────┐
│ Thu hồi đợt PH-2610-01?                    ✕  │
├───────────────────────────────────────────────┤
│ 240 khoản phí sẽ bị hủy. Cư dân không còn      │
│ thấy và không thanh toán được các khoản này.   │
│ Lượt thanh toán online đang mở sẽ bị hủy.      │
│                                                │
│ Lý do *                                        │
│ ┌────────────────────────────────────────────┐ │
│ │ Nhập sai đơn giá phí quản lý               │ │
│ └────────────────────────────────────────────┘ │
│ 27 / 500                                       │
│                                                │
│            [ Hủy ]   [ Thu hồi đợt ]           │
└───────────────────────────────────────────────┘

409 batch_has_payments (the result):
┌───────────────────────────────────────────────┐
│ ⚠ Không thu hồi được                           │
│ Đã có 3 khoản được thanh toán. Không có gì bị  │
│ thay đổi.                                      │
│ Muốn sửa một khoản sai, hãy hủy từng khoản     │
│ chưa thanh toán. Khoản đã thanh toán thì bù    │
│ bằng khoản điều chỉnh trong đợt sau.           │
│            [ Xem 3 khoản đã thanh toán ] [Đóng]│
└───────────────────────────────────────────────┘
```

Do not copy: there is no canvas artboard; this wireframe is the specification until one exists (DR-72). The screen never offers to "recall except the paid charges": a partial recall does not exist (DR-97).

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Dialog | `Dialog` with the title, a warning paragraph, `Textarea` "Lý do" (required, 5 to 500, growing, counter), buttons "Hủy" and danger "Thu hồi đợt" | `idle`, `submitting`, `blocked`, `conflict` |
| Early warning | when the batch response (`counts.paid`) is above 0, the dialog opens already in the `blocked` view with the count, because recalling is certain to fail | |
| Result panel | `Banner` warning inside the dialog with `paidCount`, the explanation and the button "Xem {n} khoản đã thanh toán" (closes the dialog and filters the batch table by `status=paid`) | `blocked` |

### 5. Data

The batch (E-91, already loaded) supplies `code`, `counts.open`, `counts.paid`, `version`. The paid list is E-93 with `status=paid`.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Thu hồi đợt" | E-96 `POST /staff/fee-batches/{id}/recall {reason}` with `If-Match` | the dialog closes; the batch is `recalled`; a toast "Đã thu hồi {code}. {count} khoản đã hủy." and a button "Phát hành lại" | **409 `batch_has_payments {paidCount}`** → the result panel (nothing changed); 409 `version_conflict` → "Đợt phí đã thay đổi. Đã cập nhật." and the dialog re-evaluates; 409 `invalid_transition` (closed or recalled) → "Chỉ thu hồi được đợt đã phát hành, chưa đóng."; 422 `reason_too_short` / `reason_too_long` under the field |
| "Xem {n} khoản đã thanh toán" | none | closes and sets `status=paid` on the table | |

The recall and a payment race on the charge row (DOC-22 §10, EXP-04): whichever commits first decides, and the other side sees a typed answer. A Manager who loses sees the result panel; a resident whose transfer lost goes to the money log (P3).

### 7. States

| State | Screen |
| --- | --- |
| `idle` | the form |
| `submitting` | button disabled, spinner after 150 ms |
| `blocked` | the result panel |
| `error` | the generic error inside the dialog |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-recall.title` | Thu hồi đợt {code}? | Recall {code}? |
| `web.fee-recall.body` | {count} khoản phí sẽ bị hủy. Cư dân không còn thấy và không thanh toán được các khoản này. Lượt thanh toán online đang mở sẽ bị hủy. | {count} charges will be voided. Residents no longer see them or can pay them. Online payments in progress are cancelled. |
| `web.fee-recall.reason` | Lý do | Reason |
| `web.fee-recall.reason.placeholder` | Nhập sai đơn giá phí quản lý | Management fee priced wrongly |
| `web.fee-recall.submit` | Thu hồi đợt | Recall the batch |
| `web.fee-recall.blocked.title` | Không thu hồi được | The batch cannot be recalled |
| `web.fee-recall.blocked.body` | Đã có {count, plural, one {# khoản} other {# khoản}} được thanh toán. Không có gì bị thay đổi. | {count, plural, one {# charge has} other {# charges have}} been paid. Nothing was changed. |
| `web.fee-recall.blocked.hint` | Muốn sửa một khoản sai, hãy hủy từng khoản chưa thanh toán. Khoản đã thanh toán thì bù bằng khoản điều chỉnh trong đợt sau. | To fix a wrong charge, void the unpaid ones one by one. Offset a paid one with an adjustment line in a later batch. |
| `web.fee-recall.blocked.view` | Xem {count} khoản đã thanh toán | View the {count} paid charges |
| `web.fee-recall.done` | Đã thu hồi {code}. {count} khoản đã hủy. | Recalled {code}. {count} charges voided. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-43 | **G** a published batch of 240 open charges **W** the Manager recalls it with a reason **T** E-96 is sent with `If-Match`, the batch becomes `recalled`, the 240 charges are void and the toast reads "Đã thu hồi … 240 khoản đã hủy" | api, web-e2e |
| UIWF-44 | **G** a batch with one paid charge **W** the dialog opens **T** it shows the blocked view at once; a forced E-96 answers 409 `batch_has_payments {paidCount: 1}` and nothing changes | api, web-e2e |
| UIWF-45 | **G** a payment lands between the dialog opening and the press **W** "Thu hồi đợt" is pressed **T** the result panel shows `paidCount` from the 409 and the batch stays `published` | api, web-e2e |
| UIWF-46 | **G** a reason of 4 characters **W** the form is submitted **T** the field shows the rule sentence and no request is sent (client) or 422 `reason_too_short` (server) | web-e2e |
| UIWF-47 | **G** a recalled batch **W** the page reloads **T** no recall control remains and "Phát hành lại" is the only header action | web-e2e |

### 10. E2E cases

Playwright: `fee-recall.spec.ts` (UIWF-43, 44, 45, 46, 47). UIWF-45 uses the barrier helper of `apps/api/tests/exp/` for the API side and a forced response for the screen.

### 11. Open questions

None.

---

## W-Charge-Void

> Status: Draft · Prototype: to design (a wireframe below) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-04 (a wrong charge inside a batch that cannot be recalled), FR-49 (the void of one open charge), DR-19, DR-20. `admin`, `manager` (`VOID_CHARGE_ROLES`). Opened from a row of a published or closed batch in `W-Fee-Batch` and from the open-charges table of `W-Fee-Record`.

### 2. URL and search params

`?dialog=void&charge=<chargeId>` on `/fees/$batchId` or `/debts/$unitId`.

### 3. Wireframe

```text
┌───────────────────────────────────────────────┐
│ Hủy khoản phí của A-1508?                  ✕  │
├───────────────────────────────────────────────┤
│ PH-2610-01 · Phí tháng 10/2026, đợt 1         │
│ Trần Minh Anh · 2.488.000 đ                   │
│                                                │
│ ⚠ Đang có thanh toán online cho khoản này      │
│   (từ 09:12). Lượt thanh toán sẽ bị hủy và cư  │
│   dân phải thanh toán lại.                     │
│                                                │
│ Khoản đã hủy không mở lại được. Muốn thu đúng, │
│ hãy tạo khoản mới trong một đợt nháp.          │
│                                                │
│ Lý do *                                        │
│ ┌────────────────────────────────────────────┐ │
│ │ Tính nhầm căn                              │ │
│ └────────────────────────────────────────────┘ │
│                                                │
│            [ Đóng ]   [ Hủy khoản phí ]        │
└───────────────────────────────────────────────┘
```

Do not copy: no artboard. The dialog never offers to void a **paid** charge (a paid charge is offset by a negative adjustment line in a later batch, DR-19).

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Dialog | `Dialog`: the charge summary (batch `Plate`, name, owner, amount), the active-intent `Banner` (warning, when E-102 / E-93 reports `activeIntent`), the explanation, `Textarea` "Lý do" (5 to 500, required), buttons | `idle`, `submitting`, `conflict` |
| Entry points | a `⋯` menu item "Hủy khoản này" on a row whose `status` is `open`; absent for `paid` and `void` | |

### 5. Data

The charge row (version, amount, `activeIntent`) comes from the table that opened the dialog (E-93 or E-102); no extra read.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Hủy khoản phí" | E-100 `POST /staff/charges/{id}/void {reason}` with `If-Match` (charge `version`) | the dialog closes; the row turns `void` (single); the totals refetch; a toast "Đã hủy khoản phí của {unit}." | 409 `charge_not_voidable {status}` (paid meanwhile) → the dialog switches to "Khoản này vừa được thanh toán, không hủy được." with the refreshed row; 409 `version_conflict` → the fresh row; 409 `invalid_transition` (already void); 422 `reason_too_short` / `reason_too_long`; 403 for another role |

The void and a settlement race on the charge row: exactly one wins (FR-49.5). When the Manager loses to a payment, the dialog says so; when the payment loses, the resident's transfer goes to the money log as `charge_recalled` (P3). An intent that held the charge is cancelled **as a whole**, including other charges in it (DOC-21 §3.9).

### 7. States

| State | Screen |
| --- | --- |
| `idle` | the form, with the intent banner when present |
| `submitting` | button disabled, spinner after 150 ms |
| `lost` | the "paid meanwhile" message and "Đóng" only |
| `error` | the generic error inside the dialog |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.charge-void.title` | Hủy khoản phí của {unit}? | Void the fee of {unit}? |
| `web.charge-void.summary` | {batch} · {owner} · {amount} | {batch} · {owner} · {amount} |
| `web.charge-void.intent` | Đang có thanh toán online cho khoản này (từ {time}). Lượt thanh toán sẽ bị hủy và cư dân phải thanh toán lại. | An online payment is open for this fee (since {time}). It will be cancelled and the resident must pay again. |
| `web.charge-void.body` | Khoản đã hủy không mở lại được. Muốn thu đúng, hãy tạo khoản mới trong một đợt nháp. | A voided fee cannot be reopened. To bill it correctly, add a new charge in a draft batch. |
| `web.charge-void.reason` | Lý do | Reason |
| `web.charge-void.reason.placeholder` | Tính nhầm căn | Billed to the wrong unit |
| `web.charge-void.submit` | Hủy khoản phí | Void the fee |
| `web.charge-void.lost` | Khoản này vừa được thanh toán, không hủy được. | This fee was just paid and cannot be voided. |
| `web.charge-void.done` | Đã hủy khoản phí của {unit}. | Voided the fee of {unit}. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-48 | **G** an open charge of A-1508 in a published batch **W** it is voided with "Tính nhầm căn" **T** E-100 is sent with the charge `If-Match`, the row shows `void`, the other 239 are untouched and the batch can still be recalled | api, web-e2e |
| UIWF-49 | **G** the charge is paid **W** its row is inspected **T** no "Hủy khoản này" exists; a forced E-100 answers 409 `charge_not_voidable` | api, web-e2e |
| UIWF-50 | **G** the charge is paid while the dialog is open **W** it is submitted **T** the dialog shows the "paid meanwhile" message and the row refreshes as `paid` | api, web-e2e |
| UIWF-51 | **G** an intent holds the charge **W** the dialog opens **T** the warning shows with the time, and after the void the intent is `cancelling` as a whole | api, web-e2e |
| UIWF-52 | **G** a Technician **W** E-100 is called **T** 403; the web never renders the item for that role | api |

### 10. E2E cases

Playwright: `charge-void.spec.ts` (UIWF-48, 49, 50, 51).

### 11. Open questions

None.

---

## W-Fee-Reissue

> Status: Draft · Prototype: to design (a wireframe below) · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-04 (correct a recalled batch), FR-04.5, DR-20. `admin`, `manager`. A dialog on a `recalled` batch of `W-Fee-Batch`.

### 2. URL and search params

`/fees/$batchId?dialog=reissue`.

### 3. Wireframe

```text
┌───────────────────────────────────────────────┐
│ Phát hành lại PH-2610-01                   ✕  │
├───────────────────────────────────────────────┤
│ Hệ thống tạo một đợt nháp mới từ đợt đã thu    │
│ hồi:                                           │
│  • 239 khoản phí được sao chép, kèm các dòng   │
│  • 1 khoản đã hủy riêng không sao chép         │
│    (A-0407: bạn tự thêm lại nếu cần)           │
│  • Mã đợt mới được cấp khi tạo                 │
│                                                │
│ Hạn thanh toán *   [ 25/11/2026 ]              │
│ Tháng phí giữ nguyên: 10/2026                  │
│                                                │
│ Đợt mới là bản nháp. Bạn sửa rồi phát hành.    │
│            [ Đóng ]   [ Tạo bản nháp ]         │
└───────────────────────────────────────────────┘
```

Do not copy: no artboard. The dialog does not edit lines: the Manager edits the new draft in `W-Fee-Batch`.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Dialog | `Dialog`: the preview counts, the list of single-voided units (up to 5, "và {n} căn khác"), `DateField` "Hạn thanh toán" (default the old one; the publish check will test it), read-only fee month, buttons | `idle`, `submitting` |

### 5. Data

From E-91 (recalled batch): `counts.void`, `counts.voidSingle` (charges voided alone), `dueDate`, `feeMonth`. The units voided alone are listed from E-93 `status=void&voidKind=single`.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Tạo bản nháp" | E-98 `POST /staff/fee-batches/{id}/reissue {dueDate}` | the response `{ batchId, code, copiedCharges, skippedSingleVoid }`; the app navigates to `/fees/$batchId` of the new draft with a toast "Đã tạo bản nháp {code} từ {oldCode}." | 409 `invalid_transition` (the batch is not recalled); 400 `validation_failed` on `dueDate` |

A batch can be re-issued more than once (the first draft may be discarded); `replacedBy` on the recalled batch lists the batches made from it.

### 7. States

| State | Screen |
| --- | --- |
| `idle` | the dialog |
| `submitting` | button disabled, spinner after 150 ms |
| `error` | the generic error inside the dialog |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.fee-reissue.title` | Phát hành lại {code} | Re-issue {code} |
| `web.fee-reissue.intro` | Hệ thống tạo một đợt nháp mới từ đợt đã thu hồi: | A new draft is made from the recalled batch: |
| `web.fee-reissue.copied` | {count} khoản phí được sao chép, kèm các dòng | {count} charges are copied with their lines |
| `web.fee-reissue.skipped` | {count} khoản đã hủy riêng không sao chép: {units} | {count} charges voided on their own are not copied: {units} |
| `web.fee-reissue.code` | Mã đợt mới được cấp khi tạo. | The new batch gets its code when created. |
| `web.fee-reissue.due` | Hạn thanh toán | Due date |
| `web.fee-reissue.month` | Tháng phí giữ nguyên: {month}/{year} | The fee month stays {month}/{year} |
| `web.fee-reissue.note` | Đợt mới là bản nháp. Bạn sửa rồi phát hành. | The new batch is a draft. Edit it and publish. |
| `web.fee-reissue.submit` | Tạo bản nháp | Create the draft |
| `web.fee-reissue.done` | Đã tạo bản nháp {code} từ {oldCode}. | Created draft {code} from {oldCode}. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-53 | **G** a recalled batch of 240 charges with one voided alone **W** "Tạo bản nháp" is pressed **T** E-98 answers a new draft with 239 charges, the app opens it, and the old batch shows "Đã phát hành lại thành {code}" | api, web-e2e |
| UIWF-54 | **G** a published batch **W** its header is inspected **T** no "Phát hành lại" exists; a forced E-98 answers 409 `invalid_transition` | api, web-e2e |
| UIWF-55 | **G** the first re-issue was discarded **W** "Phát hành lại" is pressed again **T** a second draft with a new code is created | api, web-e2e |
| UIWF-56 | **G** the new draft **W** it is opened **T** the amounts and lines equal the recalled batch's, the ids differ, and the due date is the one chosen | api, web-e2e |

### 10. E2E cases

Playwright: `fee-reissue.spec.ts` (UIWF-53, 55, 56).

### 11. Open questions

None.

---

## W-Debts

> Status: Draft · Prototype: designed · Phase: P2 · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-05 (debt and reminders), FR-12 (what counts, buckets, building time, reminders), FR-44.3. `admin`, `manager`.

### 2. URL and search params

`/debts`. Search: `month` (a fee month `YYYY-MM`, default all), `q` (unit code or owner name), `overdue` (`30` to keep units with a charge more than 30 days past due), `cursor` (a stack).

### 3. Prototype

Artboard `W-Debts` (title "BQL: Công nợ", 1440 wide): h1 "Công nợ" and the line "Số liệu đến 09:30, 09/10/2026, gồm mọi đợt phí đã phát hành"; a button "Xuất Excel"; four stat tiles (166.990.000 đ tổng công nợ; 71 căn còn nợ trên 240; 15.550.000 đ quá hạn trên 30 ngày, 9 căn, in `danger`; 383.250.000 đ đã thu phí tháng 10/2026); a `Tabs` "Xem công nợ" (Theo căn, Theo tháng phí), a `SearchField`, a month `SelectField` "Phí của tháng: Tất cả"; a selection bar "Đã chọn 3 căn, tổng nợ 13.190.000 đ" with "Bỏ chọn" and "Gửi nhắc nợ qua push"; a table (a checkbox, Căn, Chủ hộ with the phone, Số đợt nợ, Còn nợ, Nợ lâu nhất with "Quá hạn 116 ngày", Lần nhắc gần nhất, "Ghi nhận nộp"); the footer "1–8 trên 71 căn, sắp xếp theo nợ lâu nhất".

Do not copy:

- The sort "theo nợ lâu nhất": E-101 orders by **outstanding amount**, then unit (DOC-22 §8.2), and the footer says so. The column "Nợ lâu nhất" is shown but is not a sort key in P2 (DR-324).
- The tab "Theo tháng phí": the breakdown of debt and collection per fee month is `W-Reports` (P6). In P2 the `month` filter keeps the list by unit; the tab control is not drawn until P6.
- "Xuất Excel": exports are P6 (`W-Export-Center`); the button is not drawn in P2 (DR-196).
- The tile "383.250.000 đ đã thu phí tháng 10/2026": the tile shows the collected amount of the **latest fee month with a published batch** (or of the `month` filter), with its rate; it is not "debt".
- "Quá hạn 116 ngày" for a unit whose oldest charge is due: the count is days past due of the **oldest open charge** (`maxDaysPastDue`), in building days; a charge due today is not overdue.
- The phone in the owner cell: shown in full (`0904 218 337`) to Manager and Admin, who both may see it (DOC-27 §3.2).

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | h1, muted line "Số liệu đến {time}, {date}, gồm mọi đợt phí đã phát hành" | |
| Tiles | four `Card`s: total outstanding; units with debt of all units; overdue more than 30 days (amount and units, `danger`); collected of the fee month | `loading`, `loaded` |
| Filters | `SearchField`, `SelectField` fee month, a `Switch` "Chỉ căn quá hạn trên 30 ngày" | |
| Selection bar | appears with ≥ 1 selected: "Đã chọn {n} căn, tổng nợ {amount}", "Bỏ chọn", primary "Gửi nhắc nợ qua push" | |
| Table | `DataTable` with a header checkbox (selects the **loaded page**; "Chọn tất cả {n} căn" selects the filtered set up to 500), unit `Plate`, owner + phone, open-charge count, outstanding, oldest (batch name + the overdue `Tag`), last reminder, row actions "Ghi nhận nộp" (→ `/debts/$unitId?dialog=payment`) and a caret (→ `/debts/$unitId`) | `loading`, `loaded`, `empty`, `busy` |
| Footer | range text and arrows over a cursor stack | |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The list and the tiles | E-101 `GET /staff/debts?month&q&overdue&limit=25&cursor` | `['staff','debts',{month,q,overdue},cursor]` | items: `unitId`, `unitCode`, `ownerName`, `ownerPhone`, `outstanding`, `openCharges`, `oldestDue`, `maxDaysPastDue`, `overdue30`, `lastReminderAt`; the first page adds `summary {outstanding, units, ownedUnits, overdue30 {amount, units}, collected {feeMonth, amount, rate}}` and `asOf` (the building time of the read) (DR-324). Ordered by `outstanding` descending, then unit, keyset `(outstanding, unitId)` |

No polling; a refetch on focus after 60 s. "Số liệu đến" shows `asOf`.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Filters | none | the search params change; previous rows stay under the busy bar |
| Select rows | none | the selection bar updates its sum from the loaded rows (for "Chọn tất cả" from the summary of the filtered set) |
| "Gửi nhắc nợ qua push" | a confirm dialog "Gửi nhắc nợ cho {n} căn?" ("Mỗi căn chỉ nhận một nhắc nợ mỗi ngày."), then E-103 `POST /staff/debts/reminders {unitIds}` with `Idempotency-Key` | a toast "Đã gửi {sent} căn." plus ", {alreadyRemindedToday} căn đã nhắc hôm nay" and ", {noDebt} căn không còn nợ" when > 0; `lastReminderAt` updates |
| Errors of E-103 | | 400 `no_unit_selected`; 400 `too_many_units` (> 500) → "Chọn tối đa 500 căn."; 429 `rate_limited` → "Bạn gửi nhắc nợ quá nhiều lần. Thử lại sau {minutes} phút." |
| "Ghi nhận nộp" | none | `/debts/$unitId?dialog=payment` (`W-Fee-Record`) |
| Row | none | `/debts/$unitId` |

The reminder is a push to the members of the unit with `view_fees`, with no amount in the push text (DOC-31).

### 7. States

| State | Screen |
| --- | --- |
| `loading` | tiles as skeletons in their shape; the table header and row skeletons |
| `loaded` | as §4 |
| `empty` (no unit owes) | `EmptyState` "Không có căn nào còn nợ" with the collected tile still shown |
| `empty` (filters) | "Không có căn khớp bộ lọc" and "Xóa bộ lọc" |
| `sending` | the confirm button disabled with its spinner |
| `error`, `forbidden` | DOC-68 |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.debts.title` | Công nợ | Debts |
| `web.debts.asof` | Số liệu đến {time}, {date}, gồm mọi đợt phí đã phát hành | Figures as of {time}, {date}, all published batches |
| `web.debts.tile.total` | Tổng công nợ | Total outstanding |
| `web.debts.tile.units` | {count} căn | {count} units |
| `web.debts.tile.units.label` | Còn nợ, trên {total} căn | Owing, of {total} units |
| `web.debts.tile.overdue` | Quá hạn trên 30 ngày, {count} căn | More than 30 days overdue, {count} units |
| `web.debts.tile.collected` | Đã thu phí tháng {month}/{year} | Collected for {month}/{year} |
| `web.debts.search` | Tìm mã căn, chủ hộ | Search unit or owner |
| `web.debts.month` | Phí của tháng | Fee month |
| `web.debts.month.all` | Tất cả | All |
| `web.debts.switch.overdue` | Chỉ căn quá hạn trên 30 ngày | Only units more than 30 days overdue |
| `web.debts.selection` | Đã chọn {count} căn, tổng nợ {amount} | {count} units selected, {amount} owed |
| `web.debts.selection.clear` | Bỏ chọn | Clear |
| `web.debts.selection.all` | Chọn tất cả {count} căn | Select all {count} units |
| `web.debts.action.remind` | Gửi nhắc nợ qua push | Send a push reminder |
| `web.debts.col.unit` … | Căn, Chủ hộ, Số đợt nợ, Còn nợ, Nợ lâu nhất, Lần nhắc gần nhất | Unit, Owner, Batches owed, Owed, Oldest, Last reminder |
| `web.debts.col.pay` | Ghi nhận nộp | Record a payment |
| `web.debts.overdue` | Quá hạn {days} ngày | {days} days overdue |
| `web.debts.reminded.never` | Chưa nhắc | Never |
| `web.debts.footer` | {from}–{to} trên {total} căn, sắp xếp theo số tiền nợ | {from}–{to} of {total} units, sorted by amount owed |
| `web.debts.remind.confirm.title` | Gửi nhắc nợ cho {count} căn? | Send a reminder to {count} units? |
| `web.debts.remind.confirm.body` | Mỗi căn chỉ nhận một nhắc nợ mỗi ngày. Thông báo không ghi số tiền. | Each unit gets one reminder a day. The notification does not show an amount. |
| `web.debts.remind.done` | Đã gửi {sent} căn. | Sent to {sent} units. |
| `web.debts.remind.done.extra` | {already} căn đã nhắc hôm nay, {none} căn không còn nợ. | {already} units were already reminded today, {none} no longer owe. |
| `web.debts.empty.title` | Không có căn nào còn nợ | No unit owes anything |
| `web.debts.empty.filtered` | Không có căn khớp bộ lọc | No unit matches the filters |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-57 | **G** 71 of 240 units owe **W** `/debts` opens **T** the tiles read the totals of E-101, the table is ordered by amount descending, and the footer says so | api, web-e2e |
| UIWF-58 | **G** an open charge due 2026-10-15 **W** the building date is 10-15 and 10-16 **T** it is not overdue on the 15th and "Quá hạn 1 ngày" on the 16th, in building time, not UTC | api |
| UIWF-59 | **G** 3 units are ticked **W** "Gửi nhắc nợ qua push" is confirmed **T** E-103 is sent once with 3 ids and one key, the toast reads "Đã gửi 3 căn", and `lastReminderAt` updates | api, web-e2e |
| UIWF-60 | **G** the same selection is sent again the same day **W** it is confirmed **T** the toast says 3 units were already reminded today and no push is sent | api, web-e2e |
| UIWF-61 | **G** 501 units are selected **W** the action is pressed **T** the client stops at "Chọn tối đa 500 căn." and a forced E-103 answers 400 `too_many_units` | api, web-e2e |
| UIWF-62 | **G** a filter on one fee month **W** it is applied **T** only units with an open charge of that month are listed, and the collected tile shows that month | api, web-e2e |
| UIWF-63 | **G** the 5,000-unit seed (24 batches) **W** the page loads **T** the first page answers within the target of DOC-22 §8.6 and the page shows no layout shift (Q1…Q8 at 400 ms and 0) | api, web-e2e |
| UIWF-64 | **G** a Technician **W** `/debts` is opened **T** the app redirects to the dashboard | web-e2e |
| UIWF-65 | **G** a P2 build **W** the page is inspected **T** there is no "Xuất Excel" and no "Theo tháng phí" tab | web-e2e |

### 10. E2E cases

Playwright: `debts-list.spec.ts` (UIWF-57, 62, 64, 65), `debts-remind.spec.ts` (UIWF-59, 60, 61). UIWF-58 and UIWF-63 are API tests (DOC-22 §8.3 boundary table and §8.6 timing).

### 11. Open questions

None.

---

---

## W-Transactions

> Status: Draft · Prototype: designed (N3, N4 apply) · Phase: P2 (DR-325) · DOC-66

### 1. Persona, use cases, permissions

PS-1 Admin, PS-2 Manager. UC-18 (watch online payments), UC-03 (cancel a resident's open payment), FR-08.4, FR-10.1…10.3, FR-47. `admin`, `manager`. The screen is the staff's view of **payment intents**; the money that could not be posted is the tab `W-Money-Log`.

### 2. URL and search params

`/transactions`. Search: `tab` (`intents` default, `log` for `W-Money-Log`), `status` (`all`, `pending`, `paid`, `failed`, `cancelled`), `q` (a code, a unit), `from`, `to` (building days), `cursor` (a stack).

### 3. Prototype

Artboard `W-Transactions` (title "BQL: Giao dịch online", 1440 wide): h1 "Giao dịch online" with "Giao dịch thành công được tự động gạch nợ khi nhận IPN có chữ ký hợp lệ", a button "Xuất Excel", a banner "Đang chờ chốt VNPay hoặc VietQR cho bản đầu. Màn này hiển thị theo VietQR."; a filter row (a `Tag` "Cổng thanh toán: VietQR", a `SearchField` "Mã giao dịch, căn", status and time selects); four stat tiles (37 thành công, 1 đang treo, 1 trùng đã chặn ghi 2 lần, 0 lỗi chữ ký IPN); a table (Mã GD `TT-…`, Căn and batch, Số tiền, Lúc, Trạng thái `Tag`, a "Truy vấn lại" action on a pending row); a footer "1–8 trên 40 giao dịch hôm nay"; and a side card "Giao dịch đang treo" (a pending intent with "Truy vấn lại trạng thái" and the explanation of the 5-minute re-query for an hour).

Do not copy (N3, N4, DR-325):

- The banner "Đang chờ chốt VNPay hoặc VietQR…", the tag "Cổng thanh toán: VietQR" as a fixed word and the word "IPN": a design note is not copy (N3). The tag shows the **active driver's label** (`Stripe` today) from E-49; "IPN" is "webhook" (provider-neutral).
- "Xuất Excel": exports are P6.
- The codes `TT-0910-0045` (MMDD): the intent code is `TT-261019-0045` (N4, DR-10).
- "Trùng, đã chặn ghi 2 lần" as a row status: a duplicate confirmation that was blocked is `already_processed`, which writes nothing (DOC-23 §6.2); the tile counts the **webhook deliveries that were duplicates** from the metric, not intents. A second transfer that was a different payment is a log row (`duplicate_transfer`).
- "Lỗi chữ ký IPN" as an intent status: it is a count of `webhook_rejection` rows (the tile), not a row of the table.
- "Hệ thống tự truy vấn lại mỗi 5 phút trong 1 giờ": true for the pending intent and kept, but the numbers come from the settings (`next_check_at`), not from the sentence.
- "hôm nay": the footer counts the filtered range; the default range is the last 7 days.

### 4. Regions and components

| Region | Components | State |
| --- | --- | --- |
| Header | h1, muted line (`web.transactions.subtitle`), the driver `Tag` | |
| Tiles | four `Card`s for the filtered range: paid, pending, blocked duplicates, webhook rejections | `loading`, `loaded` |
| Filters | `Tabs` (`Giao dịch` / `Tiền cần kiểm tra` with the open count), `SearchField`, status `SelectField`, date range | |
| Table | `DataTable`: intent code `Plate`, unit and batch labels, amount, created time, status `Tag`, a re-query `IconButton` on `pending` rows, a caret; a row opens a drawer | `loading`, `loaded`, `empty`, `busy` |
| Pending card | the oldest `pending` intents (≤ 5) with the last check and "Truy vấn lại trạng thái" | |
| Drawer | the intent: code, unit, who started it, charges (batch codes and amounts), status history (`creating`, `pending`, …, with times), `paidAt`, the receipts, the check count and last check, the provider session id as a copyable small line, the buttons "Truy vấn lại" and "Hủy lượt thanh toán" | |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Intents | E-107 `GET /staff/payments/intents?status&q&from&to&limit=25&cursor` | `['staff','intents',{…},cursor]` | each: `id`, `code`, `unitId`, `unitCode`, `amount`, `status`, `createdAt`, `paidAt`, `lastCheckedAt`, `checkCount`, `createdBy {name}`, `batches[] {code, amount}`; the first page adds `summary {paid, pending, duplicatesBlocked, webhookRejections}` for the range |
| The active driver | E-49 `GET /staff/gateway` | `['staff','gateway']` | `driver`, `label`, `mode`; cached |
| The open-money count | E-108 with `open=true&limit=1` | `['staff','money-log','open-count']` | for the tab badge |

Polling: the table refetches every 15 s while a `pending` intent is visible and the tab is focused (FR-08.4), otherwise on focus after 30 s.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Filters, tabs | none | search params; busy bar |
| Open a row | none | the drawer |
| "Truy vấn lại" | E-186 `POST /staff/payments/intents/{id}/check` | brings the next re-query forward and answers `{status, checkScheduled}`; the drawer shows the new status; once per 10 s per intent (429 `rate_limited`) |
| "Hủy lượt thanh toán" | confirm dialog with a reason (5 to 500), then E-175 `POST /staff/payments/intents/{id}/cancel` | the intent turns `cancelling`/`cancelled`; the household is told to start again; 409 `intent_not_cancellable` (paid meanwhile) → the drawer shows `paid` |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | tiles and the table header with row skeletons |
| `loaded` | as §4 |
| `empty` | "Chưa có giao dịch online nào" (no intent at all) or "Không có giao dịch khớp bộ lọc" |
| `no gateway` | the building has no active gateway: a neutral banner "Chưa cấu hình cổng thanh toán" with a link to `W-Gateway` (Admin) or a note to ask the Admin (Manager) |
| `error`, `forbidden` | DOC-68 |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.transactions.title` | Giao dịch online | Online payments |
| `web.transactions.subtitle` | Thanh toán thành công được tự động gạch nợ khi nhận webhook có chữ ký hợp lệ. | A successful payment is posted automatically when a webhook with a valid signature arrives. |
| `web.transactions.driver` | Cổng thanh toán: {label} | Payment gateway: {label} |
| `web.transactions.tab.intents` / `.log` | Giao dịch / Tiền cần kiểm tra | Payments / Money to check |
| `web.transactions.tile.paid` / `.pending` / `.duplicates` / `.rejections` | Thành công, đã gạch nợ / Đang chờ xác nhận / Webhook trùng, đã chặn / Webhook bị từ chối | Paid and posted / Waiting for confirmation / Duplicate webhooks blocked / Webhooks rejected |
| `web.transactions.col.code` … | Mã giao dịch, Căn, đợt phí, Số tiền, Lúc, Trạng thái | Code, Unit and batches, Amount, Time, Status |
| `web.transactions.search` | Mã giao dịch, căn | Code or unit |
| `status.intent.pending` / `.paid` / `.failed` / `.cancelled` / `.expired` / `.cancelling` / `.creating` | Đang chờ / Thành công / Lỗi / Đã hủy / Hết hạn / Đang hủy / Đang tạo | Waiting / Paid / Failed / Cancelled / Expired / Cancelling / Creating |
| `web.transactions.recheck` | Truy vấn lại trạng thái | Check the status again |
| `web.transactions.pending.title` | Giao dịch đang chờ | Payments waiting |
| `web.transactions.pending.note` | Hệ thống tự truy vấn lại định kỳ cho đến khi hết hạn. Lần gần nhất {time}: {result}. Khoản phí chỉ được gạch nợ khi cổng xác nhận thành công. | The system checks again at intervals until the payment expires. Last check {time}: {result}. A fee is posted only when the gateway confirms the payment. |
| `web.transactions.cancel` | Hủy lượt thanh toán | Cancel the payment |
| `web.transactions.cancel.confirm` | Hủy lượt thanh toán {code}? Cư dân phải thanh toán lại. | Cancel payment {code}? The resident must pay again. |
| `web.transactions.empty` | Chưa có giao dịch online nào. | No online payments yet. |
| `web.transactions.nogateway` | Chưa cấu hình cổng thanh toán. | No payment gateway is configured. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-66 | **G** 37 paid, 1 pending intents in the range **W** `/transactions` opens **T** the tiles read 37 and 1, the pending row has the re-query action, and the driver tag shows the active driver's label (no "VietQR" or "VNPay" literal) | api, web-e2e |
| UIWF-67 | **G** a pending intent **W** the Manager presses "Truy vấn lại" **T** E-186 is sent, the status is refreshed, and a second press within 10 s is refused with the rate-limit message | api, web-e2e |
| UIWF-68 | **G** a pending intent **W** the webhook settles it while the table is open **T** within 15 s the row turns "Thành công" with no layout shift | api, web-e2e |
| UIWF-69 | **G** a pending intent **W** "Hủy lượt thanh toán" is confirmed with a reason **T** E-175 is sent, the household's app moves to `Pay-Failed`, and the audit row `finance.intent.cancel` exists | api, web-e2e |
| UIWF-70 | **G** the intent is paid between the press and the answer **W** E-175 answers 409 **T** the drawer shows `paid`, not an error | api, web-e2e |
| UIWF-71 | **G** no gateway is configured **W** the page opens **T** the banner shows and no table | web-e2e |
| UIWF-72 | **G** a Technician **W** `/transactions` is opened **T** the app redirects to the dashboard | web-e2e |

### 10. E2E cases

Playwright: `transactions.spec.ts` (UIWF-66, 67, 71, 72), `transactions-live.spec.ts` (UIWF-68, 69, 70).

### 11. Open questions

None.

---

## W-Money-Log

> Status: Draft · Prototype: to design (a wireframe below; a tab of `W-Transactions`) · Phase: P2 (DR-325) · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-21 (money to check), FR-46 (review), FR-47 (the viewer). `admin`, `manager`. Staff only: every other audience gets 403 (EXP-10).

### 2. URL and search params

`/transactions?tab=log`. Search: `outcome` (`all` or one value of §4), `unit`, `from`, `to`, `state` (`open` default, `reviewed`, `all`), `row` (a row opened in the drawer: `<kind>:<id>`).

### 3. Wireframe

```text
Giao dịch │ Tiền cần kiểm tra (3)
┌──────────────────────────────────────────────────────────────────────────┐
│ [Loại ▾] [Căn ▾] [Từ – đến] (•) Chưa kiểm tra ( ) Đã kiểm tra ( ) Tất cả │
├────────┬───────────────┬──────┬───────────┬──────────────────┬───────────┤
│ Lúc    │ Loại          │ Căn  │ Số tiền   │ Mã tham chiếu    │ Trạng thái│
│ 09:12  │ Trùng thanh   │A-0906│  410.000 đ│ pi_3Q…           │ Chưa KT   │
│        │ toán          │      │           │                  │           │
│ 08:40  │ Đã hoàn tiền  │A-1102│2.236.000 đ│ re_3Q…           │ Chưa KT   │
└────────┴───────────────┴──────┴───────────┴──────────────────┴───────────┘
Drawer: số tiền, thời điểm, mã đơn, lượt thanh toán, trích dẫn payload
(không có số tài khoản người trả), phiếu thu nếu đã gạch nợ, ghi chú duyệt.
[ Đánh dấu đã kiểm tra ]
```

Do not copy: no artboard. The table never offers a button that links a row to a charge, a period or a payment, and never pre-fills a payment, an adjustment or a void from a row (DR-16, DR-19, DOC-22 §9.5).

### 4. Regions and components

| Region | Components |
| --- | --- |
| Filters | `SelectField` outcome, unit `SearchField`, date range, a `RadioGroup` state |
| Table | `DataTable` of the rows of E-108: time, outcome `Tag`, unit, amount, reference (a copyable small line), status (open / reviewed by whom) |
| Drawer | the facts of the row, the payload excerpt, the posted payment and receipt links when present, **for a `refunded` or `disputed` row the related payment (code, amount, date), its receipts and the batches they paid, each a link to `W-Fee-Record`** (DR-327), the review note, and the review action |
| Review dialog | `Textarea` note (5 to 1,000, required), button "Đánh dấu đã kiểm tra" |

**Outcomes shown** (`gateway_event.outcome`, DOC-22 §9.1, DR-327): `duplicate_transfer`, `charge_already_paid`, `charge_recalled`, `unknown_order`, and for a bank-transfer driver `amount_short`, `amount_over`; for Stripe also `refunded` and `disputed`. The statement lines (`unmatched`, `statement_only`) join in P3. Each outcome has one plain sentence under its `Tag` that says what the Manager does (below).

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The log | E-108 `GET /staff/money-log?outcome&unit&from&to&state&limit=25&cursor` | `['staff','money-log',{…},cursor]` | keyset `(at, id)`; each row `{kind, id, at, outcome, amount, unitId, unitCode, reference, intentId, paymentId, relatedPayment {id, amount, receivedAt, receipts[] {id, number, batchCode}}, reviewedAt, reviewedBy}`; the first page adds `openCount` |

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Open a row | none | the drawer (`row` in the URL) |
| "Đánh dấu đã kiểm tra" | E-109 `POST /staff/money-log/{kind}/{id}/review {note}` | the row turns reviewed; `openCount` falls; the ledger is unchanged (FR-46.3); 409 `money_log_already_reviewed {reviewedAt}` → the drawer shows who and when; 409 `invalid_transition` (a posted row) ; 422 `reason_too_short` |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | table header and row skeletons |
| `loaded` | as §4 |
| `empty` (open) | "Không có khoản tiền nào cần kiểm tra" with a success mark |
| `empty` (filters) | "Không có dòng khớp bộ lọc" |
| `error`, `forbidden` | DOC-68 |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.money-log.title` | Tiền cần kiểm tra | Money to check |
| `web.money-log.state.open` / `.reviewed` / `.all` | Chưa kiểm tra / Đã kiểm tra / Tất cả | Open / Reviewed / All |
| `status.money-log.duplicate_transfer` | Trùng thanh toán | Duplicate payment |
| `status.money-log.charge_already_paid` | Khoản đã được thanh toán | Fee already paid |
| `status.money-log.charge_recalled` | Khoản đã thu hồi | Fee withdrawn |
| `status.money-log.unknown_order` | Không rõ lượt thanh toán | Unknown payment |
| `status.money-log.amount_short` / `.amount_over` | Thiếu tiền / Thừa tiền | Short / Over |
| `status.money-log.refunded` | Đã hoàn tiền | Refunded |
| `status.money-log.disputed` | Bị khiếu nại | Disputed |
| `web.money-log.hint.duplicate_transfer` | Người trả đã thanh toán hai lần. Hoàn khoản thứ hai trong trang quản trị của cổng thanh toán. | The payer paid twice. Refund the second payment in the gateway's own dashboard. |
| `web.money-log.hint.charge_already_paid` | Khoản phí đã được thanh toán bằng cách khác trước khi tiền về. Hoàn tiền trong trang quản trị của cổng. | The fee was paid another way before this arrived. Refund it in the gateway's dashboard. |
| `web.money-log.hint.charge_recalled` | Đợt phí đã thu hồi khi người trả đang thanh toán. Hoàn tiền trong trang quản trị của cổng. | The batch was recalled while the payer was paying. Refund it in the gateway's dashboard. |
| `web.money-log.hint.unknown_order` | Không tìm thấy lượt thanh toán trong hệ thống. Kiểm tra trong trang quản trị của cổng. | No payment of ours matches this. Check in the gateway's dashboard. |
| `web.money-log.hint.refunded` | Tiền đã được hoàn ở cổng. Hệ thống chỉ ghi lại để đối chiếu với giao dịch và biên lai bên dưới; phiếu thu và công nợ không thay đổi. | The money was refunded at the gateway. The system only records it so you can cross-check it against the payment and receipts below; the receipt and the debt do not change. |
| `web.money-log.hint.disputed` | Người trả khiếu nại khoản này tại ngân hàng. Hệ thống chỉ ghi lại để đối chiếu; làm việc với cổng thanh toán. | The payer disputed this with their bank. The system only records it for cross-checking; work it out with the gateway. |
| `web.fee-record.receipts.flag.refunded` / `.disputed` | Đã hoàn tiền / Bị khiếu nại | Refunded / Disputed |
| `web.money-log.review` | Đánh dấu đã kiểm tra | Mark as checked |
| `web.money-log.review.note` | Ghi chú (ít nhất 5 ký tự) | Note (at least 5 characters) |
| `web.money-log.reviewed.by` | Đã kiểm tra bởi {name} lúc {time} | Checked by {name} at {time} |
| `web.money-log.empty` | Không có khoản tiền nào cần kiểm tra. | No money needs checking. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-73 | **G** a confirmation of a charge paid in cash **W** the log opens **T** a row "Khoản đã được thanh toán" is open with the hint, and the charge, the payments and the debt are unchanged | api, web-e2e |
| UIWF-74 | **G** an open row **W** it is reviewed with a note **T** E-109 is sent once, the row is reviewed with the Manager's name, `openCount` falls by one, and the ledger tables are byte-identical before and after | api, web-e2e |
| UIWF-75 | **G** two Managers review the same row **W** both press **T** the second gets 409 `money_log_already_reviewed` and the drawer shows the first reviewer | api, web-e2e |
| UIWF-76 | **G** a `charge.refunded` event for a posted payment **W** it is delivered **T** a row "Đã hoàn tiền" is open and linked to that payment, the payment shows the tag "Đã hoàn tiền" in `W-Fee-Record` with a link back to the row, and the charge, the receipt and the debt are unchanged (DR-327) | api, web-e2e |
| UIWF-77 | **G** a row **W** the drawer is inspected **T** it has no control to link the row to a charge or to create a payment, an adjustment or a void | web-e2e |
| UIWF-78 | **G** a resident token **W** E-108 is called **T** 403 (EXP-10 cell) | api |

### 10. E2E cases

Playwright: `money-log.spec.ts` (UIWF-73, 74, 75, 76, 77). UIWF-78 is the EXP-10 matrix cell.

### 11. Open questions

None.

---

## UnitMoneyPanel

> Status: Draft · Prototype: to design (a component; wireframe below) · Phase: P2 (DR-325) · DOC-66

### 1. Persona, use cases, permissions

PS-1, PS-2. UC-21, FR-46.2. A component, not a page: it sits inside `W-Unit-Detail` (the tab "Phí và công nợ", N12) and `W-Fee-Record`.

### 2. URL and search params

None of its own. "Xem tất cả" goes to `/transactions?tab=log&unit=<unitId>`.

### 3. Wireframe

```text
Tiền cần kiểm tra của căn A-0906                         Xem tất cả →
 09:12  Trùng thanh toán      410.000 đ   pi_3Q…        Chưa kiểm tra
 ─ hoặc ─
 Không có khoản tiền nào cần kiểm tra của căn này.
```

Do not copy: the unit debt block of the canvas has no money log (N12); the component is added to it. Like the viewer, it offers no link from a row to a charge.

### 4. Regions and components

A `Card` titled `web.unit-money.title` with up to 5 rows (time, outcome `Tag`, amount, reference, state) and the link "Xem tất cả"; hidden entirely when the building has no gateway and the unit has no row.

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The unit's rows | E-110 `GET /staff/units/{id}/money-log?limit=5` | `['staff','unit',unitId,'money-log']` | newest first, open and reviewed; refetched with the hosting screen |

### 6. Interactions

A row opens the drawer of `W-Money-Log` for that row (`/transactions?tab=log&row=…`); "Xem tất cả" opens the filtered log.

### 7. States

`loading` (three skeleton rows), `loaded`, `empty` (the sentence above), `error` (the card shows a retry; the hosting screen stays usable).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.unit-money.title` | Tiền cần kiểm tra của căn {unit} | Money to check for unit {unit} |
| `web.unit-money.all` | Xem tất cả | View all |
| `web.unit-money.empty` | Không có khoản tiền nào cần kiểm tra của căn này. | No money needs checking for this unit. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWF-79 | **G** a unit with two log rows, one reviewed **W** `W-Unit-Detail` opens its fee tab **T** the panel lists both, newest first, with the state of each | api, web-e2e |
| UIWF-80 | **G** a unit with none **W** the panel renders **T** the empty sentence shows and nothing jumps when the data arrives | web-e2e |

### 10. E2E cases

Playwright: `unit-money-panel.spec.ts` (UIWF-79, 80).

### 11. Open questions

None.

## The screens of P3 and P6

`W-Statement` is specified when P3-00 starts, from DOC-25 and DOC-22 §9 (it matters once a bank-transfer driver exists). `W-Reports` and `W-Export-Center` are specified when P6-00 starts, from DOC-33 and the export design. Their rows in DOC-56 §3 and the notes N3, N4 and N12 stay the contract until then. Test IDs continue after `UIWF-80`; keys are `web.statement.*`, `web.reports.*`, `web.export.*`.

## Decisions made while writing

Recorded as DR-324 (decided, Claude delegated by the Owner; none changes a money rule), with DR-325, DR-326 and DR-329 for the online-payment screens.

| Part of DR-324 | Decision | Where used |
| --- | --- | --- |
| Create-then-import | `W-Fee-Import` creates the draft (E-90) when the file is checked, so the import has its `batchId` (DR-265); an abandoned preview leaves an empty draft that can be discarded | `W-Fee-Import` |
| One page for every status | `W-Fee-Batch` serves a draft, a published, a closed and a recalled batch; its header actions depend on the status; the published view is read-only | `W-Fee-Batch` |
| No bulk PDF on a draft | The draft offers the one-unit preview only | `W-Fee-Batch`, `W-Fee-Notice` |
| Missing units | `missing` = units with an active owner and no charge, as `ownedUnitCount − chargedUnitCount`; `view=missing` of E-93 lists them | `W-Fee-Batch` |
| Receipt history in E-102 | E-102 returns the open charges, the summary and the first 20 payments with their receipts, and a cursor for more | `W-Fee-Record` |
| No "send receipt" tick | A posted payment always notifies the unit's members with `view_fees` (`payment.received`); the tick of the canvas is dropped and DOC-22 §5.2 step 8 is reworded | `W-Fee-Record` |
| Debt list order and tiles | E-101 is ordered by outstanding amount; its first page carries the tile `summary` and `asOf`; the "Theo tháng phí" view and the Excel export wait for P6 | `W-Debts` |
| Early warning | A recall dialog opens already blocked when the batch has a paid charge | `W-Fee-Recall` |
| Wireframes | `W-Fee-Recall`, `W-Charge-Void`, `W-Fee-Reissue`, `W-Money-Log`, `UnitMoneyPanel` have no artboard: ASCII wireframes are their specification | those screens |
| Staff re-query (DR-329) | `W-Transactions` re-queries an intent through E-186 `POST /staff/payments/intents/{id}/check`, once per 10 s per intent, because the resident's E-88 is for members | `W-Transactions` |
| Provider-neutral wording (DR-325, N3) | The screens name the active driver by its label from E-49 and say "webhook", never "IPN", VNPay or VietQR as fixed words | `W-Transactions`, `W-Money-Log` |

## Not in this document

| Topic | Lives in |
| --- | --- |
| The batch lifecycle, the import flow and the commit | DOC-21 |
| The rules and texts of an import row | DOC-18 §2 |
| Manual payment, void, debt queries, reminders, the money log | DOC-22 |
| The fee-notice PDF and the bulk job | DOC-34 |
| What the resident sees | DOC-58 |
| Online money screens | DOC-66 (P3) |
| Shared states, errors, forbidden | DOC-68 |

## Traceability

| Screen | Requirements | Decisions | Tests |
| --- | --- | --- | --- |
| `W-Fees` | FR-03, FR-04, FR-44 | DR-20, DR-72, DR-304 | `UIWF-01…05` |
| `W-Fee-Import` | FR-01, FR-02.1, NFR-12 | DR-21, DR-22, DR-265, DR-324 | `UIWF-06…14` |
| `W-Fee-Batch` | FR-02, FR-03, FR-04, FR-36.4, FR-44, FR-49 | DR-11, DR-97, DR-265, DR-293, DR-324 | `UIWF-15…25` |
| `W-Fee-Notice` | FR-36 | DR-56, DR-293 | `UIWF-26…31` |
| `W-Fee-Record` | FR-05, FR-06, FR-12, FR-49 | DR-23, DR-24, DR-84, DR-324 | `UIWF-32…42` |
| `W-Fee-Recall` | FR-04 | DR-72, DR-97 | `UIWF-43…47` |
| `W-Charge-Void` | FR-49 | DR-19, DR-20 | `UIWF-48…52` |
| `W-Fee-Reissue` | FR-04.5 | DR-20, DR-265 | `UIWF-53…56` |
| `W-Debts` | FR-12 | DR-18, DR-324 | `UIWF-57…65` |
| `W-Transactions` | FR-08.4, FR-10.1…10.3 | DR-28, DR-325, DR-326, DR-329 | `UIWF-66…72` |
| `W-Money-Log` | FR-46, FR-47 | DR-16, DR-327 | `UIWF-73…78` |
| `UnitMoneyPanel` | FR-46.2 | DR-16 | `UIWF-79…80` |

## Open questions

None. `W-Statement` and the P6 screens raise theirs when they are written.
