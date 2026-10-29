# Web: sign-in, dashboard, operations

> Status: **Approved** (Owner, 2026-10-21, for §1 (gate P1); the rest is owed to P4, P5 and P6) · Updated: 2026-10-29 (DR-311: the shell on `ground`, the active entry) · 2026-10-28 (DR-279: the usage switch on `W-Profile`) · 2026-10-20 · DOC-64
> Depends on: original SDD §18, [DR](../../00-decision-register.md) (DR-38, 39, 41…47, 64, 71, 72, 75, 84, 128, 130, 147, 150), [DOC-03](../../01-product/requirements.md) (FR-13, FR-45), [DOC-04](../../01-product/use-cases.md) (UC-17, UC-26), [DOC-26](../../06-design/identity-and-sessions.md) §3.3, §4, [DOC-37](../../06-design/files-and-uploads.md) §4, [DOC-42](../../06-design/error-handling.md) §5, [DOC-51](../../07-api/api-endpoints.md) (E-03, E-05…E-08, E-11, E-12, E-30…E-38), [DOC-53](../ux-principles-and-ia.md) §3.4, §4, [DOC-55](../client-architecture.md) §5, §6, §17, [DOC-56](README.md) §5, §6, [DOC-54](../design-system.md)
> Main readers: P1-16 (web CMS shell), P1-14, P1-15, the writers of DOC-65 and DOC-67 (they use the shell described here), P4, P5 and P6 tasks that build the later screens of this file

This document specifies the web CMS screens for signing in, the account profile and the operations area. **P1 sections (required by P1-00): the web app shell, `W-Login`, `W-Forgot-Sent`, `W-Reset`, `W-Profile`.** The other ten screens are listed once in "Specified before P4 / P5 / P6" and get their own sections before their phase (master plan §0.1). Tokens and components are DOC-54, navigation and URLs are DOC-53, the shared client rules are DOC-55, and the strings of every key are collected in DOC-68.

Test prefix: `UIWO-` (DOC-56 §6.3; unused before this document; DOC-88 §15 indexes it).

## Screens in this file

| Section | Screen | Role | Phase | Prototype | Notes (DOC-56 §5) |
| --- | --- | --- | --- | --- | --- |
| Web app shell | Sidebar, top bar, bell, `/wrong-app` | Admin, Manager | P1 | designed (shell); `/wrong-app` to design | N8 |
| `W-Login` | Email and password sign-in | Any staff (signed out) | P1 | designed | N2, N8 |
| `W-Forgot-Sent` | Reset link sent | Any staff (signed out) | P1 | designed | N8 |
| `W-Reset` | Set a new password in the browser | Any staff (link holder) | P1 | designed | |
| `W-Profile` | Name, avatar, language, reset link, sessions | Admin, Manager | P1 | designed | N9 |
| `W-Dashboard`, `W-Tickets`, `W-Ticket-Detail`, `W-Ticket-Assign`, `W-Ticket-Types`, `W-Ticket-Cancel`, `W-Notices`, `W-Notice-Edit`, `W-Notice-Stats`, `W-Docs` | | | P4, P5, P6 | see the table at the end | N7 |

## Web app shell

Every `W-` screen after sign-in sits in one shell, described here once. DOC-65, DOC-66 and DOC-67 refer to it and do not repeat it.

