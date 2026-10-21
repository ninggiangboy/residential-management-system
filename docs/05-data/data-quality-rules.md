# Data quality rules

> Status: **Draft** · Updated: 2026-10-21 (DR-226: IM-42, IM-43; earlier: DR-213: `unitCode` on an issue; DR-149: DQ-05 is a 400; DR-135: the creating contract is named) · DOC-18
> Depends on: original SDD §5.3, §11, [DR](../00-decision-register.md) (DR-21, 22, 36, 40, 41, 58, 61, 62, 74, 109, 114, DR-226), [DOC-03](../01-product/requirements.md) (FR-18, NFR-12), [DOC-11](../03-architecture/tech-stack-and-versions.md) §3, [DOC-14](data-conventions.md) §8, §13, [DOC-16](identity-and-residency-model.md) §4.2, §5.1–§5.5, [DOC-17](operations-model.md) §3.1, [DOC-06](../02-glossary.md)
> Main readers: P1-13 (units and owners import), P1-14, DOC-27, DOC-21, DOC-42, DOC-51, the Excel templates, the P1 test fixture

This document is the catalog of the data-quality rules (`DQ-xx`) of the Excel imports: for each rule the layer where it runs, the check, its severity, what the system does, the threshold, the error code and the text the user reads in Vietnamese and in English. **Section 1 (units and owners, P1) is complete. Sections 2 (fee batches, P2) and 3 (bank statements, P3) are written when their phases start**, so the document stays `Draft` until then. It does not hold the import flow and the job states (DR-21, DOC-16 §5.5, DOC-27), the endpoints (DOC-51) or the error shape of the API (DOC-50, DOC-42).

**Rules and queries tested on 2026-10-19.** The row rules were run as a TypeScript prototype on Bun 1.4.3 with `libphonenumber-js` 1.13.15 (`/max` metadata) and `exceljs` 4.4.0; every input and result in §1.3 is its output. The set queries of §1.5 were run on PostgreSQL 18.6 with the tables of DOC-16. The prototype is a scratch file, not part of the repository: P1-13 writes the real validator from this catalog.

## Layers, severities and codes

| Layer | Where it runs | Needs |
| --- | --- | --- |
| `file` | Before any row is read | The uploaded object |
| `row` | Per row, in memory | The row's own cells |
| `set` | Across the rows of the file, in memory | All rows |
| `db` | Against stored data, by set queries (never one query per row, original SDD §11.2) | Units, memberships, profiles, accounts |
| `commit` | Inside the commit request, before the write | The file read again and the stored data |
| `post` | After the write, in the commit transaction | The written rows |

"Before write" is the first five layers; "after write" is `post`.

| Severity | Effect |
| --- | --- |
| `fail` | The whole job is `failed`; no row is validated and nothing can be committed |
| `error` | The row is rejected; the valid rows can still be committed |
| `warning` | The row is accepted; the preview shows a note |
| `info` | The row is accepted; the preview says what will happen |

Error codes are `snake_case` and are the contract with the client. A message is returned as `{code, params}` and rendered in the user's language by the client from the ICU catalog (DR-22); the texts below are the catalog entries. UI strings are quoted exactly as they appear on screen.

## 1. Units and owners import (P1)

### 1.1 The template and the file

`GET /staff/imports/templates/unit_owner` returns an `.xlsx` with the first sheet named `Căn hộ` (or `Units`) and row 1 as the header, in the language of the requesting user. The stored job has `kind = 'units_owners'` (DOC-16 §5.5); `unit_owner` is the template name of DR-22, and DOC-51 fixes the path parameter. The columns of the phone, ID number and date-of-birth cells are formatted as Text in the template, because Excel drops the leading zero of a number.

| Canonical column | Header (vi) | Header (en) | Required | Cell | Stored in |
| --- | --- | --- | --- | --- | --- |
| `unit_code` | Mã căn hộ | Unit code | Yes | Text | `residency.unit.code` |
| `floor` | Tầng | Floor | No | Whole number | `unit.floor` |
| `bedrooms` | Số phòng ngủ | Bedrooms | No | Whole number | `unit.bedrooms` |
| `area_m2` | Diện tích (m²) | Area (m²) | No | Number | `unit.area_m2` |
| `occupancy` | Tình trạng | Occupancy | No | Text | `unit.occupancy` |
| `owner_name` | Họ tên chủ hộ | Owner full name | If any owner cell is filled | Text | `resident_profile.full_name` |
| `owner_phone` | SĐT chủ hộ | Owner phone | If any owner cell is filled | Text | the owner's `identity.resident_account.phone` |
| `owner_email` | Email chủ hộ | Owner email | No | Text | `resident_profile.email` |
| `owner_id_number` | CCCD chủ hộ | Owner ID number | No | Text | `resident_profile.cccd_enc`, `cccd_last4` |
| `owner_dob` | Ngày sinh chủ hộ | Owner date of birth | No | Text or date | `resident_profile.date_of_birth` |

**Header matching.** The key of a header is its text with compatibility decomposition (NFKD, so `²` becomes `2`), combining marks removed, `đ` written `d`, lower case, and every character that is not a letter or digit removed. A header is recognised when its key equals the key of one of the aliases below. Headers that match nothing are ignored with a warning (DQ-06). Results of the prototype:

