# Resident app: fees and payment

> Status: **Approved** (Owner, 2026-11-02) · Updated: 2026-11-04 (DR-335: links to the artboards) · 2026-11-02 (approved by the Owner) · 2026-11-01 (DR-325…328: online payment is in P2 with Stripe; `Pay-Select`, `Pay-Redirect`, `Pay-Done`, `Pay-Failed`, `Cards` written; the pay buttons and the fee-notice PDF are back; DR-323 revised) · 2026-11-01 (P1-27: the four fee screens written; DR-323) · DOC-58
> Depends on: original SDD §5.1, §18, [DR](../../00-decision-register.md) (DR-16, 18, 19, 40, 41…47, 72, 84, 174, 194, 196, 200, 323, 325, 326, 328), [DOC-56](README.md) (convention, notes N1, N4, N6, N10), [DOC-53](../ux-principles-and-ia.md) §3.4, §5, [DOC-55](../client-architecture.md) §5…§7, §10, §11, §12, [DOC-54](../design-system.md) (components), [DOC-22](../../06-design/ledger-and-allocation.md) §8, [DOC-27](../../06-design/residency-and-memberships.md) §3.2, §6.6, [DOC-34](../../06-design/pdf-rendering.md) §6.3, §8.2, [DOC-23](../../06-design/payment-intents-and-settlement.md) §3…§5, [DOC-24](../../06-design/payment-gateway-drivers.md) §2, §4, [DOC-51](../../07-api/api-endpoints.md) (E-80…E-84, E-15, E-13), [DOC-57](resident-signin-home.md) (the home card and tile)
> Main readers: P2-17 (receipt view and PDF in the resident app), P2-15 (the resident fee API), P2-16, P2-25 (the payment screens; was P3-05), P1-09 (catalog keys), DOC-68, DOC-88 (`UIRF-`)

This document specifies the resident screens that show what a unit owes and has paid. **All are P2.** The four fee screens (`Fees`, `Fees-NoPay`, `Fee-Detail`, `Fee-History`) and the payment screens (`Pay-Select`, `Pay-Redirect`, `Pay-Done`, `Pay-Failed`, `Cards`) are written. Online payment is in P2 and Stripe is the first gateway (DR-325); the screens render the **presentation** a driver returns (`redirect` or `qr`, DOC-24 §2), so `Pay-VietQR` and `Pay-Mismatch` are kept for a bank-transfer driver and are written when one is added. The reference for layout and UX is the canvas (<https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj>, design system "Hiên"); this file adds data, interactions, states, copy keys and acceptance criteria (DR-194). Tokens and components are DOC-54, navigation DOC-53, the shared states DOC-68, the API DOC-51, and what a resident may see by membership DOC-22 §8.4.

**The design is a reference (DR-335).** The artboard of a screen, linked from the table below and from its "Prototype" part, is the reference for its layout and UX. Components and visual styling follow the project's design system ([DOC-54](../design-system.md)), not the artboard. See the artboards rendered on the [canvas](https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj); the files and their index are in [`references/design-canvas/`](../../references/design-canvas/README.md). A "Do not copy" note and [DOC-56 §5](README.md#5-prototype-deviations-what-a-screen-document-must-not-copy) say what not to take from one.

## Screens in this file

| Section | Screen | Role or member type | Phase | Prototype |
| --- | --- | --- | --- | --- |
| [`Fees`](../../references/design-canvas/Fees.dc.html) | Open charges of the unit, grouped by fee month | Owner, Family member, Tenant (`view_fees`) | P2 | designed |
| [`Fees-NoPay`](../../references/design-canvas/Fees-NoPay.dc.html) | The same list for a tenant who may not pay: a banner, no pay buttons | Tenant without `can_pay` | P2 | designed |
| [`Fee-Detail`](../../references/design-canvas/Fee-Detail.dc.html) | One charge: lines, total, due date, how to pay | Owner, Family member, Tenant | P2 | designed |
| [`Fee-History`](../../references/design-canvas/Fee-History.dc.html) | Paid charges by fee month, with the receipt | Owner, Family member, Tenant | P2 | designed |
| [`Pay-Select`](../../references/design-canvas/Pay-Select.dc.html) | Choose the charges to pay and see the total | Member with `pay` | P2 | designed (changed, see section) |
| `Pay-Redirect` | The wait while the hosted payment page is open | Member with `pay` | P2 | to design (new, replaces `Pay-VietQR` for a redirect driver) |
| [`Pay-Done`](../../references/design-canvas/Pay-Done.dc.html) | Payment confirmed, one receipt per charge | Member with `pay` | P2 | designed |
| `Pay-Failed` | The payment expired, was cancelled or failed | Member with `pay` | P2 | to design (new) |
| `Cards` | Cards saved at the payment provider: list and remove | Member with `pay` | P2 | to design (new) |
| [`Pay-VietQR`](../../references/design-canvas/Pay-VietQR.dc.html) | The dynamic QR of a bank-transfer driver | Member with `pay` | with a QR driver | designed — section owed |
| `Pay-Mismatch` | A state of `Pay-VietQR`: a transfer of another amount arrived | Member with `pay` | with a QR driver | to design — section owed |

