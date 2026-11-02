# UI states and copy

> Status: **Approved** (Owner, 2026-10-21, as the skeleton and the P1 keys; it grows per phase) · Updated: 2026-11-02 (copy of `amount_above_maximum` and `too_many_rows_for_pdf`) · 2026-11-01 (DR-314: copy for five error codes, built in P1-30, and `status.unit-type.*`) · 2026-10-28 (DR-306: §2 the refreshing state and layout-shaped skeletons) · 2026-10-28 (P1-26: the `notify.*` and `pdf.*` families owned by DOC-31 and DOC-34, §1) · 2026-10-28 (DR-279: §4.6 the usage switch) · 2026-10-22 (P1-09: the catalog built from §3–§6, parity by argument kind, word formatters return a phrase, DR-235; DR-226: `status.import.*` labels; DR-96: `unmatchedTransfer` text) · DOC-68
> Depends on: [DR](../00-decision-register.md) (DR-17, DR-45, DR-71, DR-74, DR-84, DR-127, DR-128, DR-174, DR-175, DR-183, DR-195, DR-197, DR-205, DR-206, DR-96, DR-226), [DOC-06](../02-glossary.md), [DOC-42](../06-design/error-handling.md) §5, §9, [DOC-50](../07-api/api-guidelines.md) §11, [DOC-53](ux-principles-and-ia.md) (UX-01…20), [DOC-54](design-system.md) §6, §9, [DOC-55](client-architecture.md) §6, §9, §11, [DOC-56](screens/README.md) §6.4, the screen documents DOC-57, 60, 61, 64, 65, 67
> Main readers: P1-09 (`@rms/i18n-catalog`, the parity and formatter tests), P1-16, P1-17 (clients), the API error handler (P1-04: the server renders `error.<code>`), the writers of DOC-58, 59, 62, 63, 66

This document owns the words the whole product shares: the six view-state patterns, the message of **every** error code of DOC-42 §5 in Vietnamese and English, the labels of every status, the `common.*`, `auth.*`, `offline.*` and `upgrade.*` keys, and the number, date and phone formats of DR-71. A screen document owns only its own keys `<app>.<screen>.<element>` (DOC-56 §6.4) and refers to the keys here. It does not hold the endpoint list (DOC-51), the behavior of a client on an answer (DOC-55 §6), the colors and components (DOC-54) or the catalog files themselves (`@rms/i18n-catalog`, P1-09).

Quick pass (the Owner has the canvas): the Vietnamese text of the prototype is quoted as drawn; every other text is written here in plain Vietnamese ("bạn", short sentences) and plain English. The error table (§3) is generated from the 108 codes of DOC-42 §5, so no code is missing; a code added to DOC-42 adds a row here in the same change (UICP-03).

## 1. How keys work

| Point | Rule |
| --- | --- |
| Catalog | One package, `@rms/i18n-catalog`, with `vi` and `en` (DR-71). It feeds the three clients, the API (error messages, notification templates, emails) and the PDFs. A key exists in both languages or the build fails (NFR-13, P1-09). Each language is one flat map of ICU messages by key (DR-235): the shared families of this document are in `src/shared/en.ts` (which defines the key type) and `src/shared/vi.ts`; a screen document's keys go in their own files. The web CMS imports `@rms/i18n-catalog/web`, whose catalog is the shared families and `web.*` only: the mails, SMS and import issues are rendered by the API and `res.*`/`staff.*` belong to the apps, and without the split they would sit in every web page's first load (DOC-53 §8, DR-179). A test fails when the web sources write a key that this catalog lacks P1-09 generated the shared files from §3–§6; a change to a shared text changes both the catalog file and the row here |
| Key shape | `<app>.<screen>.<element>` for a screen (DOC-56 §6.4). Shared keys have a fixed first segment: `error.`, `status.`, `common.`, `auth.`, `offline.`, `upgrade.`. This document owns exactly these six families; `mail.*` (the staff mails) and `sms.*` (the resident SMS, which carry no diacritics and fit 160 characters) are the two families of the server that DOC-26 §5.4 owns; any other first segment belongs to a screen document. *Revised 2026-10-28 (P1-26):* two more families of the server: `notify.*` (the inbox and push texts, `notify.<templateKey>.title` and `.body`) is owned by DOC-31 §3.4 (DR-303), and `pdf.*` (the printed labels of the fee notice, the receipt and the report and library PDFs) by DOC-34 §5–§7 (DR-295); their texts live there, not here, and the parity test covers them. The last segment is lower case with `-` between words, **except** where it is a domain value (`status.ticket.in_progress`) or an existing DOC-56 name with `_` (`auth.signed_out`): a domain value is written as the enumeration writes it |
| Placeholders | ICU: `{minutes}`, `{attemptsLeft}`, `{requestId}`. Amounts, dates, times and phone numbers are **never** interpolated as text: the caller passes the result of the formatter (§7) as a string argument, so the catalog only holds the sentence |
| Plurals | Vietnamese has no plural form: write `{count} phút trước` or, where the same argument has an English plural, `{count, plural, other {# phút}}`. English uses `one` and `other`. The parity test compares the **set of argument names and their kinds** (`plain`, `number`, `date`, `time`, `select` with its options), not the branch structure of `plural`: a `plural` argument is a `number`, and a plain argument matches a `number`, so `Còn {count} ngày` matches `{count, plural, one {# day left} other {# days left}}` (DR-224, DR-235) |
| Who renders what | The **server** renders `error.<code>` (and `details[].message` of `validation_failed`) in the caller's language and returns it in `message` (DOC-42 §3). The **client** renders `t('error.' + code, details)` itself when a screen needs the same text offline-safe, and falls back to `message` when the catalog has no key (DOC-55 §6). Both read the same catalog, so the two texts are identical; test UICP-11 pins it |
| Screen aliases | A screen may define a key of its own for a code when it needs words the generic message lacks (`res.login-error.field.phone.error` for `phone_not_registered`). The alias never replaces the generic key: the generic key still exists (the API returns it) |
| Terms | Residents say "Yêu cầu", staff and web say "Phiếu" or "Phiếu hỗ trợ" for a ticket (DR-197, UX-20); "Đợt phí" for a fee batch; "Biên lai thu tiền" for a receipt, which says it is not a tax invoice (DR-17); "Ban quản lý" (short "BQL") for the management office. A money mismatch says "The management office will check" (DR-84): "Ban quản lý sẽ kiểm tra" |
| Tone | One sentence of what happened, one of what to do. No blame ("bạn nhập sai" is written "chưa đúng"), no raw code, no HTTP, no stack term, at most 140 characters (UICP-13). The English is as plain as the Vietnamese |

## 2. View-state patterns

UX-10 gives every view six states. This table fixes the component, the timing and the keys; a screen document lists which of the six apply and adds only its own words (`<screen>.empty.title`).