| Header in the file | Key | Canonical column |
| --- | --- | --- |
| `Mã căn hộ`, `MÃ CĂN HỘ`, `ma can ho` | `macanho` | `unit_code` |
| `Unit  Code`, `unit_code` | `unitcode` | `unit_code` |
| `Diện tích (m²)`, `DIEN TICH (M2)` | `dientichm2` | `area_m2` |
| `Area (m²)` | `aream2` | `area_m2` |
| `SĐT chủ hộ`, `sdt chu ho` | `sdtchuho` | `owner_phone` |
| `CMND/CCCD` | `cmndcccd` | `owner_id_number` |
| `Ngày sinh` | `ngaysinh` | `owner_dob` |
| `Tình trạng` | `tinhtrang` | `occupancy` |
| `Ghi chú`, `Status` | `ghichu`, `status` | none: ignored with a warning |

| Canonical column | Aliases (compared by key) |
| --- | --- |
| `unit_code` | Mã căn hộ, Mã căn, Căn hộ, Unit code, Unit, Apartment |
| `floor` | Tầng, Floor |
| `bedrooms` | Số phòng ngủ, Loại căn, PN, Bedrooms, Type |
| `area_m2` | Diện tích (m²), Diện tích, DT, Area (m²), Area |
| `occupancy` | Tình trạng, Hiện trạng, Occupancy |
| `owner_name` | Họ tên chủ hộ, Tên chủ hộ, Chủ hộ, Owner full name, Owner name |
| `owner_phone` | SĐT chủ hộ, Số điện thoại chủ hộ, Điện thoại chủ hộ, Owner phone |
| `owner_email` | Email chủ hộ, Owner email |
| `owner_id_number` | CCCD chủ hộ, Số CCCD, CMND/CCCD, Owner ID number, Owner CCCD |
| `owner_dob` | Ngày sinh chủ hộ, Ngày sinh, Owner date of birth, Owner DOB |

**Reading the file** (P1-13; the read is part of the 10 s budget of NFR-12):

- The streaming reader of `exceljs` is opened with `{ sharedStrings: 'cache', styles: 'cache', worksheets: 'emit', entries: 'emit', hyperlinks: 'ignore' }`. Without `styles: 'cache'` it returns a date cell as an Excel serial number (31140 for 3 April 1985); with it, as a `Date`. The date rule (DQ-23) accepts both, so a template change cannot break it.
- Only the first sheet is read. Rows whose cells are all empty or blank are skipped and not counted.
- The values are kept as read: a number stays a number, because DQ-22 depends on it.
- A row's number in an error is the Excel row number (header is row 1).

Measured on 2026-10-19 on an Apple M2 (Bun 1.4.3, no database): a generated file of 2,000 rows (113 KB, 40 rows with a wrong phone) was read and checked against the row and set rules in **77 to 83 ms** (parse 56 to 60 ms, rules 21 to 23 ms), and found 1,960 valid rows and 40 errors. The budget of NFR-12 is 10 s for the whole request, and DOC-10 plans 2 s; the two set queries and the preview insert are the rest.

### 1.2 The catalog

Thresholds come from DR-61 (5 MB, checked by `FilesApi.verify` before the job exists), DR-21 (5,000 rows, 500 listed issues) and the ranges below. "Text vi / en" are the catalog entries; `{…}` are ICU parameters.