**What every screen here shares.** All read the unit chosen in `Unit-Pick` (header `X-Unit-Id`, DOC-55 §5); every query key starts with `['unit', unitId, 'fees', …]`, so a unit switch drops the data of the old unit with no flash of it (UIRQ-02). The capability is `view_fees` (owner, family member, tenant); a helper has no tab "Phí" and a direct URL answers 403 `forbidden` and the generic forbidden state of DOC-68. A **charge** is one unit's bill in one batch; the resident word is "đợt" (batch) for the whole bill and "khoản" for a line. Money is shown as `2.838.000 đ` (Vietnamese) or `2,838,000 đ` (English), never as a decimal (DOC-14 §8). Dates are building-local `dd/MM/yyyy`, and "today" is the building's day (DR-09).

**Payment is in P2 (DR-325).** A member with `pay` sees the pay buttons when the building has an active gateway; the list answer carries `payment {enabled, presentation, savedMethods, limits}` (E-80) so the app draws a button only when a payment can really start, and a building with no gateway configured shows the office caption instead (DR-326). The resident's word for a method comes from the presentation ("Thanh toán bằng thẻ" for `redirect`, "Chuyển khoản VietQR" for `qr`), never from the provider's name. Nothing in these screens depends on Stripe: another driver changes no screen except the one that renders its presentation.

---

## Fees

> Status: Approved · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5 Owner, PS-6 Family member, PS-7 Tenant (DOC-02). UC-03 (the reading that comes before paying), FR-03 (members who see fees), FR-12.3 (what counts as debt: open charges only), FR-06.5 (the charges of a voided payment are open again), DR-18 (outstanding), DR-40 (open charges are always visible). Capability `view_fees`. The tab "Phí" exists for these three member types in P2 (DOC-57 card matrix); the "Fee card" of the home links here.

### 2. URL and search params

`/fees` (the tab "Phí" of `(app)/(tabs)`), search `view` = `due` (default) or `history`. `view=history` is the `Fee-History` section below; both are one route with a segmented control (the canvas has the same layout), so the tab bar, the title and the bell stay still when the segment changes. Deep link from a push `fee.batch_published` (DOC-31): `/fees?focus=<chargeId>` scrolls to the card of that charge and highlights it for 2 seconds.

### 3. Prototype

Canvas artboard [`Fees`](../../references/design-canvas/Fees.dc.html) (title "Phí cần thanh toán", 390 × 1560, scrolls). Regions: `Glow`; large `TopBar` ("Phí", subtitle "Căn hộ A-1508") with the bell `IconButton` and its count; `SegmentedControl` "Cần thanh toán | Lịch sử"; a line "Còn phải thanh toán, 2 đợt" with the total "2.838.000 đ"; a section titled with the fee month ("Phí tháng 10/2026") holding one `BillSlip` per batch (period "Đợt 1, phát hành 01/10", due "Hạn thanh toán 15/10/2026", a status chip "Còn 6 ngày", the lines, the total, the button "Thanh toán đợt này"); a `Button` tonal "Thanh toán nhiều đợt cùng lúc" with a caption; `TabBar` with the center QR action.

Do not copy:

- The caption's "nộp một phần" (N6, DR-84): there is no partial payment. The pay buttons stay (DR-325) and are drawn when `payment.enabled` and the member has `pay`.
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
| Pay buttons | `Button` "Thanh toán đợt này" on each card and tonal "Thanh toán nhiều đợt cùng lúc" under the list, only when `payment.enabled` and the member has `pay` | E-80 `payment` |
| How to pay caption | one muted paragraph under the list, with a link "Liên hệ BQL" to `Contact`; shown when no pay button is drawn | local, E-15 |
| Saved cards link | `ListItem` "Thẻ đã lưu" to `Cards`, when `payment.savedMethods` | E-80 `payment` |
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
| Open charges | E-80 `GET /me/fees` | `['unit', unitId, 'fees', 'open']` | all `open` charges of the unit, whatever the membership date (DOC-22 §8.4). Items: `chargeId`, `batch {code, name {vi,en}, feeMonth, ordinal}`, `amount`, `dueDate`, `daysPastDue`, `overdue`, `lines[]` (DR-323). Plus `total`, `count` and `payment {enabled, presentation, savedMethods, limits}` (DR-326). `staleTime` 30 s; refetched on focus after 30 s and on the push `fee.batch_published`, `fee.charge_paid`, `fee.batch_recalled` |
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
| "Thanh toán đợt này" / "Thanh toán nhiều đợt cùng lúc" | `Pay-Select` with that charge / all open charges selected |
| "Thẻ đã lưu" | `Cards` |

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
| `res.fees.howto` | Mỗi đợt thanh toán đủ số tiền. Muốn nộp tiền mặt, bạn liên hệ Ban quản lý. | Each batch is paid in full. To pay in cash, contact the management office. |
| `res.fees.pay.one` | Thanh toán đợt này | Pay this batch |
| `res.fees.pay.many` | Thanh toán nhiều đợt cùng lúc | Pay several batches at once |
| `res.fees.cards.link` | Thẻ đã lưu | Saved cards |
| `res.fees.howto.link` | Liên hệ BQL | Contact the office |
| `res.fees.empty.title` | Căn hộ không còn khoản phí nào cần thanh toán | This unit has no fees to pay |
| `res.fees.empty.last` | Lần thanh toán gần nhất: {date} | Last payment: {date} |
| `res.fees.more` | Còn nữa, hãy liên hệ Ban quản lý. | There are more; contact the office. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-01 | **G** A-1508 with two open charges (2,488,000 and 350,000) **W** `Fees` opens **T** the summary says "Còn phải thanh toán, 2 đợt" and "2.838.000 đ", the tab badge shows 2, and the cards are in due-date order | maestro |
| UIRF-02 | **G** a charge due in 6 days, one due in 16, one 3 days overdue **W** the list renders **T** the chips are "Còn 6 ngày" (warning), "Còn 16 ngày" (neutral) and "Quá hạn 3 ngày" (danger), and the summary adds "Trong đó quá hạn" | api, maestro |
| UIRF-03 | **G** an owner and a building with an active gateway **W** `Fees` is inspected **T** each card has "Thanh toán đợt này", the tonal button pays all open charges, no text says "nộp một phần", and a building with no gateway shows the office caption and no pay button | api, maestro |
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