| State | When | Component (DOC-54) | Pattern and timing | Keys |
| --- | --- | --- | --- | --- |
| Loading | A query has no data yet | `Skeleton` | Skeleton rows of the final shape after 150 ms; before that nothing, so a fast answer does not flash. Never a lone spinner for a list. A button that sends shows its own spinner and is disabled. A region has the accessible label `common.loading`. On the web the skeleton is the layout itself (DR-306): a table keeps its real header and fixed column widths with bars in the row height of the data, a page header keeps its subtitle line, a dialog shows label and field shapes of its form, and the boot shows the shell's frame | `common.loading` |
| Refreshing | A filter, a search or a page changes while rows are on screen | `DataTable busy` | The previous rows stay, dimmed to 60%, under a 2 px `teal` bar, until the new answer replaces them (`keepPreviousData`); no skeleton, so the table does not collapse and regrow. The new rows fade in (180 ms) (DR-306) | — |
| Timing, any API speed | Every indicator above | `Skeleton`, `DataTable busy`, `Button loading` | Nothing flashes on a fast API and nothing blinks on a slow one (DR-306): a skeleton fades in only after 150 ms, so an answer under 150 ms replaces it unseen; the dimming and bar of a busy table show after 150 ms and stay at least 300 ms; a button is disabled at once but its spinner shows after 150 ms and stays at least 400 ms (`useDelayedFlag`); content that replaces a skeleton, a tab and a new page fade in (180 ms); a background refetch with equal data does not refade (`useIdentityKey`). The full rules, motion values and acceptance checks are DOC-54 §17 | — |
| Empty, no data | A list that has no rows and no filter | `EmptyState` (icon well, title, body, one action) | Says why and what to do ("Chưa có căn hộ nào / Nhập danh sách căn hộ từ file Excel hoặc thêm từng căn."). One primary action when the role can fix it, the contact when it cannot | `<screen>.empty.title`, `.empty.body`, `<screen>.empty.action` |
| Empty, filtered | A filter or a search hides every row | `EmptyState` | Names the filter and offers "Xóa bộ lọc". Never the "no data" text | `<screen>.empty-filter.title`/`.body`, else `common.empty.filtered.*`; `common.action.clear-filters` |
| Error, one field | `validation_failed` or a rule code with a `path` | Field helper text (`TextField`), `danger` | Under the field, text from `details[].message`; the first invalid field takes focus. A `path` that matches no field becomes the form banner | `error.<rule code>`, `<screen>.field.<name>.error` |
| Error, action | A write failed and the screen is still usable (409, 422, 403 `forbidden`, `rate_limited`) | `Toast` for a result that needs no decision; `Banner` (tone `danger`/`warning`) above the form when the user must act; `Dialog` when the answer asks a decision (`staff_has_open_tickets`) | Toast 5 s, dismissible; a banner stays until the next submit. The 409 family refetches first and keeps what the user typed (UX-02). 429 shows the countdown on the control | `error.<code>`, `common.retry-in` |
| Error, page | The main query of a screen fails (5xx, network with nothing to show) | `EmptyState` variant with a retry button | Title, body, retry, and under it the reference of the failed request. The rest of the shell (sidebar, tab bar) stays usable | `common.error.page.title`/`.body`, `common.action.retry`, `common.reference` |
| Error, crash | A render error caught by the boundary | Full-screen boundary | Message, reference, "Tải lại" (reload). Reported once to E-04 (DOC-55 §15) | `common.error.boundary.*`, `common.action.reload`, `common.reference` |
| Stale | A refetch fails but older data is on screen | `Banner` (tone `warning`) above the data | "Chưa làm mới được. Đang hiện dữ liệu lúc 09:30." with "Làm mới". Money screens do not use it: they show the offline or error state instead (UX-05) | `common.stale.banner`, `common.action.refresh` |
| Forbidden | 403 `forbidden`, or a route whose role list excludes the role | `EmptyState` (lock icon) | Replaces the content; no redirect (UX-07). The shell stays. "Contact an Admin" | `common.forbidden.title`/`.body` |
| Not found | 404 on a detail screen | `EmptyState` | Link back to the list. From a push or a stale list, go back and refetch the list (DOC-55 §6) | `common.not-found.title`/`.body` |
| Offline | No network (`isInternetReachable === false`) | Global strip under the top bar | Stays on screen while offline; data already loaded stays visible; every control that writes is disabled with the reason; on reconnect the visible queries refetch. A persisted screen shows its age. A money screen offline shows `offline.money`, not old numbers | `offline.banner`, `offline.updated`, `offline.action_disabled`, `offline.money`, `offline.back_online` |
| Maintenance | 503 `maintenance` or a `GET /public/config` flag | Full-width `Banner` (tone `info`) | The app does not sign out; polls `GET /public/config` every 30 s until it answers; writes disabled meanwhile | `error.maintenance` |
| Upgrade | 426 `upgrade_required`, or the early check below `apps.<app>.minVersion` | Full-screen blocking page | Cannot be dismissed; one button opens `storeUrl`; nothing else is reachable | `upgrade.*` |
| Session ended | A refresh fails, or the SSE event `session.revoked` | Sign-in screen with a banner | Destination kept in `redirect`; the banner shows once | `auth.signed_out`, `auth.session_revoked` |
| Lost answer | A write got no answer | `Banner` (tone `warning`) | For a write with an `Idempotency-Key` the client retries as DOC-42 §9 says; for money it says "not sure" and offers a read, never a second `POST` (UX-01) | `common.network.unsure`, `common.network.not-sent` |
| Blocked account / role | Wrong client, no unit, locked | Per screen | The cases of UX-11 each have a screen owned by its document: `staff.login.wrong-app.*`, `web.wrong-app.*`, `res.unit-pick.empty.*`, `res.login-error.*`, `res.terms-update.*` | screen keys |

## 3. Error catalog

Every code of DOC-42 §5 has the key `error.<code>` in both languages (DOC-42 principle 1, test ER-03). `HTTP` and the English text are DOC-42's; the Vietnamese text and the UI action are written here. "Screens" lists the screen documents that name the code now (P1); a code with `—` is raised by an endpoint whose screen is not written yet. The column "Phase" is `P1` when an endpoint or screen of the first phase can answer it.

Parameters come from `details` (DOC-42 §3). Money in a message is passed already formatted (§7).

### 3.1 Every request (DOC-42 §5.1)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `validation_failed` | 400/422 | Một số thông tin chưa hợp lệ. Hãy kiểm tra lại. | Some values are not valid. | Show against the field (`details[].path`); form banner if no field matches | DOC-57, DOC-61, DOC-64, DOC-65, DOC-67 | P1 |
| `malformed_request` | 400 | Không đọc được yêu cầu gửi lên. Hãy thử lại. | The request could not be read. | Report `kind: network` once (client bug); show the message | — | later |
| `invalid_cursor` | 400 | Vị trí trong danh sách không còn hợp lệ. Hãy tải lại danh sách. | The list position is no longer valid. Reload the list. | Drop the cursor stack, refetch page 1 | DOC-65 | P1 |
| `unauthenticated` | 401 | Hãy đăng nhập lại. | Please sign in again. | Refresh once and replay; if refresh fails, sign out with `auth.signed_out` | — | P1 |
| `forbidden` | 403 | Bạn không có quyền thực hiện thao tác này. | You do not have permission to do this. | Forbidden state (page) or toast (action); no retry | DOC-57, DOC-64, DOC-67 | P1 |
| `not_found` | 404 | Không tìm thấy nội dung này. | We could not find this. | The screen's gone/empty state; go back and refetch the list | DOC-57, DOC-60, DOC-65, DOC-67 | P1 |
| `method_not_allowed` | 405 | Thao tác này không khả dụng. | This action is not available. | Show the message; report as a client bug | — | later |
| `version_conflict` | 409 | Nội dung này vừa được người khác thay đổi. Hãy tải lại rồi thử lại. | This was changed by someone else. Reload and try again. | Refetch the resource, show the message, keep the user's input (UX-02) | DOC-61, DOC-64, DOC-65, DOC-67 | P1 |
| `precondition_required` | 428 | Hãy tải lại rồi thử lại. | Reload and try again. | Client bug (missing `If-Match`): report once, reload the resource | — | P1 |
| `payload_too_large` | 413 | Dữ liệu gửi lên quá lớn. | The request is too large. | Show the message; no automatic retry | — | P1 |
| `request_in_progress` | 409 | Thao tác này đang được xử lý. Hãy thử lại sau giây lát. | This request is still being processed. Try again in a moment. | Wait `Retry-After`, retry with the same `Idempotency-Key` | — | later |
| `idempotency_key_reuse` | 422 | Thao tác này đã được gửi với nội dung khác. Hãy làm lại từ đầu. | This request was already used with different content. | Client bug: new intent key, start again | DOC-65, DOC-67 | P1 |
| `upgrade_required` | 426 | Hãy cập nhật ứng dụng để tiếp tục. | Update the app to continue. | Blocking update screen (`upgrade.*`) | DOC-57, DOC-61 | P1 |
| `rate_limited` | 429 | Bạn thao tác quá nhiều lần. Hãy thử lại sau. | Too many attempts. Try again later. | Countdown from `Retry-After` on the control (`common.retry-in`) | DOC-57, DOC-61, DOC-64, DOC-65, DOC-67 | P1 |
| `internal_error` | 500 | Đã có lỗi xảy ra. Hãy thử lại sau. | Something went wrong. Try again later. | Message with `common.reference`; a `GET` retries once | DOC-65 | P1 |
| `service_unavailable` | 503 | Hệ thống đang bận. Hãy thử lại sau giây lát. | The service is busy. Try again in a moment. | Reads: offline/stale banner; writes: `common.network.not-sent`; retry per DOC-42 §9 | DOC-60, DOC-64 | P1 |
| `maintenance` | 503 | Hệ thống đang được cập nhật. Hãy thử lại sau vài phút. | The system is being updated. Try again in a few minutes. | Full-width banner; poll `GET /public/config` every 30 s; never sign out | DOC-57, DOC-61, DOC-64 | P1 |

### 3.2 Sign-in, accounts and consent (DOC-42 §5.3)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `invalid_credentials` | 401 | Email hoặc mật khẩu chưa đúng. | The email or password is not correct. | Field error on the password; no counter (DR-128) | DOC-61, DOC-64 | P1 |
| `account_locked` | 423 | Đăng nhập sai quá nhiều lần. Thử lại sau {minutes} phút. | Too many attempts. Try again in {minutes} minutes. | Banner; submit waits; countdown from `details.retryAfter` | DOC-61, DOC-64 | P1 |
| `otp_invalid` | 400 | Mã chưa đúng. Còn {attemptsLeft} lần thử. | Wrong code. {attemptsLeft} tries left. | Clear and focus the code field; at `attemptsLeft: 0` show `res.otp.locked` | DOC-57 | P1 |
| `phone_not_registered` | 404 | Số này chưa được đăng ký. | This number is not registered. | `Login-Error` (screen alias `res.login-error.field.phone.error`) | DOC-57 | P1 |
| `token_invalid` | 400 | Link không còn hiệu lực. Hãy yêu cầu link mới. | This link is no longer valid. Ask for a new one. | `W-Reset` explains and points to the Admin/Manager | DOC-64 | P1 |
| `step_up_required` | 403 | Hãy xác nhận bằng mật khẩu và mã chúng tôi đã gửi qua email. | Confirm with your password and the code we emailed you. | Open `W-Step-Up`, then replay with `stepUp` | DOC-64, DOC-67 | P1 |
| `step_up_failed` | 403 | Mật khẩu hoặc mã chưa đúng. | The password or code is not correct. | Stay in `W-Step-Up`; show `attemptsLeft` | DOC-64, DOC-67 | P1 |
| `phone_in_use` | 409 | Số điện thoại này đã thuộc về tài khoản khác. | This number already belongs to another account. | Field error on the phone | DOC-65 | P1 |
| `email_in_use` | 409 | Email này đã được dùng. | This email is already used. | Field error on the email | DOC-67 | P1 |
| `staff_has_open_tickets` | 409 | Người này còn phiếu đang xử lý. Hãy giao lại các phiếu trước. | This person still has open requests. Reassign them first. | Dialog listing `details.tickets` with a link to each | DOC-67 | P1 |
| `last_admin` | 409 | Tòa nhà cần ít nhất một quản trị viên đang hoạt động. | The building needs at least one active administrator. | Show the message; no automatic retry | DOC-67 | P1 |
| `membership_inactive` | 403 | Bạn không còn quyền vào căn này. | You no longer have access to this home. | Drop the unit's cache, refetch `GET /me`, go to `Unit-Pick` with a banner | DOC-57, DOC-60, DOC-65 | P1 |
| `terms_required` | 403 | Hãy đồng ý điều khoản mới để tiếp tục. | Please accept the updated terms to continue. | Open `Terms-Update`, then replay the call once | DOC-57 | P1 |
| `terms_version_superseded` | 409 | Điều khoản vừa được cập nhật. Hãy đọc bản mới. | The terms were updated. Please read the new version. | Refetch `GET /me/terms` and show the new version (screen alias `res.terms.superseded`) | DOC-57 | P1 |
| `deletion_not_requested` | 409 | Tài khoản này chưa yêu cầu xóa. | This account has not asked to be deleted. | Refetch the resident; show the message | DOC-65 | P1 |
| `owner_must_transfer` | 409 | Hãy chuyển quyền chủ hộ của căn trước. | Transfer ownership of the unit first. | Dialog naming `details.unitIds` | DOC-60, DOC-65 | P1 |
| `invalid_signature` | 401 | Chữ ký không hợp lệ. | Invalid signature. | None: a webhook answer; never shown to a person | — | later |

