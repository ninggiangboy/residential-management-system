# Resident app: fees and payment

> Status: **Draft** · Updated: 2026-11-01 (P1-27: the four P2 screens `Fees`, `Fees-NoPay`, `Fee-Detail`, `Fee-History` written; the P3 payment screens are owed; DR-323) · DOC-58
> Depends on: original SDD §5.1, §18, [DR](../../00-decision-register.md) (DR-16, 18, 19, 40, 41…47, 72, 84, 174, 194, 196, 200, 323), [DOC-56](README.md) (convention, notes N1, N4, N6, N10), [DOC-53](../ux-principles-and-ia.md) §3.4, §5, [DOC-55](../client-architecture.md) §5…§7, §10, §11, §12, [DOC-54](../design-system.md) (components), [DOC-22](../../06-design/ledger-and-allocation.md) §8, [DOC-27](../../06-design/residency-and-memberships.md) §3.2, §6.6, [DOC-34](../../06-design/pdf-rendering.md) §6.3, §8.2, [DOC-51](../../07-api/api-endpoints.md) (E-80…E-84, E-15, E-13), [DOC-57](resident-signin-home.md) (the home card and tile)
> Main readers: P2-17 (receipt view and PDF in the resident app), P2-15 (the resident fee API), P2-16, P3-05 (the payment screens), P1-09 (catalog keys), DOC-68, DOC-88 (`UIRF-`)

This document specifies the resident screens that show what a unit owes and has paid. **Written now (P2): `Fees`, `Fees-NoPay`, `Fee-Detail` and `Fee-History`.** The four payment screens (`Pay-Select`, `Pay-VietQR`, `Pay-Done`, `Pay-Mismatch`) belong to P3 and are listed at the end; their sections are written when P3-00 starts (master plan §3.2). The visual source of truth is the canvas (<https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj>, design system "Hiên"); this file adds data, interactions, states, copy keys and acceptance criteria (DR-194). Tokens and components are DOC-54, navigation DOC-53, the shared states DOC-68, the API DOC-51, and what a resident may see by membership DOC-22 §8.4.

## Screens in this file

| Section | Screen | Role or member type | Phase | Prototype |
| --- | --- | --- | --- | --- |
| `Fees` | Open charges of the unit, grouped by fee month | Owner, Family member, Tenant (`view_fees`) | P2 | designed |
| `Fees-NoPay` | The same list for a tenant who may not pay: a banner, no pay buttons | Tenant without `can_pay` | P2 | designed |
| `Fee-Detail` | One charge: lines, total, due date, how to pay | Owner, Family member, Tenant | P2 | designed |
| `Fee-History` | Paid charges by fee month, with the receipt | Owner, Family member, Tenant | P2 | designed |
| `Pay-Select` | Choose charges and the method | Member with `pay` | P3 | designed — section owed |
| `Pay-VietQR` | The dynamic QR | Member with `pay` | P3 | designed — section owed |
| `Pay-Done` | Payment confirmed, one receipt per charge | Member with `pay` | P3 | designed — section owed |
| `Pay-Mismatch` | A state of `Pay-VietQR`: a transfer of another amount arrived | Member with `pay` | P3 | to design — section owed |

**What every screen here shares.** All read the unit chosen in `Unit-Pick` (header `X-Unit-Id`, DOC-55 §5); every query key starts with `['unit', unitId, 'fees', …]`, so a unit switch drops the data of the old unit with no flash of it (UIRQ-02). The capability is `view_fees` (owner, family member, tenant); a helper has no tab "Phí" and a direct URL answers 403 `forbidden` and the generic forbidden state of DOC-68. A **charge** is one unit's bill in one batch; the resident word is "đợt" (batch) for the whole bill and "khoản" for a line. Money is shown as `2.838.000 đ` (Vietnamese) or `2,838,000 đ` (English), never as a decimal (DOC-14 §8). Dates are building-local `dd/MM/yyyy`, and "today" is the building's day (DR-09).

**Phase 2 has no payment in the app.** The pay buttons, the QR and the payment methods are P3 and are not drawn, disabled or announced in a P2 build (DR-174, DR-196, DR-323): a resident reads the fees, the receipts and how to pay at the office. The places where P3 adds a control are marked **(P3)** below.

---

## Fees

> Status: Draft · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5 Owner, PS-6 Family member, PS-7 Tenant (DOC-02). UC-03 (the reading that comes before paying), FR-03 (members who see fees), FR-12.3 (what counts as debt: open charges only), FR-06.5 (the charges of a voided payment are open again), DR-18 (outstanding), DR-40 (open charges are always visible). Capability `view_fees`. The tab "Phí" exists for these three member types in P2 (DOC-57 card matrix); the "Fee card" of the home links here.