> Status: Approved · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-7 Tenant whose owner has not allowed payment (`can_pay` false, DOC-27 §3.2). UC-03 read-only, FR-07.1 (who may pay), FR-03. Capability `view_fees` without `pay`. The same route and the same data as `Fees`; the section exists because the canvas draws it and the screen differs in one block and in what P3 adds.

### 2. URL and search params

`/fees` (the same route). The variant is chosen by the session's capabilities: `pay` absent. A tenant whose owner later enables `can_pay` sees `Fees` on the next E-13 refresh (the capability list comes with the session, DOC-27 §6.6).

### 3. Prototype

Canvas artboard [`Fees-NoPay`](../../references/design-canvas/Fees-NoPay.dc.html) (title "Người thuê không trả phí: Phí", 390 × 1240): the same shell as `Fees` with a neutral `Banner` at the top ("Chủ hộ thanh toán phí của căn này", "Bạn xem được các đợt phí và biên lai. Muốn tự thanh toán, bạn nhờ chủ hộ bật quyền thanh toán cho bạn."), the segmented control, and two sections: "Phí tháng 10/2026" with a `BillSlip` of status "Còn 6 ngày" and the sentence "Chủ hộ thanh toán đợt phí này. Bạn nhận thông báo khi đợt phí được thanh toán.", and "Phí tháng 9/2026" with a **paid** `BillSlip` ("Đã thanh toán", "Xem biên lai").

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

> Status: Approved · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5, PS-6, PS-7 (`view_fees`). UC-03 step "read the bill", FR-03, FR-36 (the notice shows lines, total, due date and how to pay), FR-12.3. An `open` charge is always readable; a `paid` charge only if its payment is not older than the member's `startedAt` (DR-40, DOC-22 §8.4).

### 2. URL and search params

`/fees/[chargeId]` (a stack screen over the tab). No search params; the language toggle is local state. From a push (`fee.batch_published`, `fee.charge_paid`) and from `Fee-History` rows.

### 3. Prototype

Canvas artboard [`Fee-Detail`](../../references/design-canvas/Fee-Detail.dc.html) (title "Thông báo phí", 390 × 1480): `TopBar` ("Thông báo phí", subtitle "Phí tháng 10/2026, đợt 1", back); a `SegmentedControl` "Ngôn ngữ thông báo phí" (Tiếng Việt, English); a company strip (a plate with initials, "Công ty Quản lý Mộc Miên", "Phát hành 01/10/2026, hotline …"); a `BillSlip` (unit, period, due, status chip, lines, total, "Thanh toán"); the section "Cách nộp phí" with three `ListItem`s (in-app payment, bank transfer, cash at the office); a `Button` outline "Tải thông báo phí PDF".

Do not copy:

- Nothing is removed for the button "Tải thông báo phí PDF": the Owner wants it (DR-328), so the screen keeps it and E-183 serves it. A line beside the button says the notice shows the amount at publish, not whether it is paid.
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
| How to pay | `List` of `ListItem`s, each present only if its source exists: "Thanh toán trong ứng dụng" (a gateway is `active` and the member has `pay`); "Tiền mặt tại văn phòng BQL" (`contact.workingHours` set: "Tầng …, {hours}" — the floor is not stored, so the item reads "Văn phòng BQL, {hours}") | E-15, E-13 |
| Notice PDF | `Button` outline "Tải thông báo phí PDF" with the muted line `res.fee.pdf.note`; for an `open` or `paid` charge | E-183 |
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
| "Tải thông báo phí PDF" | E-183 `GET /me/fees/{chargeId}/pdf?lang=` | the PDF is downloaded to the cache and opened in the system viewer, in the language of the toggle; spinner after 150 ms; 404 → the not-found state |
| "Thanh toán" (open charge, `pay`) | none | `Pay-Select` with this charge selected |

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
| `res.fee.pdf` | Tải thông báo phí PDF | Download the fee notice (PDF) |
| `res.fee.pdf.note` | Thông báo ghi số tiền lúc phát hành, không cho biết đã thanh toán hay chưa. | The notice shows the amount at publication, not whether it is paid. |
| `res.fee.howto.app` | Thanh toán trong ứng dụng, gạch nợ ngay khi thành công | Pay in the app; your balance updates as soon as it succeeds |
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
| UIRF-15 | **G** an open charge **W** "Tải thông báo phí PDF" is tapped **T** `GET /me/fees/{chargeId}/pdf` is sent once and the PDF opens; a `void` charge answers 404 | api, maestro |
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

> Status: Approved · Prototype: designed · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5, PS-6, PS-7 (`view_fees`). UC-03 "see what I paid", DR-17 (the receipt of each allocation), DR-40: history and payer names only from the start of the caller's membership. The Owner has `startedAt` at the unit's first membership; a tenant added in October does not see September's payments.

### 2. URL and search params

`/fees?view=history` (the second segment of the tab). A row opens `/fees/[chargeId]`.

### 3. Prototype

