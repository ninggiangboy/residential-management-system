# Web: system

> Status: **Approved** (Owner, 2026-10-21, for §1 (gate P1); W-Gateway, W-Audit and W-System are owed) · Updated: 2026-10-20 · DOC-67
> Depends on: original SDD §18, [DR](../../00-decision-register.md) (DR-33, 38, 39, 41…47, 59, 72, 74, 128, 133, 147, 148), [DOC-03](../../01-product/requirements.md) (FR-13, FR-14, FR-38, FR-41, FR-50), [DOC-04](../../01-product/use-cases.md) (UC-17), [DOC-26](../../06-design/identity-and-sessions.md) §4, [DOC-36](../../06-design/building-configuration-and-demo.md) §4…8, [DOC-37](../../06-design/files-and-uploads.md), [DOC-51](../../07-api/api-endpoints.md) (E-08, E-38…E-56), [DOC-42](../../06-design/error-handling.md) §5, [DOC-53](../ux-principles-and-ia.md), [DOC-55](../client-architecture.md), [DOC-56](README.md), DOC-54
> Main readers: P1-16 (web CMS shell: `W-Staff`, `W-Staff-New`, `W-Building`), P1-14, P1-15, the writers of DOC-64…66 (they cite the step-up rule below), P3 and P6 (the later table), EXP-10

This document specifies the web screens of the System group of the sidebar (`Hệ thống`): staff accounts, building and configuration, and the step-up dialog that every sensitive Admin action opens. The sections `W-Staff`, `W-Staff-New`, `W-Building` and `W-Step-Up` are **P1** and complete for the P1 gate. `W-Gateway` (P3), `W-Audit` and `W-System` (P6) have no section yet: §"Specified before P3 and P6" lists what their sections must fix. Tokens and components are DOC-54, URLs are DOC-53 §4, the client layers are DOC-55, copy strings of errors and statuses are DOC-68. Section layout follows DOC-56 §6.2 (the Prototype part replaces the wireframe, DR-194).

Test prefix: `UIWS-` (DOC-56 §6.3; unused before this document; DOC-88 §15 indexes it).

## Screens in this file

| Section | Screen | Role | Phase | Status |
| --- | --- | --- | --- | --- |
| `W-Staff` | Staff accounts, roles, lock, resend invite | Admin; Manager (actions on Technician and Guard only) | P1 | designed |
| `W-Staff-New` | Create (and edit) a staff account, invite email | Admin; Manager (Technician and Guard only) | P1 | designed (create); edit mode reuses it (DR-218) |
| `W-Building` | Building and company info, defaults, terms | Admin | P1 | designed |
| `W-Step-Up` | Dialog: request a code, enter password and code | Admin | P1 | to design |
| `W-Gateway` | Payment gateway configuration and checks | Admin | P3 | designed (table below) |
| `W-Audit` | Audit log | Admin | P6 | designed (table below) |
| `W-System` | Backups, storage, notification channels | Admin | P6 | designed (table below) |

Shared facts for the P1 sections:

- The web CMS is the Admin's and the Manager's client. A Technician or Guard who signs in here lands on `/wrong-app` (DR-174), so no screen below has a Technician or Guard state.
- Staff web screens have no unit context and no real-time channel: after a write the screen refetches its own queries (`['staff', …]`, `['settings']`). The SSE events of DR-75 do not concern these screens.
- A `403 forbidden` on any call renders the Forbidden state of DOC-68, never a crash (UX-07). Errors not listed per screen follow DOC-55 §6.
- Staff label for a ticket is "phiếu", as drawn; decided in DR-197.
- Role labels are `common.staff-role.admin` "Admin", `common.staff-role.manager` "Ban quản lý" (`.short` "BQL"), `common.staff-role.technician` "Kỹ thuật", `common.staff-role.guard` "Bảo vệ" (en: Admin, Manager, Technician, Guard).

---

## W-Staff

> Status: Draft · Prototype: designed · Phase: P1 · DOC-67

### 1. Persona, use cases, permissions

PS-1 Admin ("Hà"), PS-2 Manager; UC-17 (alternatives A, C, D), FR-13.6, FR-14.1…14.4, FR-50. Who may do what is the table of DOC-26 §4.4; the screen shows an action only when the signed-in role may do it, and the API enforces the rest (UX-07).

| Action | Admin | Manager | Step-up | Endpoint |
| --- | --- | --- | --- | --- |
| List, open an account | all four roles | all four roles (read only) | no | E-39, E-41 |
| Create | any role | Technician, Guard | `admin_change` when the role is Admin | E-40 |
| Edit name, language | any account | Technician, Guard | no | E-42 |
| Change role | yes, not own account | no | `admin_change` when the new role is Admin | E-42 |
| Change email | yes | no | `staff_email` | E-42 |
| Lock, unlock | any account except own (lock) | Technician, Guard | no | E-43, E-44 |
| Disable, enable | yes, not own account | no | no | E-45, E-46 |
| Resend invite (`invited` only) | any account | Technician, Guard | no | E-08 |

### 2. URL and search params

`/staff` (DOC-53 §4). Params validated with a TypeBox schema, names mirror E-39: `role` (`admin`, `manager`, `technician`, `guard`; default all), `status` (`invited`, `active`, `locked`, `disabled`; default all), `q` (≤ 100), `page` (1), `pageSize` (10, max 50). A changed filter resets `page`. Create and edit are the routes `/staff/new` and `/staff/$staffId/edit`: the list stays rendered behind the dialog of `W-Staff-New`.

### 3. Prototype

Artboard `W-Staff` ("Admin: Tài khoản nhân viên"), 1440 × 1000. Regions, top to bottom: sidebar with the group `Hệ thống` and `Nhân viên` selected; header with the breadcrumb "Hệ thống / Nhân viên", the VI/EN switch and the bell; title block with the primary `Button` "Tạo tài khoản"; info `Banner`; role `Chip`s with counts beside a `SearchField`; a table card (columns Họ tên, Role, Trạng thái, Đăng nhập gần nhất, Thao tác) with `Avatar`, `Tag` and a row action `Button` plus a pencil `IconButton`; pager.

Do not copy:

- The banner "5 role cố định…": there are four roles. Use `web.staff.banner.roles`.
- The own row carries "Tài khoản của bạn" and no pencil, as drawn: nobody locks or disables their own account (DR-133 rule 2) and own name and language are edited in `W-Profile` (E-31).
- The abbreviation "BQL" in the column Role: keep in chips and tags (`.short`), write "Ban quản lý" in the form.
- No row can be disabled or re-enabled in the artboard; DR-218 adds it (§4).

### 4. Regions and components