### 2. URL and search params

`/fees` (the tab "Phí" of `(app)/(tabs)`), search `view` = `due` (default) or `history`. `view=history` is the `Fee-History` section below; both are one route with a segmented control (the canvas has the same layout), so the tab bar, the title and the bell stay still when the segment changes. Deep link from a push `fee.batch_published` (DOC-31): `/fees?focus=<chargeId>` scrolls to the card of that charge and highlights it for 2 seconds.

### 3. Prototype

Canvas artboard `Fees` (title "Phí cần thanh toán", 390 × 1560, scrolls). Regions: `Glow`; large `TopBar` ("Phí", subtitle "Căn hộ A-1508") with the bell `IconButton` and its count; `SegmentedControl` "Cần thanh toán | Lịch sử"; a line "Còn phải thanh toán, 2 đợt" with the total "2.838.000 đ"; a section titled with the fee month ("Phí tháng 10/2026") holding one `BillSlip` per batch (period "Đợt 1, phát hành 01/10", due "Hạn thanh toán 15/10/2026", a status chip "Còn 6 ngày", the lines, the total, the button "Thanh toán đợt này"); a `Button` tonal "Thanh toán nhiều đợt cùng lúc" with a caption; `TabBar` with the center QR action.

Do not copy:

- The pay buttons and the caption's "nộp một phần" (N6, DR-84): there is no partial payment, and in P2 there is no payment button at all.
- The `BillSlip` unit of measure in the line detail ("85 m² × 12.000 đ", "14 m³", "1 xe"): a line holds `quantity × unitPrice` and the item name (DR-13); the screen prints `quantity × unitPrice` or the price alone when the quantity is 1, as the notice does (DOC-34 §6.1). A Manager who wants "m²" in the sentence writes it in the item name.
- The icons per line (`buildings`, `drop`, `car`): the line has no kind or icon; the screen uses one neutral `receipt` glyph for a fee and `minus-circle` for an adjustment.
- The bell count "4 mục chưa đọc" and the tab badge "2": sample numbers. The badge on the tab is the number of open charges of the unit (E-80), and the bell is DOC-31's.

### 4. Regions and components

| Region | Components | Source |
| --- | --- | --- |
| Top | `TopBar` large (title `res.fees.title`, subtitle `res.fees.subtitle` with the unit code), bell `IconButton` + `Badge` (needs `personal_notifications`, P4; absent in P2 for a build without the inbox) | E-13 (unit), E-78 |
| Segment | `SegmentedControl` `view` | local |
| Summary line | muted label + bold amount (tabular numerals) | E-80 `total`, `count` |
| Month section | `h2` "Phí tháng {m}/{y}" (from `feeMonth`) | E-80 |
| Charge card | `BillSlip`: period line "Đợt {n}, phát hành {dd/MM}", due line, status chip, lines, total | E-80 `items[]` with `lines[]` (DR-323) |
| How to pay caption | one muted paragraph under the list, with a link "Liên hệ BQL" to `Contact` | local, E-15 |
| Tab bar | `TabBar` (the badge on "Phí" = `count`) | E-80 |

**The status chip** is computed from `daysPastDue` (negative before the due date), by the client with the server's day (DR-09):

| `daysPastDue` | Chip | Tone |
| --- | --- | --- |
| > 0 | "Quá hạn {n} ngày" | `danger` |
| 0 | "Hạn hôm nay" | `warning` |
| −7 … −1 | "Còn {n} ngày" | `warning` (the canvas `due`) |
| ≤ −8 | "Còn {n} ngày" | `neutral` (the canvas `upcoming`, tone `surface`) |

**Order.** Sections by `feeMonth` descending; inside a section the cards by `dueDate` ascending, then batch code. A closed batch's open charge is shown like any other (DR-20). The batch code `PH-2610-01` is not printed on the card (the period line says "Đợt 1"); it is on `Fee-Detail`.

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Open charges | E-80 `GET /me/fees` | `['unit', unitId, 'fees', 'open']` | all `open` charges of the unit, whatever the membership date (DOC-22 §8.4). Items: `chargeId`, `batch {code, name {vi,en}, feeMonth, ordinal}`, `amount`, `dueDate`, `daysPastDue`, `overdue`, `lines[]` (DR-323). Plus `total`, `count`. `staleTime` 30 s; refetched on focus after 30 s and on the push `fee.batch_published`, `fee.charge_paid`, `fee.batch_recalled` |
| Unit and capabilities | the session (E-13) | `['me']` | `pay` decides `Fees` or `Fees-NoPay`; P2 uses it only for the banner |
| Contact for the caption | E-15 | `['contact']` | cached by the home |