Canvas artboard [`Fee-History`](../../references/design-canvas/Fee-History.dc.html) (title "Lịch sử đợt phí và công nợ", 390 × 1160): the shell of `Fees` with the segment "Lịch sử" selected; a `Card` with "Công nợ hiện tại 2.838.000 đ", a divider and "Đã thanh toán năm 2026 21.946.000 đ"; then one section per fee month ("Phí tháng 9/2026", "… 8/2026", "… 7/2026"), each a `List` of `ListItem`s (a teal receipt icon, "Đợt 1", "Trả 12/09, VietQR", the amount).

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

---

## Pay-Select

> Status: Approved · Prototype: designed (changed by N1, N4, DR-325) · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5 Owner, PS-6 Family member, PS-7 Tenant with `can_pay`. UC-03 steps 1 to 3, FR-07.1 (who may pay), FR-07.2 (whole charges only), FR-07.4 (a second member meets an open payment), FR-07.6 (amount limits), FR-07.7 (abuse limit). Capability `pay`. A tenant without `can_pay` and a helper never see the screen (403 `forbidden`).

### 2. URL and search params

`/fees/pay` (a stack screen over the tab). Search: `charges` (comma-separated charge ids to preselect; none means all open charges).

### 3. Prototype

Artboard [`Pay-Select`](../../references/design-canvas/Pay-Select.dc.html) (title "Chọn đợt và hình thức thanh toán"): a back `TopBar`; a list of batches with a check per row (period, due date, amount); a "Hình thức" block with VietQR and a second, VNPay row; a total bar and a primary "Thanh toán {amount}".

Do not copy:

- The VNPay row (N1): the method comes from the building's active gateway; the screen shows **one** method, named by its presentation, never a provider list.
- "Chọn hình thức" as a choice: with one gateway there is nothing to choose; the block is one line that names the method and, for a card, says "Bạn có thể lưu thẻ ở trang thanh toán".
- A partial amount or an "other amount" field (DR-84): a batch is paid whole.
- The sample codes and amounts.

### 4. Regions and components

| Region | Components | Source |
| --- | --- | --- |
| Top | `TopBar` back, title `res.pay.select.title` | local |
| Charges | `List` of selectable `BillSlip`-style rows: period "Đợt {n}", batch name, due chip, amount; at least one must stay checked | E-80 |
| Method | `ListItem` with the method line (`res.pay.method.redirect` or `.qr`) | E-80 `payment.presentation` |
| Holder notice | `Banner` neutral "{name} đã bắt đầu thanh toán lúc {time}" with "Tiếp tục thanh toán" when a household member holds an intent (409 `payment_in_progress`, or the same set returned) | E-85 |
| Total bar | sticky: "Tổng {amount}" and `Button` primary "Thanh toán {amount}" | local |

### 5. Data

The list of E-80 (already cached under `['unit', unitId, 'fees', 'open']`) is the data; the screen makes no request until the button. The limits (`payment.limits {min, max}`) come with E-80.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| Check / uncheck a charge | none | the total updates; the button disables below `limits.min` with `res.pay.select.min` and above `limits.max` with `res.pay.select.max` |
| "Thanh toán {amount}" | E-85 `POST /me/payments/intents` `{chargeIds}` with `Idempotency-Key` (one per press of the screen) | 201: `Pay-Redirect` (or `Pay-VietQR` for a `qr` presentation) with the intent; **200 "started by"**: the same selection already has an intent of the household: the screen goes to it with `startedBy` shown |
| E-85 errors | | 409 `payment_in_progress {holder, startedAt, intentId}` → the holder `Banner` and "Tiếp tục thanh toán" opens that intent; 409 `charge_changed` → the list refetches and the screen says a charge was paid or voided; 400 `amount_below_minimum`, `amount_above_maximum`; 403 `forbidden` (no `pay`); 429 `rate_limited` ("Bạn thao tác quá nhanh. Thử lại sau ít phút."); 502 `gateway_unavailable` → "Chưa kết nối được cổng thanh toán. Thử lại sau." and the intent is `failed`, no charge held |

### 7. States