### 3.3 Residency and imports (DOC-42 §5.4)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `import_expired` | 409 | Bản xem trước đã hết hạn. Hãy tải tệp lên lại. | This preview has expired. Upload the file again. | Banner on `W-Import`; back to the upload step | DOC-65 | P1 |
| `import_not_ready` | 409 | Lần nhập này chưa sẵn sàng để lưu. | This import is not ready to commit. | Refetch E-73 and show the real state | DOC-65 | P1 |
| `import_stale` | 409 | Dữ liệu đã thay đổi từ lúc kiểm tra. Hãy tải tệp lên lại. | The data changed since the preview. Upload the file again. | Banner `web.import.banner.stale`; back to the upload step | DOC-65 | P1 |
| `member_exists` | 409 | Người này đã là thành viên của căn. | This person is already a member of this home. | Field error; link to the existing membership | DOC-65 | P1 |
| `unit_has_owner` | 409 | Căn này đã có chủ hộ. Hãy chuyển quyền chủ hộ. | This unit already has an owner. Transfer ownership instead. | Field error; offer the transfer dialog | DOC-65 | P1 |
| `unit_code_in_use` | 409 | Mã căn này đã được dùng. | This unit code is already used. | Field error on the unit code | DOC-65 | P1 |
| `unit_type_code_in_use` | 409 | Mã loại này đã được dùng. | This unit type code is already used. | Field error on the code | DOC-65 | P1 |
| `unit_type_name_in_use` | 409 | Tên loại này đã được dùng. | This unit type name is already used. | Field error on the Vietnamese name | DOC-65 | P1 |
| `unit_type_limit` | 409 | Mỗi tòa nhà có tối đa {max} loại căn hộ. | A building can have at most {max} unit types. | max; banner in the dialog | DOC-65 | P1 |
| `invalid_transition` | 409 | Không thể làm việc này ở trạng thái hiện tại. | This can no longer be done in its current state. | Refetch the resource, show the message, keep the user's input (UX-02) | DOC-65, DOC-67 | P1 |

### 3.4 Finance (DOC-42 §5.5)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `charge_changed` | 409 | Khoản phí này vừa thay đổi. Hãy xem lại danh sách rồi thử lại. | This charge has just changed. Check the list and try again. | Refetch the resource, show the message, keep the user's input (UX-02); use `details.charges` | — | later |
| `payment_in_progress` | 409 | Đã có một thanh toán đang mở cho khoản này, do {holder} tạo. | A payment for this is already open, started by {holder}. | Message; offer to open the existing intent | — | later |
| `allocation_mismatch` | 422 | Số tiền không khớp với các khoản phí đã chọn. | The amount does not match the selected charges. | Refetch the charges; recompute the total | — | later |
| `intent_not_cancellable` | 409 | Không thể hủy thanh toán này nữa. | This payment can no longer be cancelled. | Refetch the intent and show its real status | — | later |
| `batch_has_payments` | 409 | Đợt phí này đã có người thanh toán nên không thu hồi được. Hãy hủy từng khoản phí. | This batch has payments and cannot be recalled. Void individual charges instead. | Dialog on `W-Fee-Recall`; point to the void action | — | later |
| `charge_not_voidable` | 409 | Khoản phí này đã được thanh toán nên không hủy được. | This charge has been paid and cannot be voided. | Refetch the charge; close the void dialog | — | later |
| `payment_not_voidable` | 409 | Tiền đã được ngân hàng xác nhận không hoàn tác được ở đây. Hãy hoàn tiền ngoài hệ thống. | Money confirmed by the bank cannot be undone here. Refund it outside the system. | Show the message; no automatic retry | — | later |
| `money_log_already_reviewed` | 409 | Dòng này đã được kiểm tra. | This row has already been reviewed. | Refetch the row; close the dialog | — | later |
| `gateway_unavailable` | 502 | Dịch vụ thanh toán đang không khả dụng. Hãy thử lại sau. | The payment service is not available. Try again later. | Message with a retry button; payment choice stays | — | P1 |
| `gateway_in_use` | 409 | Đang có thanh toán online mở. Hãy thử lại khi không còn thanh toán nào. | Online payments are in progress. Try again when none is open. | Show the message; no automatic retry | DOC-67 | P1 |
| `foreign_building` | 400 | Mã đơn thuộc về tòa nhà khác. | The order code belongs to another building. | None: a webhook answer; never shown to a person | — | later |
| `sms_unavailable` | 503 | Chưa gửi được mã. Hãy thử lại sau. | Could not send the code. Try again later. | Show on `Login`/`OTP` with the office hotline row from E-03 | DOC-57 | P1 |

### 3.5 Tickets, vehicles, notices and the library (DOC-42 §5.6)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `ticket_already_accepted` | 409 | Yêu cầu này đã được tiếp nhận nên không hủy được nữa. | This request has already been accepted and can no longer be cancelled. | Refetch the resource, show the message, keep the user's input (UX-02); use `details.ticket` | — | later |
| `ticket_reassigned` | 409 | Phiếu này đã được giao cho người khác. | This job was reassigned. | Refetch the resource, show the message, keep the user's input (UX-02); use `details.ticket` | — | later |
| `already_rated` | 409 | Yêu cầu này đã được đánh giá. | This request has already been rated. | Refetch; show the rating read-only | — | later |
| `rating_window_closed` | 409 | Đã hết thời gian đánh giá yêu cầu này. | The time to rate this request has passed. | Hide the rating control | — | later |
| `plate_in_use` | 409 | Biển số này đã được đăng ký. | This plate is already registered. | Field error on the plate | — | later |

### 3.6 Files and building (DOC-42 §5.7)

| Code | HTTP | `vi` | `en` | UI action | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `file_not_verified` | 422 | Không dùng được tệp này. Hãy chọn lại. | The file could not be used. Choose it again. | Drop the upload, let the user choose again | DOC-60, DOC-61, DOC-64, DOC-65, DOC-67 | P1 |
| `quota_exceeded` | 413 | Dung lượng lưu trữ đã đầy. Hãy liên hệ quản trị viên. | Storage is full. Contact the administrator. | Show the message; no automatic retry | DOC-60, DOC-61, DOC-64, DOC-65, DOC-67 | P1 |
| `demo_reset_running` | 409 | Đang có một lần đặt lại dữ liệu chạy. | A reset is already running. | Show the message; no automatic retry | — | P1 |

### 3.7 Rule codes of `validation_failed` (DOC-42 §5.2)

A rule code is the `details[].code` of a `validation_failed`. Its key is `error.<rule code>` in the **same** namespace as the top-level codes (DR-220): the names are distinct, and test UICP-06 fails the build if a new code reuses a name. The server renders `details[].message` from this key with the parameters of the schema (the wire shape `{path, code, message}` carries no parameters); the client shows `message` as received, or its own `<screen>.field.<name>.error` when the screen branches on the rule.

