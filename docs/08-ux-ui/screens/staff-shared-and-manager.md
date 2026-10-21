# Staff app: shared and Manager

> Status: **Approved** (Owner, 2026-10-21, for §1 (gate P1); the B-screens are owed) (§1, the P1 sections: sign-in and account) · Updated: 2026-10-20 · DOC-61
> Depends on: original SDD §18, [DR](../../00-decision-register.md) (DR-38, 39, 41…47, 52, 69, 70, 71, 72, 73, 74, 128, 147), [DOC-02](../../01-product/personas-and-journeys.md), [DOC-03](../../01-product/requirements.md) (FR-13, FR-14, FR-45), [DOC-04](../../01-product/use-cases.md) (UC-17, UC-26), [DOC-26](../../06-design/identity-and-sessions.md) §4, [DOC-42](../../06-design/error-handling.md), [DOC-51](../../07-api/api-endpoints.md) (E-03, E-05, E-06, E-12, E-30…E-37), [DOC-53](../ux-principles-and-ia.md), [DOC-55](../client-architecture.md), [DOC-56](README.md)
> Main readers: P1-17 (staff app shell), P1-09 (i18n catalog), P1-00 (doc gate), the writers of DOC-62, DOC-63 and DOC-68, P4-00 and P5-00 for the later screens

This document specifies the screens that every staff role shares in the staff app and, later, the Manager's screens. **§1 (P1, `Review`)** is the sign-in and account group: `S-Login`, `S-Login-Error`, `S-Forgot`, `S-Forgot-Sent`, `S-Account` with its sessions view. The rest (`S-Inbox`, `S-Docs`, `S-Doc-Page`, `B-*`) is only listed in the last section with phase and endpoints and is specified in full before P4 and P5. The convention is DOC-56 §6: the Owner's prototype (design system "Hiên") is the visual source of truth and is not redrawn. Tokens and components are DOC-54, navigation DOC-53, client rules DOC-55, error and status copy DOC-68. The staff app serves the Manager, Technician and Guard; the Admin works on the web (DR-174).

Test prefix: `UISM-` (DOC-56 §6.3). Copy keys: `staff.<screen>.<element>`, the screen name without `S-` (DOC-56 §6.4). Maestro flows live in `apps/staff-app/.maestro/` (DOC-88).

Until a role's first screen ships (P4 for the Manager and the Technician, P5 for the Guard), the signed-in staff app has the single tab "Tài khoản" and lands on `S-Account`: a nav entry exists only when its phase has shipped (DR-174).

## Screens in this file

| Section | Screen | Role | Phase | Prototype |
| --- | --- | --- | --- | --- |
| `S-Login` | Sign-in by email and password | Any staff (signed out) | P1 | designed |
| `S-Login-Error` | Wrong password and lock: states of `S-Login` | Any staff (signed out) | P1 | designed |
| `S-Forgot` | Ask for a reset link | Any staff (signed out) | P1 | designed |
| `S-Forgot-Sent` | Reset link requested | Any staff (signed out) | P1 | designed |
| `S-Account` | Profile, language, push, sessions, sign out | Manager, Technician, Guard | P1 | designed |
| (fifteen more) | Inbox, library, Manager screens | | P4, P5 | see the last section |

## S-Login

> Status: Review · Prototype: designed · Phase: P1 · DOC-61

### 1. Persona, use cases, permissions

PS-2 Manager, PS-3 Technician, PS-4 Guard. UC-17 A (sign-in), FR-13. Public screen. An Admin can sign in (the API allows any staff role on any client) and then meets the wrong-client page (§7).

### 2. URL and search params

Route `/login` (group `(auth)`); no params. The language switch is local until sign-in (DOC-55 §11).

### 3. Prototype