`Hien.Button`, `Chip`, `SearchField`, `Tag`, `Avatar`, `IconButton`, `Banner`, `Dialog` (confirmations), `Skeleton`, `EmptyState` (DOC-54). Status `Tag` tones: `active` success, `invited` warning, `locked` danger, `disabled` neutral. A temporary lock (`status = active` and `lockedUntil` in the future, DR-107) shows the `locked` tag. Row action by status: `invited` → "Gửi lại email" (tonal); `active` → "Khóa"; `locked` or temporary lock → "Mở khóa"; `disabled` → "Kích hoạt lại" (Admin only). The pencil opens the edit dialog (`W-Staff-New`), which also holds "Vô hiệu hóa tài khoản" (Admin, from `invited`, `active`, `locked`). A Manager sees no action and no pencil on Admin and Manager rows (`row.admin-only` "Chỉ Admin quản lý").

### 5. Data

| Read | Endpoint | Query key | Refetch |
| --- | --- | --- | --- |
| The table | E-39 with the URL params | `['staff', 'accounts', params]` | after any write on this screen; on window focus |
| Chip counts and subtitle | E-39 `pageSize=50`, no filter | `['staff', 'accounts', 'summary']` | with the table (DR-217) |
| One account, with its `ETag` for `If-Match` | E-41 | `['staff', 'account', id]` | when the edit dialog opens |
| The signed-in role | E-30 | `['staff', 'me']` | session |
| Targets for "Chuyển phiếu cho" | E-39 `role=technician` and `role=guard`, `status=active` | `['staff', 'accounts', 'assignees']` | when the dialog opens |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Tạo tài khoản" | none (opens `/staff/new`) | dialog of `W-Staff-New` | |
| "Khóa" → confirm dialog | E-43 | toast `toast.locked`; row becomes "Đã khóa"; the person is signed out everywhere (DOC-26 §3.8) | 409 `staff_has_open_tickets` → the dialog lists the tickets (`details.tickets`: code, status). Admin: choose "Chuyển phiếu cho" (an active Technician or Guard) and a reason of 5…500 characters, then E-43 again with `reassignTo` and `reason`. Manager: the list only, with "Nhờ Admin chuyển các phiếu này trước khi khóa". 409 `last_admin`: message, nothing changes. 403 `forbidden` (`details.reason = "self"`): cannot happen from the UI, shown as the generic message. 409 `invalid_transition`: refetch, show the fresh state |
| "Mở khóa" (no confirmation) | E-44 | toast `toast.unlocked`; "Đang hoạt động" | 409 `invalid_transition` (already unlocked): refetch |
| "Gửi lại email" | E-08 `{ staffId }` | toast `toast.invite-resent` | 409 `invalid_transition` (the person set a password meanwhile): refetch, message |
| "Vô hiệu hóa" (edit dialog) → confirm | E-45 (same open-tickets handling as lock) | toast `toast.disabled` | as lock |
| "Kích hoạt lại" | E-46 | toast `toast.enabled`; the row shows "Đang hoạt động", or "Chờ đặt mật khẩu" when the person never set one (then "Gửi lại email") | 409 `invalid_transition`: refetch |
| Chip, search, pager | none | the URL changes, E-39 refetches | |

Every write is a plain mutation: never retried by the screen, a 409 refetches and shows the server message and keeps the dialog open (UX-02). E-08, E-43…E-46 take no `Idempotency-Key`.

### 7. States

