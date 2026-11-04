# Resident: QR, notices, account

> Status: **Approved** (Owner, 2026-10-21, for the account group (gate P1); QR, notices and library are owed to P4 and P5) (the P1 sections: the account group) · Updated: 2026-11-04 (DR-335: links to the artboards) · 2026-10-28 (DR-279: the usage switch on `Account`) · 2026-10-20 · DOC-60
> Depends on: original SDD §7.4, §18, [DR](../../00-decision-register.md) (DR-38, 40, 48, 52, 59, 69, 70, 71, 72, 73, 74, 128, 146), [DOC-02](../../01-product/personas-and-journeys.md), [DOC-03](../../01-product/requirements.md) (FR-16, FR-39, FR-45), [DOC-04](../../01-product/use-cases.md) (UC-14, UC-26, UC-27), [DOC-26](../../06-design/identity-and-sessions.md) §3.7, [DOC-27](../../06-design/residency-and-memberships.md) §3.2, [DOC-35](../../06-design/audit-privacy-and-terms.md) §10, [DOC-42](../../06-design/error-handling.md), [DOC-51](../../07-api/api-endpoints.md) (E-03, E-12…E-25), [DOC-53](../ux-principles-and-ia.md), [DOC-55](../client-architecture.md), [DOC-56](README.md)
> Main readers: P1-17 (resident app shell), P1-09 (i18n catalog), P1-00 (doc gate), the writers of DOC-68, P4-00 and P5-00 for the later screens