Artboard `S-Login` ("Nhân viên: Đăng nhập", 390 × 844). Regions: `Glow` · header (brand "Hiên", ghost `Button` "English") · context line ("Mộc Miên Residence · Ứng dụng nhân viên"), H1 "Đăng nhập", intro sentence · `TextField` Email, `TextField` Mật khẩu with suffix "Hiện" · footer: primary `Button` "Đăng nhập", ghost `Button` "Quên mật khẩu", note about who creates accounts.

Do not copy:
- The brand "Hiên", the building name and the sample email are hard-drawn (N8). The display name of the app is an Owner input (DR-69, P0-03); the building name comes from E-03 `contact.name`; no field is pre-filled.
- The footer note says accounts are created by "Admin hoặc Ban quản lý": keep it, it matches DR-147 (the Manager creates Technician and Guard).
- The "English" button names the language it switches **to** ("Tiếng Việt" when the UI is English).

### 4. Regions and components

`TextField` (email: `input-mode` email, no autocapitalize; password: secure entry with the suffix toggle "Hiện" / "Ẩn"), `Button` primary lg and ghost lg, `Banner` for the lock and policy messages.

### 5. Data

| Read | Endpoint | Query key | Refetch |
| --- | --- | --- | --- |
| Minimum version, languages, building name | E-03 | `['config']` | At start and on focus (persisted, DOC-55 §9.2) |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Đăng nhập" | E-05 `POST /auth/staff/login {email, password, client: "app"}` with `X-App-Id: staff`, `X-App-Version` | Tokens kept (refresh token in secure store, DOC-55 §5.1); E-30 read into `['staff', 'me']`; first time: the push explanation, then E-34; route by role (§7) | 401 `invalid_credentials`: field error under the password, same text for a wrong password, an unknown email and an account that is `invited`, `locked` or `disabled`; 423 `account_locked`: lock banner with a countdown from `details.retryAfter`; 429 `rate_limited`: countdown from `Retry-After`; 426 `upgrade_required`: blocking update screen with `details.storeUrl`; 400 `validation_failed`: field errors, no call for an empty field |
| "Quên mật khẩu" | Navigation | `S-Forgot`, keeping the typed email | |
| "Hiện" / "Ẩn" | none | Shows or hides the password | |
| Language button | none (local) | Catalog switches; remembered as `rms.lang` | |

### 7. States

- **Wrong password (`S-Login-Error`).** The artboard is this state: the policy `Banner` (warning) above the form and the error under the password. The screen never shows a count of tries left (DR-128, N2): the banner text carries no number (DR-206) and the error is `error.invalid_credentials`.
- **Locked (423).** A danger `Banner` "Đăng nhập sai quá nhiều lần. Thử lại sau {minutes} phút." with `minutes = ceil(retryAfter / 60)`. The sign-in button is disabled until the countdown reaches zero; "Quên mật khẩu" stays enabled because a completed reset clears a temporary lock (FR-13.6). The correct password is also refused during the lock; the screen does not say whether the password was right.
- **Admin signed in (wrong client).** E-05 succeeded and E-30 returns `role: "admin"`: the app registers no device, shows the page `/wrong-app` with "Tài khoản Admin dùng Web quản lý" and "Đăng xuất", and renders no other route (DOC-53 §3.4). Sign-out calls E-12.
- **Version too old (426).** Blocking screen with the store link; no form.
- **Maintenance (503).** Banner and a 30 s poll of E-03 (DOC-55 §6). **Offline:** "Không có kết nối" banner; the button is disabled.
- **Landing.** In P1 a Manager, Technician or Guard lands on `S-Account`; from P4 and P5 on, on the role's first tab (DOC-53 §3.4).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `staff.login.context` | {buildingName} · Ứng dụng nhân viên | {buildingName} · Staff app |
| `staff.login.title` | Đăng nhập | Sign in |
| `staff.login.subtitle` | Dùng email công việc và mật khẩu được cấp khi tạo tài khoản. | Use the work email and the password you were given when your account was created. |
| `staff.login.field.email.label` | Email | Email |
| `staff.login.field.email.placeholder` | ten@mocmien.vn | name@company.vn |
| `staff.login.field.password.label` | Mật khẩu | Password |
| `staff.login.field.password.show` | Hiện | Show |
| `staff.login.field.password.hide` | Ẩn | Hide |
| `staff.login.cta` | Đăng nhập | Sign in |
| `staff.login.cta.forgot` | Quên mật khẩu | Forgot password |
| `staff.login.language` | English | Tiếng Việt |
| `staff.login.note` | Tài khoản nhân viên do Admin hoặc Ban quản lý tạo. Bạn chưa có tài khoản thì liên hệ BQL. | Staff accounts are created by the Admin or the management office. If you have none, contact them. |
| `staff.login.banner.policy.title` | Nhập sai nhiều lần sẽ tạm khóa đăng nhập | Too many wrong passwords lock sign-in for a while |
| `staff.login.banner.policy.body` | Nếu quên mật khẩu, bạn đặt lại qua email. | If you forgot your password, reset it by email. |
| `staff.login.banner.locked` | Đăng nhập sai quá nhiều lần. Thử lại sau {minutes} phút. | Too many attempts. Try again in {minutes} minutes. |
| `staff.login.wrong-app.title` | Tài khoản Admin dùng Web quản lý | Admin accounts use the web CMS |
| `staff.login.wrong-app.body` | Ứng dụng này dành cho Ban quản lý, Kỹ thuật và Bảo vệ. Hãy đăng nhập Web quản lý trên máy tính. | This app is for the management office, technicians and guards. Sign in to the web CMS on a computer. |
| `staff.login.wrong-app.cta` | Đăng xuất | Sign out |