Loading: five `Skeleton` rows; the chips show no count until the summary arrives. Empty: no account matches the filters → `web.staff.empty.*` with a "Bỏ bộ lọc" button; the building always has at least one Admin, so "no staff at all" does not occur. Error: the DOC-68 pattern with the request id. Stale: a failed refetch keeps the rows and shows the stale banner. Forbidden: Technician and Guard never reach this route (`/wrong-app`). Offline: writes disabled with the reason (UX-04). The table has no money.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.staff.title` | Tài khoản nhân viên | Staff accounts |
| `web.staff.subtitle` | {total} tài khoản, {invited} chờ đặt mật khẩu, {locked} đã khóa | {total, plural, one {# account} other {# accounts}}, {invited} waiting to set a password, {locked} locked |
| `web.staff.cta` | Tạo tài khoản | Create account |
| `web.staff.banner.roles` | 4 role cố định, quyền định sẵn. Ban quản lý chỉ tạo và khóa được tài khoản Kỹ thuật, Bảo vệ. | There are 4 fixed roles with preset permissions. The Manager can create and lock only Technician and Guard accounts. |
| `web.staff.chip.all` | Tất cả {count} | All {count} |
| `web.staff.chip.role` | {role} {count} | {role} {count} |
| `web.staff.field.search.label` | Tìm nhân viên | Search staff |
| `web.staff.field.search.placeholder` | Tìm theo tên hoặc email | Search by name or email |
| `web.staff.col.name` / `.role` / `.status` / `.last-login` / `.actions` | Họ tên / Role / Trạng thái / Đăng nhập gần nhất / Thao tác | Name / Role / Status / Last sign-in / Actions |
| `web.staff.row.self` | Tài khoản của bạn | Your account |
| `web.staff.row.admin-only` | Chỉ Admin quản lý | Managed by an Admin |
| `web.staff.row.never` | Chưa đăng nhập | Never signed in |
| `web.staff.action.lock` / `.unlock` / `.resend-invite` | Khóa / Mở khóa / Gửi lại email | Lock / Unlock / Resend email |
| `web.staff.action.enable` | Kích hoạt lại | Enable again |
| `web.staff.action.edit.label` | Sửa {name} | Edit {name} |
| `web.staff.pager.range` | {from}–{to} trên {total} tài khoản | {from}–{to} of {total} accounts |
| `web.staff.pager.prev` / `.next` | Trang trước / Trang sau | Previous page / Next page |
| `web.staff.empty.title` | Không có nhân viên phù hợp | No staff match |
| `web.staff.empty.body` | Thử bỏ bộ lọc hoặc đổi từ khóa. | Clear the filters or change the search. |
| `web.staff.dialog.lock.title` | Khóa tài khoản {name}? | Lock {name}'s account? |
| `web.staff.dialog.lock.body` | {name} bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho đến khi bạn mở khóa. | {name} is signed out of every device and cannot sign in until you unlock the account. |
| `web.staff.dialog.lock.confirm` | Khóa tài khoản | Lock account |
| `web.staff.dialog.disable.title` / `.body` / `.confirm` | Vô hiệu hóa tài khoản {name}? / Tài khoản ngừng hoạt động, email vẫn được giữ chỗ. Dùng cho người đã nghỉ việc. / Vô hiệu hóa | Disable {name}'s account? / The account stops working and the email stays reserved. Use it for someone who left. / Disable |
| `web.staff.dialog.open-tickets.title` | {name} còn {count} phiếu chưa xong | {name} still has {count, plural, one {# open ticket} other {# open tickets}} |
| `web.staff.dialog.open-tickets.body.admin` | Chọn người nhận các phiếu này rồi nhập lý do. | Choose who takes these tickets and give a reason. |
| `web.staff.dialog.open-tickets.body.manager` | Nhờ Admin chuyển các phiếu này trước khi khóa. | Ask an Admin to move these tickets before locking. |
| `web.staff.dialog.open-tickets.field.assignee.label` | Chuyển phiếu cho | Move tickets to |
| `web.staff.dialog.open-tickets.field.reason.label` / `.hint` | Lý do / Từ 5 đến 500 ký tự | Reason / 5 to 500 characters |
| `web.staff.dialog.open-tickets.confirm` | Chuyển phiếu và khóa | Move tickets and lock |
| `web.staff.toast.locked` / `.unlocked` / `.disabled` / `.enabled` | Đã khóa {name} / Đã mở khóa {name} / Đã vô hiệu hóa {name} / Đã kích hoạt lại {name} | {name} was locked / {name} was unlocked / {name} was disabled / {name} was enabled again |
| `web.staff.toast.invite-resent` | Đã gửi lại email đặt mật khẩu cho {name} | Set-password email sent again to {name} |

Status labels are `status.staff.*` (DOC-68): "Đang hoạt động", "Chờ đặt mật khẩu", "Đã khóa", "Đã vô hiệu hóa" (en: Active, Waiting for password, Locked, Disabled). Errors are `error.staff_has_open_tickets`, `error.last_admin`, `error.invalid_transition`, `error.forbidden`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWS-01 | **G** an Admin and 9 staff (1 invited, 1 locked) **W** opening `/staff` **T** the subtitle reads "9 tài khoản, 1 chờ đặt mật khẩu, 1 đã khóa", the chips show 1/2/3/3, the own row shows "Tài khoản của bạn" and no action | web-e2e |
| UIWS-02 | **G** a Manager **W** opening `/staff` **T** all rows show, only Technician and Guard rows have actions, Admin and Manager rows show "Chỉ Admin quản lý", and the create dialog offers two roles (UIWS-11) | web-e2e |
| UIWS-03 | **G** a Technician holding an `in_progress` ticket **W** a Manager presses "Khóa" and confirms **T** E-43 answers 409 `staff_has_open_tickets`, the dialog lists the ticket code and status, and offers no reassign control | web-e2e |
| UIWS-04 | **G** the same Technician **W** an Admin locks with `reassignTo` and the reason "Nghỉ việc" **T** the account is locked, the ticket belongs to the target, the row shows "Đã khóa"; a reason of 4 characters shows `error.validation_failed` on the reason field and nothing changes | web-e2e |
| UIWS-05 | **G** two Admins A and B open the list **W** each locks the other at the same moment **T** exactly one lock succeeds, the other shows the message of `last_admin`, and the building keeps one active Admin | api |
| UIWS-06 | **G** a locked account **W** an Admin or the Manager presses "Mở khóa" **T** E-44 answers 200, the row shows "Đang hoạt động"; pressed again from a stale list, the screen refetches and shows the fresh state with the server message | web-e2e |
| UIWS-07 | **G** an invited Guard whose link expired at 25 h **W** the Manager presses "Gửi lại email" **T** a new mail with a link arrives in the mail catcher, the row stays "Chờ đặt mật khẩu" | web-e2e |
| UIWS-08 | **G** an active account **W** the Admin disables it from the edit dialog, then enables it **T** the first shows "Đã vô hiệu hóa" and the person is signed out; the second shows "Đang hoạt động" | web-e2e |
| UIWS-09 | **G** a Manager editing a Technician **W** the edit dialog opens **T** only name and language are editable, there is no role, no email and no "Vô hiệu hóa" | web-e2e |

---

## W-Staff-New

> Status: Draft · Prototype: designed (create) · Phase: P1 · DOC-67

### 1. Persona, use cases, permissions

PS-1, PS-2; UC-17 main flow "create a staff account", alternative C; FR-14.1, FR-14.2, FR-14.5, FR-50. The Admin chooses any role; the Manager chooses Technician or Guard (FR-14.1). Edit mode (same dialog, route `/staff/$staffId/edit`) follows the table of `W-Staff` §1.

### 2. URL and search params

`/staff/new` and `/staff/$staffId/edit`, no search params. The dialog is the route itself, so Back closes it and a reload reopens it.

### 3. Prototype

Artboard `W-Staff-New` ("Tạo tài khoản nhân viên"), 1440 × 960: the list of `W-Staff` dimmed behind a right-hand dialog titled "Tạo tài khoản nhân viên" with a close `IconButton`; fields `TextField` "Họ và tên", `TextField` "Email công việc", `TextField` "Số điện thoại" (optional), a `Radio` group "Role" with four options each with a description, a `Checkbox` "Gửi email đặt mật khẩu ngay"; footer "Hủy" (ghost) and "Tạo và gửi email" (primary).

Do not copy:

- "Số điện thoại": E-40 has no phone and a staff account stores none (DOC-16). Remove the field.
- The checkbox "Gửi email đặt mật khẩu ngay": E-40 always mails the invite; there is no "create without sending". Replace by the static note `web.staff-new.note.invite`.
- The Manager sees all four roles in the artboard; the Manager's dialog lists only Kỹ thuật and Bảo vệ.
- Edit mode is not drawn (DR-218).

### 4. Regions and components

`Dialog` (right-hand panel, 480 px wide, DOC-54), `TextField`, `Radio` with description, `Banner` for errors, `Button`. Create mode shows name, email, role. Edit mode shows name, language (`SegmentedControl` VI/EN), and for the Admin also email and role; the footer's left side holds "Vô hiệu hóa tài khoản" (Admin, text button, danger). Choosing the role Admin shows the hint `web.staff-new.hint.admin-step-up`.

### 5. Data

| Read | Endpoint | Note |
| --- | --- | --- |
| Edit mode: the account and its `ETag` | E-41 | `If-Match` of E-42 |
| The signed-in role (filters the role options) | E-30 | cached |

### 6. Interactions

Form: `react-hook-form` with the TypeBox resolver; the intent key is created when the dialog mounts (DOC-55 §4.3).

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Tạo và gửi email" (role Technician, Guard or Manager) | E-40 `{ fullName, email, role }`, `Idempotency-Key` | 201: dialog closes, list refetches, toast `toast.created` and `toast.created.hint`; the row shows "Chờ đặt mật khẩu" | 409 `email_in_use` → error under the email field. 400 `validation_failed` → errors from `details[].path`. 403 `forbidden` (a Manager with a forged role) → generic message |
| "Tạo và gửi email" with role Admin | `W-Step-Up` first (action `admin_change`), then E-40 with `stepUp` | as above | `step_up_failed` stays inside the step-up dialog; the form keeps its values |
| "Lưu thay đổi" (edit) | E-42 `{ fullName?, language?, role?, email?, stepUp? }`, `If-Match` | 200: toast `web.staff.toast.updated`; list refetches | 409 `version_conflict` → refetch E-41, show the message, keep typed values. 409 `email_in_use`. 409 `staff_has_open_tickets` on a role change → the open-tickets dialog of `W-Staff` §6 with `reassignTo` and `reason` in this request. 409 `last_admin` on demoting the last active Admin. Step-up: role set to Admin → `admin_change`; `email` present → `staff_email` |
| "Vô hiệu hóa tài khoản" | E-45 (as `W-Staff`) | | |
| Close | none | dialog closes without sending | with unsaved input, a confirm "Bỏ thay đổi?" |

A double click on the create button sends one request: the button is disabled while the mutation is pending and the key is shared by any retry (UIWS-14).

### 7. States

Loading (edit): skeleton fields. Error loading the account: 404 `not_found` → "Không tìm thấy tài khoản" and back to the list. Offline: submit disabled. Forbidden: a Manager opening `/staff/$staffId/edit` of an Admin gets the read-only dialog (fields disabled, no save).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.staff-new.title` | Tạo tài khoản nhân viên | Create a staff account |
| `web.staff-new.title.edit` | Sửa tài khoản nhân viên | Edit staff account |
| `web.staff-new.close.label` | Đóng | Close |
| `web.staff-new.field.name.label` | Họ và tên | Full name |
| `web.staff-new.field.email.label` | Email công việc | Work email |
| `web.staff-new.field.email.hint` | Dùng để đăng nhập web hoặc App quản lý | Used to sign in to the web CMS or the staff app |
| `web.staff-new.field.role.label` | Role | Role |
| `web.staff-new.role.admin.desc` | Toàn quyền, gồm nhóm Hệ thống và cổng thanh toán | Full access, including System and the payment gateway |
| `web.staff-new.role.manager.desc` | Toàn bộ nghiệp vụ, tạo và khóa tài khoản Kỹ thuật, Bảo vệ | All daily operations; creates and locks Technician and Guard accounts |
| `web.staff-new.role.technician.desc` | Nhận và xử lý phiếu sửa chữa trên App quản lý | Receives and handles repair tickets in the staff app |
| `web.staff-new.role.guard.desc` | Tra cứu căn, phương tiện và xử lý phiếu an ninh trên App quản lý | Looks up units and vehicles and handles security tickets in the staff app |
| `web.staff-new.field.language.label` | Ngôn ngữ giao diện | Interface language |
| `web.staff-new.hint.admin-step-up` | Tạo hoặc nâng quyền Admin cần xác nhận bằng mật khẩu và mã gửi qua email. | Creating or promoting an Admin needs your password and a code sent by email. |
| `web.staff-new.note.invite` | Nhân viên nhận email có link đặt mật khẩu, hiệu lực 24 giờ. | The person gets an email with a link to set a password, valid for 24 hours. |
| `web.staff-new.cta.cancel` / `.cta` / `.cta.save` | Hủy / Tạo và gửi email / Lưu thay đổi | Cancel / Create and send email / Save changes |
| `web.staff-new.action.disable` | Vô hiệu hóa tài khoản | Disable account |
| `web.staff-new.toast.created` | Đã tạo tài khoản. Email đặt mật khẩu đã gửi tới {email}. | Account created. A set-password email was sent to {email}. |
| `web.staff-new.toast.created.hint` | Chưa thấy email? Dùng "Gửi lại email" ở danh sách. | No email yet? Use "Resend email" in the list. |
| `web.staff.toast.updated` | Đã lưu thay đổi | Changes saved |
| `web.staff-new.dialog.discard.title` / `.confirm` | Bỏ thay đổi? / Bỏ thay đổi | Discard changes? / Discard |