| Region | What it holds | Data |
| --- | --- | --- |
| Sidebar (`aside`, 248 px, on `ground` without a border, DR-311) | Brand block: the brand mark, the building name and the words "Web quản lý". Navigation groups Tổng quan / Vận hành / Cư dân / Tài chính / Hệ thống; the entries a role and a phase allow are the table of DOC-53 §3.4 (not repeated). Active entry: `surface` with `shadow-panel`, `ink` text, weight 600, filled icon in `teal` (DOC-54 §8.1). Counter badges on "Phiếu hỗ trợ" and "Phương tiện" appear with P4 and P5 | Brand: `contact.name` of E-03 (60 s cache), never hard-coded (N8). Role and name: E-30 |
| User block (bottom of the sidebar) | Avatar, full name, role label, `sign-out` icon button. The block opens `/profile`; the icon button signs out | E-30; sign-out E-12 |
| Top bar (56 px, on `ground`; its bottom edge shows once the page scrolls under it, DR-311) | Breadcrumb "Group / Page": each crumb before the current page is a link (a group opens its first page, a detail page's middle crumb opens its list); theme switch (system, light, dark, DR-304), language switch VI / EN, bell with an unread count | E-30 `language`; theme: this browser only; bell: see below |
| Page area | Padding 28 / 32 px; `h1` (26 / 32, weight 600), one line of subtitle (14 / 20, `ink-muted`), page actions at the right | The screen |

Behavior:

- **Session boot.** The `_app` layout awaits `POST /auth/refresh` (E-11, cookie mode) and `GET /staff/me` (E-30) before it renders (DOC-55 §5.1, §17). No session: `/login?redirect=<path>` (DOC-53 §4 rule 5). A role that is not Admin or Manager: `/wrong-app`.
- **Language switch.** Signed out (`W-Login`, `W-Forgot-Sent`, `W-Reset`): local only; the choice is kept in the browser and the first value is the device language (`Accept-Language`, UX-12). Signed in: `PATCH /staff/me {language}` (E-31, `If-Match`) and the catalog switches at once; on failure the switch returns to the old language and a toast says so.
- **Bell.** Not shown in P1: the staff inbox (E-76, E-77) and the `inbox.created` event ship with P4, and an entry exists only when its phase has shipped (DR-174).
- **Live events.** The shell opens the stream `GET /staff/events` (E-75, DOC-52) once the endpoint is built. The event `session.revoked` signs the screen out at once (`auth.signed_out`); without the stream a revoked session ends at the next refresh, within the 15-minute access token (FR-45.1).
- **Sign-out.** E-12 with `X-Requested-With: rms`, then the local steps of DOC-55 §5.4 even if the call fails; the destination is `/login?reason=signed_out`.
- **Step-up.** A mutation that answers 403 `step_up_required` (`details.action`) opens the global dialog `W-Step-Up` (specified in DOC-67): "send code" (E-38), password and 6-digit code, then one replay of the same mutation with `stepUp {password, code}` and a fresh `Idempotency-Key`; `step_up_failed` stays inside the dialog (UX-09). Only an Admin can reach it: a Manager gets 403 `forbidden` first and the action is hidden (DR-147). No screen of this file needs step-up: `W-Profile` cannot change the email (E-31 refuses the key).
- **Forbidden.** A route whose role list excludes the signed-in role renders the Forbidden state, not a redirect (UX-07).

### `/wrong-app`

> Status: Draft · Prototype: to design · Phase: P1 · DOC-64 (the row is owed to DOC-56 §4)

A Technician or a Guard who signs in on the web CMS gets a valid session (the API lets any role sign in anywhere, DOC-26 §4.1) and sees only this page (DR-174, DOC-53 §3.4). No other route renders for them.

```
+------------------------------------------------+
|  <building name>                       [VI|EN] |
|                                                |
|   +----------------------------------------+   |
|   |   (phone icon)                         |   |
|   |   Tài khoản này dùng App quản lý       |   |
|   |   Kỹ thuật và Bảo vệ làm việc trên App  |   |
|   |   quản lý. Tải app rồi đăng nhập bằng   |   |
|   |   cùng email và mật khẩu.              |   |
|   |   [App Store]   [Google Play]          |   |
|   |   [ Đăng xuất ]                        |   |
|   +----------------------------------------+   |
+------------------------------------------------+
```

Data: E-30 (role), E-03 `apps.staff.storeUrl.ios|android` (buttons are links; a missing URL hides its button). Interaction: "Đăng xuất" → E-12. Keys `web.wrong-app.title`, `.body`, `.cta.ios`, `.cta.android`, `.cta.signout`. The design owner draws it before P1-16 (DOC-56 §4).

## W-Login

> Status: Review · Prototype: designed · Phase: P1 · DOC-64

### 1. Persona, use cases, permissions

PS-1 Admin and PS-2 Manager (a Technician or Guard may type their credentials here too and meets `/wrong-app`). UC-17 alternative flow A and error flow E3, FL-17; FR-13.1, FR-13.2, FR-13.4, FR-45.4. The screen is public.

### 2. URL and search params

`/login`. Search params (DOC-53 §4): `redirect` (an app path, same-origin only: it must start with a single `/` and be a route of the URL map, anything else is ignored); `reason` (`expired`, `signed_out`, `password_set`); `dialog` (`forgot`, DR-210). The email typed is never put in the URL.

### 3. Prototype

Canvas artboard `W-Login` ("Chung: Đăng nhập"), 1440 wide, fluid. Regions: (a) left hero panel (`hero-from` → `hero-to` gradient card): building name and hotline at the top; headline and subtitle; three feature lines with icons; (b) right column: language pill VI / EN, then the form: `h1`, one line of help, `Banner` (danger) for errors, `TextField` Email, `TextField` Mật khẩu, ghost `Button` "Quên mật khẩu", primary lg block `Button` "Đăng nhập", one line about the apps, and a footer line.

Do not copy:

- **N2.** The banner "Email hoặc mật khẩu chưa đúng. Còn 2 lần thử, sau đó tài khoản tạm khóa 15 phút." One 401 body answers every credential failure and no count appears anywhere (DR-128). The text is "Email hoặc mật khẩu chưa đúng."
- **N8.** "Công ty Quản lý Mộc Miên", "Hotline 1900 6868, 08:00–17:30, thứ Hai–thứ Bảy" and the address line "128 Nguyễn Văn Huyên, Cầu Giấy, Hà Nội, 1 tòa, 24 tầng, 240 căn". The public config holds the building name, hotline, working hours and email only (E-03), so the company line, the address and the unit count are dropped; the hero reads the building name and "Hotline {hotline}, {hours}" from E-03. The feature line "…của 240 căn" loses its number.
- The sample values `trang.nguyen@mocmien.vn` and `mocmien26` are data of the canvas.

### 4. Regions and components

Hien `Banner` (tone `danger`, `warning` for the lock, `info` for `reason`), `TextField` (`type="email"`, `type="password"`), `Button` (primary lg block, ghost sm), `Dialog` (forgot), language `SegmentedControl` style pill. The hero is a `Card` with the hero gradient.

### 5. Data

| Read | Endpoint | Rule |
| --- | --- | --- |
| Building contact for the hero | E-03 `GET /public/config` | Cached 60 s; a failure leaves the hero with the static headline and no hotline; the form still works |
| Boot refresh | E-11 `POST /auth/refresh` | Once on mount in cookie mode; success skips the form (navigate to a valid `redirect`, else the landing page); 401 shows the form without a message |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Sign in | E-05 `POST /auth/staff/login` `{email, password, client: "web"}`; the button is disabled while in flight (UX-01); no idempotency key (not a create) | Keep the access token in memory (DOC-55 §5.1); E-30; Admin or Manager → a valid `redirect`, else the landing page (`/units` until the dashboard ships, DOC-53 §3.4); Technician or Guard → `/wrong-app` | 401 `invalid_credentials` → banner `error.invalid_credentials`, password cleared and focused, identical for a wrong password, an unknown email and an account that is not active. 423 `account_locked` → banner with `{minutes}` = `ceil(details.retryAfter / 60)`, the submit button disabled until the countdown ends (monotonic clock). 429 `rate_limited` → banner with the wait from `Retry-After`. 400 `validation_failed` → field errors (email format). 503 `maintenance` / `service_unavailable` → banner `error.service_unavailable`, form kept |
| Forgot password | opens the dialog `?dialog=forgot` (DR-210), email prefilled from the field | Dialog submit → E-06 `POST /auth/staff/password-reset {email}`; 202 → navigate to `/forgot/sent` carrying the email in router state | 429 → inside the dialog, with the wait; 400 → email field error |
| Language switch (signed out) | none | Catalog switches and the choice is kept in the browser | |
| Show the reason | `reason=expired` → `auth.signed_out`; `reason=signed_out` → no banner; `reason=password_set` → `web.login.banner.password_set` | | |

### 7. States

Loading: the hero shows skeleton lines until E-03 answers; the form is usable at once. Error: E-03 failing is silent (see §5). Offline: banner "no network" and the submit button disabled (UX-04). Forbidden, stale and empty do not apply. Locked: the field stays editable, only submit waits.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.login.title` | Đăng nhập | Sign in |
| `web.login.subtitle` | Dùng email công việc và mật khẩu được cấp khi tạo tài khoản. | Use your work email and the password you set from your invitation. |
| `web.login.hero.title` | `{buildingName}` | `{buildingName}` |
| `web.login.hero.subtitle` | Web quản lý cho Admin và Ban quản lý | Management web for Admins and the management office |
| `web.login.hero.hotline` | Hotline {hotline}, {hours} | Hotline {hotline}, {hours} |
| `web.login.hero.point1` | Phiếu hỗ trợ, bản tin và tài liệu ở một nơi | Support tickets, notices and documents in one place |
| `web.login.hero.point2` | Căn hộ, cư dân và phương tiện của tòa nhà | The building's units, residents and vehicles |
| `web.login.hero.point3` | Đợt phí, công nợ và giao dịch online | Fee batches, debts and online payments |
| `web.login.field.email.label` | Email | Email |
| `web.login.field.email.placeholder` | ten@congty.vn | name@company.com |
| `web.login.field.password.label` | Mật khẩu | Password |
| `web.login.action.forgot` | Quên mật khẩu | Forgot password |
| `web.login.cta` | Đăng nhập | Sign in |
| `web.login.hint.apps` | Kỹ thuật và Bảo vệ đăng nhập trên App quản lý bằng cùng tài khoản. | Technicians and Guards sign in on the staff app with the same account. |
| `web.login.footer` | Tài khoản nhân viên do Admin tạo. Chưa có tài khoản thì liên hệ Admin. | Staff accounts are created by an Admin. If you have none, contact an Admin. |
| `web.login.banner.password_set` | Đã đặt mật khẩu mới. Đăng nhập để tiếp tục. | Your new password is saved. Sign in to continue. |
| `web.login.dialog.forgot.title` | Quên mật khẩu | Forgot password |
| `web.login.dialog.forgot.body` | Nhập email đăng nhập. Nếu email có tài khoản đang hoạt động, chúng tôi gửi link đặt mật khẩu mới. | Enter your sign-in email. If it belongs to an active account, we send a link to set a new password. |
| `web.login.dialog.forgot.confirm` | Gửi link | Send link |
| `error.invalid_credentials` (DOC-68) | Email hoặc mật khẩu chưa đúng. | The email or password is not correct. |
| `error.account_locked` (DOC-68) | Đăng nhập sai quá nhiều lần. Thử lại sau {minutes} phút. | Too many attempts. Try again in {minutes} minutes. |
| `auth.signed_out` (DOC-68) | Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại. | Your session has ended. Sign in again. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWO-01 | **G** an active Manager **W** signs in with the right credentials **T** the page lands on `/units`; `document.cookie` and web storage hold no refresh token, the access token is only in memory | web-e2e |
| UIWO-02 | **G** a known email with a wrong password, and an unknown email **W** each is submitted **T** both show exactly "Email hoặc mật khẩu chưa đúng." and no number of tries; the password field is empty and focused | web-e2e |
| UIWO-03 | **G** a building with lockout 5 / 15 **W** five wrong passwords, then the right one **T** the banner says "Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.", the submit button is disabled, and the right password is still refused until the lock ends (fake clock) | web-e2e |
| UIWO-04 | **G** a signed-out visitor on `/units?q=an` **W** redirected to `/login?redirect=…` and signing in **T** the page lands on `/units?q=an`; with `redirect=https://evil.example` or `//evil.example` the landing page opens instead | web-e2e |
| UIWO-05 | **G** an active Technician **W** signs in on the web **T** `/wrong-app` shows and no other route renders (typing `/units` returns to `/wrong-app`); "Đăng xuất" clears the cookie | web-e2e |
| UIWO-06 | **G** 31 attempts from one IP in 15 minutes **W** the 31st is sent **T** the banner shows the wait from `Retry-After` | api |
| UIWO-07 | **G** the forgot dialog **W** a known and an unknown email are submitted **T** both navigate to `/forgot/sent` | web-e2e |
| UIWO-08 | **G** a signed-out visitor with an English browser **W** the page opens, then VI is chosen **T** all strings change with no API call and the choice survives a reload | web-e2e |
| UIWO-09 | **G** E-03 answers 503 **W** the page opens **T** the form is usable and the hero shows no hotline | web-e2e |
| UIWO-10 | **G** the page **W** it is tabbed through and Enter is pressed in the password field **T** every control is reachable, focus is visible, the form submits, and axe finds no serious issue | web-e2e |

### 10. E2E cases

`apps/cms-web/e2e/auth-sign-in.spec.ts`: UIWO-01…05, 07…10. UIWO-06 is covered by the `AU-` rate test of E-05 and by a Playwright route mock for the banner.

### 11. Open questions

None.

## W-Forgot-Sent

> Status: Review · Prototype: designed · Phase: P1 · DOC-64

### 1. Persona, use cases, permissions

PS-1, PS-2 (and a Technician or Guard who asks from the web). UC-17 alternative flow B, FL-18; FR-13.3, FR-13.4. Public.

### 2. URL and search params

`/forgot/sent`, no params (DOC-53 §4). The email is passed in router state only, never in the URL. A visit without that state (a pasted link) goes to `/login?dialog=forgot`. *Revised 2026-10-25 (P1-16, DR-263):* a reload keeps the page, because the browser keeps `history.state`.

### 3. Prototype

Canvas artboard `W-Forgot-Sent` ("Chung: Quên mật khẩu, đã gửi link"), 1440 wide. Regions: top row (building name, "Web quản lý", language pill); a centered 520 px `Card`: round `teal-soft` icon (`check-circle`), `h1` "Kiểm tra email của bạn", a paragraph, a `fill` box with two rows (clock, phone), outline lg `Button` "Gửi lại link sau 00:45" (disabled), ghost lg `Button` "Quay lại đăng nhập" with `caret-left`, one footnote.

Do not copy:

- "Đã gửi link … tới trang.nguyen@mocmien.vn": E-06 answers the same `202 {}` for an unknown email, a locked or an invited account (FR-13.4), so the screen must not say a mail was sent. It says "Nếu {email} có tài khoản đang hoạt động, link đổi mật khẩu đã được gửi."
- "Link có hiệu lực 30 phút, tới 10:02, 09/10/2026": E-06 returns no expiry and an unknown email has no link. The row reads "Link có hiệu lực 30 phút" (DOC-26 §4.3).
- N8: the hard-coded building name; it comes from E-03.

### 4. Regions and components

`Card`, `Icon`, `Button` (outline, ghost), a list box on `fill`. The icon is decorative (`aria-hidden`); the `h1` receives focus on mount so a screen reader announces it.

### 5. Data

E-03 for the brand block (as `W-Login`). No other read.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Resend the link | E-06 `POST /auth/staff/password-reset {email}` | 202 → toast `web.forgot-sent.toast.resent`, the countdown restarts at 45 s | 429 `rate_limited` → the button stays disabled and shows the wait from `Retry-After`; 400 → back to `/login?dialog=forgot` |
| Back to sign-in | none | `/login` | |

The 45 s wait is a client constant (`RESET_RESEND_AFTER_SECONDS`, fixed in code, like the OTP wait of DOC-57), counted on the device's monotonic clock; the real limits are the server buckets, 3 per hour per email and 10 per hour per IP (E-06). The button label shows `mm:ss` while waiting.

### 7. States

Offline: the resend button is disabled with the reason. Loading, empty, stale and forbidden do not apply. A 429 on resend replaces the 45 s countdown by the longer wait.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.forgot-sent.title` | Kiểm tra email của bạn | Check your email |
| `web.forgot-sent.body` | Nếu {email} có tài khoản đang hoạt động, link đổi mật khẩu đã được gửi. Mở link trong email để đặt mật khẩu mới. | If {email} belongs to an active account, a link to change the password has been sent. Open it to set a new password. |
| `web.forgot-sent.info.validity` | Link có hiệu lực 30 phút | The link is valid for 30 minutes |
| `web.forgot-sent.info.device` | Mở được trên máy tính hoặc điện thoại | Opens on a computer or a phone |
| `web.forgot-sent.cta.resend` | Gửi lại link | Resend link |
| `web.forgot-sent.cta.resend_wait` | Gửi lại link sau {time} | Resend link in {time} |
| `web.forgot-sent.action.back` | Quay lại đăng nhập | Back to sign in |
| `web.forgot-sent.hint` | Không thấy email, bạn xem thư mục Spam hoặc liên hệ Admin. | If you do not see the email, check Spam or contact an Admin. |
| `web.forgot-sent.toast.resent` | Đã gửi lại link. | The link was sent again. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWO-11 | **G** a reset requested for a known and for an unknown email **W** `/forgot/sent` shows **T** the two pages are identical except for the typed address, and neither claims that a mail was sent | web-e2e |
| UIWO-12 | **G** the page just opened **W** the clock advances **T** the resend button reads "Gửi lại link sau 00:45", counts down, is disabled until 00:00 and then enabled | web-e2e |
| UIWO-13 | **G** three requests for one email in an hour **W** the fourth resend is clicked **T** the answer is 429 and the button shows the wait from `Retry-After` | web-e2e |
| UIWO-14 | **G** `/forgot/sent` opened by a pasted link, with no router state **T** the visitor lands on `/login?dialog=forgot`; a reload of the page that was reached from the dialog stays on it (the history state survives) | web-e2e |

### 10. E2E cases

`apps/cms-web/e2e/auth-reset.spec.ts`: UIWO-11…14, with UIWO-15…19 of `W-Reset`.

### 11. Open questions

None.

## W-Reset

> Status: Review · Prototype: designed · Phase: P1 · DOC-64

### 1. Persona, use cases, permissions

Any staff member holding a link: a new account from an invitation (24 hours) or an `active` one from a reset (30 minutes). UC-17 main flow step 3 and alternative flow B, FL-18.1…3; FR-13.3, FR-13.5, FR-13.6, FR-14.2. Public; the single-use token is the credential.

### 2. URL and search params

Two routes, one screen (DOC-53 §4, DOC-26 §4.3): `/reset?token=…` and `/invite?token=…`. The path decides the kind and the wording; the token is the only param and is required. A missing token shows the invalid-link state at once with no API call. The route sends `Referrer-Policy: no-referrer`, the token is never put in a log line or in a `POST /client-errors` report (DOC-55 §15), and E-07 is the only call that carries it.

### 3. Prototype

Canvas artboard `W-Reset` ("Chung: Đặt mật khẩu mới (trình duyệt)"), 1440 wide. Regions: top row (building name, "Tài khoản nhân viên", language pill); a centered 520 px `Card`: `h1` "Đặt mật khẩu mới", one line of validity, an account block (avatar, "Tài khoản", the email), two `TextField` (Mật khẩu mới, Nhập lại mật khẩu mới), a rule checklist of three rows (Ít nhất 8 ký tự / Có cả chữ và số / Hai lần nhập giống nhau; a filled `check-circle` in `success` when met), a primary lg block `Button` "Lưu mật khẩu mới" (disabled until all rules hold), one closing line.

Do not copy (DR-209):

- "Link còn hiệu lực tới 10:02, 09/10/2026." and the account block with the email. No endpoint reads a token without consuming it, and one would let anyone holding a link look up an account; E-07 is the only call. The line becomes a fixed validity ("Link có hiệu lực 30 phút." for `/reset`, "Lời mời có hiệu lực 24 giờ." for `/invite`), counted from when the mail was sent.
- The sample passwords in the two fields.

The invite variant uses the same layout with its own title and subtitle (below); it needs no new artboard.

### 4. Regions and components

`Card`, `TextField` (`type="password"`, `autocomplete="new-password"`), `Icon` (`check-circle`: weight `fill` when a rule holds, `regular` when not), `Button`, `Banner` for errors. Each rule row carries visually hidden text "đạt" / "chưa đạt" so colour and icon weight are not the only signal (UX-13).

### 5. Data

None to read. E-03 for the brand block.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Save the password | E-07 `POST /auth/staff/password {token, password}`; the client checks the rules first (8 to 128 characters, at least one letter and one digit, both fields equal) and sends the password untrimmed; the button is disabled while in flight | 204 → `/login?reason=password_set`. An invite has made the account `active`; a reset has cleared the lockout and revoked every session (FR-13.6), so this browser's old session, if any, ends at its next refresh | 400 `validation_failed` rule `password_weak` → inline under the first field (the link is not consumed, DOC-26 §4.3). 400 `token_invalid` → the invalid-link state below. 429 → banner with the wait. Network failure → banner "Chưa gửi được. Thử lại.", fields kept |
| Ask for a new link (invalid `/reset` state) | none; opens `/login?dialog=forgot` | | |
| Back to sign-in | none | `/login` | |

**Invalid-link state** (replaces the card; shown for `token_invalid`, a missing token, and a token that is unknown, expired or used, which E-07 cannot tell apart). `/reset`: title "Link không còn hiệu lực", body "Link đã hết hạn hoặc đã được dùng. Nếu bạn vừa đặt mật khẩu, hãy thử đăng nhập. Nếu chưa, yêu cầu một link mới.", primary `Button` "Yêu cầu link mới", ghost "Quay lại đăng nhập". `/invite`: the body says "Lời mời đã hết hạn hoặc đã được dùng. Nếu bạn vừa đặt mật khẩu, hãy thử đăng nhập. Nếu chưa, nhờ Admin hoặc Ban quản lý gửi lại lời mời." and has no "Yêu cầu link mới" button, because the resend is the Admin's or Manager's action (E-08) and an `invited` account cannot use the reset link (E-06). The sentence "Nếu bạn vừa đặt mật khẩu…" covers a lost answer after the token was consumed (UX-01).

### 7. States

Loading: none before the form. Offline: the save button is disabled with the reason. Stale, empty and forbidden do not apply. While a rule is unmet the save button stays disabled; Enter does nothing then.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.reset.title` | Đặt mật khẩu mới | Set a new password |
| `web.reset.title_invite` | Đặt mật khẩu cho tài khoản | Set your account password |
| `web.reset.subtitle` | Link có hiệu lực 30 phút. | The link is valid for 30 minutes. |
| `web.reset.subtitle_invite` | Lời mời có hiệu lực 24 giờ. Sau khi lưu, bạn dùng email và mật khẩu này để đăng nhập. | The invitation is valid for 24 hours. After saving, sign in with your email and this password. |
| `web.reset.field.password.label` | Mật khẩu mới | New password |
| `web.reset.field.confirm.label` | Nhập lại mật khẩu mới | Repeat the new password |
| `web.reset.rule.length` | Ít nhất 8 ký tự | At least 8 characters |
| `web.reset.rule.mix` | Có cả chữ và số | Letters and digits |
| `web.reset.rule.match` | Hai lần nhập giống nhau | Both entries match |
| `web.reset.rule.met` | đạt | met |
| `web.reset.rule.unmet` | chưa đạt | not met |
| `web.reset.cta` | Lưu mật khẩu mới | Save new password |
| `web.reset.hint` | Dùng mật khẩu mới để đăng nhập trên web hoặc App quản lý. | Use the new password to sign in on the web or the staff app. |
| `web.reset.banner.network` | Chưa gửi được. Thử lại. | Could not send. Try again. |
| `web.reset.invalid.title` | Link không còn hiệu lực | This link is no longer valid |
| `web.reset.invalid.body` | Link đã hết hạn hoặc đã được dùng. Nếu bạn vừa đặt mật khẩu, hãy thử đăng nhập. Nếu chưa, yêu cầu một link mới. | The link has expired or was already used. If you just set a password, try signing in. If not, ask for a new link. |
| `web.reset.invalid.body_invite` | Lời mời đã hết hạn hoặc đã được dùng. Nếu bạn vừa đặt mật khẩu, hãy thử đăng nhập. Nếu chưa, nhờ Admin hoặc Ban quản lý gửi lại lời mời. | The invitation has expired or was already used. If you just set a password, try signing in. If not, ask an Admin or the management office to send it again. |
| `web.reset.invalid.cta` | Yêu cầu link mới | Ask for a new link |
| `error.password_weak` (DOC-68) | Mật khẩu cần 8 ký tự trở lên, có cả chữ và số. | The password needs 8 or more characters, with letters and digits. |
| `error.token_invalid` (DOC-68) | Link không còn hiệu lực. Hãy yêu cầu link mới. | This link is no longer valid. Ask for a new one. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWO-15 | **G** a live reset link **W** "abc12345" matches in both fields **T** the three rules are met and the button is enabled; with "abcdefgh", "12345678", "abc1234" or two different entries the button stays disabled and the unmet rules read "chưa đạt" | web-e2e |
| UIWO-16 | **G** a live reset link **W** a valid password is saved **T** the page opens `/login` with the banner "Đã đặt mật khẩu mới. Đăng nhập để tiếp tục.", the old password is refused and the new one signs in; a locked-by-attempts account signs in at once | web-e2e |
| UIWO-17 | **G** a link already used, and a link 31 minutes old (fake clock) **W** each is opened and a password saved **T** the invalid-link state shows with "Yêu cầu link mới" | web-e2e |
| UIWO-18 | **G** an invitation link at 23 hours, and one at 25 hours **W** each is used **T** the first activates the account; the second shows the invite wording without "Yêu cầu link mới" and the account stays `invited` | web-e2e |
| UIWO-19 | **G** `/reset` with no token **W** it opens **T** the invalid-link state shows and no request is sent | web-e2e |

### 10. E2E cases

`apps/cms-web/e2e/auth-reset.spec.ts`: UIWO-15…19 (the email in the invite mail is read from Mailpit in the test environment).

### 11. Open questions

None.

## W-Profile

> Status: Review · Prototype: designed · Phase: P1 · DOC-64

### 1. Persona, use cases, permissions

PS-1 Admin and PS-2 Manager (a Technician or Guard edits the same fields in `S-Account`). UC-26 steps 1 to 4 and alternative flow 4a; FR-45.1, FR-13.3. Any signed-in Admin or Manager; each sees and changes only their own account.

### 2. URL and search params

`/profile`, no search params. DOC-53 §4 lists a `tab` param (`account`, `sessions`); the canvas is one page, so the param is dropped (DR-211, DOC-53 §4 owes the edit). It is reached from the user block of the shell, not from the sidebar.

### 3. Prototype

Canvas artboard `W-Profile` ("Chung: Hồ sơ cá nhân"), 1440 wide, inside the shell. Regions: page header (`h1` "Hồ sơ cá nhân", subtitle "Tên và ảnh hiển thị cho đồng nghiệp trên web và App quản lý", primary md `Button` "Lưu thay đổi"); left column: `Card` "Thông tin cá nhân" (large `Avatar`, name, "Ban quản lý, {building}", outline sm `Button` "Đổi ảnh" with `camera`; two fields Họ và tên and Email; the label "Vai trò" with an info `Tag` and a hint) and `Card` "Ngôn ngữ giao diện" (two-option `SegmentedControl` Tiếng Việt / English, one hint on formats); right column: `Card` "Mật khẩu" (hint and tonal sm `Button` "Gửi link đổi mật khẩu") and `Card` "Phiên đăng nhập gần nhất" (rows: round icon, where, time).

Do not copy:

- **N9.** The sessions card has no way to end a session. FR-45.1 gives every account the list and the revoke: each row except the current one gets "Đăng xuất phiên" (E-33).
- The sample row labels "Web quản lý, Chrome trên Windows" and "App quản lý, iPhone": E-32 returns `client` (`web` | `app`), `device` ("Chrome on macOS") and `current` (DR-225). The row shows `device` as the title and `client` chooses the icon: a window for `web`, a phone for `app`; the sample label "Web quản lý" / "App quản lý" is `web.profile.session.client.web|app`.
- The sample name "Nguyễn Thu Trang" and the role text: the role label comes from `role` of E-30 (`common.staff-role.*`).
- Additions the canvas does not draw: "Gỡ ảnh" (ghost sm, shown when an avatar exists; sends `avatarFileId: null`), the revoke dialog, and the hint under "Gửi link đổi mật khẩu" about other devices.

### 4. Regions and components

`Card` (titled), `Avatar` (lg), `TextField` (the email one `read-only` and `disabled`, helper text), `Tag` (tone `info`), `SegmentedControl`, `Button` (primary md, outline sm, tonal sm, ghost sm), `Dialog` (revoke), `Toast`, `Skeleton`.

### 5. Data

| Read | Endpoint | Rule |
| --- | --- | --- |
| The account | E-30 `GET /staff/me` | Already loaded by the shell; `ETag` → `If-Match` of E-31 |
| Sessions | E-32 `GET /staff/sessions` | At most 10 live rows, no pagination; refetch on window focus and after a revoke; `session.revoked` (E-75) invalidates it |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Change photo | file picker (`image/jpeg`, `image/png`, `image/webp`, at most 10 MB, DOC-37 §4) → E-36 `POST /staff/uploads {purpose: "avatar", mime, size}` with an `Idempotency-Key` → `PUT` to the returned URL with the returned headers → E-37 `POST /staff/uploads/{id}/verify` | The new photo previews locally; "Lưu thay đổi" becomes enabled; the file attaches only on save | 400 `file_type_not_allowed` / `file_too_large` → text under the button; 422 `file_not_verified` → "Không dùng được tệp này. Hãy chọn lại." (DOC-42); 413 `quota_exceeded`; 429 → toast with the wait |
| Save | E-31 `PATCH /staff/me {fullName?, avatarFileId?}` with `If-Match` and only the changed fields; disabled while nothing changed and while in flight | 200 → cache replaced by the answer, toast `web.profile.toast.saved`, the shell shows the new name and photo | 409 `version_conflict` → refetch E-30, keep the typed name, banner `error.version_conflict` (UX-02); 422 `file_not_verified` → the pending photo is dropped; 400 `validation_failed` → under "Họ và tên" (1 to 120 characters after trimming) |
| Remove photo | none until save | The avatar shows initials; save sends `avatarFileId: null` | |
| Change language | E-31 `PATCH /staff/me {language}` with `If-Match`, at once (not with "Lưu thay đổi", DR-211); the same call as the top-bar switch | The catalog switches, toast `web.profile.toast.language` | The control returns to its old value; 409 as above |
| Usage switch (DR-279) | None: a switch with `common.usage.title` and the hint `common.usage.hint` (DOC-68 §4.6), on by default, kept in `localStorage` (DOC-104 §5.4); like the language it applies at once, not with "Lưu thay đổi". Tracked controls on this page: `W-Profile.language`, `W-Profile.reset_link` (DOC-104 §4.2) | The switch shows the new state | |
| Send the reset link | E-06 `POST /auth/staff/password-reset {email}` with the email of E-30 | 202 → toast `web.profile.toast.reset_sent`; the button is disabled for 45 s | 429 → toast with the wait (3 per hour per email) |
| End another session | dialog `web.profile.dialog.revoke.*` (names the consequence, UX-14) → E-33 `DELETE /staff/sessions/{id}` | 204 → the row disappears, toast | 404 → refetch E-32 (already gone) |
| Leave with unsaved changes | the router blocker opens a dialog | "Ở lại" / "Bỏ thay đổi" | |

Signing out is the shell's (E-12). Ending the current session from this list is not offered. The reset link sent from here, once used, revokes every session of the account including this one (DOC-26 §4.3), which the hint says.

### 7. States

Loading: skeleton cards (150 ms rule, UX-10). Error on E-30: the page error state with "Mã tham chiếu: {requestId}" and a retry. Error on E-32: that card shows a retry and the rest works. Stale: after a failed refetch the session list keeps the old rows with a banner. Offline: every write is disabled with the reason; data stays visible read-only. Forbidden and empty do not apply.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `web.profile.title` | Hồ sơ cá nhân | My profile |
| `web.profile.subtitle` | Tên và ảnh hiển thị cho đồng nghiệp trên web và App quản lý | Your name and photo as colleagues see them on the web and the staff app |
| `web.profile.cta` | Lưu thay đổi | Save changes |
| `web.profile.card.info.title` | Thông tin cá nhân | Personal details |
| `web.profile.action.photo` | Đổi ảnh | Change photo |
| `web.profile.action.photo_remove` | Gỡ ảnh | Remove photo |
| `web.profile.field.name.label` | Họ và tên | Full name |
| `web.profile.field.email.label` | Email | Email |
| `web.profile.field.email.hint` | Email đăng nhập do Admin cấp | Your sign-in email is set by an Admin |
| `web.profile.field.role.label` | Vai trò | Role |
| `web.profile.field.role.hint` | Vai trò do Admin gán, quyền định sẵn theo role | Your role is set by an Admin and fixes your permissions |
| `web.profile.card.language.title` | Ngôn ngữ giao diện | Interface language |
| `web.profile.card.language.hint` | Ngày, số và tiền hiển thị theo ngôn ngữ đã chọn, ví dụ 09/10/2026 và 2.488.000 đ khi dùng Tiếng Việt. | Dates, numbers and amounts follow the chosen language, for example Oct 9, 2026 and ₫2,488,000 in English. |
| `web.profile.card.password.title` | Mật khẩu | Password |
| `web.profile.card.password.body` | Đổi mật khẩu bằng link gửi qua email. Link có hiệu lực 30 phút. | Change your password with a link sent by email. The link is valid for 30 minutes. |
| `web.profile.card.password.warning` | Sau khi đặt mật khẩu mới, mọi thiết bị đang đăng nhập sẽ phải đăng nhập lại. | After you set a new password, every signed-in device must sign in again. |
| `web.profile.card.password.cta` | Gửi link đổi mật khẩu | Send password link |
| `web.profile.card.sessions.title` | Phiên đăng nhập gần nhất | Recent sessions |
| `web.profile.session.current` | phiên hiện tại | this session |
| `web.profile.session.client.web` | Web quản lý | Web CMS |
| `web.profile.session.client.app` | App quản lý | Staff app |
| `web.profile.session.cta` | Đăng xuất phiên | End session |
| `web.profile.dialog.revoke.title` | Đăng xuất phiên này? | End this session? |
| `web.profile.dialog.revoke.body` | Thiết bị đó sẽ phải đăng nhập lại. | That device will have to sign in again. |
| `web.profile.dialog.revoke.confirm` | Đăng xuất phiên | End session |
| `web.profile.dialog.unsaved.title` | Bạn chưa lưu thay đổi | You have unsaved changes |
| `web.profile.dialog.unsaved.confirm` | Bỏ thay đổi | Discard changes |
| `web.profile.toast.saved` | Đã lưu thay đổi. | Changes saved. |
| `web.profile.toast.language` | Đã đổi ngôn ngữ. | Language changed. |
| `web.profile.toast.reset_sent` | Đã gửi link tới {email}. | Link sent to {email}. |
| `common.staff-role.admin` / `.manager` / `.technician` / `.guard` (DOC-68) | Admin / Ban quản lý / Kỹ thuật / Bảo vệ | Admin / Management office / Technician / Guard |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIWO-20 | **G** a Manager on `/profile` **W** the name is changed and saved **T** one E-31 call with `If-Match` and only `fullName` is sent, and the user block shows the new name | web-e2e |
| UIWO-21 | **G** the same account open in two tabs **W** tab A saves, then tab B saves **T** tab B shows the fresh name and the message from `version_conflict`, its typed name is kept and nothing was replayed | web-e2e |
| UIWO-22 | **G** a PNG of 200 KB **W** "Đổi ảnh" is used and the page saved **T** the call order is E-36, `PUT`, E-37, E-31 with `avatarFileId`, and the user block shows the photo; a 12 MB file is refused under the button before any `PUT` | web-e2e |
| UIWO-23 | **G** the language is Tiếng Việt **W** English is chosen **T** all strings switch at once and `language: "en"` is stored; after a reload the page is English | web-e2e |
| UIWO-24 | **G** "Gửi link đổi mật khẩu" **W** it is pressed **T** a mail arrives (Mailpit), the toast names the email, the button is disabled for 45 s; a fourth press within the hour shows the wait | web-e2e |
| UIWO-25 | **G** a second live session **W** it is ended from the list **T** its row disappears, and that session's next refresh returns 401 | web-e2e |
| UIWO-26 | **G** the email field **W** it is inspected **T** it is read-only and E-31 never sends `email` | web-e2e |

### 10. E2E cases

`apps/cms-web/e2e/profile.spec.ts`: UIWO-20…26. The P1-16 Playwright flows "sign in, create staff, import units" use UIWO-01 and the shell of this document.

### 11. Open questions

None.

## Specified before P4 / P5 / P6

These ten screens have no section yet. Each gets one before its phase starts (master plan §0.1); until then the row is the contract. Endpoints are those of DOC-51 §2.2; the notes are those of DOC-56 §5. Strings stay in Vietnamese as drawn until the section is written.

| Artboard | Phase | Role | Endpoints known | Notes and deviations |
| --- | --- | --- | --- | --- |
| `W-Tickets` | P4 | Admin, Manager | E-125 list, E-131 types (filter), E-39 (assignee filter), SSE `ticket.created`, `ticket.changed` | N7 (word "Phiếu hỗ trợ" for staff, decided DR-197); code format `YC-YYMMDD-NNN`, not `YC-1009-010` (N4); the button "Xuất Excel" waits for E-167 (P6) |
| `W-Ticket-Detail` | P4 | Admin, Manager | E-126 detail, E-129 messages (resident comment vs internal note), E-128 transition, E-127 assign, E-130 cancel | N7; conflict rule UX-02 on assign and transition |
| `W-Ticket-Assign` | P4 | Admin, Manager | E-127 | **Endpoint gap:** the dialog lists staff with "open-ticket count"; E-39 returns no count. DOC-28 decides a workload field or a filter on E-125 |
| `W-Ticket-Types` | P4 | Admin, Manager | E-131, E-132 | The "SLA marked phase 2" column of the canvas is not a feature: leave it out (original SDD, DR-47 optional deadlines) |
| `W-Ticket-Cancel` | P4 | Admin, Manager | E-130 (reason) | **To design** (DR-44, DR-72); ASCII wireframe in its section |
| `W-Notices` | P4 | Admin, Manager | E-145, SSE none | Read percentage per row comes from E-149 totals; scheduled and draft tabs |
| `W-Notice-Edit` | P4 | Admin, Manager | E-146 create, E-147 update, E-148 send, E-36 / E-37 (`notice_attachment`, `notice_image`) | At most 5 attachments; audience includes staff roles with a recipient count |
| `W-Notice-Stats` | P4 | Admin, Manager | E-149 | Read rate per member type, unread list, push failures |
| `W-Docs` | P5 | Admin, Manager | E-153…E-164 (tree, search, folders, pages, versions, restore, order), E-36 / E-37 (`wiki_attachment`, `wiki_image`) | Library content is hidden, never deleted (DR-115); storage used from E-55 (Admin) |
| `W-Dashboard` | P6 | Admin, Manager | E-165 | Collection rate counts whole charges only (DR-84); every figure carries its computation time (UX-16); until P6 the landing page is `/units` |

## Decisions made while writing

Delegated by the Owner (design details). Recorded in the register as DR-209…211.

| Id | Decision |
| --- | --- |
| DR-209 | `W-Forgot-Sent` and `W-Reset` do not echo an account email or an absolute expiry: E-06 answers the same for every input and no endpoint peeks at a token. Copy is conditional ("Nếu {email} có tài khoản…") and states a fixed validity. The reset and invite routes keep the token in the URL with `Referrer-Policy: no-referrer` |
| DR-210 | The request form for a reset link is a dialog on `W-Login` (`/login?dialog=forgot`), not a new artboard; its success goes to `/forgot/sent`. `W-Login` accepts `reason=password_set`. DOC-53 §4 owes both additions to the `W-Login` row |
| DR-211 | `W-Profile` is one page without tabs (the `tab` param of DOC-53 §4 is dropped). Language saves at once through E-31, name and photo save with "Lưu thay đổi". Every session except the current one can be ended (N9, FR-45.1). "Gỡ ảnh" is added |

## Open questions

None.