`error.invalid_credentials`, `error.rate_limited`, `error.upgrade_required` and `error.maintenance` are DOC-68's.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UISM-01 | **G** an active Technician **W** the correct email and password are sent **T** E-05 is called with `client: "app"`, the refresh token is in secure store, E-30 is read, and the app lands on `S-Account` (P1) | maestro |
| UISM-02 | **G** a wrong password and, separately, an unknown email **W** each is submitted **T** both show the same text under the password and no number of tries anywhere on the screen | api, maestro |
| UISM-03 | **G** E-05 answers 423 with `retryAfter: 900` **W** the screen renders **T** the banner says "…sau 15 phút", the sign-in button is disabled, "Quên mật khẩu" is enabled, and the button enables when the countdown ends (fake clock) | unit, maestro |
| UISM-04 | **G** an Admin **W** signs in on the staff app **T** `/wrong-app` shows, no device is registered, no other route renders, and "Đăng xuất" calls E-12 | maestro |
| UISM-05 | **G** E-05 answers 426 **W** the screen renders **T** the update screen shows with the store link of the platform and no form | maestro |
| UISM-06 | **G** the password field **W** "Hiện" is tapped **T** the characters show and the control reads "Ẩn" to a screen reader | maestro |

### 10. E2E cases

Maestro: `staff-login.yaml` (UISM-01, 02, 06), `staff-login-locked.yaml` (UISM-03, uses a seeded locked account), `staff-login-admin.yaml` (UISM-04). UISM-05 runs against the stubbed 426.

### 11. Open questions

None.

## S-Login-Error

> Status: Review · Prototype: designed · Phase: P1 · DOC-61

A state of `S-Login`, not a route: it is specified in §7 of `S-Login`. This section lists what the artboard `S-Login-Error` ("Nhân viên: Đăng nhập sai mật khẩu") shows and how it is built.

### 1. Persona, use cases, permissions

As `S-Login`.

### 2. URL and search params

None (same route `/login`).

### 3. Prototype

Artboard `S-Login-Error` (390 × 844): the same screen with a warning `Banner` titled "Nhập sai 5 lần sẽ tạm khóa đăng nhập" above the form and the password field in error with "Email hoặc mật khẩu chưa đúng. Bạn còn 2 lần thử."