| State | Screen |
| --- | --- |
| `ready` | rows checked, total shown, button enabled |
| `below minimum` / `above maximum` | the total in `danger` ink with the reason, button disabled |
| `holder` | the holder banner; the button reads "Tiếp tục thanh toán" |
| `submitting` | button disabled, spinner after 150 ms; the rows stay |
| `error`, `offline`, `forbidden` | DOC-68; offline disables the button |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.pay.select.title` | Thanh toán | Pay |
| `res.pay.select.charges` | Chọn các đợt thanh toán | Choose the batches to pay |
| `res.pay.method.redirect` | Thanh toán bằng thẻ. Bạn có thể lưu thẻ ở trang thanh toán. | Pay by card. You can save the card on the payment page. |
| `res.pay.method.qr` | Chuyển khoản VietQR | VietQR bank transfer |
| `res.pay.select.total` | Tổng {amount} | Total {amount} |
| `res.pay.select.cta` | Thanh toán {amount} | Pay {amount} |
| `res.pay.select.continue` | Tiếp tục thanh toán | Continue the payment |
| `res.pay.select.holder` | {name} đã bắt đầu thanh toán lúc {time}. | {name} started a payment at {time}. |
| `res.pay.select.min` | Số tiền tối thiểu là {amount}. | The minimum is {amount}. |
| `res.pay.select.max` | Số tiền tối đa là {amount}. Hãy bỏ bớt một đợt. | The maximum is {amount}. Remove a batch. |
| `res.pay.select.changed` | Có khoản phí đã được thanh toán hoặc thu hồi. Danh sách đã được cập nhật. | A fee was paid or withdrawn. The list has been updated. |
| `res.pay.select.gateway` | Chưa kết nối được cổng thanh toán. Thử lại sau. | The payment service is not reachable. Try again later. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-27 | **G** an owner with two open charges **W** the screen opens **T** both are checked, the total is their sum, and one method line is shown with no provider name | maestro |
| UIRF-28 | **G** one charge unchecked **W** the button is pressed **T** E-85 is sent with that one `chargeId` and one `Idempotency-Key` | api, maestro |
| UIRF-29 | **G** a total below the minimum **W** the screen shows **T** the button is disabled with the minimum message and no request is sent | maestro |
| UIRF-30 | **G** the owner started an intent for A and B **W** a family member selects A and B **T** E-85 returns the same intent ("started by" the owner) and the app opens it | api, maestro |
| UIRF-31 | **G** the family member selects only A **W** the button is pressed **T** 409 `payment_in_progress` shows the holder banner with the owner's name and time | api, maestro |
| UIRF-32 | **G** a charge is paid in cash while the screen is open **W** the button is pressed **T** 409 `charge_changed` refreshes the list with the message and nothing is held | api, maestro |
| UIRF-33 | **G** a tenant without `can_pay` **W** `/fees/pay` is opened **T** the forbidden state shows and E-85 answers 403 | api, maestro |

### 10. E2E cases

Maestro with the fake gateway: `pay-select.yaml` (UIRF-27, 28, 29), `pay-two-phones.yaml` (UIRF-30, 31); UIRF-32 and 33 are API tests with one assertion each.

### 11. Open questions

None.

---

## Pay-Redirect

> Status: Approved · Prototype: to design (a wireframe below; replaces `Pay-VietQR` for a redirect driver) · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

As `Pay-Select`. UC-03 steps 4 to 8, FR-08.4 (visible quickly), FR-08.7 (receipt on screen), FR-10.3 ("I have transferred" brings the check forward).

### 2. URL and search params

`/fees/pay/[intentId]`. The deep link `rms-resident://pay/return?intent=<id>&result=success|cancel` opens this route (DOC-55 §7). A return is never trusted: the screen decides from the intent status.

### 3. Wireframe

```text
┌──────────────────────────────┐
│ ←  Thanh toán                │
│                              │
│        ◔  Đang chờ thanh     │
│           toán               │
│   2.838.000 đ · 2 đợt        │
│   Còn 28:41                  │
│                              │
│ Hoàn tất ở trang thanh toán, │
│ rồi quay lại ứng dụng.       │
│                              │
│ [ Mở lại trang thanh toán ]  │
│ [ Tôi đã thanh toán xong ]   │
│ Hủy thanh toán               │
└──────────────────────────────┘
```