Errors: `error.email_in_use`, `error.validation_failed`, `error.version_conflict`, `error.staff_has_open_tickets`, `error.last_admin`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWS-10 | **G** a Manager **W** opening "Tạo tài khoản" **T** the role group lists only "Kỹ thuật" and "Bảo vệ" | web-e2e |
| UIWS-11 | **G** a Manager **W** creating the Guard "Hoàng Đức Long" with a valid email **T** E-40 answers 201, the row shows "Bảo vệ" and "Chờ đặt mật khẩu", the mail catcher holds one invite whose link works once within 24 h | web-e2e |
| UIWS-12 | **G** an Admin **W** choosing the role "Admin" and pressing "Tạo và gửi email" **T** the step-up dialog opens before any E-40 call; with the right proof the account is created and every Admin gets the step-up notice mail | web-e2e |
| UIWS-13 | **G** an email that exists **W** creating **T** the error `email_in_use` shows under the email field and the dialog keeps the other values | web-e2e |
| UIWS-14 | **G** a valid form **W** double-clicking "Tạo và gửi email" **T** one account exists | web-e2e |
| UIWS-15 | **G** an Admin editing a Manager **W** changing the email **T** the step-up dialog (action `staff_email`) opens; after the proof E-42 answers 200 and the sessions of the person stay | web-e2e |
| UIWS-16 | **G** two Admins editing the same account **W** the second saves a stale form **T** the screen refetches, shows the message of `version_conflict`, and keeps the typed values | web-e2e |

---

## W-Building

> Status: Draft · Prototype: designed · Phase: P1 · DOC-67

### 1. Persona, use cases, permissions

PS-1 Admin only; UC-17 alternative E, UC-27 (terms); FR-38.1…38.4, FR-41.1, FR-41.2, FR-40.1. A Manager has no menu entry and gets 403 `forbidden` by URL (FR-38.1), shown as the Forbidden state.

### 2. URL and search params

`/building`; `dialog` · `terms` (the publish panel, with `kind` · `terms` or `privacy`, default `terms`). DOC-53 §4 listed a `tab` parameter with three tabs; the artboard is one page with one save, so DR-219 replaces `tab` by `dialog` and DOC-53 §4 owes the row change.

### 3. Prototype

Artboard `W-Building` ("Tòa nhà và cấu hình"), 1440 × 1120. Regions: title "Tòa nhà và cấu hình" with the subtitle and the actions "Hoàn tác" (ghost) and "Lưu thay đổi" (primary); left column, card "Thông tin tòa nhà và công ty" (name VI/EN, company, address, hotline, email, working hours) and card "Cấu hình chung" (default due days, default resident language `SegmentedControl`, login tries, lock minutes); right column, card "Logo công ty" (preview, "Đổi logo", format note) and card "Điều khoản sử dụng" (version, date, `Tag` "Đang áp dụng", "Sửa điều khoản").

