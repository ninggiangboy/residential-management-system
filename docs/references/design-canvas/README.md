# Design canvas: snapshot

> Status: **Reference** (DR-335) · Snapshot: 2026-11-04, canvas version `1792655344-f8bf` · Source: <https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj>

**Use these artboards as the reference for layout and UX**: a screen's regions and their order, its flow and the states it draws. They are not a spec to match exactly. Components and visual styling follow the project's design system: [DOC-54](../../08-ux-ui/design-system.md), `@rms/design-tokens`, `apps/cms-web/src/components/ui` and `@rms/ui-native` (DR-335).

Do not take from an artboard what these correct:

1. the "Do not copy" list in the "Prototype" part of the screen's document (DOC-57…67);
2. the notes of [DOC-56 §5](../../08-ux-ui/screens/README.md#5-prototype-deviations-what-a-screen-document-must-not-copy) and [DOC-53 §7](../../08-ux-ui/ux-principles-and-ia.md#7-where-the-prototype-differs-from-a-decision);
3. a decision in the [register](../../00-decision-register.md).

A screen with no artboard (`to design` in [DOC-56 §4](../../08-ux-ui/screens/README.md)) follows the wireframe in its document.

## How to read it

- **To see a screen:** open the [canvas](https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj). These files do not render from disk: `./support.js` is served by the canvas page and the fonts are at `/_blob/<id>` in the artifact.
- **To read the details:** open the artboard's file below. It holds the markup, the sample copy and the `Hien.*` components it was drawn with. The copy of a screen comes from §8 of its document.
- **The values in the code** come from `packages/design-tokens`. `ds/hien/tokens.json` here has the same SHA-256 as `packages/design-tokens/tokens.json` on 2026-11-04; a color or size is never copied from an artboard into a component (DOC-54 §2).

## What is here

This folder holds the canvas's `project/` files, byte for byte: 110 artboards, `canvas.json` and the design system copy in `ds/hien/`. Do not edit them by hand. The editor's own files (`index.html`, `SKILL.md`, `artifact-type/`) are left out. The full design system, with its component notes and fonts, stays in its own artifact ([references](../README.md#design-artifacts)).

The canvas is the source. When it changes, refresh the snapshot in its own commit:

1. `Artifact { action: "list", url: "https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj", scope: "files" }` lists the files and the version.
2. `Artifact { action: "read", url: "…", paths: ["project/…"] }` saves every file under `project/` to the scratchpad.
3. Copy them over this folder, keep this README, update the version and date above, and add a row for any new artboard to the index below and to DOC-56 §3.

## Artboards

### App cư dân (42)

| Artboard | Canvas title | Frame (px) | Screen document |
| --- | --- | --- | --- |
| [`Login`](Login.dc.html) | Đăng nhập | 390 × 844 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#login) |
| [`Login-Error`](Login-Error.dc.html) | Đăng nhập, số chưa đăng ký | 390 × 844 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#login-error) |
| [`OTP`](OTP.dc.html) | Nhập mã OTP | 390 × 844 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#otp) |
| [`Terms`](Terms.dc.html) | Đồng ý điều khoản | 390 × 844 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#terms) |
| [`Unit-Pick`](Unit-Pick.dc.html) | Chọn căn hộ | 390 × 844 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#unit-pick) |
| [`Main`](Main.dc.html) | Cư dân: Trang chủ | 390 × 1680 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#main) |
| [`Unit-Owner`](Unit-Owner.dc.html) | Chủ hộ: Căn hộ của tôi | 390 × 1560 | DOC-59 (not written yet) |
| [`Members`](Members.dc.html) | Chủ hộ: Quản lý thành viên | 390 × 1080 | DOC-59 (not written yet) |
| [`Member-Actions`](Member-Actions.dc.html) | Chủ hộ: Thao tác với thành viên | 390 × 844 | DOC-59 (not written yet) |
| [`Member-Add`](Member-Add.dc.html) | Chủ hộ: Thêm thành viên | 390 × 1100 | DOC-59 (not written yet) |
| [`Home-Member`](Home-Member.dc.html) | Thành viên gia đình: Trang chủ | 390 × 1680 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#home-member) |
| [`Unit-Member`](Unit-Member.dc.html) | Thành viên, người thuê: Căn hộ của tôi | 390 × 1440 | DOC-59 (not written yet) |
| [`Home-Tenant-Pay`](Home-Tenant-Pay.dc.html) | Người thuê được trả phí: Trang chủ | 390 × 1680 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#home-tenant-pay) |
| [`Home-Tenant-NoPay`](Home-Tenant-NoPay.dc.html) | Người thuê không trả phí: Trang chủ | 390 × 1600 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#home-tenant-nopay) |
| [`Fees-NoPay`](Fees-NoPay.dc.html) | Người thuê không trả phí: Phí | 390 × 1240 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#fees-nopay) |
| [`Home-Helper`](Home-Helper.dc.html) | Giúp việc: Trang chủ | 390 × 1240 | [DOC-57](../../08-ux-ui/screens/resident-signin-home.md#home-helper) |
| [`Notices-Helper`](Notices-Helper.dc.html) | Giúp việc: Bản tin chung | 390 × 1080 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`QR-Helper`](QR-Helper.dc.html) | Giúp việc: Mã QR | 390 × 844 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Account-Helper`](Account-Helper.dc.html) | Giúp việc: Tài khoản | 390 × 960 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md#account-helper) |
| [`Fees`](Fees.dc.html) | Phí cần thanh toán | 390 × 1560 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#fees) |
| [`Fee-Detail`](Fee-Detail.dc.html) | Thông báo phí | 390 × 1480 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#fee-detail) |
| [`Pay-Select`](Pay-Select.dc.html) | Chọn đợt và cách thanh toán | 390 × 1080 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#pay-select) |
| [`Pay-VietQR`](Pay-VietQR.dc.html) | QR thanh toán | 390 × 1080 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md) |
| [`Pay-Done`](Pay-Done.dc.html) | Thanh toán thành công | 390 × 960 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#pay-done) |
| [`Fee-History`](Fee-History.dc.html) | Lịch sử đợt phí và công nợ | 390 × 1160 | [DOC-58](../../08-ux-ui/screens/resident-fees-payment.md#fee-history) |
| [`Requests`](Requests.dc.html) | Yêu cầu hỗ trợ | 390 × 1160 | DOC-59 (not written yet) |
| [`Request-New`](Request-New.dc.html) | Tạo yêu cầu | 390 × 1160 | DOC-59 (not written yet) |
| [`Request-Detail`](Request-Detail.dc.html) | Chi tiết yêu cầu | 390 × 1560 | DOC-59 (not written yet) |
| [`Request-Done`](Request-Done.dc.html) | Yêu cầu hoàn thành, đánh giá | 390 × 1300 | DOC-59 (not written yet) |
| [`Request-Cancel`](Request-Cancel.dc.html) | Hủy yêu cầu | 390 × 844 | DOC-59 (not written yet) |
| [`Notices`](Notices.dc.html) | Bản tin | 390 × 1300 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Notice-Detail`](Notice-Detail.dc.html) | Chi tiết bản tin | 390 × 1240 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Inbox`](Inbox.dc.html) | Trung tâm thông báo | 390 × 1080 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Docs`](Docs.dc.html) | Tài liệu | 390 × 1080 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Doc-Page`](Doc-Page.dc.html) | Trang tài liệu | 390 × 1500 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`QR`](QR.dc.html) | Mã QR của tôi | 390 × 900 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`QR-Expired`](QR-Expired.dc.html) | Mã QR đã hết hạn | 390 × 900 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md) |
| [`Vehicles`](Vehicles.dc.html) | Phương tiện của căn | 390 × 1240 | DOC-59 (not written yet) |
| [`Vehicle-Add`](Vehicle-Add.dc.html) | Đăng ký phương tiện | 390 × 1240 | DOC-59 (not written yet) |
| [`Contact`](Contact.dc.html) | Liên hệ Ban quản lý | 390 × 900 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md#contact) |
| [`Account`](Account.dc.html) | Tài khoản và cài đặt | 390 × 1240 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md#account) |
| [`Account-Phone`](Account-Phone.dc.html) | Đổi số điện thoại | 390 × 900 | [DOC-60](../../08-ux-ui/screens/resident-qr-notices-account.md#account-phone) |

### App quản lý (35)

| Artboard | Canvas title | Frame (px) | Screen document |
| --- | --- | --- | --- |
| [`S-Login`](S-Login.dc.html) | Nhân viên: Đăng nhập | 390 × 844 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md#s-login) |
| [`S-Login-Error`](S-Login-Error.dc.html) | Nhân viên: Đăng nhập sai mật khẩu | 390 × 844 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md#s-login-error) |
| [`S-Forgot`](S-Forgot.dc.html) | Nhân viên: Quên mật khẩu | 390 × 844 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md#s-forgot) |
| [`S-Forgot-Sent`](S-Forgot-Sent.dc.html) | Nhân viên: Đã gửi link đổi mật khẩu | 390 × 844 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md#s-forgot-sent) |
| [`S-Inbox`](S-Inbox.dc.html) | BQL: Trung tâm thông báo | 390 × 1000 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`S-Docs`](S-Docs.dc.html) | Kỹ thuật: Tài liệu | 390 × 1080 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`S-Doc-Page`](S-Doc-Page.dc.html) | Kỹ thuật: Trang tài liệu | 390 × 1400 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`S-Account`](S-Account.dc.html) | Kỹ thuật: Tài khoản | 390 × 1100 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md#s-account) |
| [`B-Home`](B-Home.dc.html) | BQL: Trang chủ | 390 × 1440 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Tickets`](B-Tickets.dc.html) | BQL: Phiếu hỗ trợ | 390 × 1400 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Ticket-Detail`](B-Ticket-Detail.dc.html) | BQL: Chi tiết phiếu chưa phân công | 390 × 1700 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Assign`](B-Assign.dc.html) | BQL: Phân công phiếu | 390 × 844 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Ticket-Close`](B-Ticket-Close.dc.html) | BQL: Đóng phiếu đã hoàn thành | 390 × 1480 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Vehicles`](B-Vehicles.dc.html) | BQL: Phương tiện chờ duyệt | 390 × 1100 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Vehicle-Review`](B-Vehicle-Review.dc.html) | BQL: Duyệt phương tiện | 390 × 1500 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Vehicle-Reject`](B-Vehicle-Reject.dc.html) | BQL: Từ chối phương tiện | 390 × 900 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Notice-New`](B-Notice-New.dc.html) | BQL: Soạn bản tin | 390 × 1360 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Notice-Stats`](B-Notice-Stats.dc.html) | BQL: Thống kê đọc bản tin | 390 × 1240 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Units`](B-Units.dc.html) | BQL: Tra cứu căn hộ | 390 × 1060 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`B-Unit-Detail`](B-Unit-Detail.dc.html) | BQL: Chi tiết căn hộ | 390 × 1540 | [DOC-61](../../08-ux-ui/screens/staff-shared-and-manager.md) |
| [`K-Jobs`](K-Jobs.dc.html) | Kỹ thuật: Công việc của tôi | 390 × 1300 | DOC-62 (not written yet) |
| [`K-Job-New`](K-Job-New.dc.html) | Kỹ thuật: Chi tiết phiếu mới | 390 × 1400 | DOC-62 (not written yet) |
| [`K-Job-Reject`](K-Job-Reject.dc.html) | Kỹ thuật: Từ chối phiếu | 390 × 900 | DOC-62 (not written yet) |
| [`K-Job-Working`](K-Job-Working.dc.html) | Kỹ thuật: Phiếu đang xử lý | 390 × 1700 | DOC-62 (not written yet) |
| [`K-Job-Done`](K-Job-Done.dc.html) | Kỹ thuật: Xác nhận báo hoàn thành | 390 × 1000 | DOC-62 (not written yet) |
| [`K-History`](K-History.dc.html) | Kỹ thuật: Lịch sử phiếu đã xử lý | 390 × 1200 | DOC-62 (not written yet) |
| [`G-Lookup`](G-Lookup.dc.html) | Bảo vệ: Tra cứu | 390 × 1200 | DOC-63 (not written yet) |
| [`G-Scan`](G-Scan.dc.html) | Bảo vệ: Quét mã QR | 390 × 844 | DOC-63 (not written yet) |
| [`G-Scan-OK`](G-Scan-OK.dc.html) | Bảo vệ: Mã hợp lệ | 390 × 1100 | DOC-63 (not written yet) |
| [`G-Scan-Expired`](G-Scan-Expired.dc.html) | Bảo vệ: Mã hết hạn | 390 × 844 | DOC-63 (not written yet) |
| [`G-Scan-Invalid`](G-Scan-Invalid.dc.html) | Bảo vệ: Mã không hợp lệ | 390 × 844 | DOC-63 (not written yet) |
| [`G-Plate`](G-Plate.dc.html) | Bảo vệ: Tra biển số | 390 × 1000 | DOC-63 (not written yet) |
| [`G-Unit`](G-Unit.dc.html) | Bảo vệ: Căn hộ A-1508 | 390 × 1300 | DOC-63 (not written yet) |
| [`G-Jobs`](G-Jobs.dc.html) | Bảo vệ: Phiếu của tôi | 390 × 1200 | DOC-63 (not written yet) |
| [`G-Jobs-Tech`](G-Jobs-Tech.dc.html) | Bảo vệ: Phiếu bên Kỹ thuật | 390 × 1100 | DOC-63 (not written yet) |

### Web CMS (Admin, BQL) (33)

| Artboard | Canvas title | Frame (px) | Screen document |
| --- | --- | --- | --- |
| [`W-Login`](W-Login.dc.html) | Chung: Đăng nhập | 1440 × 900 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md#w-login) |
| [`W-Forgot-Sent`](W-Forgot-Sent.dc.html) | Chung: Quên mật khẩu, đã gửi link | 1440 × 900 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md#w-forgot-sent) |
| [`W-Reset`](W-Reset.dc.html) | Chung: Đặt mật khẩu mới (trình duyệt) | 1440 × 900 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md#w-reset) |
| [`W-Profile`](W-Profile.dc.html) | Chung: Hồ sơ cá nhân | 1440 × 900 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md#w-profile) |
| [`W-Dashboard`](W-Dashboard.dc.html) | BQL: Tổng quan | 1440 × 1140 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Tickets`](W-Tickets.dc.html) | BQL: Danh sách phiếu | 1440 × 1060 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Ticket-Detail`](W-Ticket-Detail.dc.html) | BQL: Chi tiết phiếu | 1440 × 1440 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Ticket-Assign`](W-Ticket-Assign.dc.html) | BQL: Phân công phiếu | 1440 × 960 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Ticket-Types`](W-Ticket-Types.dc.html) | BQL: Loại phiếu | 1440 × 900 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Units`](W-Units.dc.html) | BQL: Danh sách căn hộ | 1440 × 1060 | [DOC-65](../../08-ux-ui/screens/web-residents.md#w-units) |
| [`W-Unit-Detail`](W-Unit-Detail.dc.html) | BQL: Chi tiết căn hộ | 1440 × 900 | [DOC-65](../../08-ux-ui/screens/web-residents.md#w-unit-detail) |
| [`W-Import`](W-Import.dc.html) | BQL: Nhập căn hộ từ Excel | 1440 × 940 | [DOC-65](../../08-ux-ui/screens/web-residents.md#w-import) |
| [`W-Residents`](W-Residents.dc.html) | BQL: Danh sách cư dân | 1440 × 1100 | [DOC-65](../../08-ux-ui/screens/web-residents.md#w-residents) |
| [`W-Resident-Add`](W-Resident-Add.dc.html) | BQL: Tạo chủ hộ bằng SĐT | 1440 × 960 | [DOC-65](../../08-ux-ui/screens/web-residents.md#w-resident-add) |
| [`W-Vehicles`](W-Vehicles.dc.html) | BQL: Duyệt phương tiện | 1440 × 1060 | [DOC-65](../../08-ux-ui/screens/web-residents.md) |
| [`W-Notices`](W-Notices.dc.html) | BQL: Danh sách bản tin | 1440 × 980 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Notice-Edit`](W-Notice-Edit.dc.html) | BQL: Soạn bản tin | 1440 × 1020 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Notice-Stats`](W-Notice-Stats.dc.html) | BQL: Thống kê đã đọc | 1440 × 1200 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Docs`](W-Docs.dc.html) | BQL: Tài liệu (wiki) | 1440 × 1100 | [DOC-64](../../08-ux-ui/screens/web-auth-dashboard-operations.md) |
| [`W-Fees`](W-Fees.dc.html) | BQL: Đợt phí | 1440 × 940 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-fees) |
| [`W-Fee-Import`](W-Fee-Import.dc.html) | BQL: Nhập đợt phí từ Excel | 1440 × 1260 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-fee-import) |
| [`W-Fee-Batch`](W-Fee-Batch.dc.html) | BQL: Đợt phí nháp, kiểm tra và phát hành | 1440 × 1120 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-fee-batch) |
| [`W-Fee-Notice`](W-Fee-Notice.dc.html) | BQL: Mẫu thông báo phí (song ngữ) | 1440 × 1280 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-fee-notice) |
| [`W-Fee-Record`](W-Fee-Record.dc.html) | BQL: Ghi nhận nộp thủ công | 1440 × 960 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-fee-record) |
| [`W-Debts`](W-Debts.dc.html) | BQL: Công nợ | 1440 × 1200 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-debts) |
| [`W-Transactions`](W-Transactions.dc.html) | BQL: Giao dịch online | 1440 × 1200 | [DOC-66](../../08-ux-ui/screens/web-finance.md#w-transactions) |
| [`W-Reports`](W-Reports.dc.html) | BQL: Báo cáo | 1440 × 1040 | [DOC-66](../../08-ux-ui/screens/web-finance.md) |
| [`W-Staff`](W-Staff.dc.html) | Admin: Tài khoản nhân viên | 1440 × 1000 | [DOC-67](../../08-ux-ui/screens/web-system.md#w-staff) |
| [`W-Staff-New`](W-Staff-New.dc.html) | Admin: Tạo tài khoản nhân viên | 1440 × 960 | [DOC-67](../../08-ux-ui/screens/web-system.md#w-staff-new) |
| [`W-Building`](W-Building.dc.html) | Admin: Tòa nhà và cấu hình | 1440 × 1120 | [DOC-67](../../08-ux-ui/screens/web-system.md#w-building) |
| [`W-Gateway`](W-Gateway.dc.html) | Admin: Cổng thanh toán | 1440 × 1120 | [DOC-67](../../08-ux-ui/screens/web-system.md#w-gateway) |
| [`W-Audit`](W-Audit.dc.html) | Admin: Nhật ký thao tác | 1440 × 1280 | [DOC-67](../../08-ux-ui/screens/web-system.md) |
| [`W-System`](W-System.dc.html) | Admin: Sao lưu và lưu trữ | 1440 × 1000 | [DOC-67](../../08-ux-ui/screens/web-system.md) |