Do not copy: no artboard; the QR screen is another presentation. The screen never shows a card form (the page is the provider's) and never says a payment succeeded before the intent is `paid`.

### 4. Regions and components

| Region | Components |
| --- | --- |
| Status | spinner glyph, title, the amount and count, a countdown to `displayUntil` |
| Hint | one muted paragraph |
| Actions | `Button` primary "Mở lại trang thanh toán" (reopens `presentation.url`), outline "Tôi đã thanh toán xong" (E-88), ghost "Hủy thanh toán" (E-87) |
| Holder | when the screen was opened as a non-creator ("started by"), a line "{name} đang thanh toán" and no cancel for a member who is not the creator or the owner |

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| The intent | E-86 `GET /me/payments/intents/{id}` | `['unit', unitId, 'intent', intentId]` | `status` (`pending`, `paid`, `cancelling`, `cancelled`, `expired`, `failed`), `amount`, `displayUntil`, `presentation`, `startedBy`, `receipts[]` when paid. Polled every **2 s for 60 s, then every 3 s**, while the screen is focused; stops on a terminal status. Pull-to-refresh and focus refetch at once |

On first open with a `redirect` presentation the app opens `presentation.url` with `expo-web-browser`; it does so once per intent (a flag in the screen state), and on the return deep link it closes the tab.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| The tab closes (return or back) | none | the polling continues; with `result=cancel` the hint changes to `res.pay.redirect.unfinished` and the buttons stay |
| "Mở lại trang thanh toán" | none | the same URL opens again; if the session expired the next poll shows `expired` |
| "Tôi đã thanh toán xong" | E-88 `POST …/check` | brings the next re-query forward; answers `{status, checkScheduled}`; the screen keeps polling; rate-limited to once per 10 s |
| "Hủy thanh toán" | confirm sheet, then E-87 `POST …/cancel` | `Pay-Failed` with `cancelled`; 409 `intent_not_cancellable` (paid meanwhile) → the screen follows the status to `Pay-Done` |
| `status = paid` | none | `Pay-Done` |
| `status = expired`, `cancelled`, `failed` | none | `Pay-Failed` |

### 7. States

| State | Screen |
| --- | --- |
| `waiting` | as the wireframe |
| `unfinished` | after a return with `result=cancel`: "Bạn chưa hoàn tất thanh toán" and the same actions |
| `checking` | after "Tôi đã thanh toán xong": the button shows its spinner for the call only |
| `slow` | after the countdown is under 5 minutes: "Nếu bạn đã thanh toán, khoản phí sẽ tự được ghi nhận trong vài phút." |
| `offline` | the last status and a strip; polling resumes when the network returns |
| `error` | the generic error with a retry; the intent is not lost (it is in the URL) |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.pay.redirect.title` | Đang chờ thanh toán | Waiting for payment |
| `res.pay.redirect.amount` | {amount} · {count, plural, one {# đợt} other {# đợt}} | {amount} · {count, plural, one {# batch} other {# batches}} |
| `res.pay.redirect.left` | Còn {time} | {time} left |
| `res.pay.redirect.hint` | Hoàn tất ở trang thanh toán, rồi quay lại ứng dụng. | Finish on the payment page, then come back to the app. |
| `res.pay.redirect.unfinished` | Bạn chưa hoàn tất thanh toán. | You have not finished paying. |
| `res.pay.redirect.reopen` | Mở lại trang thanh toán | Reopen the payment page |
| `res.pay.redirect.done` | Tôi đã thanh toán xong | I have paid |
| `res.pay.redirect.cancel` | Hủy thanh toán | Cancel the payment |
| `res.pay.redirect.cancel.confirm` | Hủy lượt thanh toán này? Các đợt phí được mở lại để bạn thanh toán sau. | Cancel this payment? The batches are released so you can pay later. |
| `res.pay.redirect.slow` | Nếu bạn đã thanh toán, khoản phí sẽ tự được ghi nhận trong vài phút. | If you have paid, the fee is recorded automatically within minutes. |
| `res.pay.redirect.by` | {name} đang thanh toán | {name} is paying |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-34 | **G** an intent with a `redirect` presentation **W** the screen opens **T** the browser tab opens once with `presentation.url`, and E-86 is polled every 2 s | maestro |
| UIRF-35 | **G** the fake gateway page is paid **W** the deep link returns **T** the tab closes and the screen moves to `Pay-Done` without a manual refresh | maestro |
| UIRF-36 | **G** the return link says `cancel` **W** it opens the app **T** the intent is still `pending`, the screen shows "Bạn chưa hoàn tất" and "Mở lại" works | maestro |
| UIRF-37 | **G** the deep link is lost **W** the webhook settles the intent **T** polling alone moves the screen to `Pay-Done` within 5 s | api, maestro |
| UIRF-38 | **G** "Tôi đã thanh toán xong" is pressed twice in 5 s **W** the second runs **T** it is not sent (client) and E-88 never answers 429 to a normal use | maestro |
| UIRF-39 | **G** "Hủy thanh toán" is confirmed **W** E-87 answers 200 **T** `Pay-Failed` shows with `cancelled` and the charges are payable again | api, maestro |
| UIRF-40 | **G** the payment settles between the press of "Hủy" and E-87 **W** E-87 answers 409 **T** the screen shows `Pay-Done`, not an error | api, maestro |

### 10. E2E cases

Maestro with the fake gateway: `pay-redirect.yaml` (UIRF-34, 35, 36), `pay-cancel.yaml` (UIRF-39); UIRF-37, 38, 40 are API tests with one assertion each.

### 11. Open questions

None.

---

## Pay-Done

> Status: Approved · Prototype: designed (N1, N4) · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

As `Pay-Select`. UC-03 step 9, FR-08.7.

### 2. URL and search params

`/fees/pay/[intentId]/done` (replaces `Pay-Redirect` in the stack).

### 3. Prototype

Artboard [`Pay-Done`](../../references/design-canvas/Pay-Done.dc.html) (title "Thanh toán thành công"): a success mark, "Thanh toán thành công", the amount, the time and method, one `ListItem` per receipt ("Đợt 1", the receipt number, the amount, a download action), and the buttons "Xem biên lai" and "Về trang Phí".

Do not copy: a receipt code `PT-…` (N4: the number is `BL-2610-0153`); "VNPay" or "VietQR" in the method line (the method is `res.fee.method.online`).

### 4. Regions and components

| Region | Components |
| --- | --- |
| Result | success glyph, title, amount, "lúc {time}, {date}" |
| Receipts | `List` of `ListItem`: "Đợt {n}", `BL-…` number, amount, a download `IconButton` (E-84) |
| Actions | primary "Về trang Phí" (clears the stack to the tab), outline "Xem biên lai" when there is exactly one |

### 5. Data

E-86 (cached from `Pay-Redirect`): `status = paid`, `paidAt`, `amount`, `receipts[] {id, number, chargeId, batch {ordinal}, amount}`. The `['unit', unitId, 'fees', …]` queries are invalidated on arrival so `Fees` and `Fee-History` show the new state.

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| "Xem biên lai" / the row action | E-84 | the receipt PDF opens (as `Fee-Detail`) |
| "Về trang Phí" | none | `Fees` |
| Back | none | `Fees` (never `Pay-Redirect`) |

### 7. States

| State | Screen |
| --- | --- |
| `loaded` | as §4 |
| `rendering` | a receipt's PDF is not ready: the row action shows a spinner after 150 ms and the PDF is rendered on demand (DOC-34 §8.2) |
| `error`, `offline` | DOC-68; the data is cached from the previous screen |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.pay.done.title` | Thanh toán thành công | Payment successful |
| `res.pay.done.at` | Lúc {time}, {date} | At {time}, {date} |
| `res.pay.done.receipt` | Biên lai {number} | Receipt {number} |
| `res.pay.done.back` | Về trang Phí | Back to Fees |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-41 | **G** a payment of two batches **W** it settles **T** `Pay-Done` lists two receipts `BL-…-0001` and `-0002` with their amounts and the sum equals the total | api, maestro |
| UIRF-42 | **G** the screen is open **W** Back is pressed **T** `Fees` shows, with both charges gone from the open list and present in `view=history` | maestro |
| UIRF-43 | **G** a payment from a family member's phone **W** the owner's phone opens `Fees` **T** the charges are gone after the next refetch or the `fee.charge_paid` push | api, maestro |

### 10. E2E cases

Maestro: `pay-done.yaml` (UIRF-41, 42). UIRF-43 is an API test of the push plus one assertion.

### 11. Open questions

None.

---

## Pay-Failed

> Status: Approved · Prototype: to design (a wireframe below) · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

As `Pay-Select`. UC-03 alternative flows (expiry, cancel, failure), FR-10.2.

### 2. URL and search params

`/fees/pay/[intentId]/failed?reason=expired|cancelled|failed`.

### 3. Wireframe

```text
┌──────────────────────────────┐
│ ←  Thanh toán                │
│                              │
│        ⚠                     │
│  Thanh toán chưa hoàn tất    │
│  Lượt thanh toán đã hết hạn. │
│                              │
│  Nếu bạn đã bị trừ tiền, khoản│
│  phí sẽ tự được ghi nhận      │
│  trong vài phút.             │
│                              │
│ [ Thử lại ]                  │
│ [ Về trang Phí ]             │
└──────────────────────────────┘
```

Do not copy: no artboard. The screen never blames the card (a decline happens on the provider's page and leaves the session open).

### 4. Regions and components

A warning glyph, a title, one reason line by `reason`, the reassurance line, `Button` primary "Thử lại" (back to `Pay-Select` with the same charges, if they are still open), outline "Về trang Phí".

### 5. Data

E-86 for the status; E-80 for whether the charges are still open (a charge paid meanwhile removes "Thử lại").

### 6. Interactions

| Action | Result |
| --- | --- |
| "Thử lại" | `/fees/pay?charges=…` with the charges still open |
| "Về trang Phí" | `Fees` |
| A late confirmation arrives (an expired intent is posted, IN-32) | the next E-86 poll or E-80 refetch shows the charges paid; the screen switches to `Pay-Done` if still open |

### 7. States

| `reason` | Line |
| --- | --- |
| `expired` | "Lượt thanh toán đã hết hạn." |
| `cancelled` | "Bạn đã hủy lượt thanh toán." (or "{name} đã hủy" when a household member did) |
| `failed` | "Không tạo được lượt thanh toán. Vui lòng thử lại." |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.pay.failed.title` | Thanh toán chưa hoàn tất | The payment did not finish |
| `res.pay.failed.expired` | Lượt thanh toán đã hết hạn. | The payment window ended. |
| `res.pay.failed.cancelled` | Bạn đã hủy lượt thanh toán. | You cancelled the payment. |
| `res.pay.failed.cancelled.by` | {name} đã hủy lượt thanh toán. | {name} cancelled the payment. |
| `res.pay.failed.failed` | Không tạo được lượt thanh toán. Vui lòng thử lại. | The payment could not be started. Please try again. |
| `res.pay.failed.charged` | Nếu bạn đã bị trừ tiền, khoản phí sẽ tự được ghi nhận trong vài phút. | If you were charged, the fee is recorded automatically within minutes. |
| `res.pay.failed.retry` | Thử lại | Try again |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-44 | **G** an intent that passed `expires_at` **W** the screen opens **T** the expired line, the reassurance line and "Thử lại" show | api, maestro |
| UIRF-45 | **G** the charges were paid in cash **W** `Pay-Failed` is reopened **T** there is no "Thử lại" and "Về trang Phí" is the only action | api, maestro |
| UIRF-46 | **G** an expired intent whose exact payment arrives late **W** the app polls **T** the screen moves to `Pay-Done` | api, maestro |

### 10. E2E cases

Maestro: `pay-failed.yaml` (UIRF-44, 45); UIRF-46 is an API test (DOC-23 IN-32) with one assertion.

### 11. Open questions

None.

---

## Cards

> Status: Approved · Prototype: to design (a wireframe below) · Phase: P2 · DOC-58

### 1. Persona, use cases, permissions

PS-5, PS-6, PS-7 with `pay`. UC-03 (pay again with a saved card). Only for a driver with `capabilities.savedMethods` (Stripe); the link is not drawn otherwise. A member sees **only the cards they saved themselves** (DOC-24 §4.7).

### 2. URL and search params

`/fees/cards`. No params.

### 3. Wireframe

```text
┌──────────────────────────────┐
│ ←  Thẻ đã lưu                │
│                              │
│ ▭ Visa •••• 4242   12/2028 ⋯ │
│ ▭ Mastercard •••• 4444 …   ⋯ │
│                              │
│ Bạn lưu thẻ khi thanh toán,  │
│ ở trang thanh toán. Ứng dụng │
│ không lưu số thẻ.            │
└──────────────────────────────┘
```

Do not copy: no artboard. There is no "add a card" button: a card is saved on the provider's page during a payment (DR-326). There is no "default card" and no automatic charge.

### 4. Regions and components

`List` of `ListItem` (brand glyph, "{brand} •••• {last4}", expiry, a `⋯` with "Xóa thẻ"); a muted explanation.

### 5. Data

| Read | Endpoint | Key | Notes |
| --- | --- | --- | --- |
| Saved cards | E-184 `GET /me/payment-methods` | `['me', 'payment-methods']` | `methods[] {id, brand, last4, expMonth, expYear}`; read live from the provider, never stored; refetched on focus |

### 6. Interactions

| Action | Endpoint | Result |
| --- | --- | --- |
| "Xóa thẻ" | confirm sheet, then E-185 `DELETE /me/payment-methods/{id}` | the row leaves; a toast "Đã xóa thẻ"; 404 (not the caller's, or gone) → refetch |

### 7. States

| State | Screen |
| --- | --- |
| `loading` | skeleton rows |
| `loaded` | as §4 |
| `empty` | "Bạn chưa lưu thẻ nào." and the explanation |
| `error` | the generic error with a retry; "Dịch vụ thanh toán chưa phản hồi" for a 502 |
| `forbidden` | a member without `pay`: DOC-68 forbidden |

### 8. Microcopy

| Key | vi | en |
| --- | --- | --- |
| `res.cards.title` | Thẻ đã lưu | Saved cards |
| `res.cards.item` | {brand} •••• {last4} | {brand} •••• {last4} |
| `res.cards.expiry` | Hết hạn {month}/{year} | Expires {month}/{year} |
| `res.cards.remove` | Xóa thẻ | Remove card |
| `res.cards.remove.confirm` | Xóa thẻ {brand} •••• {last4}? Bạn có thể lưu lại khi thanh toán. | Remove {brand} •••• {last4}? You can save it again when you pay. |
| `res.cards.removed` | Đã xóa thẻ. | Card removed. |
| `res.cards.empty` | Bạn chưa lưu thẻ nào. | You have not saved a card. |
| `res.cards.note` | Bạn lưu thẻ khi thanh toán, ở trang thanh toán. Ứng dụng không lưu số thẻ. | You save a card when you pay, on the payment page. The app does not store card numbers. |

### 9. Acceptance criteria

| ID | Given / When / Then | Level |
| --- | --- | --- |
| UIRF-47 | **G** two saved cards **W** `Cards` opens **T** two rows show brand, last four and expiry, and no full number appears anywhere in the response or the screen | api, maestro |
| UIRF-48 | **G** a card **W** it is removed and confirmed **T** E-185 is sent once, the row leaves, and the next payment page no longer offers it | api, maestro |
| UIRF-49 | **G** a tenant who saved a card **W** the owner opens `Cards` **T** the owner's list does not contain the tenant's card; a forced delete of it answers 404 | api |
| UIRF-50 | **G** a building whose gateway has no saved methods **W** `Fees` renders **T** the link "Thẻ đã lưu" is absent | api, maestro |

### 10. E2E cases

Maestro: `cards.yaml` (UIRF-47, 48, 50); UIRF-49 is an API test.

### 11. Open questions

None.

---

## The screens for a bank-transfer driver

`Pay-VietQR` (the QR, its copy and save-image actions, "I transferred") and `Pay-Mismatch` (a transfer of another amount arrived, DR-84 item 8) are written when a QR driver (VietQR, payOS) is added; the work is listed in DOC-24 §6. Until then their rows in DOC-56 §3 and the notes N1 and N4 stay the contract, the app renders only the presentation types a driver declares, and the gateway screen refuses a QR driver while no `Pay-VietQR` exists (DOC-67).

## Decisions made while writing

Recorded as DR-323 (decided, Claude delegated by the Owner), revised by DR-325, DR-326 and DR-328 (the payment items and the fee-notice PDF).

| Part of DR-323 | Decision | Where used |
| --- | --- | --- |
| Lines in the list | E-80 returns `lines[]` for each charge, so a card needs no second request; E-81 returns the same lines | `Fees` §5 |
| ~~No payment in P2~~ | *Revised 2026-11-01 (DR-325):* payment is in P2; the pay buttons are drawn when E-80 says `payment.enabled` and the member has `pay`; a building with no gateway shows the office caption | `Fees`, `Fee-Detail` |
| ~~No fee-notice PDF for residents~~ | *Revised 2026-11-01 (DR-328):* E-183 serves the fee-notice PDF to a member; the canvas button stays | `Fee-Detail` |
| No bank-account line | No field holds a collection account; the app is the way to pay online and the line is not needed; it is omitted | `Fee-Detail` |
| Payment presentation | The screens render `redirect` or `qr` by the type the driver returns, never by provider name; `Cards` only for a driver with saved methods (DR-326) | `Pay-*`, `Cards` |
| Status chip | Thresholds from `daysPastDue`: overdue, today, 1–7 days left (warning), more (neutral) | `Fees` |
| History summary | E-82 carries `summary {outstanding, paidThisYear}` inside the member's window | `Fee-History` |

## Not in this document

| Topic | Lives in |
| --- | --- |
| What a resident may see by membership date | DOC-22 §8.4, DOC-27 §6.6 |
| The server side of a payment | DOC-23, DOC-24 |
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
| `Pay-Select` | FR-07.1, FR-07.2, FR-07.4, FR-07.6, FR-07.7 | DR-28, DR-84, DR-325, DR-326 | `UIRF-27…33` |
| `Pay-Redirect` | FR-08.4, FR-08.7, FR-10.3 | DR-326 | `UIRF-34…40` |
| `Pay-Done` | FR-08.7 | DR-326 | `UIRF-41…43` |
| `Pay-Failed` | FR-10.2 | DR-28, DR-326 | `UIRF-44…46` |
| `Cards` | FR-07 | DR-325, DR-326 | `UIRF-47…50` |

## Open questions

None. `Pay-VietQR` and `Pay-Mismatch` are written when a bank-transfer driver is added.