There is no polling. A pull-to-refresh refetches E-80. The list is not paginated: one unit has at most a few dozen open charges (DOC-10 §5.1), and E-80 answers at most 100 items (DR-323); beyond that the screen shows the first 100 and the line "Còn nữa, hãy liên hệ Ban quản lý".

### 6. Interactions

| Action | Result |
| --- | --- |
| Tap a card or its "Xem chi tiết" | `Fee-Detail` for the `chargeId` |
| Tap the segment "Lịch sử" | `view=history` (the `Fee-History` content), no navigation |
| Pull to refresh | E-80 refetch |
| Tap "Liên hệ BQL" in the caption | `Contact` (E-15) |
| Tap the bell | `Inbox` (P4; absent in P2 builds without it) |
| **(P3)** "Thanh toán đợt này", "Thanh toán nhiều đợt cùng lúc" | `Pay-Select` with the charge(s) selected |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | Skeleton shaped as the summary line and two cards (DOC-54 §17.3), shown after 150 ms and kept 300 ms at least |
| `loaded` | As §4 |
| `empty` | No open charge: a success `EmptyState` "Căn hộ không còn khoản phí nào cần thanh toán" with the line of the last payment ("Lần thanh toán gần nhất: 12/09/2026") when `Fee-History` has one |
| `error` | The generic error `Banner` with a retry (DOC-68); a cached list stays visible with a muted "Dữ liệu có thể đã cũ" |
| `offline` | The cached list with the offline strip of DOC-68; no write exists on this screen |
| `forbidden` | A helper: DOC-68 forbidden state (the tab is hidden, so only a deep link reaches it) |
| `overdue` | A card with `overdue` has a `danger` chip and the summary line adds "Trong đó quá hạn: {amount}" |
| `focus` | The card of `?focus=` has a 2-second highlight; an unknown id is ignored |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.fees.title` | Phí | Fees |
| `res.fees.subtitle` | Căn hộ {unit} | Unit {unit} |
| `res.fees.segment.label` | Xem phí | View fees |
| `res.fees.segment.due` | Cần thanh toán | To pay |
| `res.fees.segment.history` | Lịch sử | History |
| `res.fees.summary` | Còn phải thanh toán, {count, plural, one {# đợt} other {# đợt}} | Left to pay, {count, plural, one {# batch} other {# batches}} |
| `res.fees.summary.overdue` | Trong đó quá hạn: {amount} | Of which overdue: {amount} |
| `res.fees.month` | Phí tháng {month}/{year} | Fees for {month}/{year} |
| `res.fees.card.period` | Đợt {ordinal}, phát hành {date} | Batch {ordinal}, issued {date} |
| `res.fees.card.due` | Hạn thanh toán {date} | Due {date} |
| `res.fees.chip.overdue` | Quá hạn {days, plural, one {# ngày} other {# ngày}} | {days, plural, one {# day} other {# days}} overdue |
| `res.fees.chip.today` | Hạn hôm nay | Due today |
| `res.fees.chip.left` | Còn {days, plural, one {# ngày} other {# ngày}} | {days, plural, one {# day} other {# days}} left |
| `res.fees.card.detail` | Xem chi tiết | View details |
| `res.fees.howto` | Mỗi đợt thanh toán đủ số tiền. Muốn nộp tiền mặt hoặc chuyển khoản, bạn liên hệ Ban quản lý. | Each batch is paid in full. To pay in cash or by transfer, contact the management office. |
| `res.fees.howto.link` | Liên hệ BQL | Contact the office |
| `res.fees.empty.title` | Căn hộ không còn khoản phí nào cần thanh toán | This unit has no fees to pay |
| `res.fees.empty.last` | Lần thanh toán gần nhất: {date} | Last payment: {date} |
| `res.fees.more` | Còn nữa, hãy liên hệ Ban quản lý. | There are more; contact the office. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-01 | **G** A-1508 with two open charges (2,488,000 and 350,000) **W** `Fees` opens **T** the summary says "Còn phải thanh toán, 2 đợt" and "2.838.000 đ", the tab badge shows 2, and the cards are in due-date order | maestro |
| UIRF-02 | **G** a charge due in 6 days, one due in 16, one 3 days overdue **W** the list renders **T** the chips are "Còn 6 ngày" (warning), "Còn 16 ngày" (neutral) and "Quá hạn 3 ngày" (danger), and the summary adds "Trong đó quá hạn" | api, maestro |
| UIRF-03 | **G** a P2 build **W** `Fees` is inspected **T** no control named "Thanh toán" exists, the caption says the office takes cash or transfer, and no text says "nộp một phần" | maestro |
| UIRF-04 | **G** the unit switch from A-1508 to A-0703 **W** the user picks A-0703 **T** the queries `['unit', A-1508, 'fees', …]` are gone and the list shows A-0703 with no flash of A-1508 | maestro |
| UIRF-05 | **G** a unit with no open charge **W** the screen opens **T** the empty state shows with the date of the last payment | maestro |
| UIRF-06 | **G** a helper **W** the user opens the deep link `/fees` **T** the screen is the forbidden state, and the tab "Phí" is not in the bar | maestro |
| UIRF-07 | **G** a batch is recalled while the screen is open **W** the push `fee.batch_recalled` arrives **T** E-80 refetches and the card is gone without a reload | api, maestro |
| UIRF-08 | **G** a 400 ms API latency **W** the tab opens **T** the skeleton appears after 150 ms and stays at least 300 ms; at 0 ms no skeleton flashes (DOC-54 §17.3) | maestro |

### 10. E2E cases

Maestro: `fees-list.yaml` (UIRF-01, 02, 03, 05), `fees-unit-switch.yaml` (UIRF-04), `fees-helper.yaml` (UIRF-06). UIRF-07 is an API test on the push plus one screen assertion; UIRF-08 is the check Q1…Q8 run at `DEV_LATENCY_MS` 400 and 0.

### 11. Open questions

None.

---

## Fees-NoPay

> Status: Draft · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-7 Tenant whose owner has not allowed payment (`can_pay` false, DOC-27 §3.2). UC-03 read-only, FR-07.1 (who may pay), FR-03. Capability `view_fees` without `pay`. The same route and the same data as `Fees`; the section exists because the canvas draws it and the screen differs in one block and in what P3 adds.

### 2. URL and search params

`/fees` (the same route). The variant is chosen by the session's capabilities: `pay` absent. A tenant whose owner later enables `can_pay` sees `Fees` on the next E-13 refresh (the capability list comes with the session, DOC-27 §6.6).

### 3. Prototype

Canvas artboard `Fees-NoPay` (title "Người thuê không trả phí: Phí", 390 × 1240): the same shell as `Fees` with a neutral `Banner` at the top ("Chủ hộ thanh toán phí của căn này", "Bạn xem được các đợt phí và biên lai. Muốn tự thanh toán, bạn nhờ chủ hộ bật quyền thanh toán cho bạn."), the segmented control, and two sections: "Phí tháng 10/2026" with a `BillSlip` of status "Còn 6 ngày" and the sentence "Chủ hộ thanh toán đợt phí này. Bạn nhận thông báo khi đợt phí được thanh toán.", and "Phí tháng 9/2026" with a **paid** `BillSlip` ("Đã thanh toán", "Xem biên lai").

Do not copy:

- The paid batch of September under the segment "Cần thanh toán": a paid charge is history. The segment lists only `open` charges (E-80); the paid one is in `Fee-History` (§ below), with its receipt.
- The `unit` prop printed on every card ("A-1102"): the unit is in the subtitle.
- The sentence "Chủ hộ thanh toán đợt phí này" under **every** card: it is said once, in the banner.

### 4. Regions and components

As `Fees` plus:

| Region | Component | Notes |
| --- | --- | --- |
| Banner | `Banner` neutral with `info` icon, title `res.fees.nopay.title`, body `res.fees.nopay.body` | always shown for this variant, not dismissible |
| Cards | `BillSlip` tone `surface`, **no pay button in any phase** | P3 does not add a button here |
| Caption | not shown (the banner replaces `res.fees.howto`) | |

### 5. Data

As `Fees`. The variant decision uses the capability list in `['me']`; no extra request.

### 6. Interactions

The same as `Fees` without the **(P3)** rows. The banner has no action; a tenant who wants to pay asks the owner outside the app (the owner changes `can_pay` on their `Members` screen, DOC-59).

### 7. States

As `Fees`. `empty` uses `res.fees.empty.title`. Nothing else differs.

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.fees.nopay.title` | Chủ hộ thanh toán phí của căn này | The owner pays this unit's fees |
| `res.fees.nopay.body` | Bạn xem được các đợt phí và biên lai. Muốn tự thanh toán, bạn nhờ chủ hộ bật quyền thanh toán cho bạn. | You can see the fee batches and receipts. To pay yourself, ask the owner to allow you to pay. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-09 | **G** a tenant of A-1102 without `can_pay` **W** `Fees` opens **T** the neutral banner shows, the list is the same as an owner's, and no control to pay exists | maestro |
| UIRF-10 | **G** the owner enables `can_pay` for the tenant **W** the tenant's session refreshes (E-13) **T** the banner is gone and the screen is `Fees` | api, maestro |
| UIRF-11 | **G** the tenant has paid charges **W** `view=due` is open **T** no paid charge is listed; `view=history` lists them | api, maestro |