Do not copy:

- "PNG hoặc SVG, tối đa 1 MB": the `logo` purpose accepts PNG and JPEG up to 1 MB (DOC-37 §4). Write `web.building.logo.format`.
- "ngày sau phát hành": the proposed due date is the **creation** date plus the days (FR-38.4).
- "Phiên bản 1.2" and "Sửa điều khoản": versions are whole numbers, one sequence per kind (terms, privacy), write-once; there is no edit, only "publish the next version" (DOC-36 §8, DR-111).
- "Cư dân và nhân viên đồng ý điều khoản…": only residents accept terms (FR-39, FR-41); staff do not.
- The single "Địa chỉ" and "Giờ làm việc" fields: the API holds the building address and the company address, and the working hours in both languages (§5).
- Settings the artboard lacks but E-47 returns: `accountDeletionDays`, `maxCarsPerUnit`, `storageQuotaBytes`, `feeNoticeLanguage` (`reportColumns` has no field in P1; DOC-33 owns it). Add them to "Cấu hình chung".

### 4. Regions and components

`TextField` (with `suffix` and `helper`), `SegmentedControl`, `Card`, `Tag`, `Button`, `Dialog`, `AttachmentPicker` (logo), `Banner`. The info card lists the building's fields (name VI/EN, address, hotline, email, working hours VI/EN), then, under the heading `web.building.card.info.company` and a rule, the company's (name VI/EN, tax code, representative, address, phone, email); the required ones (building name, address, company name) carry the asterisk of DOC-54 §17.9, and the loading skeleton has the same two groups. A setting that has no stored value shows `web.building.default-tag` ("Mặc định") next to its label (E-47 `saved` lists the stored keys). The form is dirty-tracked: "Hoàn tác" and "Lưu thay đổi" are disabled while clean, and leaving the page with unsaved edits asks `web.building.dialog.discard.*`.

Field map (the prototype label → the E-47 field and its rule, DOC-36 §4.2 and §5.1):

| Label (vi) | Field | Rule |
| --- | --- | --- |
| Tên tòa nhà / Tên tiếng Anh | `building.name.vi` / `.en` | vi required 1…120; en ≤ 120 |
| Tên công ty quản lý | `building.company.name.vi` | required 1…160 |
| Tên công ty (English), Mã số thuế, Địa chỉ công ty, Số điện thoại công ty, Email công ty, Người đại diện (added) | `company.name.en`, `.taxCode`, `.address`, `.phone`, `.email`, `.representative` | taxCode `^[0-9]{10}(-[0-9]{3})?$`; address 1…300; phone ≤ 30; email valid; representative ≤ 120 |
| Địa chỉ | `building.address` | 1…300 |
| Hotline / Email | `hotline` / `email` | ≤ 30 digits, spaces, `+().-` / valid address |
| Giờ làm việc (+ English, added) | `workingHours.vi` / `.en` | vi required when present, each ≤ 200 |
| Hạn thanh toán mặc định | `settings.defaultDueDays` | 1…60, default 10 |
| Ngôn ngữ mặc định cho cư dân mới | `settings.defaultLanguage` | `vi` or `en` |
| Đăng nhập sai tối đa / Khóa đăng nhập trong | `settings.lockout.maxAttempts` / `.minutes` | 3…10 (default 5) / 5…120 (default 15); always sent together |
| Số ngày chờ trước khi xóa tài khoản (added) | `settings.accountDeletionDays` | 1…365, default 30 |
| Số ô tô tối đa mỗi căn (added) | `settings.maxCarsPerUnit` | 1…20, default 2 |
| Dung lượng file tối đa, GB (added) | `settings.storageQuotaBytes` | 1…1,024 GB (stored in bytes), default 50 |
| Ngôn ngữ thông báo phí (added) | `settings.feeNoticeLanguage` | `vi`, `en`, `both` |

### 5. Data

| Read | Endpoint | Query key | Note |
| --- | --- | --- | --- |
| Building row and settings | E-47 | `['settings']` | `ETag` `"<building.version>.<setting.version>"` is kept with the data and sent as `If-Match` |
| Terms versions of both kinds | E-52 | `['terms', kind]` | newest first, `acceptedCount` |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Lưu thay đổi" | E-48 `{ building?, settings? }` with only the changed fields (`null` removes a setting), `If-Match` | 200: the form resets to the returned document, toast `toast.saved` | 422 `validation_failed` rule `setting_invalid` → the message under each field named by `details[].path`, nothing saved. 400 `validation_failed` (pattern, length) likewise. 409 `version_conflict` → refetch E-47, re-apply the fields the Admin changed on top of the fresh document, banner `banner.conflict`, wait for a new press (UX-02). 428 cannot happen (the client always sends `If-Match`) |
| "Hoàn tác" | none | the form returns to the last fetched document | |
| "Đổi logo" (PNG or JPEG ≤ 1 MB) | E-36 `{ purpose: 'logo', mime, size }` → `PUT` to the presigned URL → E-37 verify → `logoFileId` joins the next E-48 | the preview shows the new image at once; it becomes the logo on save | 413 `quota_exceeded`, 422 `file_not_verified` → toast with the message; a wrong type is refused on the device first |
| "Xóa logo" | E-48 `building.logoFileId = null` on save | | |
| "Xem và xuất bản phiên bản mới" (per kind) | opens `dialog=terms&kind=…` | panel with the current text, two `textarea`s (vi, en) and a live preview | |
| "Xuất bản" in the panel | E-53 `{ kind, text: { vi, en } }` | 201: toast `toast.terms-published`; E-52 refetches; the card shows the new version and `acceptedCount` 0 | 400 `validation_failed` rule `terms_text`: `details[0].path` is `text.vi:12`, the preview marks that line; 409 `version_conflict` (two Admins at once): refetch E-52 |
| "Xem các phiên bản" | none (E-52 data) | list of versions with date, publisher and accepted count | |

The panel validates with the same `parseTermsMarkdown` as the API (`@rms/shared-types`, DOC-36 §8), so a violation is shown before the request. English text is required for a real building; the demo building may omit it. Publishing asks to confirm: `dialog.publish.body` ("Mọi cư dân phải đồng ý lại ở lần mở app tiếp theo.").

### 7. States