| ID | Layer | Rule | Check | Severity | Action | Threshold | Code | Text (vi / en) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DQ-01 | file | The file is an Excel workbook | The object is a zip with `xl/workbook.xml` and the name ends in `.xlsx` | fail | Job `failed` | — | `import_file_type` | "Tệp phải là sổ làm việc Excel (.xlsx)." / "The file must be an Excel workbook (.xlsx)." |
| DQ-02 | file | The unit-code column is found | Row 1 of the first sheet has a header whose key matches a `unit_code` alias | fail | Job `failed` | — | `import_no_header` | "Dòng đầu tiên phải có cột “Mã căn hộ”. Hãy dùng tệp mẫu." / "The first row must contain the “Unit code” column. Use the template." |
| DQ-03 | file | No column appears twice | Two header cells map to the same canonical column | fail | Job `failed` | — | `import_duplicate_column` | "Có hai cột cùng là “{column}”. Hãy giữ một cột." / "Two columns are both “{column}”. Keep one." |
| DQ-04 | file | There is data | At least one non-blank data row | fail | Job `failed` | ≥ 1 row | `import_empty` | "Tệp không có dòng dữ liệu." / "The file has no data rows." |
| DQ-05 | file | The file is not too long | At most 5,000 non-blank data rows; the reader stops at 5,001 | fail | **400 `validation_failed`, rule `too_many_rows`; no job is stored** (*revised 2026-10-20, DR-149*; UC-13 E2 and DOC-42 §5.2 already said 400) | 5,000 rows | `import_too_many_rows` (log only) | "Tệp có hơn {max, number} dòng. Hãy chia nhỏ tệp." / "The file has more than {max, number} rows. Split it." |
| DQ-06 | file | Unknown columns are ignored | A header that matches no alias | warning | Column ignored; one issue per column, row 1 | — | `import_unknown_column` | "Cột “{column}” không được nhận diện nên bị bỏ qua." / "Column “{column}” is not recognised and is ignored." |
| DQ-10 | row | Unit code | Trimmed value matches `^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$` | error | Row rejected; stored upper-case | 1–20 characters | `unit_code_invalid` | "Mã căn hộ gồm 1–20 ký tự: chữ, số, dấu chấm, gạch ngang hoặc gạch chéo." / "Unit code must be 1–20 letters, digits, dots, hyphens or slashes." |
| DQ-11 | row | Floor | Blank, or a whole number from −5 to 150 | error | Row rejected | −5…150 | `floor_invalid` | "Tầng phải là số nguyên từ −5 đến 150." / "Floor must be a whole number from −5 to 150." |
| DQ-12 | row | Bedrooms | Blank, or a whole number from 0 to 20 | error | Row rejected | 0…20 | `bedrooms_invalid` | "Số phòng ngủ phải là số nguyên từ 0 đến 20." / "Bedrooms must be a whole number from 0 to 20." |
| DQ-13 | row | Area | Blank, or a number above 0 and at most 2,000 with at most 2 decimals; `.` or `,` as the decimal mark | error | Row rejected | (0, 2,000] m² | `area_invalid` | "Diện tích phải lớn hơn 0 và không quá {max, number} m², tối đa 2 chữ số thập phân." / "Area must be above 0 and at most {max, number} m², with at most 2 decimals." |
| DQ-14 | row | Occupancy | Blank, or one of `occupied`, `rented`, `vacant` (aliases below) | error | Row rejected | — | `occupancy_invalid` | "Tình trạng phải là: đang ở, cho thuê hoặc trống." / "Occupancy must be occupied, rented or vacant." |
| DQ-15 | row | Owner name is given with the owner | Any owner cell filled and `owner_name` blank | error | Row rejected | — | `owner_name_required` | "Cần có họ tên chủ hộ khi đã nhập thông tin chủ hộ." / "Owner name is required when other owner details are given." |
| DQ-16 | row | Owner phone is given with the owner | Any owner cell filled and `owner_phone` blank | error | Row rejected | — | `owner_phone_required` | "Cần có số điện thoại chủ hộ khi đã nhập thông tin chủ hộ." / "Owner phone is required when other owner details are given." |
| DQ-17 | row | Owner name | After trimming and collapsing spaces: 2–100 characters, at least one letter, no control character | error | Row rejected; stored collapsed | 2–100 | `owner_name_invalid` | "Họ tên chủ hộ phải có 2–100 ký tự và có chữ cái." / "Owner name must be 2–100 characters and contain a letter." |
| DQ-18 | row | Owner phone | `libphonenumber-js/max`, region `VN`, `isValid()`; normalised to E.164 | error | Row rejected | — | `phone_invalid` | "Số điện thoại không hợp lệ." / "This phone number is not valid." |
| DQ-19 | row | Owner phone can receive SMS | The number's type is `FIXED_LINE` | warning | Row accepted | — | `phone_not_mobile` | "Đây có vẻ là số máy bàn, có thể không nhận được tin nhắn đăng nhập." / "This looks like a landline; it may not receive the sign-in SMS." |
| DQ-20 | row | Owner email | Blank, or `^[^\s@]+@[^\s@]+\.[^\s@]+$`, at most 254 characters; stored lower-case | error | Row rejected | 254 | `email_invalid` | "Địa chỉ email không hợp lệ." / "This email address is not valid." |
| DQ-21 | row | Owner ID number | Blank, or 12 digits (CCCD) or 9 digits (CMND) once spaces are removed | error | Row rejected | 9 or 12 digits | `id_number_invalid` | "Số CCCD/CMND phải gồm 9 hoặc 12 chữ số." / "ID number must be 9 or 12 digits." |
| DQ-22 | row | A number cell lost its leading zeros | The cell is a number of 10 or 11 digits | warning | Padded with zeros to 12 digits; row accepted | 10–11 digits | `id_number_padded` | "Số CCCD bị mất số 0 ở đầu trong Excel; đã bổ sung cho đủ 12 chữ số. Hãy kiểm tra lại." / "The ID number lost its leading zeros in Excel; it was padded to 12 digits. Check it." |
| DQ-23 | row | Owner date of birth | Blank, or `DD/MM/YYYY`, `YYYY-MM-DD`, an Excel date cell or an Excel serial; a real calendar day from 1900-01-01 to building today | error | Row rejected | 1900-01-01…today | `dob_invalid` | "Ngày sinh phải theo dạng DD/MM/YYYY (hoặc ô ngày của Excel), từ năm 1900 đến hôm nay." / "Date of birth must be DD/MM/YYYY (or an Excel date) between 1900 and today." |
| DQ-30 | set | A unit appears once | The normalised unit code already appeared in an earlier row | error | The first row stands; later rows rejected | — | `unit_code_duplicate` | "Căn hộ {code} đã có ở dòng {firstRow}." / "Unit {code} already appears in row {firstRow}." |
| DQ-31 | set | One phone, one person | The same E.164 number appears in an earlier row with a different person (names differ after folding, §1.3) | error | The first row stands; later rows rejected | — | `phone_conflict` | "Số điện thoại này đã dùng cho người khác ở dòng {firstRow}." / "This phone number is used for another person in row {firstRow}." |
| DQ-40 | db | The unit exists | The code matches a unit of the building, case-insensitively | info | The row updates the unit | — | `unit_will_update` | "Căn hộ {code} đã có và sẽ được cập nhật." / "Unit {code} exists and will be updated." |
| DQ-41 | db | The unit is new | No match | info | The row creates the unit | — | `unit_will_create` | "Căn hộ {code} sẽ được tạo mới." / "Unit {code} will be created." |
| DQ-42 | db | The unit has another owner | The unit has an active owner whose account is not the row's | error | Row rejected | — | `owner_conflict` | "Căn hộ {code} đã có chủ hộ khác. Hãy dùng chức năng chuyển chủ hộ." / "Unit {code} already has another owner. Use ownership transfer." |
| DQ-43 | db | The owner is already a member | The row's account has a non-removed non-owner membership in the unit | error | Row rejected | — | `owner_is_member` | "Người này đã là thành viên của căn hộ {code}. Hãy đổi vai trò ở trang căn hộ." / "This person is already a member of unit {code}. Change their role on the unit page." |
| DQ-44 | db | The phone has an account | An account with the E.164 number exists | info | The owner membership links to it; the name in the file is not used | — | `account_linked` | "Số này đã có tài khoản; chủ hộ được liên kết với tài khoản đó và không dùng tên trong tệp." / "This phone already has an account; the owner is linked to it and the name in the file is not used." |
| DQ-45 | db | The phone has no account | No account | info | A resident account is created at commit | — | `account_will_be_created` | "Sẽ tạo tài khoản cư dân mới cho số này." / "A new resident account will be created for this phone." |
| DQ-46 | db | The stored profile differs | The building already has a profile of the account with a different non-empty value (name, email, date of birth; ID number by its last four digits) | warning | The stored value stays; the file's value is not applied | — | `profile_field_differs` | "{field} khác với hồ sơ đã lưu nên không được thay đổi." / "{field} differs from the stored profile and is not changed." |
| DQ-50 | commit | The data did not change under the preview | The file is read and checked again; the counts differ from the stored preview | fail | Nothing written; 409; the job stays `validated` | counts equal | `import_stale` | "Dữ liệu đã thay đổi từ lúc xem trước. Hãy tải tệp lên lại." / "The data changed since the preview. Upload the file again." |
| DQ-51 | commit | The preview is fresh | `expires_at` has passed | fail | Nothing written; 409 | 24 h | `import_expired` | "Bản xem trước đã hết hạn sau 24 giờ. Hãy tải tệp lên lại." / "This preview expired after 24 hours. Upload the file again." |
| DQ-52 | commit | The job can be committed | The job's status is not `validated` (it is `failed`) | fail | Nothing written; 409 | — | `import_not_ready` | "Tệp này có lỗi chặn việc nhập." / "This file has errors that block the import." |
| DQ-60 | post | The write matches the preview | Per touched unit at most one active owner; owner memberships and `unit_history` rows written equal the previewed counts | fail | Rollback; 500; alert | counts equal | `import_integrity` | "Việc nhập đã bị hủy bởi kiểm tra nội bộ. Chưa có gì được lưu." / "The import was rolled back by an internal check. Nothing was saved." |
| DQ-61 | post | The file does not outlive its job | The `file_object` is `deleted` in the commit transaction; for an expired job, within one hour of `expires_at` | — | `FilesApi.remove` at commit; the `import_expire` job at expiry | 1 h | — (no message) | — |