This document specifies the resident screens of the account group (`Account`, `Account-Phone`, `Account-Helper`, `Account-Deletion`, `Sessions`, `Contact`): **P1 sections, `Review`**. The other nine screens of the area (QR, notices, inbox, library) are only listed in the last section with their phase and endpoints; they are specified in full before P4 and P5 and stay `Draft` until then. It follows the screen-document convention of DOC-56 §6: the prototype (the Owner's canvas, design system "Hiên") is the reference for layout and UX and is not redrawn here. Tokens and components are DOC-54, navigation DOC-53, client rules DOC-55, error and status copy DOC-68.

Test prefix: `UIRQ-` (DOC-56 §6.3). Copy keys: `res.<screen>.<element>` (DOC-56 §6.4). The Maestro flows live in `apps/resident-app/.maestro/` (DOC-88).

**The design is a reference (DR-335).** The artboard of a screen, linked from the table below and from its "Prototype" part, is the reference for its layout and UX. Components and visual styling follow the project's design system ([DOC-54](../design-system.md)), not the artboard. See the artboards rendered on the [canvas](https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj); the files and their index are in [`references/design-canvas/`](../../references/design-canvas/README.md). A "Do not copy" note and [DOC-56 §5](README.md#5-prototype-deviations-what-a-screen-document-must-not-copy) say what not to take from one.

## Screens in this file

| Section | Screen | Role or member type | Phase | Prototype |
| --- | --- | --- | --- | --- |
| [`Account`](../../references/design-canvas/Account.dc.html) | Account and settings | Owner, Family member, Tenant | P1 | designed |
| [`Account-Phone`](../../references/design-canvas/Account-Phone.dc.html) | Change login phone: Manager only | Owner, Family member, Tenant, Helper | P1 | designed |
| [`Account-Helper`](../../references/design-canvas/Account-Helper.dc.html) | Account of a helper | Helper | P1 | designed |
| `Account-Deletion` | Request and cancel account deletion | Owner, Family member, Tenant, Helper | P1 | to design |
| `Sessions` | Signed-in devices | Owner, Family member, Tenant, Helper | P1 | to design |
| [`Contact`](../../references/design-canvas/Contact.dc.html) | Contact the Manager | Owner, Family member, Tenant, Helper | P1 | designed |
| (nine more) | QR, notices, inbox, library | | P4, P5 | see the last section |

Which variant of `/account` opens (`Account` or `Account-Helper`) depends on the member type of the **selected** unit (DOC-55 §7): a helper in the selected unit gets `Account-Helper`, everyone else `Account`. The two share their data and interactions; the difference is in §4 of each.

## Account

> Status: Review · Prototype: designed · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-5 Owner, PS-6 Family member, PS-7 Tenant. UC-26 (settings, sessions), UC-27 (terms, deletion), UC-14 step 6 (push). FR-45, FR-39, FR-16. Any resident with a session; no capability beyond a valid token (E-13 to E-23 need no `X-Unit-Id` and no terms acceptance, DOC-51 §5). The terms gate does not hide this screen, so a person who refuses new terms can still sign out or ask for deletion.

### 2. URL and search params

Route `/account` (stack screen opened from the avatar on Home, DOC-53 §3.4); no params. Deep link `rms-resident://account`. Sub-routes: `/account/phone` (sheet), `/account/deletion`, `/account/sessions`, `/contact`, `/terms` with `mode=view` (DR-204).

### 3. Prototype

Artboard [`Account`](../../references/design-canvas/Account.dc.html) ("Tài khoản và cài đặt", 390 × 1240). Regions, top to bottom: `TopBar` with back · profile row (`Avatar` lg, name, phone, `IconButton` pencil) · section "Căn hộ của bạn" (`List` of `ListItem`, the selected unit in tone teal) · section "Cài đặt" (Ngôn ngữ with its value, Thông báo đẩy with a `Switch`, Đổi số điện thoại) · list (Liên hệ Ban quản lý, Điều khoản sử dụng, Yêu cầu xóa tài khoản) · outline `Button` "Đăng xuất".

Do not copy:
- The pencil is labelled "Sửa tên và ảnh đại diện". The name is the Manager's record and `PATCH /me` refuses `displayName` and `phone` (E-14); only the **avatar** is editable (label "Đổi ảnh đại diện").
- The artboard has no row for sessions (N9) and no state for a pending deletion; both are added (`Sessions` row, banner).
- The phone `0912 345 678` is a display form of the E.164 value `+84912345678` (DR-205).

### 4. Regions and components

| Region | Component | Notes |
| --- | --- | --- |
| Profile row | `Avatar` lg, `IconButton` | Initials when `avatarUrl` is `null` or expired (a thumbnail URL lives 15 minutes, E-13) |
| Units | `List`, `ListItem` | One row per active membership; subtitle by member type and `canPay`; the selected unit tone teal |
| Settings | `ListItem` with `value`, `Switch` | The language opens a `BottomSheet` with two options (Tiếng Việt, English). **Usage switch (DR-279):** a `Switch` row with `common.usage.title` and the hint `common.usage.hint` (DOC-68 §4.6), on by default, kept on the device (DOC-104 §5.4); no endpoint, no toast. Tracked controls on this screen: `Account.language`, `Account.push` (DOC-104 §4.2) |
| Pending deletion | `Banner` tone warning | Only when `account.status = 'deletion_requested'`, with "Hủy yêu cầu xóa" |
| Sign out | `Button` outline lg, `Dialog` | Confirmation dialog |

### 5. Data

| Read | Endpoint | Query key | Refetch |
| --- | --- | --- | --- |
| Account and active memberships | E-13 | `['me']` | On mount, on app foreground, after every write below; persisted (DOC-55 §9.2) |
| Member type labels | E-13 `memberships[].memberType`, `canPay` | same | |

No real-time channel: the apps refetch on focus and on push (DR-75).

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| Pick a language | E-14 `PATCH /me {language}` | The catalog switches at once; `['me']` updated | Toast `error.service_unavailable`; the language reverts |
| Switch push on | OS prompt, then E-22 `POST /me/devices`, then E-14 `{pushEnabled: true}` (DOC-55 §10.1) | Switch on | OS denied: the switch stays off and a sheet offers "Mở Cài đặt" (`Linking.openSettings`) |
| Switch push off | E-14 `{pushEnabled: false}` | Switch off; the token stays registered (the server respects the flag) | Revert and toast |
| Change the avatar | Image picker, resize, E-24 `POST /me/uploads {purpose: 'avatar'}` (with `X-Unit-Id` and `Idempotency-Key`), `PUT` to the presigned URL, E-25 verify, E-14 `{avatarFileId}` | New avatar | `file_type_not_allowed`, `file_too_large` (400), `quota_exceeded` (413), `file_not_verified` (422): toast with the catalog text; no active unit: the pencil is hidden |
| Tap a unit | Client only: `select(unitId)` (DOC-55 §7.3), then E-13 | Home of that unit; the previous unit's queries are dropped | `membership_inactive` (403): `Unit-Pick` |
| Open phone, contact, terms, deletion, sessions | Navigation only | The sub-screen | |
| Sign out | Best effort E-23, then E-12 `POST /auth/logout`, then the local steps of DOC-55 §5.4 | `Login` | The local steps run even if the calls fail |

### 7. States

Loading: skeleton rows (the persisted `['me']` shows first). Offline: persisted data stays, the writes above are disabled with the offline banner (UX-04); sign out still works. Pending deletion: banner with the request date. Forbidden: not applicable. Stale avatar: initials.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.account.title` | Tài khoản | Account |
| `res.account.action.avatar` | Đổi ảnh đại diện | Change photo |
| `res.account.units.title` | Căn hộ của bạn | Your homes |
| `res.account.unit.selected` | đang chọn | selected |
| `res.account.settings.title` | Cài đặt | Settings |
| `res.account.language.label` | Ngôn ngữ | Language |
| `res.account.push.label` | Thông báo đẩy | Push notifications |
| `res.account.push.hint` | Phí, yêu cầu, phương tiện, bản tin | Fees, requests, vehicles, notices |
| `res.account.push.denied.title` | Thông báo đang bị tắt trong máy | Notifications are off on this phone |
| `res.account.push.denied.confirm` | Mở Cài đặt | Open Settings |
| `res.account.phone.label` | Đổi số điện thoại | Change phone number |
| `res.account.contact.label` | Liên hệ Ban quản lý | Contact the management office |
| `res.account.terms.label` | Điều khoản sử dụng | Terms of use |
| `res.account.sessions.label` | Thiết bị đăng nhập | Signed-in devices |
| `res.account.deletion.label` | Yêu cầu xóa tài khoản | Request account deletion |
| `res.account.deletion.banner` | Bạn đã yêu cầu xóa tài khoản ngày {requestedAt}. Bạn vẫn dùng ứng dụng bình thường. | You asked to delete your account on {requestedAt}. You can keep using the app. |
| `res.account.deletion.banner.cancel` | Hủy yêu cầu xóa | Cancel the request |
| `res.account.signout.cta` | Đăng xuất | Sign out |
| `res.account.signout.dialog.title` | Đăng xuất khỏi ứng dụng? | Sign out of the app? |
| `res.account.signout.dialog.confirm` | Đăng xuất | Sign out |
| `common.member-type.owner` | Chủ hộ | Owner |
| `common.member-type.family` | Thành viên gia đình | Family member |
| `common.member-type.tenant` | Người thuê | Tenant |
| `common.member-type.tenant-pay` | Người thuê, được thanh toán phí | Tenant, may pay fees |
| `common.member-type.helper` | Giúp việc | Helper |

The member-type labels also serve `Unit-Pick` and the unit screens. Error texts are `error.<code>` (DOC-68).

*As built (P1-17, DR-265):* `Account` has the profile row (initials, name, phone), the homes, the language sheet, the push switch, the links to `Contact`, the terms reader and `Sessions`, a developer-only "Device check" row (hidden when `APP_ENV` is `production`) and the sign-out dialog. **Not built yet:** the pencil and the avatar (the upload waits for P4), the phone-change row (`Account-Phone`), the deletion row and banner (`Account-Deletion`; E-18 and E-19 are not built). The `Sessions` list shows no revoke button on the current row (UIRQ-17); signing out is on `Account`, so UIRQ-19 is met through UIRQ-07.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-01 | **G** an account that is owner of A-1508 and a paying tenant of A-0703 **W** `Account` opens **T** two unit rows show "Chủ hộ, đang chọn" and "Người thuê, được thanh toán phí" | maestro |
| UIRQ-02 | **G** A-1508 selected with cached `['unit', A-1508, …]` data **W** the user taps A-0703 **T** those queries are gone and Home shows A-0703 with no flash of A-1508 data | maestro |
| UIRQ-03 | **G** the language is Vietnamese **W** the user picks English **T** `PATCH /me {language: "en"}` is sent, the screen is English without a restart, and a reload keeps English | maestro |
| UIRQ-04 | **G** the screen **W** inspected **T** no control edits the name or the phone, and a `PATCH /me` with `displayName` is 400 `unknown_key` | api, maestro |
| UIRQ-05 | **G** OS notifications are denied **W** the user switches push on **T** the switch stays off and the "Mở Cài đặt" sheet opens; no `PATCH` is sent | maestro |
| UIRQ-06 | **G** an account in `deletion_requested` **W** `Account` opens **T** the banner shows the request date and "Hủy yêu cầu xóa"; the app is otherwise usable | maestro |
| UIRQ-07 | **G** the network is down **W** the user taps "Đăng xuất" and confirms **T** the secure store and the persisted cache are cleared and `Login` shows | maestro |

### 10. E2E cases

Maestro: `account-switch-unit.yaml` (UIRQ-01, 02), `account-settings.yaml` (UIRQ-03, 05), `account-signout.yaml` (UIRQ-07). UIRQ-04 and UIRQ-06 are covered by an API test and a screen assertion in the first two flows.

### 11. Open questions

None.

## Account-Phone

> Status: Review · Prototype: designed · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-5…PS-8, every member type. UC-26 3b, UC-13 (the Manager changes the phone). The phone is the login of the account in every unit, so the app never changes it (DOC-26 §7, E-14 refuses `phone`).

### 2. URL and search params

Route `/account/phone`, presented as a `BottomSheet` over `Account`; no params.

### 3. Prototype

Artboard [`Account-Phone`](../../references/design-canvas/Account-Phone.dc.html) ("Đổi số điện thoại", 390 × 900): `Account` behind a scrim and a `BottomSheet` titled "Đổi số điện thoại" with two paragraphs, a `List` (Hotline, Giờ làm việc) and a primary button "Gọi Ban quản lý".

Do not copy: the sample hours "08:00–17:30, thứ Hai đến thứ Bảy" and the placeholder `[HOTLINE]` are hard-drawn (N8); both come from E-15.

### 4. Regions and components

`BottomSheet` (title, primary action), `List` with `ListItem` icons phone and clock. The phone number in the text is the account's own number.

### 5. Data

| Read | Endpoint | Query key |
| --- | --- | --- |
| Account phone | E-13 `account.phone` | `['me']` |
| Hotline, working hours, email | E-15 | `['me', 'contact']` (persisted, works offline) |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gọi Ban quản lý" | `tel:` link with `hotline`; no API call | The dialer opens | No dialer (tablet): the number is shown selectable |
| Close | none | Back to `Account` | |

### 7. States

Offline: persisted contact still shows. `hotline` missing in the building row: the call button is hidden and only the text shows.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.account-phone.title` | Đổi số điện thoại | Change phone number |
| `res.account-phone.body1` | Số {phone} là tài khoản đăng nhập của bạn ở mọi căn hộ, nên ứng dụng không cho tự đổi. | {phone} is your sign-in for every home, so the app does not let you change it. |
| `res.account-phone.body2` | Bạn liên hệ Ban quản lý. BQL xác minh rồi cập nhật số mới, sau đó bạn đăng nhập bằng số mới và mã OTP. | Contact the management office. They verify you and update the number; then you sign in with the new number and an OTP. |
| `res.account-phone.hotline` | Hotline | Hotline |
| `res.account-phone.hours` | Giờ làm việc | Working hours |
| `res.account-phone.cta` | Gọi Ban quản lý | Call the management office |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-08 | **G** a resident **W** "Đổi số điện thoại" is tapped **T** a sheet shows the account's number, the building's hotline and hours from E-15, and no input field | maestro |
| UIRQ-09 | **G** the building has no hotline **W** the sheet opens **T** the call button is absent and no placeholder text such as `[HOTLINE]` shows | unit |

### 10. E2E cases

Maestro `account-phone.yaml` (UIRQ-08).

### 11. Open questions

None.

## Account-Helper

> Status: Review · Prototype: designed · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-8 Helper. UC-26, UC-27. A helper has only `broadcast_notices` (DOC-27 §3.2): the QR and general notices, no fees, requests, unit, inbox or members. The account functions (language, push, phone, contact, terms, deletion, sessions, sign out) are the same as `Account`.

### 2. URL and search params

Route `/account` (the tab "Tài khoản" of the two-tab bar, DOC-53 §3.4); no params.

### 3. Prototype

Artboard [`Account-Helper`](../../references/design-canvas/Account-Helper.dc.html) ("Giúp việc: Tài khoản", 390 × 960): large `TopBar` "Tài khoản" · profile row (name, "0934 555 666, giúp việc căn A-1508", pencil) · list (Ngôn ngữ, Thông báo đẩy "Bản tin chung của Ban quản lý", Đổi số điện thoại) · list (Liên hệ Ban quản lý, Điều khoản sử dụng, Yêu cầu xóa tài khoản) · "Đăng xuất" · `TabBar` (Trang chủ, centre QR, Tài khoản).

Do not copy: the same edit label as `Account` ("Sửa hồ sơ" edits the avatar only); the phone subtitle is built from E-13 data, not typed. The hard-coded unit in the subtitle comes from the selected membership.

### 4. Regions and components

As `Account` without the "Căn hộ của bạn" list when the account has one unit (a helper in two units gets the list). The push hint names broadcast notices only. No pending-deletion difference.

### 5. Data

E-13 `['me']` as `Account`. The copy for the push hint depends on `can('personal_notifications')`, false for a helper.

### 6. Interactions

Identical to `Account` (E-14, E-22, E-24, E-25, E-23, E-12). A helper may register an `avatar` upload because every member type has `broadcast_notices` (E-24).

### 7. States

As `Account`. If the helper's membership is locked or removed (403 `membership_inactive`) the app goes to `Unit-Pick` or, with no unit left, the "no access" state with a Contact button and Sign out (DOC-53 UX-11).

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.account-helper.title` | Tài khoản | Account |
| `res.account-helper.subtitle` | {phone}, giúp việc căn {unitCode} | {phone}, helper of home {unitCode} |
| `res.account-helper.push.hint` | Bản tin chung của Ban quản lý | General notices from the management office |

Other strings are the `res.account.*` keys.

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-10 | **G** a helper of A-1508 **W** the account tab opens **T** the helper variant shows with the subtitle "…, giúp việc căn A-1508", the push hint "Bản tin chung của Ban quản lý", and no unit list | maestro |
| UIRQ-11 | **G** a helper **W** the app is searched for fees, requests, inbox and member entries **T** none exists (tab bar has Trang chủ, QR, Tài khoản) | maestro |

### 10. E2E cases

Maestro `account-helper.yaml` (UIRQ-10, 11).

### 11. Open questions

None.

## Account-Deletion

> Status: Review · Prototype: to design · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-5…PS-8. UC-27 deletion flow, FR-39.2…4, DR-59. The resident requests deletion; the Manager approves; after `accountDeletionDays` the job executes (DOC-35 §10). The account stays usable throughout and the request can be cancelled until execution.

### 2. URL and search params

Route `/account/deletion`; no params. Not a deep link target.

### 3. Prototype

No artboard (DR-72); the design owner produces it before the P1 build of this screen. Wireframe until then:

```
+--------------------------------------+
| <  Yêu cầu xóa tài khoản             |
|                                      |
|  [!] Bạn là chủ hộ căn A-1508.       |   only for an active owner
|      Nhờ BQL chuyển quyền chủ hộ     |
|      trước khi BQL duyệt.            |
|                                      |
|  Sẽ bị xóa                           |
|   - Tên, ảnh, số điện thoại          |
|   - Quyền vào các căn hộ             |
|   - Thiết bị và thông báo            |
|  Được giữ lại                        |
|   - Lịch sử thanh toán của căn hộ    |
|   - Nhật ký thao tác (chỉ mã số)     |
|                                      |
|  Sau khi BQL duyệt, tài khoản bị xóa |
|  sau {days} ngày. Bạn hủy được       |
|  bất kỳ lúc nào trước đó.            |
|                                      |
|  [ Gửi yêu cầu xóa ]                 |   becomes "Hủy yêu cầu xóa"
+--------------------------------------+
```

The kept and removed lists are the inventory of DOC-35 §7 and §10.1 (property 6); the screen text must stay equal to it.

### 4. Regions and components

`TopBar`, `Banner` (owner warning, tone warning; requested state, tone info), two bullet groups in a `Card`, primary `Button` (danger variant when sending, outline when cancelling), `Dialog` for the confirmation.

### 5. Data

| Read | Endpoint | Query key |
| --- | --- | --- |
| Status and dates | E-13 `account.status`, `account.deletion {requestedAt, approvedAt}` | `['me']` |
| Cooling-off length | **Gap:** the resident cannot read the building setting `accountDeletionDays` (E-47 is Admin only). Proposed: E-13 `account.deletion` gains `cooloffDays` and, once approved, `executeAfter` (DR-202) | `['me']` |
| Owned units for the warning | E-13 `memberships` where `memberType = 'owner'` | `['me']` |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gửi yêu cầu xóa", then confirm | E-18 `POST /me/account/deletion` | 204; `['me']` refetched; the screen shows the requested state | 401: sign-in; network: toast, nothing changes (the call is idempotent) |
| "Hủy yêu cầu xóa" (here and on the `Account` banner) | E-19 `DELETE /me/account/deletion` | 204; status `active` | 404 `not_found` (the job already deleted the account): the app signs out with the message of `error.not_found` on `Login` |

The owner check (`owner_must_transfer`) happens at the Manager's approval (E-68), not here. An owner may send the request; the warning tells them what will block it.

### 7. States

Four states of one screen: not requested · requested, not approved ("Chờ Ban quản lý duyệt") · approved ("Tài khoản sẽ bị xóa sau {executeAfter}") · loading. Offline: the buttons are disabled with the offline banner. A deleted account cannot hold a session, so there is no "deleted" state.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.account-deletion.title` | Yêu cầu xóa tài khoản | Request account deletion |
| `res.account-deletion.owner-warning` | Bạn là chủ hộ căn {unitCode}. Nhờ Ban quản lý chuyển quyền chủ hộ trước khi BQL duyệt yêu cầu. | You are the owner of home {unitCode}. Ask the management office to transfer ownership before they approve the request. |
| `res.account-deletion.removed.title` | Sẽ bị xóa | What is deleted |
| `res.account-deletion.removed.body` | Tên, ảnh đại diện, số điện thoại, quyền vào các căn hộ, thiết bị và thông báo. | Your name, photo, phone number, access to homes, devices and notifications. |
| `res.account-deletion.kept.title` | Được giữ lại | What is kept |
| `res.account-deletion.kept.body` | Lịch sử thanh toán của căn hộ và nhật ký thao tác (chỉ lưu mã số, không lưu tên). | The home's payment history and the activity log (ids only, no names). |
| `res.account-deletion.timeline` | Sau khi Ban quản lý duyệt, tài khoản bị xóa sau {days} ngày. Bạn hủy được bất kỳ lúc nào trước đó. | After the management office approves, the account is deleted {days} days later. You can cancel any time before then. |
| `res.account-deletion.cta` | Gửi yêu cầu xóa | Send deletion request |
| `res.account-deletion.dialog.title` | Gửi yêu cầu xóa tài khoản? | Send the deletion request? |
| `res.account-deletion.dialog.confirm` | Gửi yêu cầu | Send request |
| `res.account-deletion.requested` | Đã gửi ngày {requestedAt}. Chờ Ban quản lý duyệt. | Sent on {requestedAt}. Waiting for the management office. |
| `res.account-deletion.approved` | Tài khoản sẽ bị xóa sau {executeAfter}. | Your account will be deleted after {executeAfter}. |
| `res.account-deletion.cancel` | Hủy yêu cầu xóa | Cancel the request |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-12 | **G** an active account **W** the user sends and confirms the request **T** E-18 is called once, the screen shows the requested state and the app keeps working (FR-39.2) | maestro |
| UIRQ-13 | **G** a requested account, even after approval **W** the user taps "Hủy yêu cầu xóa" **T** E-19 returns 204 and the status is `active`; the request can be sent again | maestro |
| UIRQ-14 | **G** the account is the active owner of A-1508 **W** the screen opens **T** the owner warning names A-1508; the send button still works (the block is at approval) | maestro |
| UIRQ-15 | **G** E-19 answers 404 because the job ran **W** the user cancels **T** the app signs out and `Login` explains the account no longer exists | api, maestro |
| UIRQ-16 | **G** `cooloffDays = 30` **W** the screen renders **T** the text says "sau 30 ngày"; with `cooloffDays = 7` it says 7 (no number is hard-coded) | unit |

### 10. E2E cases

Maestro `account-deletion.yaml` (UIRQ-12, 13, 14).

### 11. Open questions

None (DR-202 decides the gap).

## Sessions

> Status: Review · Prototype: to design · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-5…PS-8. UC-26 steps 2 and 3, FR-45.1, DR-38. Lists the live sessions of the account (at most 10) and ends one. The staff variants are `S-Account` (DOC-61) and `W-Profile` (DOC-64).

### 2. URL and search params

Route `/account/sessions`; no params.

### 3. Prototype

No artboard (DR-72, N9). Wireframe until the design exists:

```
+--------------------------------------+
| <  Thiết bị đăng nhập                |
|                                      |
|  [phone] iPhone17,1, iOS 19.1        |
|          Thiết bị này                |
|          Dùng lần cuối 09:30 hôm nay |
|  --------------------------------    |
|  [phone] Pixel 9, Android 16         |
|          Dùng lần cuối 18/10/2026    |
|          [ Đăng xuất thiết bị ]      |
|                                      |
|  Chỉ có thiết bị đang đăng nhập.     |
+--------------------------------------+
```

### 4. Regions and components

`TopBar`, `List` of `ListItem` (icon by `client`, a phone for `app`; title `device`, subtitle last use), `Tag` "Thiết bị này" on the current row, `Button` ghost per other row, `Dialog` to confirm.

### 5. Data

| Read | Endpoint | Query key |
| --- | --- | --- |
| Live sessions, `current` marked | E-20 | `['me', 'sessions']` (never persisted) |

Refetched on mount and after a revoke. `device` is already a readable string computed by the server from the user agent (DOC-26 §3.7); `client` is `app` for every resident session (DR-225).

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Đăng xuất thiết bị" on another row, confirm | E-21 `DELETE /me/sessions/{id}` | 204; the row disappears; that device's token dies within 15 minutes and its push stops | 404 `not_found` (already gone): the list refetches |
| The same on the current row | E-21 | Equals a sign-out: the local steps of DOC-55 §5.4 | as above |

### 7. States

Loading skeleton. Empty is impossible (the current session is always there). Offline: the list is not persisted, so the offline state shows and the revoke buttons are disabled.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.sessions.title` | Thiết bị đăng nhập | Signed-in devices |
| `res.sessions.current` | Thiết bị này | This device |
| `res.sessions.last-used` | Dùng lần cuối {lastUsedAt} | Last used {lastUsedAt} |
| `res.sessions.action.revoke` | Đăng xuất thiết bị | Sign this device out |
| `res.sessions.dialog.title` | Đăng xuất thiết bị này? | Sign this device out? |
| `res.sessions.dialog.body` | Thiết bị đó sẽ phải đăng nhập lại bằng mã OTP. | That device will need to sign in again with an OTP. |
| `res.sessions.dialog.confirm` | Đăng xuất | Sign out |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-17 | **G** an account with 2 sessions **W** the screen opens **T** two rows show, the current one tagged "Thiết bị này" and without a revoke button | maestro |
| UIRQ-18 | **G** the same **W** the user revokes the other session **T** E-21 returns 204 and one row remains; a refresh from the revoked device returns 401 | api, maestro |
| UIRQ-19 | **G** the user revokes the current session **W** confirmed **T** the app clears its state and shows `Login` | maestro |

### 10. E2E cases

Maestro `account-sessions.yaml` (UIRQ-17, 18, 19).

### 11. Open questions

None.

## Contact

> Status: Review · Prototype: designed · Phase: P1 · DOC-60

### 1. Persona, use cases, permissions

PS-5…PS-8. UC-14 E7, UC-26 3b. Reached from `Account`, `Login-Error` (as an unauthenticated variant with E-03), the "no access" state and the Home shortcut "Liên hệ BQL".

### 2. URL and search params

Route `/contact`; no params. Deep link `rms-resident://contact`.

### 3. Prototype

Artboard [`Contact`](../../references/design-canvas/Contact.dc.html) ("Liên hệ Ban quản lý", 390 × 900): `TopBar` · header (a plate "MM", "Ban quản lý Mộc Miên Residence", "Công ty Quản lý Mộc Miên") · `List` (Hotline, Giờ làm việc, Email, Văn phòng) · a note about out-of-hours calls · fixed bottom actions "Gọi hotline" and "Tạo yêu cầu hỗ trợ".

Do not copy (DR-203): the company line and the row "Văn phòng: Tầng 1, cạnh sảnh thang máy" have no source (E-15 returns name, hotline, hours, email only); the plate uses the building's initials, not a logo; the sentence about calling the hotline out of hours to reach the guard is an operating promise not backed by a requirement; the hours and `[HOTLINE]`/`[EMAIL BQL]` are placeholders (N8). "Tạo yêu cầu hỗ trợ" is a P4 button (tickets) and is hidden until then and for a helper (no `tickets`).

### 4. Regions and components

`TopBar`, `Plate` (initials), `List` with `ListItem` icons phone, clock, chat; fixed footer `Button` primary and tonal.

### 5. Data

| Read | Endpoint | Query key |
| --- | --- | --- |
| Name, hotline, hours (vi/en with fallback to vi), email | E-15 | `['me', 'contact']`, persisted |

### 6. Interactions

| Action | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| "Gọi hotline", tap Hotline row | `tel:` link | Dialer | none |
| Tap Email row | `mailto:` link | Mail composer | none |
| "Tạo yêu cầu hỗ trợ" (P4, `tickets` only) | Navigation to `Request-New` (E-120 there) | | |

### 7. States

Offline: persisted values show. A field that is `null` (no email) hides its row.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.contact.title` | Liên hệ Ban quản lý | Contact the management office |
| `res.contact.hotline` | Hotline | Hotline |
| `res.contact.hours` | Giờ làm việc | Working hours |
| `res.contact.email` | Email | Email |
| `res.contact.cta` | Gọi hotline | Call the hotline |
| `res.contact.cta.request` | Tạo yêu cầu hỗ trợ | Create a request |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRQ-20 | **G** a building with hotline, hours and email **W** `Contact` opens **T** the rows show E-15's values in the account language (vi when `en` is `null`) and no row for an office or company | maestro |
| UIRQ-21 | **G** a helper, or P1 without tickets **W** `Contact` opens **T** the button "Tạo yêu cầu hỗ trợ" is absent | maestro |

### 10. E2E cases

Maestro `contact.yaml` (UIRQ-20, 21).

### 11. Open questions

None.

## Specified before P4 / P5

No full sections yet. Each row is specified with the template above before its phase (P4-00, P5-00). Endpoints are those of DOC-51 §2.2; the notes of DOC-56 §5 are the deviations to remember.

| Artboard | Phase | Role or member type | Endpoints | Remember |
| --- | --- | --- | --- | --- |
| `Notices` | P4 | Owner, Family, Tenant | E-143 `GET /me/notices`, E-144 read | Categories and pinned items; push route `notice` |
| `Notices-Helper` | P4 | Helper | E-143 | General notices only |
| `Notice-Detail` | P4 | Owner, Family, Tenant, Helper | E-143, E-144 | Attachments by signed URL (DOC-37) |
| `Inbox` | P4 | Owner, Family, Tenant | E-78 `GET /me/inbox`, E-79 read-all | N11: a helper has no inbox and no bell |
| `QR` | P5 | Owner, Family, Tenant | E-141 `POST /me/qr` | 15-minute countdown from `serverTime`; never persisted; brightness raised (SDD §18.2) |
| `QR-Expired` | P5 | Owner, Family, Tenant | E-141 | Regenerate on focus when under 60 s remain |
| `QR-Helper` | P5 | Helper | E-141 | Same QR rules; capability `broadcast_notices` |
| `Docs` | P5 | Owner, Family, Tenant | E-150 tree, E-152 search | Visibility inherited from the folder (DR-54) |
| `Doc-Page` | P5 | Owner, Family, Tenant | E-151 | VI/EN with fallback to vi |

## Decisions made while writing

Delegated by the Owner; recorded in the register as DR-202…205.

### DR-202 · The resident reads the cooling-off length

- **Problem:** `Account-Deletion` must say how long after approval the account is deleted, but `accountDeletionDays` is a building setting readable only by the Admin (E-47), and E-13 returns only the two dates.
- **Decision:** E-13 `account.deletion` gains `cooloffDays` (the setting, integer) and, when `approvedAt` is set, `executeAfter` (`approvedAt` plus the days). Nothing else of the settings is exposed.
- **Consequences:** DOC-51 E-13 example and DOC-35 §10 gain two fields; no schema change (computed on read).
- **Write to:** DOC-51, DOC-35, DOC-60.

### DR-203 · `Contact` shows only what E-15 returns

- **Problem:** The artboard shows a company line, an office location, a logo mark and an out-of-hours promise that no document backs and E-15 does not carry.
- **Decision:** `Contact` and `Account-Phone` show name, hotline, working hours and email only; the plate shows initials of the building name; the out-of-hours sentence and the office row are dropped. An office location or a logo can return later as an addition to the contact block of DOC-36 §4.
- **Consequences:** Less copy to translate; the Owner can ask for the rows later.
- **Write to:** DOC-60, DOC-36 (note).

### DR-204 · `Terms` has a read-only mode

- **Problem:** `Account` has the row "Điều khoản sử dụng", but `Terms` (DOC-53 §5.1) only has the modes `first` and `update`, both of which end in an accept button.
- **Decision:** `Terms` takes `mode=view`: it shows the accepted versions from E-16, with no accept button, and back returns to `Account`.
- **Consequences:** DOC-53 §5.1 params and DOC-57 `Terms` gain one value.
- **Write to:** DOC-53, DOC-57, DOC-60.

### DR-205 · A phone is shown in national form

- **Problem:** The API returns E.164 (`+84912345678`); the artboards show `0912 345 678`.
- **Decision:** A helper `formatPhone(e164)` in `@rms/shared-types` returns the Vietnamese national form `0912 345 678` (spaces after the 4th and 7th digit); any other country code is shown in international form. It is display only: requests always carry E.164.
- **Consequences:** One small table test beside the money and date formatters.
- **Write to:** DOC-55 §11, DOC-60.

## Open questions

None.