Do not copy (N2, DR-128): the counter "Bạn còn 2 lần thử" (the API gives no remaining count and the client keeps none); the numbers 5 and 15 in the banner, which are building settings (`lockout.maxAttempts`, `lockout.minutes`, DOC-36) and would be wrong after an Admin changes them (DR-206). The banner shows after a failed attempt, not before.

### 4. Regions and components

`Banner` tone warning with title and body, `TextField` in the `error` state.

### 5. Data

None beyond `S-Login`.

### 6. Interactions

As `S-Login` (E-05 failure rows).

### 7. States

This is the 401 state. The 423 state is the danger banner of `S-Login`.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `staff.login.field.password.error` | Email hoặc mật khẩu chưa đúng. | The email or password is not correct. |
| `staff.login.banner.policy.title` | Nhập sai nhiều lần sẽ tạm khóa đăng nhập | Too many wrong passwords lock sign-in for a while |

The banner keys are defined in `S-Login` §8; the field error is also `error.invalid_credentials` in DOC-68 and this key is its screen alias.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UISM-07 | **G** the screen in the 401 state **W** the text is checked **T** it contains no digit that reports tries left, and the banner contains no number | unit, maestro |

### 10. E2E cases

Covered by `staff-login.yaml`.

### 11. Open questions

None.

## S-Forgot

> Status: Review · Prototype: designed · Phase: P1 · DOC-61

### 1. Persona, use cases, permissions

PS-2…PS-4. UC-17 B, FR-13.3, FR-13.4. Public. The password is **not** changed inside the app: the link opens in the browser (`W-Reset`, DOC-64).

### 2. URL and search params

Route `/forgot`; no params (the typed email is passed in memory).

### 3. Prototype

Artboard `S-Forgot` ("Nhân viên: Quên mật khẩu", 390 × 844): `TopBar` with back · H1 "Quên mật khẩu" and a sentence · `TextField` Email with helper · neutral `Banner` "Đổi mật khẩu trên trình duyệt" · primary `Button` "Gửi link đổi mật khẩu".

Do not copy: the pre-filled sample email; the helper "Email bạn dùng để đăng nhập ứng dụng nhân viên" (keep, it is accurate).

### 4. Regions and components

`TopBar`, `TextField`, `Banner` tone neutral, `Button` primary lg (disabled with a countdown after a 429).

### 5. Data

None to read.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gửi link đổi mật khẩu" | E-06 `POST /auth/staff/password-reset {email}` | 202 `{}` for every email (known, unknown, locked, disabled, invited): `S-Forgot-Sent` with the typed email | 400 `validation_failed`: field error, no navigation; 429 `rate_limited` (3 per hour per email, 10 per hour per IP): countdown from `Retry-After` on the button; 426: update screen |

### 7. States

Offline: the button is disabled with the offline banner. The screen never says whether the account exists (FR-13.4).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `staff.forgot.title` | Quên mật khẩu | Forgot password |
| `staff.forgot.subtitle` | Nhập email công việc của bạn. Hệ thống gửi link đổi mật khẩu tới email này. | Enter your work email. We send a password-reset link to it. |
| `staff.forgot.field.email.label` | Email | Email |
| `staff.forgot.field.email.hint` | Email bạn dùng để đăng nhập ứng dụng nhân viên. | The email you use to sign in to the staff app. |
| `staff.forgot.banner.title` | Đổi mật khẩu trên trình duyệt | Change your password in a browser |
| `staff.forgot.banner.body` | Bạn mở link trong email bằng trình duyệt để đặt mật khẩu mới. Ứng dụng không có chức năng đổi mật khẩu. Đổi xong, bạn quay lại ứng dụng và đăng nhập bằng mật khẩu mới. | Open the link in your email with a browser to set a new password. The app cannot change passwords. Then come back and sign in with the new one. |
| `staff.forgot.cta` | Gửi link đổi mật khẩu | Send reset link |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UISM-08 | **G** a known and an unknown email **W** each is submitted **T** both navigate to `S-Forgot-Sent` with the same copy (FR-13.4) | api, maestro |
| UISM-09 | **G** "abc" in the email field **W** the button is tapped **T** a field error shows and E-06 is not called | unit |
| UISM-10 | **G** E-06 answers 429 with `Retry-After: 1200` **W** the screen renders **T** the button is disabled with a countdown and re-enables at zero | unit |