| Rule code | HTTP | `vi` | `en` | Parameters | Screens | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `required` | 400 | Vui lòng nhập thông tin này. | This field is required. | — | — | P1 |
| `type` | 400 | Giá trị này không đúng dạng. | This value is not the right type. | — | — | P1 |
| `format` | 400 | Giá trị này chưa đúng định dạng. | This value is not in the right format. | — | DOC-65 | P1 |
| `enum` | 400 | Hãy chọn một giá trị trong danh sách. | Choose one of the listed values. | — | — | P1 |
| `pattern` | 400 | Giá trị này có ký tự không được phép. | This value has characters that are not allowed. | — | — | P1 |
| `min_length` | 400 | Nhập ít nhất {min} ký tự. | Write at least {min} characters. | min | — | P1 |
| `max_length` | 400 | Nhập tối đa {max} ký tự. | Write at most {max} characters. | max | — | P1 |
| `minimum` | 400 | Giá trị tối thiểu là {min}. | Must be at least {min}. | min | — | P1 |
| `maximum` | 400 | Giá trị tối đa là {max}. | Must be at most {max}. | max | — | P1 |
| `max_items` | 400 | Chọn tối đa {max}. | Choose at most {max}. | max | — | later |
| `min_items` | 400 | Chọn ít nhất {min}. | Choose at least {min}. | min | — | later |
| `unknown_key` | 400 | Thông tin này không được chấp nhận. | This field is not accepted. | — | DOC-60 | P1 |
| `file_type_not_allowed` | 400 | Loại tệp này không được dùng ở đây. | This file type is not allowed here. | — | DOC-60, DOC-61, DOC-64, DOC-65 | P1 |
| `file_too_large` | 400 | Tệp quá lớn. Giới hạn là {maxMb} MB. | The file is too large. The limit is {maxMb} MB. | maxMb | DOC-60, DOC-61, DOC-64, DOC-65 | P1 |
| `too_many_rows` | 400 | Tệp có hơn {maxRows} dòng. Hãy tách thành nhiều tệp. | The file has more than {maxRows} rows. Split it into smaller files. | maxRows | DOC-65 | P1 |
| `too_many_rows_for_pdf` | 422 | Báo cáo có hơn {max} dòng, quá nhiều để xuất PDF. Hãy xuất Excel hoặc thu hẹp bộ lọc. | The report has more than {max} rows, too many for a PDF. Export to Excel or narrow the filter. | max | DOC-33 | later |
| `too_many_charges` | 400 | Bạn chọn tối đa {max} khoản phí mỗi lần thanh toán. | You can pay at most {max} charges at once. | max | — | later |
| `too_few_charges` | 400 | Hãy chọn ít nhất một khoản phí để thanh toán. | Select at least one charge to pay. | — | — | later |
| `amount_below_minimum` | 400 | Tổng tiền thấp hơn mức tối thiểu để thanh toán online ({min}). | The total is below the minimum for online payment ({min}). | min (formatted money) | — | later |
| `amount_above_maximum` | 400 | Tổng tiền vượt mức tối đa để thanh toán online ({max}). Hãy chọn ít khoản hơn. | The total is above the maximum for online payment ({max}). Select fewer charges. | max (formatted money) | — | later |
| `password_weak` | 400 | Mật khẩu cần 8 ký tự trở lên, có cả chữ và số. | The password needs 8 or more characters, with letters and digits. | — | DOC-64 | P1 |
| `phone_invalid` | 400 | Số điện thoại chưa đúng. Kiểm tra lại số bạn nhập. | This phone number is not valid. Check the number you entered. | — | DOC-57, DOC-65 | P1 |
| `received_on_future` | 400 | Ngày nhận tiền không được ở tương lai. | The payment date cannot be in the future. | — | — | later |
| `received_on_too_old` | 400 | Ngày nhận tiền cách đây hơn 90 ngày. | The payment date is more than 90 days ago. | — | — | later |
| `no_charges` | 400 | Đợt phí này chưa có khoản phí nào. | This batch has no charges yet. | — | — | later |
| `charge_total_zero` | 400 | Có khoản phí trong đợt này có tổng bằng 0. | A charge in this batch has a total of zero. | — | — | later |
| `due_date_in_past` | 400 | Hạn thanh toán không được ở quá khứ. | The due date cannot be in the past. | — | — | later |
| `due_date_not_later` | 400 | Hãy chọn ngày sau hạn hiện tại. | Choose a date later than the current due date. | — | — | later |
| `no_unit_selected` | 400 | Hãy chọn ít nhất một căn. | Select at least one unit. | — | — | later |
| `too_many_units` | 400 | Mỗi lần chỉ chọn tối đa {max, number} căn. | Select at most {max, number} units at a time. | — | — | later |
| `audience_empty` | 400 | Bản tin này chưa có người nhận. Hãy chọn đối tượng. | This notice would reach nobody. Choose who receives it. | — | — | later |
| `notice_rule` | 400 | Bản tin có nội dung, tệp đính kèm hoặc liên kết không được phép. | The notice has a body, attachment or link that is not allowed. | — | — | later |
| `folder_depth` | 400 | Thư mục chỉ được lồng tối đa {max} cấp. | Folders can be at most {max} levels deep. | max | — | later |
| `external_url` | 400 | Không được chèn ảnh từ trang ngoài. | External images are not allowed. | — | — | later |
| `unsafe_link` | 400 | Liên kết này không được phép. | This link is not allowed. | — | — | later |
| `terms_text` | 400 | Văn bản dùng định dạng không được phép (dòng {line}). | The text uses formatting that is not allowed (line {line}). | line | DOC-67 | P1 |
| `reason_too_short` | 422 | Nhập ít nhất {min} ký tự. | Write at least {min} characters. | min | DOC-65 | P1 |
| `same_assignee` | 422 | Phiếu này đang do người đó phụ trách. | This ticket is already assigned to that person. | — | — | later |
| `assignee_locked` | 422 | Người này không nhận được việc. Hãy chọn người khác. | That person cannot take jobs. Choose someone else. | — | — | P1 |
| `setting_invalid` | 422 | Giá trị cài đặt này chưa hợp lệ. | This setting value is not valid. | — | DOC-67 | P1 |
| `one_change_only` | 400 | Mỗi lần chỉ đổi một thông tin. | Change one thing at a time. | — | — | P1 |
| `min_properties` | 400 | Chưa có thay đổi nào để lưu. | There is nothing to save. | — | — | P1 |
| `can_pay_tenant_only` | 422 | Chỉ người thuê mới được cấp quyền thanh toán phí. | Only a tenant can be allowed to pay fees. | — | DOC-65 | P1 |
| `unit_type_unknown` | 422 | Loại căn hộ này không còn. Hãy chọn loại khác. | This unit type no longer exists. Choose another. | Field error on the type; the select reloads | DOC-65 | P1 |
| `unit_type_archived` | 422 | Loại căn hộ này đã ngừng dùng. Hãy chọn loại khác. | This unit type is no longer in use. Choose another. | Field error on the type; the select reloads | DOC-65 | P1 |
| `driver_not_allowed` | 422 | Chế độ thanh toán này chỉ dành cho tòa nhà demo. | This payment mode is only for demo buildings. | — | — | P1 |

Two more rules apply to every rule code: the wording is a **sentence about the field**, not about the person; and the same code on two fields reads the same ("Nhập ít nhất 5 ký tự." for a reason and for a note).

### 3.8 Codes owed by documents not yet written (DOC-42 §5.8)

A document that adds a code to DOC-42 §5 adds its row to §3 in the same change. Reserved now, with no text until the owner document names the rule: DOC-23 (the lock rules of intent creation), DOC-25 (`statement_line_not_assignable`), DOC-30 (vehicle review), DOC-31 (notice send), DOC-33 (`too_many_rows` for an export over 50,000 rows, reusing the rule code above with another limit text through the parameter `maxRows`).

### 3.9 Answers that are not shown to a person

`invalid_signature` and `foreign_building` are webhook answers (DOC-42 §6): the provider reads the status only. They have keys because ER-03 requires one for every code, and because a log reader sees the message. `method_not_allowed` and `malformed_request` are client bugs more often than user errors; the text exists so that nothing shows a blank.

### 3.10 Count

61 top-level codes and 42 rule codes, 103 keys `error.*` in each language. Generated from DOC-42 §5 on 2026-10-20; UICP-03 repeats the generation in CI.

## 4. `common.*` keys

Strings used by three screens or more, or by the shell, move here (DOC-56 §6.4). A screen that needs the same word writes the key, not a copy of the text. Keys marked "alias" in the note column have a screen key that already exists in a screen document and must be replaced by this one when the screen document is next edited (§11).

### 4.1 Actions

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.action.cancel` | Hủy | Cancel |  |
| `common.action.confirm` | Xác nhận | Confirm | Dialogs name the action instead (UX-14); this is the fallback |
| `common.action.save` | Lưu | Save |  |
| `common.action.save-changes` | Lưu thay đổi | Save changes | `W-Profile`, `W-Building` |
| `common.action.close` | Đóng | Close |  |
| `common.action.back` | Quay lại | Back |  |
| `common.action.next` | Tiếp tục | Continue |  |
| `common.action.retry` | Thử lại | Try again |  |
| `common.action.reload` | Tải lại | Reload | `version_conflict`, error boundary |
| `common.action.refresh` | Làm mới | Refresh | Stale banner |
| `common.action.edit` | Sửa | Edit |  |
| `common.action.add` | Thêm | Add |  |
| `common.action.delete` | Xóa | Delete |  |
| `common.action.remove` | Gỡ | Remove |  |
| `common.action.search` | Tìm kiếm | Search |  |
| `common.action.clear-filters` | Xóa bộ lọc | Clear filters | One wording for web and apps |
| `common.action.copy` | Sao chép | Copy |  |
| `common.action.download` | Tải xuống | Download |  |
| `common.action.upload` | Tải lên | Upload |  |
| `common.action.call` | Gọi | Call | Guard call button, hotline rows |
| `common.action.sign-in` | Đăng nhập | Sign in |  |
| `common.action.sign-out` | Đăng xuất | Sign out |  |
| `common.action.contact-office` | Liên hệ Ban quản lý | Contact the management office |  |

### 4.2 Feedback and generic content

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.feedback.copied` | Đã sao chép | Copied | Toast |
| `common.feedback.saved` | Đã lưu | Saved | Toast |
| `common.loading` | Đang tải… | Loading… | Accessible label of a skeleton region, never visible text on a list |
| `common.yes` | Có | Yes |  |
| `common.no` | Không | No |  |
| `common.today` | Hôm nay | Today |  |
| `common.yesterday` | Hôm qua | Yesterday |  |
| `common.reference` | Mã tham chiếu: {requestId} | Reference: {requestId} | Under every 500/502 message and error screen (UX-10) |
| `common.updated-at` | Cập nhật {time} | Updated {time} | Age of a persisted screen (UX-05) |
| `common.figures-as-of` | Số liệu đến {time}, {date} | Figures as of {time}, {date} | Aggregates (UX-16); `{date}` through `formatDate` |
| `common.retry-in` | Thử lại sau {seconds} giây | Try again in {seconds} s | 429 countdown (`res.login.retry-in` is its screen alias) |
| `common.network.not-sent` | Chưa gửi được. Hãy thử lại. | Not sent. Try again. | A write with no answer and no `Idempotency-Key` |
| `common.network.unsure` | Chưa chắc thao tác đã được thực hiện. Hãy kiểm tra lại trước khi làm lại. | We are not sure this went through. Check before you try again. | Money and other writes after a lost answer (UX-01) |
| `common.empty.filtered.title` | Không có kết quả phù hợp | No matching results | Generic; a screen with its own words uses `<screen>.empty-filter.title` |
| `common.empty.filtered.body` | Bỏ bớt bộ lọc hoặc đổi từ khóa. | Remove some filters or try another keyword. |  |
| `common.table.empty-cell` | – | – | An en dash, never an empty cell |
| `common.pagination.range` | {from}–{to} trên {total} | {from}–{to} of {total} | Table footer |
| `common.pagination.page` | Trang {page}/{pages} | Page {page} of {pages} |  |
| `common.pagination.previous` | Trang trước | Previous page | Icon button label |
| `common.pagination.next` | Trang sau | Next page | Icon button label |