A repeated import of the same file is not a rule: the second commit finds the job `committed` and answers the first result (DOC-16 §5.5, IM-33).

**Occupancy values** (compared by the key of §1.1): `occupied` ← `occupied`, `đang ở`, `chủ ở`; `rented` ← `rented`, `cho thuê`; `vacant` ← `vacant`, `trống`, `bỏ trống`. Anything else, such as `empty` or `ở`, is `occupancy_invalid`.

**What a blank cell does.** A blank cell never erases a stored value. On an existing unit, blank floor, bedrooms, area or occupancy keep the stored value; on a new unit occupancy is `vacant` and the others are null. A row with no owner cell filled changes nothing about owners.

### 1.3 Results of the row rules

Each table is the output of the prototype on 2026-10-19, in the order of the rules above. `ok` shows the normalised value.

**DQ-10 unit code**

| Input | Result |
| --- | --- |
| `A-1508` | ok `A-1508` |
| ` a-1508 ` | ok `A-1508` |
| `B2.05` | ok `B2.05` |
| `A 1508` (space) | `unit_code_invalid` |
| ` ` (empty) | `unit_code_invalid` |
| `-A1` | `unit_code_invalid` |
| 21 characters | `unit_code_invalid` |

**DQ-11, DQ-12 floor and bedrooms**

| Input | Floor (−5…150) | Bedrooms (0…20) |
| --- | --- | --- |
| `15` | ok 15 | ok 15 |
| `-2` | ok −2 | `bedrooms_invalid` |
| `0` | ok 0 | ok 0 |
| `151` | `floor_invalid` | `bedrooms_invalid` |
| `21` | ok 21 | `bedrooms_invalid` |
| `3.5`, `abc` | `floor_invalid` | `bedrooms_invalid` |