### 10. E2E cases

Maestro `staff-forgot.yaml` (UISM-08).

### 11. Open questions

None.

## S-Forgot-Sent

> Status: Review · Prototype: designed · Phase: P1 · DOC-61

### 1. Persona, use cases, permissions

As `S-Forgot`.

### 2. URL and search params

Route `/forgot/sent`; the email is passed in memory, not in the URL.

### 3. Prototype

Artboard `S-Forgot-Sent` ("Nhân viên: Đã gửi link đổi mật khẩu", 390 × 844): a close `IconButton` · `EmptyState` (icon check-circle, title, description with the masked email) · footer: primary "Mở ứng dụng email", ghost "Quay lại đăng nhập", a line about resending after 60 seconds.

Do not copy:
- The title "Đã gửi link tới email của bạn" asserts delivery, which is false for an unknown email; the text is neutral (DR-206).
- The button "Mở ứng dụng email" is cut in phase 1: no single API opens the inbox on both platforms without an extra native dependency (DR-207).
- "Gửi lại sau 60 giây" becomes 45 seconds, as every other resend in the product (DR-208).

### 4. Regions and components

`EmptyState`, `Button` primary (resend) and ghost (back), a text line with the countdown.

### 5. Data

None. The masked email (`tr***@mocmien.vn`) is computed on the client from what was typed; it reveals nothing about the account.

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gửi lại link" (enabled 45 s after the screen opened, re-armed after each send) | E-06 | The countdown restarts | 429: countdown from `Retry-After` (the bucket allows 3 per hour per email) |
| "Quay lại đăng nhập", close | Navigation | `Login` with the email kept | |

### 7. States

Offline: the resend is disabled. Link lifetime (30 minutes, `RESET_TTL_MINUTES`) is part of the catalog text; changing the setting means changing the text in the same pull request.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `staff.forgot-sent.title` | Kiểm tra email của bạn | Check your email |
| `staff.forgot-sent.body` | Nếu {maskedEmail} có tài khoản đang hoạt động, bạn sẽ nhận email có link đặt mật khẩu mới. Mở link bằng trình duyệt trong vòng 30 phút. | If {maskedEmail} has an active account, you will get an email with a link to set a new password. Open it in a browser within 30 minutes. |
| `staff.forgot-sent.cta.resend` | Gửi lại link | Send the link again |
| `staff.forgot-sent.resend-in` | Gửi lại sau {seconds} giây. Bạn nhớ xem cả thư mục Spam. | You can resend in {seconds} seconds. Check your spam folder too. |
| `staff.forgot-sent.cta.back` | Quay lại đăng nhập | Back to sign in |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UISM-11 | **G** the screen just opened **W** 44 s then 45 s pass (fake clock) **T** the resend is disabled, then enabled, and a tap calls E-06 once | unit |
| UISM-12 | **G** "tran.minh@mocmien.vn" was typed **W** the screen renders **T** the body shows a masked form (`tr***@mocmien.vn`), never the full address | unit |

### 10. E2E cases

Covered by `staff-forgot.yaml`.

### 11. Open questions

None.

## S-Account

> Status: Review · Prototype: designed · Phase: P1 · DOC-61

### 1. Persona, use cases, permissions

PS-2 Manager, PS-3 Technician, PS-4 Guard. UC-26, FR-45. Any staff role with a session (`staff(...)` guard, E-30…E-35). The Admin never sees it (wrong-client page). The tab bar around it depends on the role (DOC-53 §3.4); the screen is the same.