### 10. E2E cases

Maestro: `fees-nopay.yaml` (UIRF-09, 11); UIRF-10 is an API test on the capability list plus one assertion.

### 11. Open questions

None.

---

## Fee-Detail

> Status: Draft · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5, PS-6, PS-7 (`view_fees`). UC-03 step "read the bill", FR-03, FR-36 (the notice shows lines, total, due date and how to pay), FR-12.3. An `open` charge is always readable; a `paid` charge only if its payment is not older than the member's `startedAt` (DR-40, DOC-22 §8.4).

### 2. URL and search params

`/fees/[chargeId]` (a stack screen over the tab). No search params; the language toggle is local state. From a push (`fee.batch_published`, `fee.charge_paid`) and from `Fee-History` rows.

### 3. Prototype

Canvas artboard `Fee-Detail` (title "Thông báo phí", 390 × 1480): `TopBar` ("Thông báo phí", subtitle "Phí tháng 10/2026, đợt 1", back); a `SegmentedControl` "Ngôn ngữ thông báo phí" (Tiếng Việt, English); a company strip (a plate with initials, "Công ty Quản lý Mộc Miên", "Phát hành 01/10/2026, hotline …"); a `BillSlip` (unit, period, due, status chip, lines, total, "Thanh toán"); the section "Cách nộp phí" with three `ListItem`s (in-app payment, bank transfer, cash at the office); a `Button` outline "Tải thông báo phí PDF".