**DQ-13 area**

| Input | Result |
| --- | --- |
| `72.5`, `72,5`, the number 72.5 | ok 72.5 |
| `2000` | ok 2000 |
| `2000.01` | `area_invalid` |
| `72.555` (3 decimals) | `area_invalid` |
| `0`, `abc` | `area_invalid` |
| `1,000.5` | `area_invalid` |

**DQ-14 occupancy**

| Input | Result |
| --- | --- |
| `occupied`, `Đang ở` | ok `occupied` |
| `CHO THUÊ` | ok `rented` |
| `trống`, `Bỏ trống` | ok `vacant` |
| `empty`, `ở` | `occupancy_invalid` |

**DQ-17 owner name and the "same person" test of DQ-31**

| Input | Result |
| --- | --- |
| `  Nguyễn   Văn An ` | ok `Nguyễn Văn An` |
| `A` (1 character), `12345` (no letter), `Trần Thị B` followed by a control character, 101 characters | `owner_name_invalid` |
| `Nguyễn Văn An` and `NGUYEN  VAN AN` | same person (keys equal after folding case, diacritics and spaces) |
| `Nguyễn Văn An` and `Nguyễn Văn Anh` | different people |

**DQ-18, DQ-19 phone** (region `VN`, `/max` metadata)

| Input | Result |
| --- | --- |
| `0901234567` | ok `+84901234567` |
| `+84 901 234 567`, `84901234567`, `(090) 123-4567` | ok `+84901234567` |
| the number 901234567 (Excel dropped the zero) | ok `+84901234567` |
| `02838251234` | ok `+842838251234`, warning `phone_not_mobile` |
| `+65 9123 4567` | ok `+6591234567` (any internationally valid number is allowed, DR-36) |
| `0123456789` | `phone_invalid` |
| `0901 234 56` (too short) | `phone_invalid` |
| `abc` | `phone_invalid` |

The default `libphonenumber-js` bundle (`min` metadata) accepted `0123456789` as `+84123456789`; the `max` metadata rejects it. The validator therefore imports `libphonenumber-js/max` (DR-114). This is a note for DOC-11 §3.

**DQ-20 email**

| Input | Result |
| --- | --- |
| `An.Nguyen@Example.COM` | ok `an.nguyen@example.com` |
| `an@`, `an nguyen@x.vn` | `email_invalid` |

**DQ-21, DQ-22 ID number**

| Input | Result |
| --- | --- |
| text `079085012345`, text `079 085 012 345` | ok `079085012345` |
| text `012345678` (9 digits, CMND) | ok `012345678` |
| number 79085012345 (11 digits; Excel dropped the zero) | ok `079085012345`, warning `id_number_padded` |
| number 1234567890 (10 digits) | ok `001234567890`, warning `id_number_padded` |
| `12345`, `AB1234567`, `B1234567` (a passport) | `id_number_invalid` |

**DQ-23 date of birth** (building today 2026-10-19)

| Input | Result |
| --- | --- |
| `03/04/1985`, `3/4/1985`, `1985-04-03`, an Excel date cell, the serial 31140 | ok `1985-04-03` |
| `31/02/1990` | `dob_invalid` (not a calendar day) |
| `04/03/2030` | `dob_invalid` (after today) |
| `01/01/1899` | `dob_invalid` |
| `1985/04/03` | `dob_invalid` |
| the serial 31140.5, 0, 99999 | `dob_invalid` |

### 1.4 The preview

The preview is the `result` of `residency.import_job` (DOC-16 §5.5) and is also what the response carries. It **never holds an ID number or a date of birth**: the commit reads the file again (the object is kept until commit or expiry, DR-22), and the rows listed in the preview show the ID number masked. This keeps national ID numbers out of an unencrypted `jsonb` column (DR-58).

```json
{
  "counts": {
    "rows": 7, "valid": 3, "errors": 4, "warnings": 0,
    "unitsToCreate": 1, "unitsToUpdate": 2,
    "accountsToCreate": 1, "accountsLinked": 2,
    "ownersToAdd": 2, "ownersUnchanged": 1
  },
  "validRows": [
    { "row": 2, "unitCode": "A-1508", "ownerName": "Nguyễn Văn An", "ownerPhone": "+84901234567", "ownerIdNumber": "•••• 2345",
      "notes": [{ "code": "unit_will_update" }, { "code": "account_linked" }] }
  ],
  "issues": [
    { "row": 4, "unitCode": "A-1510", "column": "owner_phone", "severity": "error", "code": "owner_conflict", "params": { "code": "A-1510" } },
    { "row": 8, "unitCode": "A-1508", "column": "unit_code", "severity": "error", "code": "unit_code_duplicate", "params": { "code": "A-1508", "firstRow": 2 } }
  ],
  "issuesTruncated": false
}
```