### 2. URL and search params

Route `/account`, and the sub-view `/account/sessions` (DOC-53 §5.2); no params. Deep link `rms-staff://account`.

### 3. Prototype

Artboard `S-Account` ("Kỹ thuật: Tài khoản", 390 × 1100, drawn for the Technician). Regions: large `TopBar` "Tài khoản" · profile row (`Avatar` lg, name, email, role `Tag`, pencil `IconButton`) · building row · section "Cài đặt" (Ngôn ngữ, Thông báo đẩy `Switch`) · section "Mật khẩu" (note card) · outline "Đăng xuất" · `TabBar`.

Do not copy:
- The second line of the building row ("Công ty Quản lý Mộc Miên") has no source; the row shows the building name from E-03 (DR-203 applies to staff too).
- The artboard has no sessions row (N9): add a list row "Thiết bị đăng nhập" (§6).
- The pencil label "Sửa tên và ảnh đại diện" stays: for staff the name **is** editable (E-31 `fullName`).
- The tab bar is the Technician's; the Manager's and the Guard's come from DOC-53.
- The password note says the system sends the link to the user's own address; the address in the text is the one from E-30.

### 4. Regions and components

`Avatar`, `Tag` (tone info, icon by role), `List`/`ListItem`, `Switch`, `BottomSheet` (language; edit profile), `Card` tone fill (password note), `Button` outline lg, `Dialog` (sign out).

### 5. Data

| Read | Endpoint | Query key | Refetch |
| --- | --- | --- | --- |
| Own account (name, email, role, language, `pushEnabled`, `avatarUrl`, `version`) with `ETag` | E-30 | `['staff', 'me']` | On mount, on focus, after each write |
| Building name | E-03 `contact.name` | `['config']` | |
| Live sessions (sub-view) | E-32 | `['staff', 'sessions']` (never persisted) | On mount and after a revoke |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Edit name (pencil, sheet "Sửa hồ sơ") | E-31 `PATCH /staff/me {fullName}` with `If-Match: "<version>"` | Name updated; `['staff', 'me']` replaced by the answer | 409 `version_conflict`: the sheet closes and shows the fresh object with a toast (DOC-55 §8.4); 428: a client bug, reported once; 400: field error (1…120 characters) |
| Change the avatar | Picker, resize, E-36 `POST /staff/uploads {purpose: "avatar"}` (`Idempotency-Key`), `PUT`, E-37 verify, E-31 `{avatarFileId}` | New avatar | `file_type_not_allowed`, `file_too_large`, `quota_exceeded`, `file_not_verified` (422): toast |
| Pick a language | E-31 `{language}` | The catalog switches; mail and push follow (FR-29) | revert and toast |
| Switch push on | OS prompt, E-34 `POST /staff/devices`, E-31 `{pushEnabled: true}` | On | OS denied: stays off, sheet "Mở Cài đặt" |
| Switch push off | E-31 `{pushEnabled: false}` | Off (token stays) | revert |
| Open "Thiết bị đăng nhập" | Navigation to `/account/sessions` | | |
| Revoke another session | E-33 `DELETE /staff/sessions/{id}` | 204; the row goes; its push stops | 404: list refetches |
| Revoke the current session | E-33 | A sign-out (below) | |
| Sign out (confirm) | Best effort E-35, then E-12 `POST /auth/logout`, then the local steps of DOC-55 §5.4 | `S-Login` | The local steps run even if the calls fail |

The password has no control: the note explains the way out (sign out, "Quên mật khẩu"), as UC-26 4a states for the apps. A staff session list row is built like the resident `Sessions` (DOC-60): an icon by `client` (`web` a window, `app` a phone, DR-225), `device`, "Thiết bị này", last use, a revoke button on the other rows.

### 7. States