Do not copy:

- The button "Tải thông báo phí PDF": there is no resident endpoint for the fee-notice PDF (DOC-34 §6.3: "residents read their fees in the app"); it is removed (DR-323). The receipt PDF is another thing and has its own button (below).
- "Qua VNPay hoặc VietQR" (N1): P3 shows the methods of the configured provider (VietQR).
- The bank line "[NGÂN HÀNG], số tài khoản …, nội dung A1508 T10 D1": no building field holds a collection account for manual transfers (the fee notice has no such line, DOC-34 §6.1), and a transfer content that is not an intent's `TT…` code (DR-27) would be matched to nothing. The line is omitted until the Owner supplies the data (then a DR).
- "Phát hành … hotline [HOTLINE]" with a placeholder: the strip reads the company name and hotline from E-15, and the issue date from `batch.publishedAt`.
- The unit measure in the line detail ("14 m³ × 12.000 đ"), as in `Fees`.

### 4. Regions and components

| Region | Components | Source |
| --- | --- | --- |
| Top | `TopBar` (title `res.fee.title`, subtitle = the batch name in the app language, back) | E-81 `batch.name` |
| Language | `SegmentedControl` `vi` / `en`, default = the app language; changes the language of the item names on this screen only | local |
| Company strip | initials `Plate` + name + "Phát hành {date}, hotline {hotline}" | E-15 `contact`, E-81 `batch.publishedAt` |
| Bill | `BillSlip`: unit code, period "{batch.code}, đợt {n}", due, chip (as `Fees`), `lines[]`, total | E-81 |
| Adjustment lines | a line with `kind = adjustment` shows its `note` under the name and a negative amount "−35.175 đ" in `danger`-free ink (not red: an adjustment is not an error) | E-81 `lines[].note` |
| How to pay | `List` of `ListItem`s, each present only if its source exists: **(P3)** "Thanh toán trong ứng dụng" (a gateway is `active` and the member has `pay`); "Tiền mặt tại văn phòng BQL" (`contact.workingHours` set: "Tầng …, {hours}" — the floor is not stored, so the item reads "Văn phòng BQL, {hours}") | E-15, E-13 |
| Receipt | for a `paid` charge: a `Button` outline "Xem biên lai" and the receipt number | E-81 `receipt {id, number}` |
| Status banner | `Banner` for `paid` ("Đã thanh toán ngày {date}, {method}") and for `void` ("Khoản phí này đã bị thu hồi") | E-81 |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The charge | E-81 `GET /me/fees/{chargeId}` | `['unit', unitId, 'fees', 'charge', chargeId]` | fields: `status` (`open`, `paid`, `void`), `batch {code, name, feeMonth, ordinal, publishedAt, dueDate}`, `amount`, `daysPastDue`, `lines[]`, and for `paid` `payment {receivedAt, method}` and `receipt {id, number}`. A `paid` or `void` charge older than `startedAt` is 404 (DOC-22 §8.4) |
| Contact | E-15 | `['contact']` | cached |