- `validRows` lists the first 50 valid rows; `issues` lists up to 500 entries, errors first, then warnings; `issuesTruncated` is true beyond that (DR-21). `counts` are always complete.
- The API adds a rendered `message` to each issue in the language of the request; the stored `jsonb` keeps `{code, params}` only (DR-22).
- A row with an `error` is counted in `errors` once, however many issues it has.
- *Revised 2026-10-20 (DR-213):* every issue carries `unitCode`, the normalized code of its row (`null` when the row has none), so `W-Import` can show a "Mã căn" column and build the error CSV in the browser. It is stored in the `jsonb` with `{code, params}`, not rendered.

### 1.5 The database layer: two set queries and one contract

The `db` rules need three lookups per file, each with the whole set of values at once (the 2,000-row file of NFR-12 makes three queries, not 2,000). `residency` may not read `identity` tables, so the accounts come through a contract (DOC-07 §5.2, DR-114). The codes are trimmed, lower-cased and de-duplicated in code first.

```sql
-- Q-U: the units of the file and their active owner
SELECT u.code, u.occupancy, m.account_id AS owner_account_id
  FROM residency.unit u
  LEFT JOIN residency.membership m
         ON m.building_id = u.building_id AND m.unit_id = u.id AND m.member_type = 'owner' AND m.status <> 'removed'
 WHERE u.building_id = :building_id AND lower(u.code) = ANY (:codes_lower);

-- Q-M: non-removed memberships of the file's accounts in the file's units (DQ-43)
SELECT m.unit_id, m.account_id, m.member_type, m.status
  FROM residency.membership m
 WHERE m.building_id = :building_id AND m.unit_id = ANY (:unit_ids) AND m.account_id = ANY (:account_ids) AND m.status <> 'removed';

-- Q-P: the building's profiles of those accounts (DQ-46); the ID number is compared by its last four digits, never decrypted
SELECT account_id, full_name, email, cccd_last4, date_of_birth
  FROM residency.resident_profile WHERE building_id = :building_id AND account_id = ANY (:account_ids);
```

```ts
// IdentityApi (new read contract, DR-114): ≤ 5,000 E.164 numbers; deleted accounts have phone 'deleted:<id>' and never match
findResidentAccountsByPhones(phones: string[]): Promise<{ phone: string; accountId: string; displayName: string | null; status: 'active' | 'deletion_requested' }[]>
```

```sql
-- what the identity module runs (served by resident_account_phone_key, DOC-16 §4.2)
SELECT phone, id, display_name, status FROM identity.resident_account WHERE phone = ANY (:phones);
```

**Classification** of each row that passed the row and set layers:

1. `unit` = the Q-U row for the lower-cased code. If it exists, DQ-40 (`unit_will_update`); otherwise DQ-41 (`unit_will_create`).
2. If no owner cell is filled, stop: the row changes the unit only.
3. `account` = the contract's answer for the E.164 number. If it exists, DQ-44 (`account_linked`); otherwise DQ-45 (`account_will_be_created`).
4. If the unit has an active owner: when it is `account`, the owner is unchanged (`ownersUnchanged`); otherwise DQ-42 (`owner_conflict`), the row is rejected.
5. Else, if `account` already has a non-removed membership in the unit (Q-M): DQ-43 (`owner_is_member`), the row is rejected.
6. Else the owner is added (`ownersToAdd`).
7. If `account` has a profile in this building (Q-P): for each of name, email, date of birth and ID number whose file value is non-empty and differs from the stored one, DQ-46 (`profile_field_differs`) with `field` set to the column name; names compare by the folded key of §1.3, emails in lower case, the ID number by its last four digits.

Results on PostgreSQL 18.6 for the sample building of §1.6 (five codes, `a-1509` lower-case in the query):

| Query | Rows |
| --- | --- |
| Q-U | `A-1508` (occupied, owner account 1), `A-1509` (vacant, no owner), `A-1510` (occupied, owner account 3), `A-1512` (occupied, no owner); `A-1511` is absent, so it is new |
| Q-M (units `A-1508`, `A-1512`; accounts 1 and 4) | account 1 is `owner` of `A-1508`; account 4 is `family` of `A-1512` |
| Q-P (account 1) | `Nguyễn Văn An`, `an@example.com`, last four `2345`, `1985-04-03` |
| `findResidentAccountsByPhones` for `+84901234567`, `+84912345678`, `+84999999999` | two accounts; the third number has none |

Plans with `enable_seqscan = off`: Q-U uses `unit_code_prefix_idx` (`lower(code)` with `text_pattern_ops` serves `= ANY`), and the phone lookup uses `resident_account_phone_key`. The post-condition query of DQ-60 (units with more than one active owner) returned no rows.

### 1.6 The commit

`POST /staff/imports/{id}/commit` is one transaction (DR-21, DOC-27 holds the flow; this is what the rules require of it):