Loading: skeleton cards. Error: the DOC-68 pattern. Stale: the form keeps edits; the conflict banner above is the stale state. Forbidden: Manager by URL. Offline: save and publish disabled. Unsaved edits guard the route. No money.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.building.title` | Tòa nhà và cấu hình | Building and configuration |
| `web.building.subtitle` | Thông tin hiện trên thông báo phí, App cư dân và email gửi nhân viên | Shown on fee notices, the resident app and staff emails |
| `web.building.action.undo` / `.cta` | Hoàn tác / Lưu thay đổi | Undo changes / Save changes |
| `web.building.card.info.title` | Thông tin tòa nhà và công ty | Building and company |
| `web.building.card.info.company` | Công ty quản lý | Management company |
| `web.building.field.name.label` / `.name-en.label` / `.name-en.hint` | Tên tòa nhà / Tên tiếng Anh / Hiện khi người dùng chọn English | Building name / English name / Shown when the user picks English |
| `web.building.field.company.label` | Tên công ty quản lý | Management company name |
| `web.building.field.company-en.label` / `.tax-code.label` / `.tax-code.placeholder` / `.representative.label` | Tên công ty (tiếng Anh) / Mã số thuế / VD: 0312345678 / Người đại diện | Company name (English) / Tax code / e.g. 0312345678 / Representative |
| `web.building.field.company-address.label` / `.company-phone.label` / `.company-email.label` | Địa chỉ công ty / Số điện thoại công ty / Email công ty | Company address / Company phone / Company email |
| `web.building.field.address.label` / `.hotline.label` / `.email.label` / `.hours.label` | Địa chỉ / Hotline / Email / Giờ làm việc | Address / Hotline / Email / Working hours |
| `web.building.card.settings.title` | Cấu hình chung | General settings |
| `web.building.field.due-days.label` / `.suffix` / `.hint` | Hạn thanh toán mặc định / ngày sau ngày tạo đợt / Gợi ý khi tạo đợt phí mới, sửa được ở từng đợt | Default payment term / days after the batch is created / Suggested for a new batch; editable per batch |
| `web.building.field.language.label` / `.hint` | Ngôn ngữ mặc định cho cư dân mới / Cư dân đổi được trong App cư dân | Default language for new residents / Residents can change it in the resident app |
| `web.building.field.max-tries.label` / `.suffix` / `.hint` | Đăng nhập sai tối đa / lần / Áp dụng cho tài khoản nhân viên | Wrong sign-ins allowed / times / Applies to staff accounts |
| `web.building.field.lock-minutes.label` / `.suffix` / `.hint` | Khóa đăng nhập trong / phút / Sau khi nhập sai quá số lần cho phép | Lock sign-in for / minutes / After too many wrong tries |
| `web.building.field.deletion-days.label` / `.hint` | Số ngày chờ trước khi xóa tài khoản / Từ lúc Ban quản lý duyệt yêu cầu của cư dân | Days before an account is deleted / Counted from the Manager's approval of the resident's request |
| `web.building.field.max-cars.label` / `.hint` | Số ô tô tối đa mỗi căn / Chỉ cảnh báo khi duyệt xe, không chặn | Maximum cars per unit / Only a warning when a vehicle is reviewed, never a block |
| `web.building.field.quota.label` / `.suffix` | Dung lượng file tối đa / GB | File storage quota / GB |
| `web.building.field.fee-lang.label` | Ngôn ngữ thông báo phí | Fee notice language |
| `web.building.default-tag` | Mặc định | Default |
| `web.building.card.logo.title` / `.hint` | Logo công ty / Dùng trên thông báo phí và phiếu thu PDF | Company logo / Used on fee notices and receipt PDFs |
| `web.building.logo.change` / `.remove` / `.format` | Đổi logo / Xóa logo / PNG hoặc JPEG, tối đa 1 MB | Change logo / Remove logo / PNG or JPEG, up to 1 MB |
| `web.building.card.terms.title` / `.privacy.title` | Điều khoản sử dụng / Chính sách quyền riêng tư | Terms of use / Privacy notice |
| `web.building.terms.version` | Phiên bản {version}, xuất bản {date} | Version {version}, published {date} |
| `web.building.terms.accepted` | {count} cư dân đã đồng ý | {count} residents accepted |
| `web.building.terms.note` | Cư dân đồng ý điều khoản khi đăng nhập lần đầu và sau mỗi phiên bản mới. | Residents accept the terms at first sign-in and after each new version. |
| `web.building.terms.publish` / `.versions` | Xuất bản phiên bản mới / Xem các phiên bản | Publish a new version / See versions |
| `web.building.dialog.publish.body` | Mọi cư dân phải đồng ý lại ở lần mở app tiếp theo. | Every resident must accept again the next time they open the app. |
| `web.building.dialog.publish.confirm` | Xuất bản | Publish |
| `web.building.banner.conflict` | Có người vừa thay đổi cấu hình. Đã tải bản mới, hãy xem lại thay đổi của bạn rồi lưu lại. | Someone just changed the settings. The new version is loaded; review your changes and save again. |
| `web.building.dialog.discard.title` / `.confirm` | Bỏ thay đổi chưa lưu? / Bỏ thay đổi | Discard unsaved changes? / Discard |
| `web.building.toast.saved` / `.terms-published` | Đã lưu cấu hình / Đã xuất bản phiên bản {version} | Settings saved / Version {version} published |

Errors: `error.setting_invalid`, `error.terms_text`, `error.version_conflict`, `error.file_not_verified`, `error.quota_exceeded`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWS-17 | **G** an Admin **W** changing the hotline to "1900 5678" and the default due days to 15 and saving **T** E-48 carries only those two fields, the form resets to the response, and a reload shows both | web-e2e |
| UIWS-18 | **G** an Admin **W** entering 0 in "Hạn thanh toán mặc định" and 4 in "Khóa đăng nhập trong" **T** both fields show their range message from `setting_invalid`, nothing is saved | web-e2e |
| UIWS-19 | **G** two Admins with the form open **W** the second saves after the first **T** the second sees `banner.conflict`, the fresh values load, and the fields the second typed stay on top | web-e2e |
| UIWS-20 | **G** a Manager **W** opening `/building` by URL **T** the Forbidden state shows, the sidebar has no "Tòa nhà và cấu hình" | web-e2e |
| UIWS-21 | **G** a PNG of 900 KB, an SVG, a JPEG of 2 MB **W** each is chosen as logo **T** the first uploads and previews; the other two are refused with `web.building.logo.format` before any request | web-e2e |
| UIWS-22 | **G** an Admin in the terms panel **W** the Vietnamese text has `<b>` on line 12 **T** the preview marks line 12 and "Xuất bản" is disabled; with valid Markdown in both languages publishing shows version N+1 with 0 accepted | web-e2e |
| UIWS-23 | **G** unsaved edits **W** the Admin navigates away **T** the discard dialog asks; "Bỏ thay đổi" leaves, closing it stays | web-e2e |

---

## W-Step-Up

> Status: Draft · Prototype: to design (owner: client or Owner, before the P1 gate; DR-72) · Phase: P1 · DOC-67

### 1. Persona, use cases, permissions

PS-1 Admin, journey J-1; UC-17 (main flow "change the receiving account", error E2); FR-50.1…50.4, FR-14.5, FR-38.3. Only an Admin ever sees the dialog: for a Manager the route answers 403 `forbidden` first (DR-147) and the actions are hidden.

**The usage rule for every web screen.** A screen that performs a sensitive staff action (glossary) uses the shared `StepUpDialog` through `useStepUpMutation(action, buildRequest)` (DOC-55 §5), never its own prompt:

| Action | Triggered by | Screens |
| --- | --- | --- |
| `admin_change` | E-40 with `role = admin`; E-42 with `role = admin` (promotion) | `W-Staff-New` |
| `staff_email` | E-42 with `email` | `W-Staff-New` (edit mode) |
| `gateway_config` | every E-50, including an unchanged re-save | `W-Gateway` (P3) |

1. **Proactive and reactive (DR-216).** The screen knows its action from its own form (the table above) and opens the dialog when the user presses the main button, before sending a request that would be refused. The dialog also opens on any `403 step_up_required` (`details.action` names the action), which covers a rule that changed on the server.
2. **Two steps.** Step 1 "Gửi mã": `POST /staff/step-up { action }` (E-38, 204) mails a 6-digit code to the Admin's own address. Step 2: the Admin enters the password and the code; the screen sends the original request again with `"stepUp": { "password", "code" }`.
3. **Code rules to show:** valid 10 minutes, single use, one live code per action (a new request consumes the older), at most 5 requests per hour (429 `rate_limited`, `details.scope = "step_up"`, `Retry-After`).
4. **The original request is held in memory** (method, path, body, `If-Match`) while the dialog is open; the form behind it keeps its values and is not submittable. The password and the code live only in the dialog's fields and are never stored, logged or put in a URL.
5. **Each proof attempt is a new request with a new `Idempotency-Key`** (a refused call stored nothing, and a body that differs by `stepUp` under the same key would be 422 `idempotency_key_reuse`). A network retry inside one attempt reuses that attempt's key (DOC-55 §4.3).
6. **Errors.** `step_up_failed` (403, the same body for a wrong password, a wrong, expired, used or another Admin's code) keeps the dialog open, clears the code field, keeps the password, and shows "Mật khẩu hoặc mã chưa đúng" with `details.attemptsLeft`. With `attemptsLeft = 0` the code is spent: show `banner.code-spent` and return to step 1. Five wrong codes consume the challenge; a wrong password counts toward the sign-in lockout, so the dialog carries `hint.lockout`.
7. **Cancel** ("Hủy", Esc, outside click): nothing is sent, the held request is dropped, the form becomes editable again.
8. **Success:** the dialog closes, the original screen handles the 200 or 201 as usual, and the toast `toast.done` tells that every Admin receives an email (FR-50.4).

### 2. URL and search params

None. A dialog mounted by the Admin shell, triggered by a mutation, not linkable (DOC-53 §4 rule 4).

### 3. Prototype

Not drawn (DR-72, `to design`). ASCII wireframe until the artboard exists; design owner and deadline: the client or Owner, before the P1 gate (P1-00).

```
Step 1                                          Step 2
+------------------------------------------+    +------------------------------------------+
| Xác nhận thao tác nhạy cảm          [x]  |    | Xác nhận thao tác nhạy cảm          [x]  |
| Tạo hoặc nâng quyền một Admin            |    | Tạo hoặc nâng quyền một Admin            |
|                                          |    |                                          |
| Chúng tôi gửi mã 6 số tới p***@mocmien.vn|    | Mật khẩu        [ ••••••••••••  ]        |
| Mã có hiệu lực 10 phút, dùng được 1 lần.|    | Mã xác nhận     [ _ ][ _ ][ _ ][ _ ][ _ ][ _ ]|
|                                          |    | ! Mật khẩu hoặc mã chưa đúng. Còn 4 lần  |
|                                          |    |   thử mã này.                            |
|                                          |    | Gửi lại mã (sau 24 giây)                 |
|           [ Hủy ]   [ Gửi mã ]           |    |        [ Hủy ]   [ Xác nhận ]            |
+------------------------------------------+    +------------------------------------------+
```

Width 480 px, centered `Dialog`, focus trapped, Esc cancels.

### 4. Regions and components

`Dialog`, `OtpInput` (6 digits, `inputmode="numeric"`, `autocomplete="one-time-code"`), `TextField` type password (`autocomplete="current-password"`, paste allowed), `Banner` (danger), `Button`. The masked address comes from E-30 (`p***@domain`). The resend button is disabled for 30 s after each request (a client convenience; the server limit is 5 per hour).

### 5. Data

| Read | Endpoint | Note |
| --- | --- | --- |
| The Admin's email (masked on screen) | E-30 | cached `['staff', 'me']` |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gửi mã" / "Gửi lại mã" | E-38 `{ action }` | 204: step 2, toast `toast.sent`, 30 s resend timer | 429 `rate_limited` (`scope = "step_up"`): `banner.rate-limited` with the minutes from `Retry-After`, stay on step 1. 403 `forbidden`: close the dialog, show the Forbidden message |
| "Xác nhận" | the held request, now with `stepUp { password, code }` (E-40, E-42 or E-50) | the dialog closes; the screen handles the answer | 403 `step_up_failed`: item 6 above. 409 and 4xx of the action itself (`email_in_use`, `gateway_in_use`, `last_admin`, `version_conflict`): the dialog closes and the originating screen shows the error and keeps its form |
| "Hủy" | none | item 7 | |
| The code is older than 10 minutes on the device clock | none | `banner.code-expired`, back to step 1 (the server remains the authority: its `step_up_failed` is handled the same way) | |

### 7. States

Sending the code: the button shows a spinner and is disabled. Confirming: both fields disabled. Offline: both buttons disabled with the reason (UX-04). No loading, empty or stale state beyond that.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.step-up.title` | Xác nhận thao tác nhạy cảm | Confirm a sensitive action |
| `web.step-up.action.admin_change` | Tạo hoặc nâng quyền một Admin | Create or promote an Admin |
| `web.step-up.action.staff_email` | Đổi email của một nhân viên | Change a staff member's email |
| `web.step-up.action.gateway_config` | Đổi cấu hình cổng thanh toán hoặc tài khoản nhận tiền | Change the payment gateway or the receiving account |
| `web.step-up.step1.body` | Chúng tôi gửi mã 6 số tới email của bạn ({maskedEmail}). Mã có hiệu lực 10 phút và chỉ dùng được một lần. | We will email a 6-digit code to {maskedEmail}. It is valid for 10 minutes and works once. |
| `web.step-up.cta.send` | Gửi mã | Send code |
| `web.step-up.field.password.label` | Mật khẩu | Password |
| `web.step-up.field.code.label` / `.hint` | Mã xác nhận / Nhập mã 6 số trong email | Confirmation code / Enter the 6-digit code from the email |
| `web.step-up.field.code.attempts` | Còn {attemptsLeft} lần thử mã này. | {attemptsLeft, plural, one {# try} other {# tries}} left for this code. |
| `web.step-up.cta` / `.cta.cancel` | Xác nhận / Hủy | Confirm / Cancel |
| `web.step-up.cta.resend` / `.cta.resend-wait` | Gửi lại mã / Gửi lại sau {seconds} giây | Send a new code / Send again in {seconds} s |
| `web.step-up.banner.code-spent` | Mã này đã hết lượt thử. Gửi mã mới để tiếp tục. | This code has no tries left. Send a new code to continue. |
| `web.step-up.banner.code-expired` | Mã đã hết hạn sau 10 phút. Gửi mã mới. | The code expired after 10 minutes. Send a new one. |
| `web.step-up.banner.rate-limited` | Bạn đã yêu cầu quá nhiều mã. Thử lại sau {minutes} phút. | You asked for too many codes. Try again in {minutes} minutes. |
| `web.step-up.hint.lockout` | Nhập sai mật khẩu nhiều lần sẽ tạm khóa đăng nhập. | Too many wrong passwords temporarily lock sign-in. |
| `web.step-up.toast.sent` | Đã gửi mã tới {maskedEmail} | Code sent to {maskedEmail} |
| `web.step-up.toast.done` | Đã xác nhận. Mọi Admin sẽ nhận email về thay đổi này. | Confirmed. Every Admin will get an email about this change. |

Errors: `error.step_up_failed` (body "The password or code is not correct."), `error.step_up_required`, `error.rate_limited`.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWS-24 | **G** an Admin creating an Admin **W** pressing the main button **T** the dialog opens with no E-40 call yet; "Gửi mã" calls E-38 once and shows step 2; the mail catcher holds one 6-digit code | web-e2e |
| UIWS-25 | **G** step 2 **W** a wrong code is entered **T** E-40 answers 403 `step_up_failed`, the dialog stays, shows "Còn 4 lần thử mã này.", the code field is empty, the form behind keeps its values | web-e2e |
| UIWS-26 | **G** step 2 **W** five wrong codes **T** the fifth shows `banner.code-spent` and step 1; the right code of the same challenge is refused until a new code is requested | web-e2e |
| UIWS-27 | **G** a used code and a code of 10 min 1 s **W** each is entered **T** each gives `step_up_failed`; neither creates the account | web-e2e |
| UIWS-28 | **G** the right password and code **W** "Xác nhận" **T** the account is created once, the dialog closes, `toast.done` shows, every Admin has the notice mail | web-e2e |
| UIWS-29 | **G** six code requests within one hour **W** the sixth **T** E-38 answers 429 and `banner.rate-limited` shows | web-e2e |
| UIWS-30 | **G** the dialog open **W** "Hủy" or Esc **T** no proof request is sent and the form becomes editable | web-e2e |
| UIWS-31 | **G** a proof attempt that fails and a second that succeeds **W** the requests are inspected **T** the two E-40 calls carry different `Idempotency-Key` headers and only the second stores a response | api |
| UIWS-32 | **G** a Manager **W** inspecting the create and edit screens **T** no path opens the dialog; a forged E-38 call is 403 `forbidden` | web-e2e |

---

## Specified before P3 and P6

These screens are designed. They get full sections (A.5) before their phase; this table fixes what those sections must settle. Endpoint IDs are DOC-51 §9.

| Screen | Phase | Role | Endpoints | What the section must fix (prototype deviations from DOC-56 §5 and gaps) |
| --- | --- | --- | --- | --- |
| `W-Gateway` | P3 | Admin | E-49 read, E-50 write (step-up `gateway_config`), E-51 check | N3: one configured provider whose fields come from `drivers` in E-49, not a VNPay/VietQR choice or the banner "Chưa chốt cổng…" (a design note). Secrets are masked (`••••` + last four) and never returned, so the "Hiện" buttons go. Receiving account is bank BIN (a picker), account number (6…20 digits) and name (upper-case ASCII ≤ 50), replacing "Ngân hàng nhận" free text. "URL nhận IPN" becomes a provider-neutral webhook URL. The "Môi trường thử nghiệm" switch has no field in E-50. 409 `gateway_in_use` is a first-class state. "IPN gần nhất" and the health cards need data E-51 does not return (last webhook) — owed by DOC-24 / DOC-52 |
| `W-Audit` | P6 | Admin (a Manager has no page; E-54 serves history panels) | E-54 | The filters are the E-54 parameters (`actorId`, `action` prefix, `objectType` + `objectId`, `from`, `to`, `requestId`, `cursor`, `limit`); the free-text search "Tìm nội dung, mã căn…" has no endpoint; "Xuất Excel" has no endpoint (the export center, DR-55). Each row is built from `action` and `changes` through catalog keys, not stored sentences. Codes in rows follow DOC-14 (N4). Values show `[masked]` as returned; `ip` and `userAgent` appear for the Admin only |
| `W-System` | P6 | Admin | E-55 storage; E-56 demo reset (demo building only) | Storage is the live `usedBytes` / `quotaBytes` and `byPurpose` (labels map from purposes, not the sample ones). Backups: the artboard shows "Tự động hằng ngày 02:00, 5 bản" while the system uses pgBackRest with point-in-time recovery (DR-66, DR-83), so the card shows the last full backup and the latest archived WAL time; **no endpoint exists for this** (owed by DOC-40 / DOC-72). The "Môi trường" and "Gửi thông báo" cards (staging/production URLs, SMS count of the day) are not product data and have no endpoint; drop them or source them from DOC-40 metrics |

## Decisions made while writing

Delegated by the Owner (design details). Recorded in the register as DR-216…219.

| Id | Decision |
| --- | --- |
| DR-216 | The step-up dialog opens proactively (the form knows its action) and reactively (any 403 `step_up_required`); each proof attempt carries a new `Idempotency-Key`; the held request, password and code live only in memory |
| DR-217 | The chip counts and the subtitle of `W-Staff` come from one unfiltered E-39 call (`pageSize=50`); no new endpoint |
| DR-218 | Edit mode of a staff account reuses the dialog of `W-Staff-New`; "Vô hiệu hóa tài khoản" lives in that dialog; "Kích hoạt lại" is the row action of a disabled account |
| DR-219 | `W-Building` is one page with one save; the terms panel is `dialog=terms`; this replaces the `tab` parameter of DOC-53 §4 |

## Open questions

None.