The first paint uses the card data already in the list cache (`placeholderData` from the `['unit', unitId, 'fees', 'open']` item with the same id), so nothing jumps when E-81 answers.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Toggle the language | none | item names switch between `itemName.vi` and `itemName.en` (falls back to `vi` when `en` is null) |
| "Xem biên lai" (paid) | E-84 `GET /me/receipts/{id}/pdf` with the bearer token | the PDF is downloaded to the cache and opened in the system viewer (DOC-55 §12); 404 → "Không tìm thấy biên lai" and the row is refetched; the PDF may be rendered on demand and take a few seconds (DOC-34 §8.2): the button shows a spinner after 150 ms |
| Back | none | previous screen |
| **(P3)** "Thanh toán" | none | `Pay-Select` with this charge selected |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | Skeleton of the strip and the bill (with the list data as placeholder when present) |
| `open` | As §4 |
| `paid` | The bill with a success banner; no "How to pay"; the receipt button |
| `void` | A `warning` banner "Khoản phí này đã bị thu hồi"; the bill is shown muted and without a chip |
| `gone` | 404 (a charge outside the member's history window, or a wrong id): the not-found state of DOC-68 with a button back to `Fees` |
| `error`, `offline`, `forbidden` | DOC-68; offline shows the cached charge |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.fee.title` | Thông báo phí | Fee notice |
| `res.fee.lang.label` | Ngôn ngữ thông báo phí | Fee notice language |
| `res.fee.lang.vi` | Tiếng Việt | Tiếng Việt |
| `res.fee.lang.en` | English | English |
| `res.fee.issued` | Phát hành {date}, hotline {hotline} | Issued {date}, hotline {hotline} |
| `res.fee.issued.nohotline` | Phát hành {date} | Issued {date} |
| `res.fee.period` | {code}, đợt {ordinal} | {code}, batch {ordinal} |
| `res.fee.line.qty` | {quantity} × {unitPrice} | {quantity} × {unitPrice} |
| `res.fee.howto.title` | Cách nộp phí | How to pay |
| `res.fee.howto.office` | Nộp tại văn phòng Ban quản lý, {hours} | Pay at the management office, {hours} |
| `res.fee.paid.banner` | Đã thanh toán ngày {date}, {method} | Paid on {date}, {method} |
| `res.fee.method.cash` | tiền mặt tại BQL | cash at the office |
| `res.fee.method.bank_transfer` | chuyển khoản | bank transfer |
| `res.fee.method.online` | thanh toán trong ứng dụng | in the app |
| `res.fee.void.banner` | Khoản phí này đã bị thu hồi. | This fee was withdrawn. |
| `res.fee.receipt.open` | Xem biên lai | View receipt |
| `res.fee.receipt.number` | Biên lai {number} | Receipt {number} |
| `res.fee.receipt.missing` | Không tìm thấy biên lai. | The receipt was not found. |
| `res.fee.gone` | Không tìm thấy khoản phí này. | This fee was not found. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-12 | **G** an open charge with 4 lines (total 2,488,000) **W** `Fee-Detail` opens **T** the four lines show `quantity × unitPrice` and the total reads "2.488.000 đ" | maestro |
| UIRF-13 | **G** a charge with an adjustment line −35,175 "Trừ phí nước tính thừa tháng 9" **W** it renders **T** the line shows the note and "−35.175 đ", and the total is the sum | api, maestro |
| UIRF-14 | **G** the toggle on English **W** it is tapped **T** the item names switch to `itemName.en`, the app language is unchanged, and a line with no English name keeps the Vietnamese one | maestro |
| UIRF-15 | **G** a P2 build **W** the screen is inspected **T** no button to download a fee notice PDF exists, and "How to pay" lists the office only (when `workingHours` is set) | maestro |
| UIRF-16 | **G** a paid charge with a receipt **W** "Xem biên lai" is tapped **T** `GET /me/receipts/{id}/pdf` is sent once and the PDF opens | maestro |
| UIRF-17 | **G** a charge paid before the member's `startedAt` **W** its URL is opened **T** E-81 answers 404 and the not-found state shows | api, maestro |
| UIRF-18 | **G** a recalled (void) charge opened from an old push **W** the screen loads **T** it shows the withdrawn banner, or the not-found state when E-81 answers 404, and never an error screen | api, maestro |
| UIRF-19 | **G** the list was loaded **W** a card is tapped **T** the title and the lines show at once from the list cache, and nothing moves when E-81 answers | maestro |

### 10. E2E cases

Maestro: `fee-detail.yaml` (UIRF-12, 14, 15, 19), `fee-receipt.yaml` (UIRF-16). UIRF-13, 17, 18 are API tests of E-81 with one screen assertion each.

### 11. Open questions

None. The collection account for manual transfers is not drawn (§3); it is an Owner input, not a question for this document.

---

## Fee-History

> Status: Draft · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5, PS-6, PS-7 (`view_fees`). UC-03 "see what I paid", DR-17 (the receipt of each allocation), DR-40: history and payer names only from the start of the caller's membership. The Owner has `startedAt` at the unit's first membership; a tenant added in October does not see September's payments.

### 2. URL and search params

`/fees?view=history` (the second segment of the tab). A row opens `/fees/[chargeId]`.

### 3. Prototype

Canvas artboard `Fee-History` (title "Lịch sử đợt phí và công nợ", 390 × 1160): the shell of `Fees` with the segment "Lịch sử" selected; a `Card` with "Công nợ hiện tại 2.838.000 đ", a divider and "Đã thanh toán năm 2026 21.946.000 đ"; then one section per fee month ("Phí tháng 9/2026", "… 8/2026", "… 7/2026"), each a `List` of `ListItem`s (a teal receipt icon, "Đợt 1", "Trả 12/09, VietQR", the amount).

Do not copy:

- "VNPay" in a sample row subtitle (N1): the subtitle shows the recorded method as data (`cash`, `bank_transfer`, `online`), never a provider name.
- The receipt codes of the money log (`PT-0915-0118`, N4) if they appear: the receipt number is `BL-2610-0153`.
- The row title "Đợt 2, sửa cửa cuốn hầm B1": the title is "Đợt {ordinal}" and the batch name follows when it adds information (not for a plain "Phí tháng 8/2026, đợt 1").
- A figure "Đã thanh toán năm 2026" computed over all payments: it is limited to the member's window (see §5).

### 4. Regions and components

| Region | Components | Source |
| --- | --- | --- |
| Summary card | `Card`: "Công nợ hiện tại" (the open total), a divider, "Đã thanh toán năm {year}" | E-82 `summary` |
| Month sections | `h2` "Phí tháng {m}/{y}" + `List` of `ListItem` (icon `receipt`, tone teal, title, subtitle, amount `value`) | E-82 items |
| Row | title "Đợt {ordinal}" (+ the batch name after a comma when it is not the default), subtitle "Trả {dd/MM}, {method}", value = the charge amount | E-82 |
| Load more | an infinite list; a footer spinner while the next page loads | E-82 cursor |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Paid charges | E-82 `GET /me/fees/history?cursor=` | `['unit', unitId, 'fees', 'history']` (`useInfiniteQuery`, 20 per page) | newest first by `(receivedAt, id)`; items: `chargeId`, `batch {code, name, feeMonth, ordinal}`, `amount`, `payment {receivedAt, method}`, `receipt {id, number}`; only payments with `received_at >= startedAt` (DR-40). The first page also carries `summary {outstanding, paidThisYear}` (DR-323): `paidThisYear` is the sum of those payments in the building's current year, inside the same window |
| Receipts list | E-83 | not used by this screen | the unit's receipt list is a P2 API for the receipt view (P2-17); the history rows reach a receipt through `Fee-Detail` |

### 6. Interactions

| Action | Result |
| --- | --- |
| Tap a row | `Fee-Detail` for the charge (it shows the receipt button) |
| Scroll to the end | next page (E-82 with `cursor`); `400 invalid_cursor` → refetch the first page |
| Pull to refresh | the first page |
| Tap the segment "Cần thanh toán" | `view=due` |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | Skeleton of the summary card and two month sections |
| `loaded` | As §4 |
| `empty` | `EmptyState` "Chưa có khoản thanh toán nào" when the window has no payment (a new member sees this even if the unit paid before them); the summary card still shows the open total |
| `paging` | A footer spinner (after 150 ms) while the next page loads |
| `error`, `offline`, `forbidden` | DOC-68; offline shows the pages already loaded |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.history.outstanding` | Công nợ hiện tại | Current balance due |
| `res.history.paid-year` | Đã thanh toán năm {year} | Paid in {year} |
| `res.history.row.title` | Đợt {ordinal} | Batch {ordinal} |
| `res.history.row.title.named` | Đợt {ordinal}, {name} | Batch {ordinal}, {name} |
| `res.history.row.sub` | Trả {date}, {method} | Paid {date}, {method} |
| `res.history.empty` | Chưa có khoản thanh toán nào. | No payments yet. |
| `res.history.empty.hint` | Lịch sử bắt đầu từ ngày bạn được thêm vào căn hộ. | History starts on the day you were added to the unit. |

(The method words are `res.fee.method.*` of `Fee-Detail`.)

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-20 | **G** payments in July, August (two) and September **W** `view=history` opens **T** three month sections in descending order, the August section lists two rows, each subtitle shows the date and the recorded method | maestro |
| UIRF-21 | **G** a tenant added on 2026-10-01 and payments dated 2026-09-12 and 2026-10-05 **W** the tenant opens history **T** only the October payment shows, and `paidThisYear` counts only it; an Owner sees both | api, maestro |
| UIRF-22 | **G** 45 paid charges **W** the user scrolls to the end twice **T** E-82 is called three times with the cursor of the previous page and no row repeats | api, maestro |
| UIRF-23 | **G** the summary **W** the history opens **T** "Công nợ hiện tại" equals the total of `Fees` for the unit | api, maestro |
| UIRF-24 | **G** a payment recorded as `bank_transfer` and one as `online` **W** the rows render **T** the subtitles say "chuyển khoản" and "thanh toán trong ứng dụng", and no provider name appears | maestro |
| UIRF-25 | **G** a voided payment (E-105) **W** history reloads **T** the charge is no longer listed as paid and appears in `Fees` as open again | api, maestro |
| UIRF-26 | **G** a unit with no payment in the window **W** the history opens **T** the empty state shows with the hint, and the summary card is still there | maestro |

### 10. E2E cases

Maestro: `fees-history.yaml` (UIRF-20, 24, 26). UIRF-21, 22, 23 and 25 are API tests of E-82 with one screen assertion.

### 11. Open questions

None.

---

## The payment screens (P3)

`Pay-Select`, `Pay-VietQR`, `Pay-Done` and `Pay-Mismatch` are specified when P3-00 starts, from E-85…E-88, DOC-23 and DOC-24. Their rows in the screens index (DOC-56 §3) and the notes N1 and N4 stay the contract until then. Their test IDs continue after `UIRF-26` and their keys are `res.pay.*`.

## Decisions made while writing

Recorded as DR-323 (decided, Claude delegated by the Owner; none touches money or access).

| Part of DR-323 | Decision | Where used |
| --- | --- | --- |
| Lines in the list | E-80 returns `lines[]` for each charge, so a card needs no second request; E-81 returns the same lines | `Fees` §5 |
| No payment in P2 | No pay button, QR or method is drawn or disabled in a P2 build; the caption sends the resident to the office | `Fees`, `Fee-Detail` |
| No fee-notice PDF for residents | The canvas button is removed (DOC-34 §6.3); the receipt PDF stays | `Fee-Detail` |
| No bank-account line | No field holds a collection account; the line is omitted until the Owner supplies it | `Fee-Detail` |
| Status chip | Thresholds from `daysPastDue`: overdue, today, 1–7 days left (warning), more (neutral) | `Fees` |
| History summary | E-82 carries `summary {outstanding, paidThisYear}` inside the member's window | `Fee-History` |

## Not in this document

| Topic | Lives in |
| --- | --- |
| What a resident may see by membership date | DOC-22 §8.4, DOC-27 §6.6 |
| The payment screens | DOC-58 (P3), DOC-23 |
| The staff view of the same charges | DOC-66 |
| The receipt PDF and its render | DOC-34 §7, §8.2 |
| The push for a new batch or a paid charge | DOC-31, DOC-44 |
| Shared states, errors, forbidden, offline | DOC-68 |

## Traceability

| Screen | Requirements | Decisions | Tests |
| --- | --- | --- | --- |
| `Fees` | FR-03, FR-06.5, FR-12.3, NFR-03 | DR-18, DR-20, DR-174, DR-196, DR-323 | `UIRF-01…08` |
| `Fees-NoPay` | FR-03, FR-07.1 | DR-40, DR-72 | `UIRF-09…11` |
| `Fee-Detail` | FR-03, FR-12.3, FR-36 | DR-19, DR-40, DR-323 | `UIRF-12…19` |
| `Fee-History` | FR-06.5 | DR-17, DR-40, DR-323 | `UIRF-20…26` |

## Open questions

None for the four P2 screens. The payment screens raise theirs in P3.