1. `UPDATE residency.import_job … WHERE id = :id AND status = 'validated' AND expires_at > now()` (DOC-16 §5.5). Zero rows: DQ-51, DQ-52 or the answer of the earlier commit.
2. Read the file again and run the file, row, set and db layers on it (DQ-01…DQ-46). If `counts` differ from the stored preview: DQ-50, roll back.
3. Upsert the units of the valid rows: non-blank cells overwrite, blank cells keep (§1.2).
4. Ask identity for the accounts of the new phones through the creating contract (`IdentityApi.findOrCreateResidentAccount`, DOC-26 §2.2, called once per new phone because there is no batch form; it runs in this transaction) and use the existing ones for linked phones.
5. For each owner row: insert or fill the building's `resident_profile` (empty fields only; the ID number encrypted with the PII key, `cccd_last4` set), insert the owner membership (`added_by_kind = 'staff'`), and write a `unit_history` row of kind `owner_changed` with `details {"from": null, "to": "<account>", "source": "import"}`.
6. One audit row `residency.import.commit` with the counts in `details` (DOC-17 §2), and `FilesApi.remove` on the file.
7. Run DQ-60; on a difference roll back and answer 500.

Rows with an `error` are skipped. A second press of "Save" finds the job `committed` and returns the first result with no new write.

**Sample file and its outcome.** The sample building has units `A-1508` (owner An), `A-1509` (no owner), `A-1510` (owner Cường), `A-1512` (Dung is a family member), and a resident account for Bình who is a member of nothing:

| Row | Unit | Owner name | Phone | Outcome |
| --- | --- | --- | --- | --- |
| 2 | `A-1508` | Nguyễn Văn An | `0901234567` | valid: `unit_will_update`, `account_linked`; owner unchanged |
| 3 | `A-1509` | Trần Thị Bình | `0912345678` | valid: `unit_will_update`, `account_linked`; owner added |
| 4 | `A-1510` | Phạm Thị Dung | `0934567890` | error `owner_conflict` (the owner is Lê Văn Cường) |
| 5 | `A-1511` | Võ Thị Hà | `0956789012` | valid: `unit_will_create`, `account_will_be_created`; owner added |
| 6 | `A-1512` | Phạm Thị Dung | `0934567890` | error `owner_is_member` (Dung is family of `A-1512`); the same name on row 4 is the same person, so no `phone_conflict` |
| 7 | `A-1513` | Ngô Văn Khoa | `0901234567` | error `phone_conflict` (row 2 has this number for another name) |
| 8 | `a-1508` | | | error `unit_code_duplicate` (row 2) |

Counts: 7 rows, 3 valid, 4 errors, 1 unit to create, 2 to update, 1 account to create, 2 linked, 2 owners to add, 1 unchanged. This file, plus one file with at least one row for each code of §1.2, is the P1 fixture (DR-22).

## 2. Fee import (P2)

Not written; P1-27 (DR-22, DOC-21, DOC-15). The rules continue the numbering of this catalog after the last rule of section 1; the layers, severities and error shape above apply.

## 3. Statement import (P3)

Not written; P2-20 (DR-34, DOC-25). The rules continue the numbering after §2.

## 4. Required tests (units and owners)

The prefix `IM-` is shared with DOC-21 and DOC-27 (master plan §0.2). This document owns the numbers up to 49 for the units and owners import (41 are defined); the tests of the fee-batch import start at 50. Every test runs against the validator and, where it says so, the database layer and the commit.