Loading: skeleton, then the persisted `['staff', 'me']` shows first. Offline: writes disabled with the offline banner, sign out still works. Sessions: the list is not persisted. A role changed or an account locked since sign-in surfaces as a 401 on the next call and the app returns to `S-Login` with `auth.signed_out`.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `staff.account.title` | Tài khoản | Account |
| `staff.account.action.edit` | Sửa tên và ảnh đại diện | Edit name and photo |
| `staff.account.edit.title` | Sửa hồ sơ | Edit profile |
| `staff.account.field.name.label` | Họ và tên | Full name |
| `staff.account.settings.title` | Cài đặt | Settings |
| `staff.account.language.label` | Ngôn ngữ | Language |
| `staff.account.push.label` | Thông báo đẩy | Push notifications |
| `staff.account.push.hint` | Phiếu được giao, bình luận, bản tin nội bộ | Assigned tickets, comments, internal notices |
| `staff.account.sessions.label` | Thiết bị đăng nhập | Signed-in devices |
| `staff.account.password.title` | Mật khẩu | Password |
| `staff.account.password.note` | Ứng dụng không có chức năng đổi mật khẩu. Muốn đổi, bạn đăng xuất rồi chọn "Quên mật khẩu" ở màn đăng nhập. Hệ thống gửi link đặt mật khẩu mới tới {email}, bạn mở link trên trình duyệt. | The app cannot change passwords. To change it, sign out and choose "Forgot password" on the sign-in screen. We send a link to {email}; open it in a browser. |
| `staff.account.signout.cta` | Đăng xuất | Sign out |
| `staff.account.signout.dialog.title` | Đăng xuất khỏi ứng dụng? | Sign out of the app? |
| `staff.account.sessions.title` | Thiết bị đăng nhập | Signed-in devices |
| `staff.account.sessions.current` | Thiết bị này | This device |
| `staff.account.sessions.revoke` | Đăng xuất thiết bị | Sign this device out |
| `common.staff-role.admin` | Admin | Admin |
| `common.staff-role.manager` | Ban quản lý | Management office |
| `common.staff-role.technician` | Kỹ thuật | Technician |
| `common.staff-role.guard` | Bảo vệ | Guard |

The role labels follow the web sidebar ("Ban quản lý" for the Manager, `W-Tickets`) and the artboard (`Tag` "Kỹ thuật").

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UISM-13 | **G** a Technician **W** `S-Account` opens **T** it shows the name, email, role tag "Kỹ thuật" and the building name from E-03; no company line | maestro |
| UISM-14 | **G** the profile is at `version: 5` **W** the name is saved **T** E-31 carries `If-Match: "5"` and the screen shows `version: 6`; if another device saved first, a 409 shows the fresh name | api, maestro |
| UISM-15 | **G** the language is Vietnamese **W** English is picked **T** E-31 `{language: "en"}` is sent and the screen switches without a restart | maestro |
| UISM-16 | **G** two sessions **W** the sessions view opens and the other one is revoked **T** E-33 returns 204; a refresh from the revoked device gets 401 | api, maestro |
| UISM-17 | **G** the screen **W** inspected **T** no control changes the password; the note and the way out are present | maestro |
| UISM-18 | **G** the network is down **W** the user signs out **T** local state is cleared and `S-Login` shows | maestro |

### 10. E2E cases

Maestro `staff-account.yaml` (UISM-13, 15, 17), `staff-sessions.yaml` (UISM-16), `staff-signout.yaml` (UISM-18). UISM-14 pairs an API test (`If-Match`) with one screen assertion.

### 11. Open questions

None.

## Specified before P4 / P5

No full sections yet; each is written with the template above before its phase (P4-00, P5-00). Endpoints are from DOC-51 §2.2; the notes of DOC-56 §5 are the deviations to remember (N7: the word "Phiếu" for staff is decided in DR-197; N8: no hard-coded names or hotline).