### 4.3 Pages and boundaries

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.error.page.title` | Không tải được nội dung | We could not load this | Full-page error state |
| `common.error.page.body` | Đã có lỗi xảy ra. Hãy thử lại. | Something went wrong. Try again. |  |
| `common.error.boundary.title` | Có gì đó chưa ổn | Something went wrong | Render error boundary (DOC-55 §15) |
| `common.error.boundary.body` | Hãy tải lại màn hình. Nếu lỗi vẫn còn, hãy gửi mã tham chiếu cho Ban quản lý. | Reload the screen. If it keeps happening, send the reference to the management office. |  |
| `common.forbidden.title` | Bạn không có quyền xem nội dung này | You do not have access to this | Forbidden state (UX-07) |
| `common.forbidden.body` | Tài khoản của bạn chưa được cấp quyền cho nội dung này. Hãy liên hệ Admin nếu bạn cần. | Your account does not have access to this. Contact an Admin if you need it. |  |
| `common.not-found.title` | Không tìm thấy nội dung | We could not find this |  |
| `common.not-found.body` | Nội dung có thể đã bị xóa, hoặc đường dẫn chưa đúng. | It may have been removed, or the link is not right. |  |
| `common.stale.banner` | Chưa làm mới được. Đang hiện dữ liệu lúc {time}. | Could not refresh. Showing data from {time}. | Stale state (UX-10) |

### 4.4 People and building

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.app.name` | Hiên | Hiên | Display name is an Owner input (P0-03) |
| `common.language.switch-to-en` | English | English | Always in the target language |
| `common.language.switch-to-vi` | Tiếng Việt | Tiếng Việt | Always in the target language |
| `common.unit.label` | Căn hộ | Home |  |
| `common.unit.role-line` | {memberType, select, owner {Bạn là chủ hộ} family {Bạn là thành viên gia đình} tenant {Bạn là người thuê} helper {Bạn là giúp việc} other {}} | {memberType, select, owner {You are the owner} family {You are a family member} tenant {You are a tenant} helper {You are a helper} other {}} | Unit switcher and home |
| `common.member-type.owner` | Chủ hộ | Owner |  |
| `common.member-type.family` | Thành viên gia đình | Family member | Kept apart from tenant (decided 2026-10-19) |
| `common.member-type.tenant` | Người thuê | Tenant |  |
| `common.member-type.tenant-pay` | Người thuê, được thanh toán phí | Tenant, may pay fees | `Account` |
| `common.member-type.helper` | Giúp việc | Helper |  |
| `common.staff-role.admin` | Admin | Admin | Replaces the `common.role.*` of DOC-64 and DOC-67 (DR-221) |
| `common.staff-role.manager` | Ban quản lý | Management office |  |
| `common.staff-role.technician` | Kỹ thuật | Technician |  |
| `common.staff-role.guard` | Bảo vệ | Guard |  |
| `common.notice-category.general` | Thông báo chung | General | Notice categories (DR-50) |
| `common.notice-category.maintenance` | Bảo trì | Maintenance |  |
| `common.notice-category.urgent` | Khẩn cấp | Urgent |  |
| `common.notice-category.event` | Sự kiện | Event |  |
| `common.greeting.morning` | Chào buổi sáng | Good morning | Building-local hour: 05–10 |
| `common.greeting.noon` | Chào buổi trưa | Good midday | 10–13 |
| `common.greeting.afternoon` | Chào buổi chiều | Good afternoon | 13–18 |
| `common.greeting.evening` | Chào buổi tối | Good evening | 18–05 |
| `common.field.phone.placeholder` | VD: 0912 345 678 | e.g. 0912 345 678 | Placeholder of a phone field (DOC-54 §17.9) |
| `common.field.name.placeholder` | VD: Nguyễn Văn An | e.g. Nguyễn Văn An | Placeholder of a full-name field |
| `common.field.email.placeholder` | VD: ten@email.com | e.g. name@email.com | Placeholder of a personal email field; a work email uses `web.login.field.email.placeholder` |