| ID | Scenario | Expected |
| --- | --- | --- |
| IM-01 | A `.xls` file, a CSV renamed `.xlsx` | `import_file_type`, job `failed` |
| IM-02 | Row 1 without any unit-code alias | `import_no_header`, job `failed` |
| IM-03 | Headers `Mã căn hộ` and `Unit code` in one file | `import_duplicate_column` |
| IM-04 | A header and blank rows only | `import_empty` |
| IM-05 | 5,001 data rows; 5,000 data rows | 400 `too_many_rows` and no job stored (*revised 2026-10-20, DR-149*); 5,000 validated |
| IM-06 | Extra column `Ghi chú` | one warning `import_unknown_column`; the rows validated |
| IM-07 | Unit codes of §1.3 | the table of DQ-10 |
| IM-08 | Floors and bedrooms of §1.3 | the table of DQ-11, DQ-12 |
| IM-09 | Areas of §1.3 | the table of DQ-13 |
| IM-10 | Occupancy values of §1.3; a blank occupancy on an existing unit | the table of DQ-14; the stored value is kept |
| IM-11 | A row with only an email in the owner cells | `owner_name_required` and `owner_phone_required` |
| IM-12 | Owner names of §1.3 | the table of DQ-17 |
| IM-13 | Phones of §1.3 | the table of DQ-18, DQ-19 |
| IM-14 | `0123456789` with `/min` and with `/max` metadata (regression test for DR-114) | accepted by `min`, `phone_invalid` with `max`; the validator uses `max` |
| IM-15 | Emails of §1.3 | the table of DQ-20 |
| IM-16 | ID numbers of §1.3, text and number cells | the table of DQ-21, DQ-22 |
| IM-17 | Dates of birth of §1.3 as text, as a `Date` and as a serial | the table of DQ-23, the same result for the three kinds of cell |
| IM-18 | A date cell read with and without `styles: 'cache'` | a serial without it, a `Date` with it; both give `1985-04-03` |
| IM-19 | Two rows with `A-1508` and `a-1508` | the second is `unit_code_duplicate` with `firstRow` 2 |
| IM-20 | The same phone on two rows with different names | the later row is `phone_conflict` |
| IM-21 | The same phone and the same name (case and diacritics differ) on two units | both rows valid; one account created |
| IM-22 | A unit that exists; a unit that does not | `unit_will_update`; `unit_will_create` |
| IM-23 | A unit whose owner has another phone | `owner_conflict` |
| IM-24 | A unit whose owner has the same phone | no membership change; `ownersUnchanged` 1 |
| IM-25 | The row's account is already a family member of the unit | `owner_is_member` |
| IM-26 | A phone with an account; a phone without | `account_linked`, the account's name is not changed; `account_will_be_created` |
| IM-27 | A profile with another name and another last four digits | two warnings `profile_field_differs`; the stored values stay after the commit |
| IM-28 | A profile with an empty email and a row with an email | the commit fills the email |
| IM-29 | The sample file of §1.6 | the counts and the row outcomes of the table |
| IM-30 | A file of 2,000 rows with 40 errors, from upload to the preview | the preview within 10 s (NFR-12); 40 issues, each with the `unitCode` of its row (`null` for a row without a code, DR-213); 1,960 valid rows |
| IM-31 | A file with 600 wrong rows | 500 issues, `issuesTruncated` true, `errors` 600 |
| IM-32 | The preview of a file with ID numbers and birth dates | `result` contains neither; the ID number is masked |
| IM-33 | "Save" pressed twice | one commit; the second answer equals the first |
| IM-34 | An owner is transferred between the preview and the commit | `import_stale`, nothing written, the job stays `validated` |
| IM-35 | The commit after `expires_at` | `import_expired`, nothing written |
| IM-36 | The commit of a `failed` job | `import_not_ready` |
| IM-37 | A commit where the write would leave two owners (forced in a test) | rollback, `import_integrity`, an alert |
| IM-38 | The commit of the sample file | 3 units written, 2 owner memberships and 2 `unit_history` rows of kind `owner_changed`, 1 audit row with counts, the profiles filled |
| IM-39 | The file after the commit; the file of an expired job one hour after `expires_at` | the `file_object` is `deleted`; the `import_expire` job has removed the expired one |
| IM-40 | An existing unit with blank floor, bedrooms, area and occupancy cells | the stored values are unchanged |
| IM-41 | A manager without the right role calls the endpoints | 403 (DOC-39) |
| IM-42 | `GET /staff/imports` (E-169) with 3 jobs created at different times, one `validated` past its `expires_at`, and a `limit` of 2 | newest first; the first page has 2 rows and a `nextCursor`, the second has 1 and `nextCursor` null; the stale `validated` job reads `expired`; `status=expired` finds it and `status=validated` does not; each row has `counts`, `createdBy.name` and no preview rows (DR-226) |
| IM-43 | The same call as a Technician and as a Guard; as a Manager of building B when building A has jobs | 403 `forbidden`; building B sees none of building A's jobs (DOC-39) |

## 5. Decisions made while writing

Every new decision here is a DR, decided by Claude under the Owner's delegation, and applied in the text above (the register has it in full).

| ID | Decision | Where used |
| --- | --- | --- |
| DR-114 | Units and owners import: unit codes are upper-case and matched case-insensitively; a blank cell never erases; owner cells are all-or-name-and-phone; phones use the `/max` metadata; ID numbers are 9 or 12 digits and short numeric cells are padded with a warning; "same person" is the same phone and folded name; an existing profile is only filled where empty; the commit reads the file again, re-validates and refuses with `import_stale` when the counts changed; the preview holds no ID number or date of birth; a new read contract `IdentityApi.findResidentAccountsByPhones`; an hourly `import_expire` job removes the file of an expired job | §1 |

## 6. Not in this document

| Topic | Lives in |
| --- | --- |
| The import job table, states and the conditional commit | DOC-16 §5.5, DR-21 |
| The import flow, the account-creating contract, transfers and phone changes | DOC-27 |
| Upload, verification and removal of files | DOC-37, DOC-17 §3.1 |
| Fee-batch rules and the fee template | DOC-21, DOC-18 §2 |
| Statement import and matching | DOC-25, DOC-18 §3 |
| The error shape, status codes, ICU catalog files | DOC-50, DOC-42, DOC-68 |
| The `import_expire` and `import_purge` jobs | DOC-38 |
| Permissions of the import endpoints | DOC-39, DOC-51 |

## 7. Traceability

| Rule here | Decision | Requirements and checks |
| --- | --- | --- |
| DQ-01…06 file | DR-21, DR-22, DR-61 | NFR-12; IM-01…06 |
| DQ-10…23 row | DR-22, DR-36, DR-41, DR-58, DR-114 | FR-18.1; IM-07…18 |
| DQ-30, DQ-31 set | DR-22, DR-114 | FR-18.1; IM-19…21 |
| DQ-40…46 db | DR-40, DR-114 | FR-18.1; IM-22…29 |
| DQ-50…52 commit | DR-21, DR-74, DR-114 | FR-18.1; IM-33…36 |
| DQ-60, DQ-61 post | DR-22, DR-114 | FR-18.2; IM-37…39 |
| §1.4 preview | DR-21, DR-22, DR-58 | NFR-14; IM-30…32 |

## Open questions

None for section 1. The decision made while writing (DR-114) is decided and does not block Phase 1. Sections 2 and 3 raise their own questions when they are written.