| Artboard | Phase | Role | Endpoints | Remember |
| --- | --- | --- | --- | --- |
| `S-Inbox` | P4 | Manager, Technician, Guard | E-76 `GET /staff/inbox`, E-77 read-all | Push route `inbox`; no SSE on mobile (DR-75) |
| `S-Docs` | P5 | Manager, Technician, Guard | E-153 tree, E-154 search | Filtered to the staff role by the API |
| `S-Doc-Page` | P5 | Manager, Technician, Guard | E-159 | Video and file embeds by signed URL |
| `B-Home` | P4 | Manager | E-125 (new, unassigned counts), E-136 (pending vehicles) | Counts come from the list endpoints' filters or a summary field added in P4-00 (open, DOC-31/DOC-28); N7 |
| `B-Tickets` | P4 | Manager | E-125 | N7; filters `status`, `assignee` as search params |
| `B-Ticket-Detail` | P4 | Manager | E-126, E-129 | Internal notes are never shown to residents |
| `B-Assign` | P4 | Manager | E-127; staff list with open-ticket counts (E-39 or a field of E-127, open for DOC-28) | Workload shown as a count |
| `B-Ticket-Close` | P4 | Manager | E-128 | Close or reopen is a transition; 409 refetches |
| `B-Units` | P4 | Manager | E-57 `GET /staff/units`, E-70 lookup | Phone masked outside the Manager's detail view (UX-18) |
| `B-Unit-Detail` | P4 | Manager | E-59, E-62, E-125, E-136 | Members with call buttons; `pii.read` rules (DOC-35 §6) |
| `B-Notice-New` | P4 | Manager | E-146, E-148, E-36 | Quick notice only; the rich editor is `W-Notice-Edit` |
| `B-Notice-Stats` | P4 | Manager | E-149 | |
| `B-Vehicles` | P5 | Manager | E-136 | |
| `B-Vehicle-Review` | P5 | Manager | E-136, E-138 | Photos by signed URL; max 2 cars per unit is a warning to the Manager (design catalog) |
| `B-Vehicle-Reject` | P5 | Manager | E-138 | Reason code and note |

## Decisions made while writing

Delegated by the Owner; recorded in the register as DR-206…208.

### DR-206 · Sign-in and reset copy reveals nothing about the account

- **Problem:** The artboards show "Bạn còn 2 lần thử" (a counter the API does not give, DR-128), the numbers 5 and 15 in a policy banner (building settings an Admin can change), and "Đã gửi link tới email của bạn" (false for an unknown email, FR-13.4).
- **Decision:** No screen shows a count of tries left. The policy banner has no number. The 423 message takes its minutes from `details.retryAfter`. The reset confirmation says "if the address has an active account you will get an email". The same rules apply to `W-Login` and `W-Forgot-Sent` (DOC-64).
- **Consequences:** The catalog keys of §8 replace the prototype text; DOC-68 holds `error.account_locked` with `{minutes}`.
- **Write to:** DOC-61, DOC-64, DOC-68.

### DR-207 · "Mở ứng dụng email" is not in phase 1

- **Problem:** `S-Forgot-Sent` shows a button that opens the mail app. No single call opens the inbox on both iOS and Android without a native intent library, and `mailto:` opens a composer.
- **Decision:** The button is dropped from phase 1; the screen keeps "Quay lại đăng nhập" and the resend. It can return if P1-17 adds an intent library for another reason.
- **Consequences:** None for the API.
- **Write to:** DOC-61.

### DR-208 · The reset-link resend is 45 seconds

- **Problem:** `S-Forgot-Sent` says 60 seconds; the catalog says 45; every other resend in the product (OTP) is 45 seconds, and the server has no cooldown for E-06 (it has an hourly bucket).
- **Decision:** The client enables the resend 45 seconds after each send. The server bucket (3 per hour per email) stays the real limit and a 429 shows its `Retry-After`.
- **Consequences:** A single constant in `@rms/client-core`.
- **Write to:** DOC-61, DOC-64 (`W-Forgot-Sent`), DOC-55.

## Open questions

None.