### 4.5 Relative time

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.time.just-now` | Vừa xong | Just now | Under 1 minute |
| `common.time.minutes-ago` | {count} phút trước | {count, plural, one {# minute ago} other {# minutes ago}} | 1 to 59 minutes |
| `common.time.hours-ago` | {count} giờ trước | {count, plural, one {# hour ago} other {# hours ago}} | 1 to 23 hours, same building day |
| `common.time.yesterday-at` | Hôm qua {time} | Yesterday {time} |  |
| `common.time.today-at` | Hôm nay {time} | Today {time} | Used when the instant is earlier today and 24 h have not passed in a deadline context |
| `common.time.days-left` | Còn {count} ngày | {count, plural, one {# day left} other {# days left}} | Deadlines (`res.main.fee.due-in` is its screen alias) |
| `common.time.days-overdue` | Quá hạn {count} ngày | {count, plural, one {# day overdue} other {# days overdue}} | Staff debt rows |

### 4.6 Usage switch

The switch of DR-279 (DOC-104 §5.4) is on three screens (`Account`, `S-Account`, `W-Profile`), so its strings are shared keys (DOC-56 §6.4).

| Key | `vi` | `en` | Note |
| --- | --- | --- | --- |
| `common.usage.title` | Chia sẻ dữ liệu sử dụng ẩn danh | Share anonymous usage data | The label of the switch |
| `common.usage.hint` | Giúp ban quản lý biết màn hình nào được dùng nhiều và ứng dụng được mở bao lâu để cải thiện ứng dụng. Không gắn với tài khoản hay số điện thoại của bạn. | Helps the management see which screens are used, and how often and how long the app is open, so it can improve the app. It is not tied to your account or phone number. | Helper text under the label; no toast on change |

## 5. `status.*` labels

The key is `status.<entity>.<value>`; the value is the enumeration value of the data document (DOC-14 §9) or, where the label depends on a condition (due date, audience), the derived name in the tables below. Tone and icon are DOC-54 §6 and are not repeated as colors: the label is **always** shown, the tone says what the viewer should do (DR-183). `drawn` is text the canvas shows; `proposed` is text written here for a status the canvas does not draw (DOC-54 §6.1 rule 4), to be confirmed by the design owner.

Test DS-04 (DOC-54) checks that every enumeration value has a row in `status.json` and a label key; UICP-04 checks that the key exists in both languages.

### 5.1 `status.charge.*`

Resident view of a charge (`BillSlip`, `Fees`). The tone and icon are DOC-54 §6.2.

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.charge.upcoming` | Chưa đến hạn | Not due yet | neutral | drawn |
| `status.charge.due` | Đến hạn | Due | warning | drawn |
| `status.charge.due_in` | Còn {count} ngày | {count, plural, one {# day left} other {# days left}} | warning | drawn |
| `status.charge.overdue` | Quá hạn | Overdue | danger | drawn |
| `status.charge.paid` | Đã thanh toán | Paid | success | drawn |
| `status.charge.void` | Đã hủy | Cancelled | neutral | proposed |
| `status.charge.draft` | Nháp | Draft | neutral | drawn |

### 5.2 `status.charge-staff.*`

Staff view of an open charge (`W-Fee-Record`, `W-Debts`); `paid`, `void` and `draft` reuse `status.charge.*`.

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.charge-staff.unpaid` | Chưa nộp | Unpaid | neutral | drawn |
| `status.charge-staff.due_soon` | Sắp hạn | Due soon | warning | drawn |
| `status.charge-staff.overdue_days` | Quá hạn {count} ngày | {count, plural, one {# day overdue} other {# days overdue}} | danger | drawn |

### 5.3 `status.batch.*`

Fee batch (`W-Fees`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.batch.draft` | Nháp | Draft | neutral | drawn |
| `status.batch.published` | Đã phát hành | Published | info | drawn |
| `status.batch.recalled` | Đã thu hồi | Recalled | warning | proposed |
| `status.batch.closed` | Đã đóng | Closed | success | drawn |

### 5.4 `status.payment-intent.*`

Payment intent (`W-Transactions`; statuses of DOC-23, owed).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.payment-intent.creating` | Đang treo | Pending | warning | drawn |
| `status.payment-intent.pending` | Đang treo | Pending | warning | drawn |
| `status.payment-intent.paid` | Thành công | Successful | success | proposed |
| `status.payment-intent.failed` | Thất bại | Failed | danger | proposed |
| `status.payment-intent.expired` | Hết hạn | Expired | neutral | proposed |
| `status.payment-intent.cancelling` | Đã hủy | Cancelled | neutral | proposed |
| `status.payment-intent.cancelled` | Đã hủy | Cancelled | neutral | proposed |

### 5.5 `status.money-log.*`

Money-log row (`W-Money-Log`, P2/P3).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.money-log.to_review` | Cần kiểm tra | To review | warning | proposed |
| `status.money-log.reviewed` | Đã kiểm tra | Reviewed | success | proposed |

### 5.6 `status.ticket.*`

Staff and web view of a ticket (DR-43: "Phiếu"). Keys use the domain status.

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.ticket.submitted` | Chưa phân công | Unassigned | warning | drawn |
| `status.ticket.assigned` | Đã giao | Assigned | neutral | proposed |
| `status.ticket.accepted` | Đã tiếp nhận | Accepted | neutral | drawn |
| `status.ticket.in_progress` | Đang xử lý | In progress | info | drawn |
| `status.ticket.on_hold` | Tạm dừng | On hold | warning | proposed |
| `status.ticket.resolved` | Chờ đóng phiếu | Waiting to close | success | drawn |
| `status.ticket.closed` | Đã đóng | Closed | success | drawn |
| `status.ticket.cancelled` | Đã hủy | Cancelled | neutral | proposed |
| `status.ticket.urgent` | Khẩn | Urgent | warning | drawn |

### 5.7 `status.ticket-resident.*`

Resident view of a ticket (DR-45: five states; DR-43: "Yêu cầu").

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.ticket-resident.sent` | Chờ tiếp nhận | Waiting for acceptance | neutral | drawn |
| `status.ticket-resident.received` | Đã tiếp nhận | Accepted | info | drawn |
| `status.ticket-resident.processing` | Đang xử lý | In progress | info | drawn |
| `status.ticket-resident.done` | Hoàn thành | Done | success | drawn |
| `status.ticket-resident.cancelled` | Đã hủy | Cancelled | neutral | proposed |
| `status.ticket-resident.step.sent` | Đã gửi | Sent | — | drawn |
| `status.ticket-resident.step.received` | BQL đã tiếp nhận | Accepted by the office | — | drawn |
| `status.ticket-resident.step.processing` | Đang xử lý | In progress | — | drawn |
| `status.ticket-resident.step.done` | Hoàn thành | Done | — | drawn |

### 5.8 `status.membership.*`

Membership of a person in a unit (`W-Unit-Detail`, `W-Residents`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.membership.active` | Đang dùng | Active | success | drawn |
| `status.membership.locked` | Đã khóa | Locked | danger | drawn |
| `status.membership.removed` | Đã gỡ | Removed | neutral | proposed |

### 5.9 `status.resident-account.*`

Resident account (`W-Residents`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.resident-account.active` | Đang dùng | Active | success | drawn |
| `status.resident-account.never_signed_in` | Chưa đăng nhập | Never signed in | neutral | drawn |
| `status.resident-account.deletion_requested` | Yêu cầu xóa tài khoản | Deletion requested | warning | drawn |
| `status.resident-account.deleted` | Đã xóa | Deleted | neutral | proposed |

### 5.10 `status.staff.*`

Staff account (`W-Staff`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.staff.invited` | Chờ đặt mật khẩu | Waiting for password | warning | drawn |
| `status.staff.active` | Đang hoạt động | Active | success | drawn |
| `status.staff.locked` | Đã khóa | Locked | danger | drawn |
| `status.staff.disabled` | Đã vô hiệu hóa | Disabled | neutral | proposed |

### 5.11 `status.vehicle.*`

Vehicle, staff and web view (`W-Vehicles`, `B-Vehicles`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.vehicle.pending` | Chờ duyệt | Waiting for review | warning | drawn |
| `status.vehicle.approved` | Đã duyệt | Approved | success | drawn |
| `status.vehicle.rejected` | Bị từ chối | Rejected | danger | proposed |
| `status.vehicle.retired` | Đã gỡ | Removed | neutral | proposed |

### 5.12 `status.vehicle-resident.*`

Vehicle, resident view (`VehicleCard`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.vehicle-resident.pending` | Chờ BQL duyệt | Waiting for approval | neutral | drawn |
| `status.vehicle-resident.approved` | Thẻ đang hoạt động | Card active | success | drawn |
| `status.vehicle-resident.rejected` | Bị từ chối | Rejected | danger | proposed |
| `status.vehicle-resident.retired` | Đã gỡ | Removed | neutral | proposed |

### 5.13 `status.notice.*`

Notice (`W-Notices`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.notice.draft` | Nháp | Draft | neutral | drawn |
| `status.notice.scheduled` | Hẹn giờ | Scheduled | info | drawn |
| `status.notice.sending` | Đang gửi | Sending | info | proposed |
| `status.notice.sent` | Đã gửi | Sent | success | proposed |

### 5.14 `status.unit.*`

Unit occupancy (`W-Units`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.unit.occupied` | Đang ở | Occupied | success | drawn |
| `status.unit.rented` | Cho thuê | Rented | info | drawn |
| `status.unit.vacant` | Trống | Vacant | neutral | drawn |

### 5.15 `status.setting.*`

A configuration in effect (`W-Building`, `W-Gateway`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.setting.in_effect` | Đang áp dụng | In effect | success | drawn |

### 5.16 `status.import.*`

Import preview (`W-Import`, `W-Fee-Import`) and the status of an import job in the recent-imports table (`W-Import`, E-169).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.import.errors` | {count} dòng lỗi | {count, plural, one {# row with errors} other {# rows with errors}} | danger | drawn |
| `status.import.validated` | Chờ lưu | Waiting to save | info | proposed (DR-226) |
| `status.import.committed` | Đã lưu | Saved | success | proposed (DR-226) |
| `status.import.failed` | Không đọc được | Could not be read | danger | proposed (DR-226) |
| `status.import.expired` | Hết hạn | Expired | neutral | proposed (DR-226) |

Other labels that are not statuses: the ticket code, batch code and receipt code (plates) are never translated (DOC-54 §9).

### 5.17 `status.unit-type.*`

*Added 2026-11-01 (DR-314).* The status of a unit type (`W-Unit-Types`, the type select of `W-Units`).

| Key | `vi` | `en` | Tone | Text |
| --- | --- | --- | --- | --- |
| `status.unit-type.active` | Đang dùng | In use | success | proposed (DR-314) |
| `status.unit-type.archived` | Ngừng dùng | Not in use | neutral | proposed (DR-314) |

## 6. `auth.*`, `offline.*`, `upgrade.*`

### 6.1 `auth.*`

| Key | `vi` | `en` | Used by |
| --- | --- | --- | --- |
| `auth.signed_out` | Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại. | Your session has ended. Sign in again. | Sign-in banner after a failed refresh; replaces `common.auth.signed_out` of DOC-64 (DR-221) |
| `auth.session_revoked` | Phiên đăng nhập này đã bị kết thúc từ thiết bị khác. Hãy đăng nhập lại. | This session was ended from another device. Sign in again. | SSE `session.revoked`, a revoked session found at refresh |
| `auth.password.show` | Hiện | Show | Password field toggle (`staff.login.field.password.show` is its screen alias) |
| `auth.password.hide` | Ẩn | Hide |  |
| `auth.otp.resend` | Gửi lại mã | Resend code | OTP, resend of a reset link (`res.otp.action.resend` is its screen alias) |
| `auth.otp.resend_in` | Gửi lại mã sau {seconds} giây | Resend code in {seconds} s | Countdown (45 s) |

### 6.2 `offline.*`

| Key | `vi` | `en` | Used by |
| --- | --- | --- | --- |
| `offline.banner` | Không có mạng. Bạn xem được dữ liệu đã tải, nhưng chưa thể thực hiện thao tác. | No network. You can see data already loaded, but you cannot make changes yet. | The global strip; replaces `common.offline.banner` of DOC-57 and `offline.banner` of DOC-55 §9.3 (one text) |
| `offline.updated` | Dữ liệu lúc {time} | Data from {time} | Second line of the strip: the age of the visible query |
| `offline.action_disabled` | Cần có mạng để thực hiện thao tác này. | You need a network connection to do this. | Reason shown on a disabled write control (tooltip on the web, helper text in the apps) |
| `offline.money` | Cần có mạng để xem số tiền mới nhất. Hãy kết nối mạng rồi thử lại. | You need a network connection to see the latest amounts. Connect and try again. | Fees, receipts, payment, debts, money log: the state instead of old numbers (UX-05); `res.main.fee.offline` is its home-card alias |
| `offline.back_online` | Đã có mạng trở lại. | You are back online. | Toast after reconnect |

### 6.3 `upgrade.*`

| Key | `vi` | `en` | Used by |
| --- | --- | --- | --- |
| `upgrade.title` | Cần cập nhật ứng dụng | Update the app | Blocking page (DOC-55 §16) |
| `upgrade.body` | Phiên bản bạn đang dùng không còn được hỗ trợ. Hãy cập nhật để tiếp tục. | The version you have is no longer supported. Update to continue. |  |
| `upgrade.cta` | Cập nhật | Update | Opens `storeUrl` |
| `upgrade.cta.ios` | Mở App Store | Open the App Store | When the platform is known |
| `upgrade.cta.android` | Mở Google Play | Open Google Play |  |

### 6.4 Wrong client and other blocked states

The texts are screen-owned and listed here only so that one place names them all: `staff.login.wrong-app.*` (DOC-61, an Admin on the staff app), `web.wrong-app.*` (DOC-64, a Technician or Guard on the web), `res.unit-pick.empty.*` (DOC-57, no unit), `res.login-error.*` (DOC-57, unknown phone), `res.terms-update.*` (DOC-57, terms gate), `res.account-deletion.*` (DOC-60). Their wording follows §1: what is wrong, then the next step (UX-11).

## 7. Formats (DR-71)

One module, `@rms/shared-types`, owns the formatters; no component calls `Intl` for money or builds a date string by hand (DOC-55 §11). The two that end in words (`relativeTime`, `daysLeft`) return a phrase (`{key, params}` or a finished `{text}`) because `shared-types` holds no catalog; `createTranslator(lang).phrase()` of `@rms/i18n-catalog` turns it into text (DR-235). Amounts and areas end with a no-break space before `đ`, `m²`, `MB`; the table below writes a plain space. All take the language and, for instants, the building time zone (`building.timezone`, default `Asia/Ho_Chi_Minh`, ADR-0013). They are pure and are the only code under test in §7.2.

### 7.1 Rules

| Formatter | Rule |
| --- | --- |
| `formatMoney(amount, lang)` | Integer đồng. `vi`: groups with `.`, then a no-break space and `đ` (`2.838.000 đ`). `en`: `₫` then groups with `,` (`₫2,838,000`). A negative amount has a leading `-` (`-350.000 đ`, `-₫350,000`) and is shown only where DOC-54 §9 allows. Never `Intl` currency output, never a decimal part. The result is `white-space: nowrap` with `tabular-nums` (DOC-54 §9) |
| `formatDate(day \| instant, lang, tz)` | A building day (`YYYY-MM-DD`) is formatted without any time zone shift; an instant is converted to the building zone first. `vi`: `dd/MM/yyyy`; `en`: `MMM d, yyyy` with English month abbreviations (`Oct 9, 2026`) |
| `formatTime(instant, tz)` | 24-hour `HH:mm` in the building zone, both languages |
| `formatDateTime(instant, lang, tz)` | `formatDate` then a space then `formatTime` |
| `formatPhone(e164)` | `+84` followed by 9 or 10 digits becomes the national form with a `0`, with a space after the 4th and the 7th digit (DR-205); any other country code is returned unchanged in international form. Display only; requests carry E.164. A masked number from the API (`090••••123`) is shown as received |
| `formatPercent(ratio, lang)` | Up to one decimal, a trailing zero dropped; `vi` uses `,` and `en` uses `.`; always followed by `%` without a space |
| `formatArea(m2, lang)` | Up to one decimal like `formatPercent`, a no-break space, `m²` |
| `formatBytes(n, lang)` | Mebibytes and gibibytes written "MB" and "GB" (DOC-37 §2: 1 MB = 1,048,576 bytes), one decimal, decimal sign by language |
| `relativeTime(instant, now, lang, tz)` (`formatRelative` of DR-223) | Returns a phrase, rendered by `t.phrase()` of the catalog (DR-235). Under 1 minute `common.time.just-now`; under 1 hour `common.time.minutes-ago`; the same building day `common.time.hours-ago`; the previous building day `common.time.yesterday-at`; older: `formatDate`. Only used for "last seen", "sent" and inbox rows, never for a deadline |
| `daysLeft(dueDay, today)` | Returns a phrase, like `relativeTime`. Calendar days in the building zone (ADR-0013): the due day itself is `common.today`, the day before is `common.time.days-left` with 1, a day in the past is `common.time.days-overdue`. Never counts hours |

### 7.2 Table test (P1-09, UICP-07)

Each row is one case of the formatter test; the input is given as the formatter receives it. `now` for relative cases is 2026-10-09 10:00 in the building zone.

| Formatter | Input | `vi` | `en` |
| --- | --- | --- | --- |
| `formatMoney` | 2838000 | `2.838.000 đ` | `₫2,838,000` |
| `formatMoney` | 0 | `0 đ` | `₫0` |
| `formatMoney` | 1000 | `1.000 đ` | `₫1,000` |
| `formatMoney` | -350000 | `-350.000 đ` | `-₫350,000` |
| `formatMoney` | 1234567890 | `1.234.567.890 đ` | `₫1,234,567,890` |
| `formatDate` | 2026-10-09 (calendar day) | `09/10/2026` | `Oct 9, 2026` |
| `formatDate` | 2026-01-05 | `05/01/2026` | `Jan 5, 2026` |
| `formatTime` | 2026-10-09T08:30:00Z, building zone Asia/Ho_Chi_Minh | `15:30` | `15:30` |
| `formatDateTime` | 2026-10-09T08:30:00Z | `09/10/2026 15:30` | `Oct 9, 2026 15:30` |
| `formatDate (instant)` | 2026-10-09T17:30:00Z (past midnight in the building zone) | `10/10/2026` | `Oct 10, 2026` |
| `formatPhone` | +84912345678 | `0912 345 678` | `0912 345 678` |
| `formatPhone` | +842838123456 (landline, 11 digits) | `0283 812 3456` | `0283 812 3456` |
| `formatPhone` | +14155550123 (not +84) | `+14155550123` | `+14155550123` |
| `formatPercent` | 0.907 | `90,7%` | `90.7%` |
| `formatPercent` | 1 | `100%` | `100%` |
| `formatArea` | 85.5 | `85,5 m²` | `85.5 m²` |
| `formatArea` | 85 | `85 m²` | `85 m²` |
| `formatBytes` | 2621440 | `2,5 MB` | `2.5 MB` |
| `formatRelative` | now − 30 s | `Vừa xong` | `Just now` |
| `formatRelative` | now − 2 min | `2 phút trước` | `2 minutes ago` |
| `formatRelative` | now − 1 min | `1 phút trước` | `1 minute ago` |
| `formatRelative` | now − 3 h, same building day | `3 giờ trước` | `3 hours ago` |
| `formatRelative` | yesterday 15:30 (building zone) | `Hôm qua 15:30` | `Yesterday 15:30` |
| `formatRelative` | 3 days ago | `06/10/2026` | `Oct 6, 2026` |
| `daysLeft` | due 15/10, today 09/10 (calendar days) | `Còn 6 ngày` | `6 days left` |
| `daysLeft` | due today | `Hôm nay` | `Today` |
| `daysLeft` | due 10/10, today 09/10 | `Còn 1 ngày` | `1 day left` |
| `daysLeft` | due 06/10, today 09/10 | `Quá hạn 3 ngày` | `3 days overdue` |

The same table is the extension of `CL-13` (DOC-55 §18) for the formatters it does not list; `CL-13` keeps its three money and date cases.

## 8. Who owns which keys

Counts are the rows of the microcopy tables of each screen document (generated by script on 2026-10-20; UICP-08 recomputes them from the catalog). "Shared" are the `common.*` rows a screen document had defined before this document; they are folded into §4.

| Document | Screens | Gate | `res.*` | `staff.*` | `web.*` | Shared defined there |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-57 | Resident sign-in, home | P1 (all keys; cards of P2…P5 ship later) | 96 | 0 | 0 | 14 |
| DOC-60 | Resident account (QR, notices, docs later) | P1 (account); P4/P5 owed | 55 | 0 | 0 | 5 |
| DOC-61 | Staff app shared, Manager | P1 (`S-` sign-in, account); P4/P5 owed | 0 | 48 | 0 | 4 |
| DOC-64 | Web sign-in, profile, operations | P1 (sign-in, profile); P4…P6 owed | 0 | 0 | 74 | 5 |
| DOC-65 | Web residents | P1 (units, residents, import); P5 owed | 0 | 0 | 231 | 0 |
| DOC-67 | Web system | P1 (staff, building, step-up); P3, P6 owed | 0 | 0 | 70 | 0 |
| **Total** | | | **151** | **48** | **375** | **28** |

Shared families in this document: 103 `error.*`, 73 `status.*`, 81 `common.*`, 6 `auth.*`, 5 `offline.*`, 5 `upgrade.*`.

Owed by documents not yet written, each adding its screen keys and any new `status.*`/`error.*` rows here in the same change:

| Document | Screens | Phase |
| --- | --- | --- |
| DOC-58 | Resident fees and payment (`Fees`, `Pay-*`, `Pay-Mismatch`): `unmatchedTransfer` text "Ban quản lý sẽ kiểm tra", one neutral text for the four outcomes of DR-96 (`amount_short`, `amount_over`, `charge_already_paid`, `charge_recalled`), never the reason | P2, P3 |
| DOC-59 | Resident requests, unit, members, vehicles | P4, P5 |
| DOC-60 (rest) | QR, notices, inbox, docs | P4, P5 |
| DOC-61 (rest), DOC-62, DOC-63 | Manager, Technician and Guard screens | P4, P5 |
| DOC-64 (rest) | Dashboard, tickets, notices, docs | P4…P6 |
| DOC-65 (rest) | `W-Vehicles`, `UnitMoneyPanel` | P3, P5 |
| DOC-66 | Web finance | P2, P3, P6 |
| DOC-67 (rest) | `W-Gateway`, `W-Audit`, `W-System` | P3, P6 |

A key needed before M1 is one of: every `res.*` of DOC-57 and DOC-60 (account), every `staff.*` of DOC-61 §1, every `web.*` of DOC-64 §1, DOC-65 and DOC-67 §1, and every shared key in §3 to §6 whose Phase is `P1`.

## 9. Required tests

Prefix `UICP-` (DOC-56 §6.3). They run in `bun run test` beside the parity test of P1-09; levels `unit` or `ci` need no device. ER-03 (DOC-42 §14) already checks that the code list of the catalog equals the code list of `error.*`; the cases below check the content.

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UICP-01 | **G** the catalog files `vi` and `en` **W** the parity test runs **T** every key exists in both and the sets of ICU argument names and types are equal; a missing key or a different placeholder fails with the key named | unit |
| UICP-02 | **G** a key whose `vi` and `en` differ in placeholders (`{minutes}` vs `{minute}`) **W** the test runs **T** it fails (negative case of UICP-01) | unit |
| UICP-03 | **G** the 102 codes of DOC-42 §5 (parsed from the document) **W** the test runs **T** each has `error.<code>` in `vi` and `en`, non-empty, and no `error.*` key exists without a code | unit |
| UICP-04 | **G** `status.json` of DOC-54 **W** the test runs **T** every enumeration value of DOC-14 §9 has a label key in `status.*` in both languages (complements DS-04) | unit |
| UICP-05 | **G** the clients' source **W** a static scan collects every `t('…')` key **T** each key exists, and each catalog key is used by a client, the API or a template (an unused key is listed, not failing, until M1) | unit |
| UICP-06 | **G** a key defined twice, or a new `error.*` rule code that equals a top-level code **W** the test runs **T** it fails; keys of the six shared families live only in the shared catalog file, and a key of a screen starts with its `<app>.<screen>.` | unit |
| UICP-07 | **G** the table of §7.2 **W** the formatters run for `vi` and `en` with the building zone `Asia/Ho_Chi_Minh` **T** every output equals the table; `formatMoney` never contains a decimal part | unit |
| UICP-08 | **G** the screen documents **W** the key counts of §8 are recomputed **T** a screen document key is not in the catalog (or the reverse) and the test lists the difference | ci |
| UICP-09 | **G** the `res.*` strings and `status.ticket-resident.*` **W** scanned **T** none contains "Phiếu"; no `status.ticket.*` string contains "Yêu cầu"; no `res.*` string says "BQL" without "Ban quản lý" appearing in the same screen (DR-197) | unit |
| UICP-10 | **G** the strings of `error.invalid_credentials`, `error.account_locked`, `staff.login.*`, `staff.forgot*`, `web.login.*`, `web.forgot*`, `web.reset.*` **W** scanned **T** none contains "lần thử", "tries left", or a literal number of attempts or minutes (DR-128, DR-206) | unit |
| UICP-11 | **G** an API test client with `Accept-Language: vi` and `en` **W** it triggers one code per class (400, 401, 403, 404, 409, 422, 429, 503) **T** `error.message` equals the catalog text for the code with the `details` parameters, in the requested language | integration |
| UICP-12 | **G** every screen key group that has `empty.title` **W** scanned **T** it also has `empty.body`; every `dialog.<name>.title` has `.confirm`; no confirm text is "OK" (UX-14) | unit |
| UICP-13 | **G** every string of `error.*` **W** scanned **T** it is at most 140 characters, has no raw code (`[a-z]+_[a-z_]+`), no "HTTP", "API", "token" or "null", and ends with `.` or `)` | unit |
| UICP-14 | **G** a catalog with an `error.*` key removed **W** the API is asked for that code **T** it returns the generic `internal_error` text and logs `catalog_key_missing` (the build already fails, this is the runtime safety net) | integration |

## 10. Decisions made while writing

Delegated by the Owner (design details that touch neither money nor access). Recorded as DR-220…224 in the register.

| Id | Decision |
| --- | --- |
| DR-220 | Rule codes of `validation_failed` (`password_weak`, `phone_invalid`, `reason_too_short`, …) live in the same `error.` namespace as the top-level codes, as the screen documents already assume; a collision is a build failure (UICP-06) |
| DR-221 | One name per shared string: `auth.signed_out` (not `common.auth.signed_out`), `offline.banner` (not `common.offline.banner`), `common.staff-role.<role>` (not `common.role.<role>`); DOC-57, DOC-64 and DOC-67 are corrected at their next edit |
| DR-222 | Ticket statuses are two key families: `status.ticket.<domain status>` for staff and web, `status.ticket-resident.<sent\|received\|processing\|done\|cancelled>` for the resident's five states (DR-45); the example `status.ticket.sent` of DOC-56 §6.4 becomes `status.ticket-resident.sent` |
| DR-223 | Formatter details DR-71 leaves open: a negative amount is written with a leading `-`; percentages and areas have up to one decimal with the trailing zero dropped; relative time is used for "sent" and "last seen" only and a deadline uses calendar days; `formatPhone` follows DR-205 and does not guess a layout for other countries |
| DR-224 | The parity test compares the **set of argument names and types**, not the branch structure of a `plural` or `select`: Vietnamese writes only the `other` branch |

Each of the five has full text below for the register.

- **DR-220 · Rule codes share the `error.` namespace.** *Problem:* DOC-42 §3 says the message key of a code is `error.<code>`, but a rule code such as `password_weak` is a `details[].code`, not a top-level code; the screens already use `error.password_weak`, `error.phone_invalid`, `error.setting_invalid`, `error.terms_text`. *Decision:* the same namespace, one table in §3.7, a uniqueness test. *Consequences:* a future rule code must not reuse the name of a top-level code. *Write to:* DOC-68, DOC-42 §3, DOC-55 §14.
- **DR-221 · One name per shared string.** *Problem:* three documents defined the same string under different keys (`common.auth.signed_out`/`auth.signed_out`; `common.offline.banner`/`offline.banner`; `common.role.*`/`common.staff-role.*`). *Decision:* the names in §4 and §6; the screen documents change at their next edit. *Consequences:* no catalog file holds two keys with one text. *Write to:* DOC-68, DOC-57, DOC-64, DOC-67, DOC-55 §9.3.
- **DR-222 · Two ticket status families.** *Problem:* the staff status set (eight values) and the resident's five states share the word "status" but not the values; DOC-56 §6.4 used `status.ticket.sent` for the resident state. *Decision:* §5 keys. *Consequences:* a ticket card reads the family of its audience. *Write to:* DOC-68, DOC-56 §6.4, DOC-54 §6.3.
- **DR-223 · Formatter details.** *Problem:* DR-71 fixes the money and date outputs only; negative amounts, percentages, areas, relative time and day counts have no rule. *Decision:* §7.1. *Consequences:* the table of §7.2 is the test. *Write to:* DOC-68, DOC-55 §11, DOC-54 §9.
- **DR-224 · Parity compares arguments.** *Problem:* the parity test of P1-09 says "a different ICU placeholder fails" without defining equality for a `plural`. *Decision:* equal sets of argument names and types. *Consequences:* Vietnamese strings are simpler. *Write to:* DOC-68, DOC-55 §11, P1-09.

## 11. Gaps found while collecting the keys

Not decisions: differences between documents that the owners fix at their next edit. Nothing here blocks the P1 gate.

| # | Finding | Fix owed by |
| --- | --- | --- |
| 1 | Every code used by the six screen documents exists in DOC-42 §5; none is missing there. The codes of later-phase screens (statement lines, vehicle review, notice send, export size) are reserved in §3.8 | DOC-23, 25, 30, 31, 33 |
| 2 | `common.auth.signed_out` (DOC-64) vs `auth.signed_out` (DOC-61); `common.offline.banner` (DOC-57) vs `offline.banner` (DOC-55); `common.role.*` (DOC-64, DOC-67) vs `common.staff-role.*` (DOC-61): one name each (DR-221) | DOC-57, 61, 64, 67, 55 |
| 3 | Clear filters: "Xóa bộ lọc" (DOC-65) vs "Bỏ bộ lọc" (DOC-67); chosen "Xóa bộ lọc" (`common.action.clear-filters`) | DOC-67 |
| 4 | The same disabled label: "Đã vô hiệu" (DOC-54 §6.4) vs "Đã vô hiệu hóa" (DOC-67); chosen "Đã vô hiệu hóa" | DOC-54 |
| 5 | "tệp" (errors) vs "file" ("Nhập từ file Excel"): one word for a file in a sentence, "tệp"; "file Excel" stays where the prototype draws it as a button label | DOC-65 |
| 6 | `otp_invalid` shows `attemptsLeft` on the resident OTP (DOC-26 allows it: a code is not a password) but no staff sign-in screen shows a counter (DR-128, DR-206); UICP-10 covers only the staff and web keys | — |
| 7 | UX-05 (DOC-53) lists members and vehicles among persisted queries; DOC-55 §9.2 never persists them (DR-190). Copy for an offline unit screen follows DOC-55 | DOC-53 UX-05 |
| 8 | DOC-42 §5.1 English for `unauthenticated` ("Please sign in again.") differs from the banner `auth.signed_out`; both are kept: the first is the API message, the second is the screen text after a failed refresh | — |
| 9 | `res.terms.superseded` (DOC-57) is longer than the generic `error.terms_version_superseded`; kept as a screen alias (§1) | — |
| 10 | Statuses the canvas does not draw (DOC-54 §6): 22 labels are `proposed` in §5; the design owner confirms them before P2 (batch `recalled`, money log) and P4 (ticket `assigned`, `on_hold`, `cancelled`) | Design owner |

## Propagation owed

| Target | Change |
| --- | --- |
| `docs/00-master-plan.md` §0.2 | `UICP-` is already in the prefix row; nothing to add |
| DOC-88 | Add `UICP-` to the prefix index |
| DOC-42 §3, §5.2 | One sentence that rule codes share the `error.` namespace (DR-220) |
| DOC-56 §6.4 | The example `status.ticket.sent` becomes `status.ticket-resident.sent` (DR-222) |
| DOC-57, 64, 67 | Rename the shared keys of DR-221 |
| DOC-54 §6 | Use the label "Đã vô hiệu hóa" for a disabled staff account |

## Open questions

None.
